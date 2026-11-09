// Suite for scripts/check-min-type-size.mjs — le garde du plancher typographique.
//
// Pourquoi ce garde existe : `src/index.css` déclare un plancher de lisibilité
// de 12 px (8-10 px est illisible sur la tablette d'une école), mais ce plancher
// n'était qu'une INTENTION. `--text-3xs` valait 11 px et se présentait comme la
// marche « méta » ; du sens (badges de classe, pastille de doublon) atterrissait
// donc sous le plancher qu'on croyait respecter. Le commentaire de la feuille
// promettait déjà ce script — il n'existait pas, et une règle qu'aucune commande
// ne fait respecter redescend au premier édit distrait.
//
// Cette suite le juge comme ce dépôt juge ses gardes : sur des arborescences
// FABRIQUÉES (une règle que rien ne déclenche est un ornement), avec le piège de
// la prose — un commentaire qui CITE « 8px » ne doit pas être accusé — et le
// refus de vacuité (aucun fichier lu, ou aucun jeton `--text-*` lu, sortie 2).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance le garde sur une racine donnée et rend son code, sa sortie, son erreur. */
function runGuard(fixtureRoot: string): Run {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/check-min-type-size.mjs'], {
      cwd: root,
      env: { ...process.env, CHECK_MIN_TYPE_ROOT: fixtureRoot },
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Une arborescence fabriquée : `files` est un chemin → contenu. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mama-min-type-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const CSS_CLEAN = ':root {\n  --text-3xs: 0.75rem;\n  --text-2xs: 0.75rem;\n}\n.text-2xs {\n  font-size: var(--text-2xs);\n}\n';
const TSX_CLEAN = 'export const A = () => <span className="text-2xs font-black">ok</span>;\n';

describe('le plancher typographique — ce que le garde refuse', () => {
  it('un jeton `--text-*` sous 12 px rougit, et dit sa ligne', () => {
    const dir = fixture({
      'index.css': ':root {\n  --text-3xs: 11px;\n  --text-2xs: 0.75rem;\n}\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1, `attendu un échec, obtenu ${run.status}`);
      assert.match(run.stderr, /--text-3xs: 11px/);
      assert.match(run.stderr, /index\.css:2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une taille arbitraire Tailwind sous le plancher rougit — en px comme en rem', () => {
    const dir = fixture({
      'index.css': CSS_CLEAN,
      'A.tsx': 'export const A = () => (<><span className="text-[10px]">a</span><span className="text-[0.6rem]">b</span></>);\n',
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /text-\[10px\]/);
      assert.match(run.stderr, /text-\[0\.6rem\]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un `fontSize` inline sous 12 px rougit (React lit des pixels)', () => {
    const dir = fixture({
      'index.css': CSS_CLEAN,
      'A.tsx': 'export const A = () => <span style={{ fontSize: 9 }}>a</span>;\n',
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /fontSize: 9/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un `!important` ne cache plus la taille : 10 px derrière lui rougit (le trou mesuré dans index.css)', () => {
    // Mesuré le 2026-11-09 : `th, td { font-size: 10px !important; }` (bloc
    // `@media print`) passait sous le garde, parce que le motif s'arrêtait au
    // nombre et laissait ` !important` derrière lui — `toPx` ne savait pas le
    // lire et rendait `null`, c'est-à-dire « pas une taille ».
    const dir = fixture({
      'index.css': CSS_CLEAN + '@media print {\n  th, td { font-size: 10px !important; }\n}\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1, `attendu un échec, obtenu ${run.status}`);
      assert.match(run.stderr, /font-size: 10px/);
      // CSS_CLEAN fait 7 lignes ; le bloc imprimé commence donc ligne 8 et la
      // déclaration fautive est ligne 9 — la ligne est nommée, pas approchée.
      assert.match(run.stderr, /index\.css:9/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une taille RELATIVE (em, %) rougit : sa base est calculée, donc invisible ici', () => {
    // Ce n'est pas une valeur « trop petite » : c'est une valeur que le plancher
    // ne SAIT pas mesurer. On refuse au lieu de supposer un parent à 16 px —
    // la même asymétrie que partout ailleurs dans ce dépôt.
    const dir = fixture({
      'index.css': CSS_CLEAN + '.a { font-size: 0.8em; }\n.b { font-size: 80%; }\n',
      'A.tsx': 'export const A = () => <span style={{ fontSize: \'0.7em\' }}>a</span>;\n',
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1, `attendu un échec, obtenu ${run.status}`);
      assert.match(run.stderr, /font-size: 0\.8em/);
      assert.match(run.stderr, /font-size: 80%/);
      assert.match(run.stderr, /fontSize: '0\.7em'/);
      assert.match(run.stderr, /RELATIVE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un `var()` est RÉSOLU et jugé, au lieu d’être laissé de côté', () => {
    const dir = fixture({
      // Deux jetons : `--text-2xs` est une MARCHE (12 px, saint), `--space` vaut
      // 10 px et n'est pas une taille de texte — il peut être une gouttière. Un
      // jeton n'est donc jugé qu'à l'endroit où il sert de `font-size`, et c'est
      // cette consommation-là qui rougit.
      'index.css': ':root {\n  --text-2xs: 0.75rem;\n  --space: 10px;\n}\n.ok { font-size: var(--text-2xs); }\n.bad { font-size: var(--space); }\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1, `attendu un échec, obtenu ${run.status}`);
      assert.match(run.stderr, /font-size: var\(--space\)/);
      assert.match(run.stderr, /10 px sous le plancher/);
      assert.equal(/font-size: var\(--text-2xs\)/.test(run.stderr), false, 'la marche saine ne doit pas être accusée');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un `var()` qui ne se résout nulle part rougit — un plancher qui n’a rien mesuré n’est pas un vert', () => {
    const dir = fixture({
      'index.css': CSS_CLEAN + '.x { font-size: var(--absente); }\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /var\(--absente\)/);
      assert.match(run.stderr, /ne se résout nulle part/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le MINIMUM d’un `clamp()` est jugé : c’est la valeur que la taille ne franchira jamais par le bas', () => {
    const dir = fixture({
      'index.css': CSS_CLEAN + '.a { font-size: clamp(10px, 1.5vw, 1.5rem); }\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /clamp\(10px/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('le plancher typographique — ce qu’il laisse passer', () => {
  it('12 px et au-dessus sont verts (rem, px, pt)', () => {
    const dir = fixture({
      'index.css': ':root {\n  --text-3xs: 0.75rem;\n  --text-sm: 0.875rem;\n  --text-lg: 14px;\n}\n.t { font-size: 9pt; }\n',
      'A.tsx': 'export const A = () => <span className="text-2xs text-[13px]" style={{ fontSize: 12 }}>ok</span>;\n',
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 0, run.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ce qui reste jugeable passe : `var()` résolu, `clamp()` dont le minimum tient, `!important` au-dessus du plancher', () => {
    const dir = fixture({
      'index.css': ':root {\n  --text-2xs: 0.75rem;\n  --copy: var(--text-2xs);\n}\n.ok { font-size: var(--copy); }\n.clamp { font-size: clamp(1.125rem, 1.5vw, 1.5rem); }\n.force { font-size: 12px !important; }\n',
      'A.tsx': TSX_CLEAN,
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 0, run.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la prose n’est pas accusée : un commentaire qui CITE « 8px » ne rougit pas', () => {
    const dir = fixture({
      'index.css': ':root {\n  /* 8px était illisible, 10px aussi : plancher 12px */\n  --text-3xs: 0.75rem;\n}\n',
      'A.tsx': '// ancien : className="text-[10px]"\nexport const A = () => <span className="text-2xs">ok</span>;\n',
    });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 0, run.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un corpus VIDE ne conclut pas vert : zéro fichier lu, sortie 2', () => {
    const dir = fixture({ '.keep': '' });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 2, `attendu 2 (vacuité), obtenu ${run.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('des fichiers lus mais AUCUN jeton `--text-*` : sortie 2, le motif a disparu', () => {
    const dir = fixture({ 'A.tsx': TSX_CLEAN });
    try {
      const run = runGuard(dir);
      assert.equal(run.status, 2, `attendu 2 (aucun jeton), obtenu ${run.status}`);
      assert.match(run.stderr, /Aucun jeton/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('le plancher typographique — son branchement', () => {
  it('est déclaré dans l’inventaire des immunités (non-vacuité + prose)', () => {
    const entry = GUARD_INVENTORY.find((item) => item.check === 'check-min-type-size.mjs');
    assert.ok(entry, 'check-min-type-size.mjs doit être DÉCLARÉ dans GUARD_INVENTORY');
    assert.deepEqual([...entry.needs].sort(), [IMMUNITY.NON_VACUOUS, IMMUNITY.PROSE_BLIND].sort());
  });

  it('est branché dans `lint:chain` par son nom, jamais par une copie', () => {
    assert.equal(PKG.scripts['check:min-type'], 'node scripts/check-min-type-size.mjs');
    assert.ok(
      PKG.scripts['lint:chain'].includes('node scripts/check-min-type-size.mjs'),
      'lint:chain doit appeler ce garde — sinon il ne protège que ceux qui le lancent à la main',
    );
  });
});
