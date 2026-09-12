// Suite for scripts/lib/theme-css.mjs — the loader that keeps the lint gate
// and the contrast model reading the SAME stylesheets.
//
// Why this file exists: the theme remap layer was extracted from src/index.css
// into src/themes/overrides.css. Every reader that hard-coded one path would
// have kept passing while checking nothing — the path still exists, it just
// stopped holding the rules. So the corpus is asserted on what the guards
// actually depend on (the slate remap being IN it, the parsers still seeing
// remaps), never on "the loader returned a string".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ENTRY, localImports, readThemeCss, themeCssFiles } from '../scripts/lib/theme-css.mjs';
import { slateTextRemap, textOverrides, whitenSurfaces } from './tailwind-pairs.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Build a throwaway project tree from `relative path → content`. */
const tmpProject = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mama-theme-css-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
};

const withProject = (files: Record<string, string>, run: (dir: string) => void): void => {
  const dir = tmpProject(files);
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('theme-css — @import graph', () => {
  it('collecte les chemins relatifs et ignore les paquets', () => {
    const css = [
      '@import "tailwindcss";',
      "@import './themes/z.css';",
      "@import url('./themes/a.css');",
      '@import "./assets/fonts/geist.css";',
    ].join('\n');
    assert.deepEqual(localImports(css), ['./themes/z.css', './themes/a.css', './assets/fonts/geist.css']);
  });

  it("l'ordre de chargement suit les @import, pas l'alphabet", () => {
    withProject(
      {
        'src/index.css': "@import './themes/z.css';\n@import './themes/a.css';\n.x{color:red}",
        'src/themes/z.css': '.z{}',
        'src/themes/a.css': '.a{}',
        'src/themes/m.css': '.m{}',
      },
      (dir) => {
        assert.deepEqual(themeCssFiles(dir), [
          'src/themes/z.css',
          'src/themes/a.css',
          'src/themes/m.css', // jamais importé, visible quand même
          ENTRY, // les règles de l'entrée viennent après ses imports
        ]);
      },
    );
  });

  it('un import mort ou un fichier absent ne fait pas échouer la lecture', () => {
    const entry = "@import './themes/disparu.css';\n.x{}";
    withProject({ 'src/index.css': entry }, (dir) => {
      assert.deepEqual(themeCssFiles(dir), [ENTRY]);
      assert.equal(readThemeCss(dir), entry, "l'entrée se lit telle quelle");
    });
  });

  it('concatène avec un saut de ligne (une frontière ne colle jamais deux blocs)', () => {
    withProject(
      { 'src/index.css': '@import "./themes/t.css";.entry{}', 'src/themes/t.css': '.theme{}' },
      (dir) => {
        assert.equal(readThemeCss(dir), '.theme{}\n@import "./themes/t.css";.entry{}');
      },
    );
  });
});

describe('theme-css — corpus réel du dépôt', () => {
  const files = themeCssFiles(ROOT);
  const css = readThemeCss(ROOT);

  it('la couche extraite en fait partie', () => {
    assert.ok(files.includes('src/themes/overrides.css'), `corpus: ${files.join(', ')}`);
    assert.ok(files.includes('src/themes/midnight.css'));
    assert.equal(files[files.length - 1], ENTRY, "l'entrée se lit en dernier");
    assert.equal(new Set(files).size, files.length, 'aucun doublon');
  });

  it('src/index.css ne porte plus aucune règle .theme- (la scission est complète)', () => {
    const index = readFileSync(join(ROOT, ENTRY), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const leftover = index.split(/\r?\n/).filter((l) => /^\s*\.theme-/.test(l));
    assert.deepEqual(leftover, [], 'une règle de thème est restée dans index.css');
  });

  it('le corpus contient ce que les guards promettent (sinon ils passent à vide)', () => {
    // Un commentaire n'est pas du code : index.css EXPLIQUE la media query OS
    // pour justifier le @custom-variant, et cette prose ne doit pas compter.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const needle of [
      '.theme-cream',
      '.theme-slate',
      '.app-sidebar',
      '.theme-slate .bg-rose-50',
      '.theme-slate .text-rose-600',
      'FEF9C3',
    ]) {
      assert.ok(code.includes(needle), `le corpus ne contient pas ${needle}`);
    }
    assert.ok(!code.includes('prefers-color-scheme'), 'la media query OS doit rester absente');
  });

  it("midnight reste chargé avant overrides (ordre de cascade d'avant la scission)", () => {
    const index = readFileSync(join(ROOT, ENTRY), 'utf8');
    const order = localImports(index);
    const midnight = order.findIndex((s) => s.includes('midnight.css'));
    const overrides = order.findIndex((s) => s.includes('overrides.css'));
    assert.ok(midnight >= 0 && overrides >= 0, `imports: ${order.join(', ')}`);
    assert.ok(midnight < overrides, 'les deux couches doivent garder leur ordre');
  });

  it('les parsers de contraste lisent bien ce corpus (aucun manifeste vide)', () => {
    // Même corpus, mêmes Maps que la suite de contraste : si la lecture
    // pointait encore src/index.css seul, ces tailles seraient à zéro.
    assert.ok(textOverrides.size >= 8, `remaps clairs lus : ${textOverrides.size}`);
    assert.ok(slateTextRemap.size >= 5, `remaps slate lus : ${slateTextRemap.size}`);
    assert.ok(whitenSurfaces.size >= 10, `surfaces :is() lues : ${whitenSurfaces.size}`);
  });
});
