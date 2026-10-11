// Tests de scripts/lib/rls-coverage.mjs (et de la commande qui s'en sert,
// `npm run check:public-rls`, par sa FORME).
//
// WHY THIS EXISTS
// ---------------
// Le 2026-10-11, la clé PUBLIQUE du site rendait les 14 lignes de
// `public.students_dupe_backup_20261005` : noms d'élèves, téléphones de parents,
// notes médicales. Un `create table … as select` n'active pas RLS et Supabase
// ouvre `select` à `anon` par défaut. Les gardes existantes (`verify-anon-rls`,
// veille `prod-anon-rls`) sondent une LISTE DE TABLES DÉCLARÉES : une table que
// personne n'a déclarée leur est invisible.
//
// Ces cas protègent ce qui se trompe SANS base — donc sans qu'on s'en aperçoive :
// une énumération qui ne lit qu'`information_schema.tables` (donc qui ignore les
// vues matérialisées et les tables étrangères, exactement le silence que ce
// contrôle existe pour supprimer), un refus qui oublie de NOMMER la table
// ouverte, une énumération vide comptée comme un vert, une table scellée (RLS
// sans aucune politique) refusée à tort, une exemption muette ou périmée qui
// autorise un retour en arrière silencieux, et une commande qui ACTIVERAIT RLS
// elle-même — effaçant la preuve de ce qu'elle a trouvé.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVIDENCE_STEP_NAME, parseWorkflowFile } from '../scripts/lib/automation-evidence.mjs';
import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';
import { JUDGED_KINDS, PUBLIC_RELATIONS_SQL, UNJUDGED_REASONS, judgePublicRls } from '../scripts/lib/rls-coverage.mjs';
import { maskComments } from '../scripts/lib/source-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

/** L'état MESURÉ le 2026-10-11 après suppression de l'artefact : 15 tables, RLS partout. */
const MEASURED = [
  'academic_years',
  'app_settings',
  'audit_logs',
  'calendar_notes',
  'custom_classes',
  'expenses',
  'parents',
  'payments',
  'salary_payments',
  'staff',
  'student_matricule_counters',
  'students',
  'todos',
  'user_profiles',
  'vendor_expenses',
].map((name) => ({
  name,
  kind: 'r',
  rls: true,
  policies: name === 'student_matricule_counters' ? 0 : 5,
  owner: 'postgres',
}));

describe('rls-coverage — le trou mesuré : une table de public sans RLS est REFUSÉE et NOMMÉE', () => {
  it('la table d’artefact du dédoublonnage (create table … as select) est nommée', () => {
    const report = judgePublicRls({
      relations: [
        ...MEASURED,
        { name: 'students_dupe_backup_20261005', kind: 'r', rls: false, policies: 0, owner: 'postgres' },
      ],
    });
    assert.equal(report.ok, false, 'une table ouverte rend le verdict rouge');
    assert.deepEqual(
      report.unguarded.map((row) => row.name),
      ['students_dupe_backup_20261005'],
      'le rapport NOMME la table — une accusation sans nom n’est pas réparable',
    );
    assert.equal(report.unguarded[0]?.label, 'table');
    assert.equal(report.scanned, 16);
    assert.equal(report.judged, 16);
  });

  it('l’état mesuré du jour est VERT : les 15 tables de public portent RLS', () => {
    const report = judgePublicRls({ relations: MEASURED });
    assert.equal(report.scanned, 15);
    assert.deepEqual(report.unguarded, []);
    assert.deepEqual(report.problems, []);
    assert.equal(report.ok, true);
    assert.equal(report.guarded.length, 14);
    assert.equal(report.totalPolicies, 14 * 5);
  });

  it('une énumération VIDE n’est pas un vert : c’est un regard qui n’a rien atteint', () => {
    const report = judgePublicRls({ relations: [] });
    assert.equal(report.scanned, 0);
    assert.equal(report.vacuous, true, 'la commande s’en sert pour sortir en 2, jamais en 0');
    assert.equal(report.ok, false, 'zéro relation lue ne peut pas être un état sain');
  });
});

describe('rls-coverage — scellée et non jugée : ce qui n’est pas un refus se DIT quand même', () => {
  it('RLS activée sans aucune politique est dite « scellée », pas refusée (cas mesuré : student_matricule_counters)', () => {
    const report = judgePublicRls({ relations: MEASURED });
    assert.deepEqual(
      report.sealed.map((row) => row.name),
      ['student_matricule_counters'],
      'une table scellée est sûre mais doit se savoir — la refuser ferait rougir un état sain',
    );
    assert.equal(report.ok, true);
  });

  it('vues, vues matérialisées et tables étrangères sont NOMMÉES avec leur raison, jamais avalées', () => {
    const report = judgePublicRls({
      relations: [
        ...MEASURED,
        { name: 'v_students', kind: 'v', rls: false, policies: 0, owner: 'postgres' },
        { name: 'mv_totals', kind: 'm', rls: false, policies: 0, owner: 'postgres' },
        { name: 'f_remote', kind: 'f', rls: false, policies: 0, owner: 'postgres' },
      ],
    });
    assert.deepEqual(report.unguarded, [], 'RLS ne s’applique pas à ces relations : les refuser serait un faux rouge');
    assert.deepEqual(
      report.unjudged.map((row) => row.name),
      ['f_remote', 'mv_totals', 'v_students'],
      'une relation non jugée apparaît quand même dans le rapport',
    );
    for (const row of report.unjudged) {
      assert.ok(row.reason.length > 20, `${row.name} porte une raison lisible`);
      assert.equal(UNJUDGED_REASONS[row.kind as 'v' | 'm' | 'f'], row.reason);
    }
    assert.match(UNJUDGED_REASONS.m, /recopie ses lignes/i, 'une matview recopie : la RLS de sa source ne la couvre plus');
    assert.match(UNJUDGED_REASONS.v, /security_invoker/i, 'une vue sans security_invoker lit avec les droits de son propriétaire');
    assert.equal(report.scanned, 18);
    assert.equal(report.judged, 15, 'les trois relations non jugées ne comptent pas comme jugées');
  });
});

describe('rls-coverage — les exemptions sont bornées DANS LES DEUX SENS', () => {
  const open = { name: 'tooling_scratch', kind: 'r', rls: false, policies: 0, owner: 'postgres' };

  it('une exemption motivée retire la table du refus, mais reste RAPPORTÉE', () => {
    const report = judgePublicRls({
      relations: [...MEASURED, open],
      exemptions: [{ name: 'tooling_scratch', reason: 'table d’outillage hors du client, sans donnée d’école' }],
    });
    assert.deepEqual(report.unguarded, []);
    assert.equal(report.exempted.length, 1);
    assert.equal(report.exempted[0]?.name, 'tooling_scratch');
    assert.equal(report.ok, true);
    assert.equal(report.judged, 16);
  });

  it('une exemption MUETTE est un trou', () => {
    const report = judgePublicRls({ relations: [...MEASURED, open], exemptions: [{ name: 'tooling_scratch' }] });
    assert.equal(report.ok, false);
    assert.match(report.problems.join(' '), /sans raison/);
    assert.equal(report.unguarded.length, 1, 'sans raison recevable, le refus tient');
  });

  it('une exemption PÉRIMÉE échoue aussi : table absente, ou table qui porte désormais RLS', () => {
    const absent = judgePublicRls({
      relations: MEASURED,
      exemptions: [{ name: 'table_disparue', reason: 'elle existait hier' }],
    });
    assert.equal(absent.ok, false);
    assert.match(absent.problems.join(' '), /n’existe pas dans public/);

    const guardedNow = judgePublicRls({
      relations: MEASURED,
      exemptions: [{ name: 'students', reason: 'exemptée du temps où elle n’avait pas RLS' }],
    });
    assert.equal(guardedNow.ok, false);
    assert.match(guardedNow.problems.join(' '), /alors qu’elle porte RLS/);
  });
});

describe('rls-coverage — la requête ne peut pas manquer les cas muets', () => {
  it('elle lit l’état RLS dans pg_class, pour le schéma public', () => {
    assert.match(PUBLIC_RELATIONS_SQL, /relrowsecurity/);
    assert.match(PUBLIC_RELATIONS_SQL, /pg_class/);
    assert.match(PUBLIC_RELATIONS_SQL, /n\.nspname = 'public'/);
    assert.match(PUBLIC_RELATIONS_SQL, /order by c\.relname/i, 'deux exécutions du même état rendent le même ordre');
  });

  it('elle énumère AUSSI ce qui n’a pas de ligne dans information_schema.tables', () => {
    assert.match(
      PUBLIC_RELATIONS_SQL,
      /relkind in \('r', 'p', 'v', 'm', 'f'\)/,
      'sans m et f, une vue matérialisée ou une table étrangère n’apparaîtrait NULLE PART — le silence même que ce contrôle supprime',
    );
    assert.deepEqual(JUDGED_KINDS, ['r', 'p'], 'les partitions restent jugées : chacune a son propre relrowsecurity');
  });

  it('elle compte les politiques, donc distingue une table gardée d’une table scellée', () => {
    assert.match(PUBLIC_RELATIONS_SQL, /pg_policies/);
    assert.match(PUBLIC_RELATIONS_SQL, /as policies/);
  });

  it('elle est en LECTURE SEULE : aucune écriture, même déguisée', () => {
    assert.doesNotMatch(PUBLIC_RELATIONS_SQL, /\b(insert|update|delete|alter|drop|create)\b/i);
  });
});

describe('check:public-rls — la commande elle-même, telle qu’elle est écrite', () => {
  const source = read('scripts/check-public-rls.mjs');
  const code = maskComments(source);
  const pkg = JSON.parse(read('package.json'));

  it('elle existe sous son nom, et vise la base partagée', () => {
    assert.equal(pkg.scripts['check:public-rls'], 'node scripts/check-public-rls.mjs');
    assert.match(source, /SHARED_PROJECT_REF/, 'la connexion est construite sur le ref partagé');
  });

  it('elle n’écrit RIEN : un contrôle qui active RLS efface la preuve de ce qu’il a trouvé', () => {
    assert.doesNotMatch(code, /\balter\s+table\b/i);
    assert.doesNotMatch(code, /\benable\s+row\s+level\s+security\b/i);
    assert.doesNotMatch(code, /\bclient\.query\((?!PUBLIC_RELATIONS_SQL)/, 'une seule requête, et c’est la lecture du catalogue');
    assert.deepEqual(
      code.match(/client\.query\(/g)?.length,
      1,
      'une seule requête — donc aucune écriture possible',
    );
  });

  it('une table ouverte rend la commande ROUGE, sans laisser croire à une réparation', () => {
    assert.match(code, /if \(report\.unguarded\.length > 0 \|\| report\.problems\.length > 0\) process\.exitCode = 1;/);
  });

  it('et elle refuse de verdir sans mot de passe ni lecture', () => {
    assert.match(source, /SUPABASE_DB_PASSWORD absent/);
    assert.match(code, /process\.exit\(2\)/, 'ne pas avoir pu regarder n’est pas un vert');
    assert.match(code, /if \(report\.vacuous\)/, 'une énumération vide sort en 2, elle ne retombe pas sur 0');
  });

  it('aucune exemption n’est déclarée — le refus ne connaît pas de cas légitime', () => {
    assert.match(code, /const EXEMPTIONS = \[\]/, 'la première exception devra s’écrire, avec sa raison');
  });

  it('elle publie sa substance par le module partagé, jamais en imprimant la sentinelle elle-même', () => {
    assert.match(source, /publishEvidence\(/);
  });
});

describe('la veille quotidienne — le contrôle doit tourner sans commit', () => {
  const file = 'public-rls-watch.yml';
  const text = read(`.github/workflows/${file}`);
  const parsed = parseWorkflowFile(text, { file });

  it('elle est quotidienne (une table à la main apparaît sans qu’aucun fichier ne change)', () => {
    assert.equal(parsed.hasSchedule, true);
    assert.ok(
      parsed.crons.some((cron: string) => /^\d+ \d+ \* \* \*$/.test(cron)),
      `cadence quotidienne attendue, vu : ${JSON.stringify(parsed.crons)}`,
    );
  });

  it('elle lance LA commande du dépôt (jamais une copie de sa ligne de commande)', () => {
    assert.match(text, /run: npm run check:public-rls/);
  });

  it('elle publie une preuve sous le nom EXACT que l’audit relit', () => {
    assert.match(text, /Publier la preuve d’action/);
    assert.ok(EVIDENCE_STEP_NAME.startsWith('Publier la preuve d’action'));
    assert.match(text, /publish-automation-evidence\.mjs --acted/);
    assert.match(text, /AUTOMATION_EVIDENCE: '1'/, 'le mandat est posé par l’étape qui exécute le script');
  });
});

describe('l’inventaire des immunités — un contrôle non déclaré fait échouer la chaîne', () => {
  it('check-public-rls.mjs s’y déclare, et y déclare son exemption de prose', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-public-rls.mjs') as
      | { needs: string[]; exempt?: Record<string, string> }
      | undefined;
    assert.ok(entry, 'un contrôle non déclaré n’a pas d’immunités prouvées');
    assert.deepEqual(entry.needs, [IMMUNITY.NON_VACUOUS]);
    assert.ok(
      String(entry.exempt?.[IMMUNITY.PROSE_BLIND] ?? '').length > 10,
      'l’exemption de prose doit dire POURQUOI (il lit un catalogue, pas du code)',
    );
  });
});
