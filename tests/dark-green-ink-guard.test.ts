// Suite for scripts/check-dark-green-ink.mjs — the gate that keeps the
// `currentTheme.isDark ? 'text-emerald-…' : …` ink convention from coming back.
//
// Why this gate exists: the app once chose a text's ink with a theme ternary,
// and the dark branch carried a green accent. The `!important` remap of a dark
// theme cannot correct it — it only knows its own accent, and the class is
// real. The ink migration moved those branches onto `currentTheme.inkStrong`;
// this suite locks the gate that keeps them there.
//
// The suite judges the gate the way this repository judges every gate: on
// fabricated fixtures (a rule nobody can trigger is decoration), with the
// prose-as-code trap, the out-of-scope `dark:` variant, and above all the
// REFUSAL OF VACUITY (zero files, and zero `isDark` lines, are exit 2 — never a
// green over nothing).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_SRC = readFileSync(join(root, 'scripts/check-dark-green-ink.mjs'), 'utf8');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance le garde sur une racine donnée et rend son code, sa sortie, son erreur. */
function runGuard(fixtureRoot: string): Run {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-dark-green-ink.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CHECK_DARK_GREEN_INK_ROOT: fixtureRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Écrit des fixtures dans un dossier temporaire, lance `fn`, nettoie toujours. */
function withFixture<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-dark-ink-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('dark-green-ink gate — l’encre verte sous `isDark` ne revient pas', () => {
  it('le dépôt réel est propre (aucune violation, aucune entrée périmée)', () => {
    const result = runGuard(join(root, 'src'));
    assert.equal(result.status, 0, `le garde doit passer sur src/ : ${result.stderr}`);
    assert.match(result.stdout, /✅ Aucune encre verte sous/);
  });

  it('une encre verte sur une ligne `isDark` est accusée, avec la ligne et le remède', () => {
    withFixture(
      {
        'Bad.tsx': "const cls = theme.isDark ? 'text-emerald-300' : 'text-slate-700';\n",
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'une régression du motif doit échouer (exit 1)');
        assert.match(result.stderr, /Bad\.tsx:1/);
        assert.match(result.stderr, /text-emerald-300/);
        assert.match(result.stderr, /inkStrong/, 'le remède doit être nommé');
      },
    );
  });

  it('l’exception vaut pour le couple (fichier, classe), jamais pour la classe seule', () => {
    // Même classe que l’exception motivée, mais dans un AUTRE fichier : le grain
    // (fichier, classe) doit laisser la régression passer au travers du filet si
    // l’allowlist était à tort par fichier entier — ici elle est bien accusée.
    withFixture(
      {
        'Other.tsx': "const c = t.isDark ? 'text-emerald-300/80' : 'text-emerald-800';\n",
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'une exception accordée ailleurs ne blanchit pas ce fichier');
        assert.match(result.stderr, /Other\.tsx:1/);
      },
    );
  });

  it('la prose qui CITE la règle n’est pas du code', () => {
    withFixture(
      {
        'Prose.tsx': [
          "// isDark ? 'text-emerald-500' : 'text-slate-800' — ancienne convention",
          "const c = t.isDark ? 'text-slate-100' : 'text-slate-800';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 0, `un commentaire citant le motif ne doit pas être accusé : ${result.stderr}`);
      },
    );
  });

  it('une variante `dark:` de vert est hors périmètre (vert sémantique)', () => {
    withFixture(
      {
        'Variant.tsx': [
          "const c = t.isDark ? 'text-slate-100' : 'text-slate-800';",
          "const d = 'text-emerald-600 dark:text-emerald-400';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 0, `le vert sémantique hors ligne isDark reste légal : ${result.stderr}`);
      },
    );
  });

  it('un ternaire `isDark` ÉTALÉ est accusé (branche `whenTrue` sur une autre ligne)', () => {
    withFixture(
      {
        'Multi.tsx': [
          'const cls = theme.isDark',
          "  ? 'text-emerald-300'",
          "  : 'text-slate-700';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'la ligne à ligne seule passe à côté — l’arbre doit rattraper');
        assert.match(result.stderr, /Multi\.tsx:2/, 'la ligne de la BRANCHE est désignée');
        assert.match(result.stderr, /text-emerald-300/);
        assert.match(result.stderr, /inkStrong/, 'le remède doit être nommé');
      },
    );
  });

  it('la branche `whenFalse` d’un ternaire étalé est accusée aussi', () => {
    withFixture(
      {
        'Multi.tsx': [
          'const cls = currentTheme.isDark',
          '  ? currentTheme.inkStrong',
          "  : 'text-emerald-500';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Multi\.tsx:3/);
        assert.match(result.stderr, /text-emerald-500/);
      },
    );
  });

  it('un ternaire étalé SANS `isDark` reste hors périmètre', () => {
    withFixture(
      {
        'Other.tsx': [
          "const a = t.isDark ? 'text-slate-100' : 'text-slate-800';",
          'const b = flag',
          "  ? 'text-emerald-300'",
          "  : 'text-slate-700';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 0, `seul un ternaire piloté par isDark est visé : ${result.stderr}`);
      },
    );
  });

  it('un ternaire imbriqué est rapporté une seule fois par (fichier, ligne, classe)', () => {
    withFixture(
      {
        'Nested.tsx': [
          'const cls = theme.isDark',
          '  ? (x',
          "    ? 'a'",
          "    : 'text-emerald-300')",
          "  : 'b';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1);
        const hits = [...result.stderr.matchAll(/Nested\.tsx:4/g)].length;
        assert.equal(hits, 1, 'la branche extérieure et la branche intérieure ne doivent peser qu’une fois');
      },
    );
  });

  it('zéro ligne `isDark` est un échec (exit 2), pas un vert sur rien', () => {
    withFixture({ 'None.tsx': "const c = 'text-emerald-600';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 2, 'le motif disparu est un refus, pas un vert silencieux');
      assert.match(result.stderr, /Rien à vérifier/);
      assert.match(result.stderr, /isDark/);
    });
  });

  it('zéro fichier est un échec (exit 2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-dark-ink-empty-'));
    try {
      const result = runGuard(dir);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Rien à vérifier/);
      assert.match(result.stderr, /0 fichier/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le garde est câblé dans `npm run lint` (chaîne pré-commit + CI)', () => {
    const chain = [PKG.scripts.lint, PKG.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-dark-green-ink\.mjs/);
  });

  it('le garde est déclaré dans l’inventaire d’immunités', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-dark-green-ink.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });

  it('l’allowlist est vidée et reste un mécanisme motivé', () => {
    // La bannière de rôles de SettingsUsersCard est passée aux jetons d'accent :
    // il n'y a plus aucune encre verte sous `isDark` dans le dépôt, donc plus
    // aucune exception. On garde le MÉCANISME (fichier + classe + raison) pour
    // qu'une future exception doive se justifier, plutôt que de blanchir une
    // ligne en silence.
    assert.match(GUARD_SRC, /const ALLOWLIST = \[\]/);
    assert.match(GUARD_SRC, /entry\.reason/);
  });
});
