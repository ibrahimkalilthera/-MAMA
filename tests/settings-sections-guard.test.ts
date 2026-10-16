/**
 * Suite for scripts/check-settings-composition.mjs — the SOURCE gate that
 * complements the DOM proof (tests/settings-composition.test.tsx).
 *
 * The DOM test measures what the browser sees; this gate pins the shell FILE:
 * it imports exactly the section components of the contract and renders them in
 * order. The
 * suite judges the gate the way this repository judges every gate — on
 * fabricated sources (a rule nobody can trigger is decoration) and on the real
 * file — with the prose-as-code trap and the REFUSAL OF VACUITY (a missing or
 * empty shell is exit 2, never a green over nothing).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'scripts/check-settings-composition.mjs';
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance le garde sur une coquille (et, si donnée, un dossier de sections). */
function runGuard(viewFile: string, sectionsDir?: string): Run {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CHECK_SETTINGS_VIEW_FILE: viewFile,
        ...(sectionsDir ? { CHECK_SETTINGS_SECTIONS_DIR: sectionsDir } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Écrit une coquille dans un dossier temporaire, lance `fn`, nettoie toujours. */
function withSource<T>(source: string, fn: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-settings-src-'));
  const file = join(dir, 'SettingsView.tsx');
  try {
    writeFileSync(file, source, 'utf8');
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Écrit PLUSIEURS fichiers dans un dossier temporaire, lance `fn`, nettoie. */
function withFixture<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-settings-fix-'));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source, 'utf8');
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Un composant de section qui déclare ses `data-slot` — un par bloc enfant. */
function sectionSource(slots: string[]): string {
  return `export function Section() {\n  return (\n    <>\n${slots
    .map((slot) => `      <div data-slot="${slot}" />`)
    .join('\n')}\n    </>\n  );\n}\n`;
}

/** Les quatre composants en pile + la coquille — le jeu complet d'une fixture. */
const STACK_FIXTURE = (preferenceSlots: string[]): Record<string, string> => ({
  'SettingsView.tsx': CORRECT,
  'SettingsPreferencesCard.tsx': sectionSource(preferenceSlots),
  'SettingsSchoolCard.tsx': sectionSource(['settings-school-name']),
  'SettingsBackupCard.tsx': sectionSource(['settings-backup']),
  'SettingsClassesCard.tsx': sectionSource(['settings-classes']),
  'SettingsUsersCard.tsx': sectionSource(['settings-staff-access']),
});

// Doit refléter `SETTINGS_STACK_SLOTS` : les six blocs de PRÉFÉRENCES, dans
// l'ordre du DOM (langue, devise, densité des tableaux, verre des icônes, thème,
// logo). Le nom de l'école a sa propre section (`SettingsSchoolCard`), donc il
// n'est pas dans cette liste-ci — mais il est bien dans la table de la pile.
const PREFERENCE_SLOTS = [
  'settings-system-language',
  'settings-currency-format',
  'settings-table-density',
  'settings-icon-glass',
  'settings-theme-settings',
  'settings-upload-logo',
];

const IMPORTS = [
  "import { useMainViews } from '../app/mainViewsContext';",
  "import { SettingsPreferencesCard } from './SettingsPreferencesCard';",
  "import { SettingsSchoolCard } from './SettingsSchoolCard';",
  "import { SettingsBackupCard } from './SettingsBackupCard';",
  "import { SettingsClassesCard } from './SettingsClassesCard';",
  "import { SettingsUsersCard } from './SettingsUsersCard';",
  "import { SettingsPasswordModal } from './SettingsPasswordModal';",
].join('\n');

const RENDERS = [
  '        <SettingsPreferencesCard />',
  '        <SettingsSchoolCard />',
  '        <SettingsBackupCard />',
  '        <SettingsClassesCard />',
  '        <SettingsUsersCard />',
]
  .join('\n')
  .concat('\n      <SettingsPasswordModal />');

const CORRECT = `${IMPORTS}\n\nexport function SettingsView() {\n  return (\n    <>\n      <div>\n${RENDERS}\n      </div>\n    </>\n  );\n}\n`;

describe('settings-composition gate — la coquille importe et rend les cinq sections, dans l’ordre', () => {
  it('le fichier réel est conforme', () => {
    const result = runGuard(join(root, 'src/components/SettingsView.tsx'));
    assert.equal(result.status, 0, `le garde doit passer sur la vraie coquille : ${result.stderr}`);
    assert.match(result.stdout, /importe et rend les 6 sections dans l’ordre/);
  });

  it('une fixture conforme passe (la règle est bien celle-là)', () => {
    withSource(CORRECT, (file) => {
      assert.equal(runGuard(file).status, 0, 'une coquille conforme doit être verte');
    });
  });

  it('une section absente (import ET rendu) est nommée', () => {
    const broken = CORRECT.replace(
      "import { SettingsClassesCard } from './SettingsClassesCard';\n",
      '',
    ).replace('        <SettingsClassesCard />\n', '');
    withSource(broken, (file) => {
      const result = runGuard(file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /imports MANQUANTS/);
      assert.match(result.stderr, /SettingsClassesCard/);
    });
  });

  it('une section en trop (hors contrat) est refusée', () => {
    const extra = CORRECT.replace(
      "import { SettingsPasswordModal } from './SettingsPasswordModal';",
      "import { SettingsPasswordModal } from './SettingsPasswordModal';\nimport { SettingsExtraCard } from './SettingsExtraCard';",
    ).replace('      <SettingsPasswordModal />', '      <SettingsPasswordModal />\n      <SettingsExtraCard />');
    withSource(extra, (file) => {
      const result = runGuard(file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /imports en TROP/);
      assert.match(result.stderr, /SettingsExtraCard/);
    });
  });

  it('deux sections INVERSÉES au rendu tombent, avec l’ordre observé', () => {
    const swapped = CORRECT.replace(
      '        <SettingsBackupCard />\n        <SettingsClassesCard />',
      '        <SettingsClassesCard />\n        <SettingsBackupCard />',
    );
    withSource(swapped, (file) => {
      const result = runGuard(file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /rendu observé/);
      assert.match(result.stderr, /SettingsClassesCard → SettingsBackupCard/);
    });
  });

  it('la prose qui CITE un composant ne compte pas (commentaires blanchis)', () => {
    const prose = `${CORRECT}\n// <SettingsExtraCard /> — cité dans un commentaire, jamais rendu\n`;
    withSource(prose, (file) => {
      assert.equal(runGuard(file).status, 0, 'un nom cité en commentaire ne doit pas être un rendu');
    });
  });

  it('une coquille absente est un échec (exit 2), pas un vert', () => {
    const result = runGuard(join(tmpdir(), 'mama-settings-absent', 'SettingsView.tsx'));
    assert.equal(result.status, 2, 'un fichier introuvable est un refus, pas un contrat tenu');
    assert.match(result.stderr, /Rien à vérifier/);
  });

  it('la pile conforme (six blocs de préférences, le nom de l’école, puis trois sections) passe', () => {
    withFixture(STACK_FIXTURE(PREFERENCE_SLOTS), (dir) => {
      const result = runGuard(join(dir, 'SettingsView.tsx'), dir);
      assert.equal(result.status, 0, `une pile conforme doit être verte : ${result.stderr}`);
      assert.match(result.stdout, /la pile porte ses 10 enfants/);
    });
  });

  it('un bloc AJOUTÉ dans la pile sans mise à jour de la table fait échouer le contrôle', () => {
    const withExtra = STACK_FIXTURE([...PREFERENCE_SLOTS, 'settings-extra-block']);
    withFixture(withExtra, (dir) => {
      const result = runGuard(join(dir, 'SettingsView.tsx'), dir);
      assert.equal(result.status, 1, 'changer la structure sans la table doit échouer');
      assert.match(result.stderr, /la pile doit porter 10 enfants/);
      assert.match(result.stderr, /SANS que la table/);
      assert.match(result.stderr, /settings-extra-block/);
    });
  });

  it('un bloc RETIRÉ de la pile sans mise à jour de la table fait échouer le contrôle', () => {
    const withFewer = STACK_FIXTURE(PREFERENCE_SLOTS.slice(0, 3));
    withFixture(withFewer, (dir) => {
      const result = runGuard(join(dir, 'SettingsView.tsx'), dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /la pile doit porter 10 enfants/);
    });
  });

  it('un composant de section ABSENT rend le comptage impossible (exit 2)', () => {
    const files = STACK_FIXTURE(PREFERENCE_SLOTS);
    delete files['SettingsUsersCard.tsx'];
    withFixture(files, (dir) => {
      const result = runGuard(join(dir, 'SettingsView.tsx'), dir);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Rien à vérifier/);
      assert.match(result.stderr, /SettingsUsersCard\.tsx/);
    });
  });

  it('le garde est câblé dans `npm run lint` et déclaré dans l’inventaire d’immunités', () => {
    const chain = [PKG.scripts.lint, PKG.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-settings-composition\.mjs/);

    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-settings-composition.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });
});
