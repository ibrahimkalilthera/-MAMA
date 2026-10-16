/**
 * Suite pour scripts/lib/reserved-tabs.mjs + sa porte
 * (scripts/check-reserved-tabs.mjs).
 *
 * La règle qu'elle verrouille : un onglet réservé se garde à UN seul endroit. Le
 * 2026-10-15, le rail et le filet du shell décidaient chacun de leur côté, la
 * base a ouvert la lecture de l'historique des paiements à l'économe, le rail a
 * suivi et le filet non : la ligne s'affichait, l'onglet revenait au tableau de
 * bord, et aucune suite verte ne le disait.
 *
 * Elle juge donc le contrôle sur les TROIS formes du défaut — la ligne écrite à
 * la main, l'alias local qui garde un bloc d'onglet, la liste d'onglets — et
 * autant de formes LÉGITIMES : une déclaration de type qui énumère tout le
 * vocabulaire, un alias de rôle qui n'est pas une garde d'onglet, et l'appel de
 * la source unique, y compris quand il est accompagné d'une condition ajoutée
 * (là, le contrôle doit encore mordre : une table demandée n'est pas un blanc-seing).
 * Un contrôle qui mordrait sur du code légitime apprendrait à être contourné.
 *
 * Les refus de vacuité sont exécutés POUR DE VRAI, sur des arborescences de
 * fixtures : table vide, vocabulaire illisible, aucun appelant de la table —
 * trois sorties 2, jamais un ✅ sur un corpus que le lecteur n'atteint plus. Et
 * l'allowlist se paie : elle acquitte un manquement nommé, et une entrée périmée
 * fait échouer le contrôle.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY } from '../scripts/lib/guard-immunity.mjs';
import {
  gateAliasHits,
  readReservedTabEntries,
  readRightsImports,
  readTabVocabulary,
  reservedTabHits,
} from '../scripts/lib/reserved-tabs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESERVED = ['audit', 'paymentHistory', 'settings'];

/** Le vocabulaire des onglets, lu sur le fichier RÉEL : c'est lui qui distingue liste et type. */
const VOCABULARY = readTabVocabulary(readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8'));
const VOCABULARY_ENV = { reservedTabs: RESERVED, vocabulary: VOCABULARY };

/** Le contrôle, lancé pour de vrai, avec son code de sortie et sa sortie complète. */
function runCheck(env: Record<string, string> = {}): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['scripts/check-reserved-tabs.mjs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { status: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: Number(failure.status ?? -1), out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** Une arborescence de fixtures : `chemin relatif → contenu`. */
function fixtureTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mama-reserved-tabs-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** La table minimale d'une fixture : un onglet réservé, sa liste importée. */
const TABLE = [
  "import { ADMIN_ROLES } from '../lib/deleteRights';",
  "export type ReservedTab = 'audit';",
  'export const RESERVED_TABS = [',
  "  { tab: 'audit', roles: ADMIN_ROLES },",
  '];',
  '',
].join('\n');

/** Le vocabulaire minimal, dans l'union `AppTab` que le contrôle lit. */
const VOCAB_TREE = "export type AppTab = 'dashboard' | 'audit';\n";

/** Les deux navigations, chacune demandant la table : le cas « tout est propre ». */
const CLEAN_TREE = {
  'src/app/tabRights.ts': TABLE,
  'src/lib/deleteRights.ts': "export const ADMIN_ROLES = ['admin', 'dev'] as const;\n",
  'src/components/Sidebar.tsx': `${VOCAB_TREE}{canOpenTab('audit', currentUser?.role) && <button />}\n`,
  'src/components/MobileNav.tsx': "{canOpenTab('audit', currentUser?.role) && <button />}\n",
  'src/app/useAuthWelcome.ts': "if (isReservedTab(activeTab) && !canOpenTab(activeTab, role)) setActiveTab('dashboard');\n",
};

describe('reserved-tabs — une seule source de droit par onglet réservé', () => {
  it('le corpus réel est propre : une table, et des gardes qui la demandent', () => {
    const { status, out } = runCheck();
    assert.equal(status, 0, out);
    assert.match(out, /✅ 3 onglet\(s\) réservé\(s\)/);
    assert.match(out, /garde\(s\) qui la demandent/);
  });

  it('la table réelle est LUE : ses onglets, et des listes importées d’un module de droits', () => {
    const text = readFileSync(join(root, 'src/app/tabRights.ts'), 'utf8');
    const { entries, problems } = readReservedTabEntries({ text });
    assert.deepEqual(problems, [], 'aucune entrée en clair dans la table');
    assert.deepEqual(entries.map((entry) => entry.tab), RESERVED);

    // Les listes ne sont pas écrites ici : elles viennent d'un `src/lib/*Rights.ts`,
    // là où les tests les comparent à la migration.
    const imported = readRightsImports(text);
    for (const entry of entries) {
      assert.ok(imported.has(entry.roles), `${entry.roles} est importé d'un module de droits`);
    }
  });

  it('le vocabulaire des onglets est lu sur l’union `AppTab` — les trois réservés y sont', () => {
    assert.ok(VOCABULARY.length >= 10, `le vocabulaire lu : ${VOCABULARY.join(', ')}`);
    for (const tab of RESERVED) assert.ok(VOCABULARY.includes(tab), `${tab} est un onglet du vocabulaire`);
    assert.ok(VOCABULARY.includes('dashboard'), 'et un onglet NON réservé y est aussi');
  });

  it('MORD sur la ligne qui a coûté le défaut — le filet du shell et sa liste écrite à la main', () => {
    const old = "    if (!auth.isAdmin && (activeTab === 'settings' || activeTab === 'audit')) {";
    const rules = new Set(reservedTabHits(old, VOCABULARY_ENV).map((hit) => hit.rule));
    assert.ok(rules.has('tab-role-literal'), 'le couple « onglet réservé + rôle à la main » est nommé');
    assert.ok(rules.has('tab-list'), 'et la liste de deux onglets réservés aussi');
  });

  it('MORD sur un onglet gardé par un appel de droit posé hors de la table', () => {
    const line = "{activeTab === 'paymentHistory' && canViewPaymentHistory(currentUser?.role) && (";
    const rules = reservedTabHits(line, VOCABULARY_ENV).map((hit) => hit.rule);
    assert.deepEqual(rules, ['tab-gate-call']);
  });

  it('MORD sur l’alias local qui garde un bloc où un onglet réservé est posé', () => {
    // La forme exacte du rail : l'alias dit le rôle, le bloc pose l'onglet.
    const old = [
      "  const isAdminDev = currentUser?.role === 'admin' || currentUser?.role === 'dev';",
      '  return (',
      '    <nav>',
      '      {isAdminDev && (',
      "        <button onClick={() => setActiveTab('audit')} />",
      '      )}',
      '    </nav>',
      '  );',
    ].join('\n');
    const hits = gateAliasHits({ text: old, reservedTabs: RESERVED });
    assert.equal(hits.length, 1, 'l’alias fautif est accusé une fois');
    assert.match(hits[0].token, /isAdminDev/);
    assert.equal(hits[0].line, 1, 'la déclaration est nommée');
    assert.equal(hits[0].useLine, 4, 'et la garde qui l’emploie aussi');
  });

  it('MORD sur une liste d’onglets réservés — mais pas sur une déclaration de type', () => {
    const list = "const HIDDEN = ['settings', 'audit'];";
    assert.deepEqual(reservedTabHits(list, VOCABULARY_ENV).map((hit) => hit.rule), ['tab-list']);

    // Une déclaration qui énumère TOUT le vocabulaire n'est pas une liste réservée :
    // c'est la forme de l'union `AppTab` et des props de vues.
    const union =
      "  activeTab: 'dashboard' | 'students' | 'parents' | 'settings' | 'calendar' | 'audit' | 'paymentHistory';";
    assert.deepEqual(reservedTabHits(union, VOCABULARY_ENV), []);
  });

  it('acquitte la source unique DEMANDÉE — et mord encore sur ce qu’on ajoute à côté', () => {
    const asked = "{canOpenTab('audit', currentUser?.role) && (";
    assert.deepEqual(reservedTabHits(asked, VOCABULARY_ENV), [], 'demander la table est le geste voulu');

    const askedPlus = "{canOpenTab('audit', role) && role === 'admin' && (";
    const rules = reservedTabHits(askedPlus, VOCABULARY_ENV).map((hit) => hit.rule);
    assert.deepEqual(rules, ['tab-role-literal'], 'demander la table ne blanchit pas une condition ajoutée');
  });

  it('acquitte un alias de RÔLE qui n’est pas une garde d’onglet', () => {
    const other = ["  const isPromoter = auth.isAdmin;", '  return { auth, isPromoter };'].join('\n');
    assert.deepEqual(gateAliasHits({ text: other, reservedTabs: RESERVED }), []);
  });

  it('refuse une table SANS onglet réservé — sortie 2', () => {
    const dir = fixtureTree({ 'src/app/tabRights.ts': 'export const RESERVED_TABS = [];\n', 'src/components/Sidebar.tsx': VOCAB_TREE });
    try {
      const { status, out } = runCheck({ CHECK_RESERVED_TABS_ROOT: join(dir, 'src') });
      assert.equal(status, 2, out);
      assert.match(out, /aucun onglet réservé/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un vocabulaire d’onglets illisible — sortie 2', () => {
    const dir = fixtureTree({ 'src/app/tabRights.ts': TABLE, 'src/components/Sidebar.tsx': 'export const nothing = 1;\n' });
    try {
      const { status, out } = runCheck({ CHECK_RESERVED_TABS_ROOT: join(dir, 'src') });
      assert.equal(status, 2, out);
      assert.match(out, /aucun onglet lu dans l’union/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un scan qui ne lit AUCUN appelant de la table — sortie 2, jamais un ✅', () => {
    const dir = fixtureTree({
      'src/app/tabRights.ts': TABLE,
      'src/components/Sidebar.tsx': VOCAB_TREE,
      'src/app/useAuthWelcome.ts': 'export const nothing = 1;\n',
    });
    try {
      const { status, out } = runCheck({ CHECK_RESERVED_TABS_ROOT: join(dir, 'src') });
      assert.equal(status, 2, out);
      assert.match(out, /aucun appel à `canOpenTab`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un onglet gardé par une seule navigation, et l’acquitte quand les deux le gardent', () => {
    const half = {
      'src/app/tabRights.ts': TABLE,
      'src/components/Sidebar.tsx': `${VOCAB_TREE}{canOpenTab('audit', currentUser?.role) && <button />}\n`,
      'src/components/MobileNav.tsx': 'export const nothing = 1;\n',
    };
    const dir = fixtureTree(half);
    try {
      const { status, out } = runCheck({ CHECK_RESERVED_TABS_ROOT: join(dir, 'src') });
      assert.equal(status, 1, out);
      assert.match(out, /un onglet réservé que les deux navigations ne gardent pas/);
      assert.match(out, /audit est gardé par 1 fichier/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const both = fixtureTree(CLEAN_TREE);
    try {
      assert.equal(runCheck({ CHECK_RESERVED_TABS_ROOT: join(both, 'src') }).status, 0, 'les deux navigations suffisent');
    } finally {
      rmSync(both, { recursive: true, force: true });
    }
  });

  it('une exception motivée acquitte UN manquement nommé — et une entrée périmée fait échouer', () => {
    const dir = fixtureTree({
      ...CLEAN_TREE,
      // Le manquement : une seconde décision, écrite à la main.
      'src/components/Sidebar.tsx': `${VOCAB_TREE}if (!auth.isAdmin && activeTab === 'audit') setActiveTab('dashboard');\n{canOpenTab('audit', currentUser?.role) && <button />}\n`,
    });
    const allowlist = join(dir, 'allow.json');
    try {
      // Sans allowlist : refusé, en nommant la règle.
      const refused = runCheck({ CHECK_RESERVED_TABS_ROOT: join(dir, 'src') });
      assert.equal(refused.status, 1, refused.out);
      assert.match(refused.out, /un onglet réservé gardé par un rôle écrit à la main/);

      // Avec l'exception au bon grain (fichier, règle), et sa raison : acquitté.
      writeFileSync(
        allowlist,
        JSON.stringify([
          { file: 'src/components/Sidebar.tsx', rule: 'tab-role-literal', reason: 'fixture : manquement nommé, acquitté' },
        ]),
      );
      const acquitted = runCheck({
        CHECK_RESERVED_TABS_ROOT: join(dir, 'src'),
        CHECK_RESERVED_TABS_ALLOWLIST: allowlist,
      });
      assert.equal(acquitted.status, 0, acquitted.out);
      assert.match(acquitted.out, /1 exception\(s\) motivée\(s\)/);

      // Une entrée qui n'accuse plus rien est PÉRIMÉE : elle se retire dans le commit.
      writeFileSync(
        allowlist,
        JSON.stringify([
          { file: 'src/components/Sidebar.tsx', rule: 'tab-list', reason: 'fixture : entrée périmée' },
        ]),
      );
      const stale = runCheck({
        CHECK_RESERVED_TABS_ROOT: join(dir, 'src'),
        CHECK_RESERVED_TABS_ALLOWLIST: allowlist,
      });
      assert.equal(stale.status, 1, stale.out);
      assert.match(stale.out, /PÉRIMÉE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une allowlist injectée illisible est un refus, pas un silence', () => {
    const dir = fixtureTree(CLEAN_TREE);
    try {
      const { status, out } = runCheck({
        CHECK_RESERVED_TABS_ROOT: join(dir, 'src'),
        CHECK_RESERVED_TABS_ALLOWLIST: join(dir, 'absente.json'),
      });
      assert.equal(status, 2, out);
      assert.match(out, /Allowlist injectée introuvable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le contrôle est déclaré dans l’inventaire et câblé dans le script npm ET la chaîne qualité', () => {
    assert.ok(
      GUARD_INVENTORY.some((entry) => entry.check === 'check-reserved-tabs.mjs'),
      'l’inventaire des immunités porte son entrée',
    );
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:reserved-tabs'], /check-reserved-tabs\.mjs/);
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-reserved-tabs\.mjs/);
  });
});
