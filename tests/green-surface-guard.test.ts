// Suite for scripts/check-green-surface.mjs — the gate that keeps the
// `currentTheme.isDark ? 'bg-emerald-900/…' : …` surface convention from coming
// back.
//
// Why this gate exists: the app once chose a NEUTRAL surface with a theme
// ternary, and the dark branch carried a green accent. A dark theme's `!important`
// remap cannot correct it — it only knows its own accent, and the class is real.
// The surface migration moved those branches onto `currentTheme.surfaceInset`;
// this suite locks the gate that keeps them there.
//
// The suite judges the gate the way this repository judges every gate: on
// fabricated fixtures (a rule nobody can trigger is decoration), with the
// prose-as-code trap, the allowlist grain (file, token), and above all the
// REFUSAL OF VACUITY (zero files, and zero green surfaces, are exit 2 — never a
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
const GUARD_SRC = readFileSync(join(root, 'scripts/check-green-surface.mjs'), 'utf8');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance le garde sur une racine donnée et rend son code, sa sortie, son erreur. */
function runGuard(fixtureRoot: string): Run {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-green-surface.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CHECK_GREEN_SURFACE_ROOT: fixtureRoot },
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
  const dir = mkdtempSync(join(tmpdir(), 'mama-green-surface-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('green-surface gate — le fond vert non sémantique ne revient pas', () => {
  it('le dépôt réel est propre (aucune violation, aucune entrée périmée)', () => {
    const result = runGuard(join(root, 'src'));
    assert.equal(result.status, 0, `le garde doit passer sur src/ : ${result.stderr}`);
    assert.match(result.stdout, /✅ Aucun fond vert non sémantique/);
  });

  it('un fond vert sur une surface neutre est accusé, avec la ligne et le remède', () => {
    withFixture(
      {
        'Theme.tsx': "const cls = theme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50';\n",
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'une régression du motif doit échouer (exit 1)');
        assert.match(result.stderr, /Theme\.tsx:1/);
        assert.match(result.stderr, /bg-emerald-900\/10/);
        assert.match(result.stderr, /surfaceInset/, 'le remède doit être nommé');
      },
    );
  });

  it('une variante `dark:` / `hover:` est couverte (le jeton, pas le préfixe)', () => {
    withFixture({ 'Variant.tsx': "const c = 'dark:hover:bg-emerald-900/20';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 1, 'la surface verte sous une variante reste une surface verte');
      assert.match(result.stderr, /Variant\.tsx:1/);
      assert.match(result.stderr, /bg-emerald-900\/20/);
    });
  });

  it('la teinte 950 est hors périmètre (badge « payé » sémantique)', () => {
    withFixture(
      {
        'Paid.tsx': [
          "const badge = 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700';",
          "const inset = 'bg-emerald-950/40';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        // Aucune surface 900 : le motif 900 disparaît, donc refus de conclure.
        assert.equal(result.status, 2, `950 n'est pas 900 — rien à vérifier : ${result.stderr}`);
        assert.match(result.stderr, /Rien à vérifier/);
      },
    );
  });

  it('la prose qui CITE la règle n’est pas du code, la vraie surface l’est', () => {
    withFixture(
      {
        'Prose.tsx': [
          "// isDark ? 'bg-emerald-900/10' : 'bg-slate-50' — ancienne convention",
          "const c = theme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'le code est accusé');
        assert.match(result.stderr, /Prose\.tsx:2/, 'la ligne de CODE est désignée');
        assert.doesNotMatch(result.stderr, /Prose\.tsx:1/, 'le commentaire citant la règle ne l’est pas');
      },
    );
  });

  it('l’exception vaut pour le couple (fichier, classe), jamais pour la classe seule', () => {
    // La classe `bg-emerald-900/90` est tolérée dans ToastNotification.tsx ; dans
    // un AUTRE fichier, la même classe doit tomber.
    withFixture(
      {
        'Elsewhere.tsx': "const bg = 'bg-emerald-900/90';\n",
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'une exception accordée ailleurs ne blanchit pas ce fichier');
        assert.match(result.stderr, /Elsewhere\.tsx:1/);
      },
    );
  });

  it('zéro surface verte est un échec (exit 2), pas un vert sur rien', () => {
    withFixture({ 'None.tsx': "const c = 'bg-slate-50';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 2, 'le motif disparu est un refus, pas un vert silencieux');
      assert.match(result.stderr, /Rien à vérifier/);
      assert.match(result.stderr, /bg-emerald-900/);
    });
  });

  it('zéro fichier est un échec (exit 2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-green-surface-empty-'));
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
    assert.match(chain, /node scripts\/check-green-surface\.mjs/);
  });

  it('le garde est déclaré dans l’inventaire d’immunités', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-green-surface.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });

  it('la seule exception restante est le toast de succès — le CTA vert a été gagné', () => {
    // L'allowlist est une dette : chaque entrée porte fichier, classe ET raison.
    assert.match(GUARD_SRC, /src\/components\/ToastNotification\.tsx/);
    assert.match(GUARD_SRC, /'bg-emerald-900\/90'/);
    assert.match(GUARD_SRC, /reason:/);
    assert.match(GUARD_SRC, /Toast de succès/);
    // La migration de la cloche et de « marquer comme lu » vers les tokens a
    // retiré l'entrée CTA : la garder la rendrait PÉRIMÉE et le contrôle
    // échouerait — le retrait est précisément le gain.
    assert.doesNotMatch(GUARD_SRC, /NotificationsPanel/);
    assert.doesNotMatch(GUARD_SRC, /'bg-emerald-900\/20'/);
  });
});
