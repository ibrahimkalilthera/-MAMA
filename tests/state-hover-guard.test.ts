// Suite for scripts/check-state-hover.mjs — the gate that keeps a hover from
// being a hand-written recipe again.
//
// Why this gate exists: a hover surface was copied into every component
// (`hover:bg-slate-50 dark:hover:bg-white/10` on one row, `hover:bg-slate-100
// dark:hover:bg-slate-800` on the next, a hand-written rose on each destructive
// action). No theme remap can correct that — a remap only knows its own classes
// — so a warm theme kept cold hovers, and a school's accent (the colour of its
// logo, decided at runtime) reached none of them. The migration moved them onto
// `currentTheme.hoverSurface` and friends; this suite locks the gate that keeps
// them there.
//
// The suite judges the gate the way this repository judges every gate: on
// fabricated fixtures (a rule nobody can trigger is decoration), with the
// prose-as-code trap, the allowlist grain (file, token) and above all the
// REFUSAL OF VACUITY (zero files, and zero coloured hover recipes, are exit 2 —
// never a green over nothing).
//
// The repository's own allowlist is now EMPTY: its seven entries were earned by
// four cranks (a clear control on a coloured plate, the alert of an always-dark
// chrome, the alert on that plate, a filled neutral control on fixed chrome). A
// rule that can no longer be triggered by the repository's own data would stop
// being tested, so the grain and the staleness rule are exercised through an
// INJECTED list (`CHECK_STATE_HOVER_ALLOWLIST`) — the same file shape, another
// list, and the refusal of a malformed one.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_SRC = readFileSync(join(root, 'scripts/check-state-hover.mjs'), 'utf8');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance le garde sur une racine donnée et rend son code, sa sortie, son erreur. */
function runGuard(fixtureRoot: string, env: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-state-hover.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CHECK_STATE_HOVER_ROOT: fixtureRoot, ...env },
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
  const dir = mkdtempSync(join(tmpdir(), 'mama-state-hover-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('state-hover gate — la recette de survol écrite à la main ne revient pas', () => {
  it('le dépôt réel est propre (aucune violation, aucune entrée périmée)', () => {
    const result = runGuard(join(root, 'src'));
    assert.equal(result.status, 0, `le garde doit passer sur src/ : ${result.stderr}`);
    assert.match(result.stdout, /✅ Aucune recette de survol écrite à la main/);
  });

  it('un survol neutre écrit à la main est accusé, avec la ligne et les crans', () => {
    withFixture({ 'Row.tsx': "const c = 'hover:bg-slate-50 dark:hover:bg-white/10';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 1, 'une régression du motif doit échouer (exit 1)');
      assert.match(result.stderr, /Row\.tsx:1/);
      assert.match(result.stderr, /hover:bg-slate-50/, 'le jeton est nommé EN ENTIER (pas tronqué)');
      assert.match(result.stderr, /hover:bg-white\/10/);
      assert.match(result.stderr, /hoverSurface/, 'le cran de remplacement doit être nommé');
    });
  });

  it('les trois familles remplacées tombent : neutre, accent, alerte', () => {
    withFixture(
      {
        'Mixed.tsx': [
          "const neutral = 'hover:bg-slate-200';",
          "const accent = 'hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600';",
          "const alert = 'hover:bg-rose-100 dark:hover:bg-rose-950/60';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1);
        for (const token of ['hover:bg-slate-200', 'hover:bg-blue-50', 'hover:text-blue-600', 'hover:bg-rose-100']) {
          assert.match(result.stderr, new RegExp(token.replace(/[/]/g, '\\/')), `${token} doit tomber`);
        }
        assert.match(result.stderr, /hoverAccent/);
        assert.match(result.stderr, /hoverAlert/);
      },
    );
  });

  it('une variante `group-` est couverte, et l’encre neutre reste permise', () => {
    withFixture(
      {
        'Group.tsx': [
          "const chevron = 'group-hover:text-blue-600';",
          "const plainInk = 'hover:text-slate-600 dark:hover:text-slate-200';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'l’encre d’accent sous `.group` est une recette');
        assert.match(result.stderr, /group-hover:text-blue-600/);
        assert.match(result.stderr, /hoverAccentGroupInk/, 'la moitié « encre » a son cran');
        assert.doesNotMatch(
          result.stderr,
          /hover:text-slate-600/,
          'une encre NEUTRE au survol n’a pas de cran : elle reste autorisée',
        );
      },
    );
  });

  it('une famille SÉMANTIQUE reste permise (elle code un fait, pas un thème)', () => {
    withFixture(
      {
        'Semantic.tsx': [
          "const late = 'hover:bg-amber-100 dark:hover:bg-amber-950/70';",
          "const paid = 'hover:bg-emerald-50 dark:hover:bg-emerald-950/60';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 0, `l’ambre et l’émeraude CODENT un état : ${result.stderr}`);
        assert.match(result.stdout, /✅/);
      },
    );
  });

  it('la prose qui CITE la règle n’est pas du code, la vraie recette l’est', () => {
    withFixture(
      {
        'Prose.tsx': [
          "// un survol s'écrivait 'hover:bg-slate-50 dark:hover:bg-white/10' — ancienne recette",
          "const c = 'hover:bg-slate-50 dark:hover:bg-white/10';",
          '',
        ].join('\n'),
      },
      (dir) => {
        const result = runGuard(dir);
        assert.equal(result.status, 1, 'le code est accusé');
        assert.match(result.stderr, /Prose\.tsx:2/, 'la ligne de CODE est désignée');
        assert.doesNotMatch(result.stderr, /Prose\.tsx:1/, 'le commentaire citant la recette ne l’est pas');
      },
    );
  });

  /**
   * La clé DÉPÔT-RELATIVE d'un fichier de fixture : c'est EXACTEMENT ce que le
   * garde compare à une entrée (`path.relative(cwd, …)`, séparateurs normalisés),
   * donc une liste injectée doit parler la même langue que lui.
   */
  const repoKeyOf = (dir: string, name: string): string =>
    relative(root, join(dir, name)).replace(/\\/g, '/');

  /** Écrit une allowlist injectée à côté des fixtures et rend son chemin. */
  const injectAllowlist = (
    dir: string,
    entries: { file: string; token: string; reason: string }[],
  ): string => {
    const pathname = join(dir, 'allowlist.json');
    writeFileSync(pathname, JSON.stringify(entries), 'utf8');
    return pathname;
  };

  it('l’exception vaut pour le couple (fichier, classe), jamais pour la classe seule', () => {
    // Une entrée pour (Row.tsx, hover:bg-white/90) : la MÊME classe écrite dans un
    // autre fichier doit rester une violation. Les deux moitiés sont dans le même
    // passage — sans le contrôle POSITIF, un garde qui n'exempterait plus rien du
    // tout passerait ce test.
    withFixture(
      {
        'Row.tsx': "const c = 'bg-white hover:bg-white/90';\n",
        'Elsewhere.tsx': "const c = 'bg-white hover:bg-white/90';\n",
      },
      (dir) => {
        const allowlist = injectAllowlist(dir, [
          {
            file: repoKeyOf(dir, 'Row.tsx'),
            token: 'hover:bg-white/90',
            reason: 'un contrôle blanc opaque sur un aplat coloré (fixture)',
          },
        ]);
        const result = runGuard(dir, { CHECK_STATE_HOVER_ALLOWLIST: allowlist });
        assert.equal(result.status, 1, 'une exception accordée ailleurs ne blanchit pas ce fichier');
        assert.match(result.stderr, /Elsewhere\.tsx:1/, 'le fichier NON nommé est accusé');
        assert.doesNotMatch(result.stderr, /Row\.tsx:1/, 'le couple (fichier, classe) nommé, lui, est exempté');
      },
    );

    // Le contrôle POSITIF, sur une racine propre : la même entrée, seule dans son
    // fichier, blanchit bien son couple — et la synthèse rendue compte la liste
    // telle qu'elle a été lue.
    withFixture({ 'Row.tsx': "const c = 'bg-white hover:bg-white/90';\n" }, (dir) => {
      const allowlist = injectAllowlist(dir, [
        {
          file: repoKeyOf(dir, 'Row.tsx'),
          token: 'hover:bg-white/90',
          reason: 'un contrôle blanc opaque sur un aplat coloré (fixture)',
        },
      ]);
      const ok = runGuard(dir, { CHECK_STATE_HOVER_ALLOWLIST: allowlist });
      assert.equal(ok.status, 0, `une exception valide doit blanchir son couple : ${ok.stderr}`);
      assert.match(ok.stdout, /1 exception\(s\) motivée\(s\)/);
    });
  });

  it('une entrée qui ne tolère plus rien est PÉRIMÉE — sur une racine de fixtures aussi', () => {
    // L'ancien contournement (« la dette ne se juge que sur l'arbre réel ») est
    // tombé avec la dette : une liste INJECTÉE porte toujours son propre verdict.
    // La fixture est propre par ailleurs (une encre neutre, permise), donc le SEUL
    // motif d'échec possible est la péremption.
    withFixture({ 'Row.tsx': "const c = 'hover:text-slate-600';\n" }, (dir) => {
      const allowlist = injectAllowlist(dir, [
        {
          file: repoKeyOf(dir, 'Row.tsx'),
          token: 'hover:bg-rose-500/30',
          reason: 'fixture : la classe nommée n’est plus dans ce fichier',
        },
      ]);
      const result = runGuard(dir, { CHECK_STATE_HOVER_ALLOWLIST: allowlist });
      assert.equal(result.status, 1, 'une entrée périmée doit échouer');
      assert.match(result.stderr, /PÉRIMÉE/);
      assert.match(result.stderr, /hover:bg-rose-500\/30/);
      assert.doesNotMatch(result.stderr, /Row\.tsx:1/, 'et rien d’autre n’est accusé');
    });
  });

  it('l’allowlist du DÉPÔT est vide — c’est la mesure de la dette payée', () => {
    const result = runGuard(join(root, 'src'));
    assert.equal(result.status, 0, `src/ doit être propre : ${result.stderr}`);
    assert.match(
      result.stdout,
      /0 exception\(s\) motivée\(s\)/,
      'plus une seule exception : les sept se sont gagnées en crans',
    );
  });

  it('une allowlist injectée absente ou illisible est un échec (exit 2), jamais un vert', () => {
    withFixture({ 'Row.tsx': "const c = 'hover:bg-slate-50';\n" }, (dir) => {
      const missing = runGuard(dir, { CHECK_STATE_HOVER_ALLOWLIST: join(dir, 'nope.json') });
      assert.equal(missing.status, 2, 'une porte pointée sur rien est un refus');
      assert.match(missing.stderr, /introuvable/);

      // Une entrée sans raison n'est pas une entrée : c'est le contrôle qui dit
      // qu'une exception doit s'EXPLIQUER.
      const malformed = injectAllowlist(dir, [{ file: '', token: '', reason: '' }]);
      const bad = runGuard(dir, { CHECK_STATE_HOVER_ALLOWLIST: malformed });
      assert.equal(bad.status, 2);
      assert.match(bad.stderr, /illisible/);
    });
  });

  it('une couleur ARBITRAIRE au survol tombe aussi (même défaut, autre écriture)', () => {
    withFixture({ 'Arbitrary.tsx': "const c = 'hover:bg-[#1E5E3A]';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /hover:bg-\[#1E5E3A\]/);
    });
  });

  it('zéro recette de survol colorée est un échec (exit 2), pas un vert sur rien', () => {
    withFixture({ 'None.tsx': "const c = 'bg-slate-50';\n" }, (dir) => {
      const result = runGuard(dir);
      assert.equal(result.status, 2, 'le motif disparu est un refus, pas un vert silencieux');
      assert.match(result.stderr, /Rien à vérifier/);
    });
  });

  it('zéro fichier est un échec (exit 2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-state-hover-empty-'));
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
    assert.match(chain, /node scripts\/check-state-hover\.mjs/);
  });

  it('le garde est déclaré dans l’inventaire d’immunités', () => {
    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-state-hover.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
  });

  it('la dette est RETIRÉE de la source, et sa porte d’injection reste déclarée', () => {
    assert.doesNotMatch(
      GUARD_SRC,
      /file:\s*'src\//,
      'aucune entrée (fichier, classe) ne subsiste dans la liste du dépôt',
    );
    // Les sept recettes nommées par la dette sont maintenant des CRANS : qu'elles
    // réapparaissent entre guillemets dans ce fichier voudrait dire qu'on les
    // tolère de nouveau.
    for (const token of [
      'hover:bg-white/90',
      'hover:bg-white/20',
      'hover:bg-slate-900',
      'hover:bg-rose-500/30',
      'hover:bg-rose-500/10',
      'hover:text-rose-300',
    ]) {
      assert.equal(
        GUARD_SRC.split(`'${token}'`).length - 1,
        0,
        `${token} n’est plus une exception : sa recette est un cran`,
      );
    }
    assert.match(GUARD_SRC, /CHECK_STATE_HOVER_ALLOWLIST/, 'la porte par laquelle la suite éprouve l’allowlist');
    assert.match(GUARD_SRC, /reason/, 'une entrée doit porter sa raison');
  });
});
