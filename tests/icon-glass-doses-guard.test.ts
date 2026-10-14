/**
 * Suite for scripts/check-icon-glass-doses.mjs — the gate that refuses a
 * DIVERGENCE between the doses DECLARED by the code (src/lib/iconGlass.ts) and
 * the dose BLOCKS written in the sheet (src/themes/icons.css).
 *
 * The setting has two halves in two languages, and nothing links them: the
 * TypeScript list says which names exist and which one is delivered, the CSS
 * says what each name DOES. The failures the gate exists for are invisible at
 * runtime — an offered dose with no block changes nothing at all, a block
 * written for a name nobody offers is dead CSS, a variable posed by a dose but
 * never read rules nothing, a variable read but posed by nobody is a fallback in
 * disguise, and a fallback that disagrees with the delivered dose makes the page
 * change appearance before hydration (or inside any fragment mounted outside the
 * shell root).
 *
 * The gate is judged the way this repository judges every gate: on fabricated
 * sources — a rule nobody can trigger is decoration — on the REAL pair of files,
 * with the prose-as-code trap in both halves (the sheet's header names a dose
 * class, the module's JSDoc cites a level), and with the REFUSAL OF VACUITY
 * (absent/empty file, empty list, sheet without a single dose block ⇒ exit 2,
 * never a green over nothing).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';
import {
  judgeIconGlassDoses,
  parseDeclaredDoses,
  parseDoseBlocks,
} from '../scripts/lib/icon-glass-doses.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'scripts/check-icon-glass-doses.mjs';
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Run = { status: number | undefined; stdout: string; stderr: string };
type Pair = { code?: string; sheet?: string };

/** Lance le garde sur deux chemins (sans argument : les fichiers RÉELS du dépôt). */
function runGuard(codeFile?: string, sheetFile?: string): Run {
  try {
    const stdout = execFileSync(process.execPath, [GUARD], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(codeFile ? { CHECK_ICON_GLASS_CODE_FILE: codeFile } : {}),
        ...(sheetFile ? { CHECK_ICON_GLASS_SHEET_FILE: sheetFile } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Écrit les deux moitiés dans un dossier temporaire, lance `fn(run)`, nettoie. */
function withPair<T>({ code = CODE, sheet = SHEET }: Pair, fn: (run: Run) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-icon-glass-'));
  try {
    const codeFile = join(dir, 'iconGlass.ts');
    const sheetFile = join(dir, 'icons.css');
    writeFileSync(codeFile, code, 'utf8');
    writeFileSync(sheetFile, sheet, 'utf8');
    return fn(runGuard(codeFile, sheetFile));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── Les deux moitiés conformes — la fixture de référence ────────────────────
// Le code déclare trois doses et livre « animated » ; la feuille écrit un bloc
// par dose et CONSOMME deux variables dont les replis sont exactement les
// valeurs de la dose livrée. Réduite à deux variables : la règle de dosage ne
// compte pas les nombres, elle confronte les deux moitiés.
const CODE = `/**
 * Le dosage du verre des icônes — trois doses, « animé » étant la dose livrée.
 */
export type IconGlass = 'discreet' | 'crisp' | 'animated';

export const DEFAULT_ICON_GLASS: IconGlass = 'animated';

/** Les doses, dans l'ordre où la carte les propose. */
export const ICON_GLASS_LEVELS: readonly IconGlass[] = ['discreet', 'crisp', 'animated'];
`;

const SHEET = `/* Le dosage du verre — trois doses, une classe sur la racine.
 *
 * Les règles de base consomment des variables dont les valeurs de repli sont la
 * dose livrée (« animé »), donc un fragment monté sans la classe rend ce qui a
 * été livré.
 */

svg.lucide {
  border-radius: var(--icon-glass-radius, 34%);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, currentColor var(--icon-glass-edge, 26%), transparent),
    0 1px 2px color-mix(in srgb, currentColor var(--icon-glass-edge, 26%), transparent);
}

.icon-glass-animated {
  --icon-glass-edge: 26%;
  --icon-glass-radius: 34%;
}

.icon-glass-crisp {
  --icon-glass-edge: 34%;
  --icon-glass-radius: 22%;
}

.icon-glass-discreet {
  --icon-glass-edge: 15%;
  --icon-glass-radius: 30%;
}
`;

/** Le bloc « crisp » de la fixture, pour les mutations qui le retirent ou le vident. */
const CRISP_BLOCK = `.icon-glass-crisp {
  --icon-glass-edge: 34%;
  --icon-glass-radius: 22%;
}
`;

describe('icon-glass doses gate — les doses du code et les blocs de la feuille ne divergent pas', () => {
  it('les fichiers réels du dépôt sont alignés, et le contrôle le dit', () => {
    const result = runGuard();
    assert.equal(result.status, 0, `le garde doit passer sur les vrais fichiers : ${result.stderr}`);
    assert.match(result.stdout, /3 dose\(s\) déclarée\(s\)/);
    assert.match(result.stdout, /discreet → crisp → animated/);
    assert.match(result.stdout, /défaut « animated »/);
    assert.match(result.stdout, /SONT les replis de la feuille/);
  });

  it('la paire conforme passe (la règle est bien celle-là)', () => {
    withPair({}, (run) => {
      assert.equal(run.status, 0, `une paire alignée doit être verte : ${run.stderr}`);
    });
  });

  it('une dose OFFERTE sans bloc dans la feuille est nommée', () => {
    withPair({ sheet: SHEET.replace(CRISP_BLOCK, '') }, (run) => {
      assert.equal(run.status, 1);
      assert.match(run.stderr, /dose\(s\) sans bloc dans la feuille/);
      assert.match(run.stderr, /\.icon-glass-crisp/);
    });
  });

  it('un bloc ORPHELIN (une dose que le code n’offre pas) est refusé', () => {
    withPair(
      { sheet: `${SHEET}\n.icon-glass-ghost {\n  --icon-glass-edge: 12%;\n}\n` },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /ORPHELIN/);
        assert.match(run.stderr, /\.icon-glass-ghost/);
      },
    );
  });

  it('un bloc de dose qui ne pose AUCUNE variable n’est pas une dose', () => {
    withPair(
      { sheet: SHEET.replace(CRISP_BLOCK, '.icon-glass-crisp {\n}\n') },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /ne pose AUCUNE variable/);
      },
    );
  });

  it('une variable posée par une dose mais JAMAIS lue est nommée', () => {
    withPair(
      { sheet: SHEET.replace('--icon-glass-edge: 26%;', '--icon-glass-edge: 26%;\n  --icon-glass-halo: 2px;') },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /JAMAIS lue\(s\)/);
        assert.match(run.stderr, /--icon-glass-halo/);
      },
    );
  });

  it('une variable lue mais posée par AUCUNE dose est un repli déguisé', () => {
    withPair(
      {
        sheet: SHEET.replace(
          'svg.lucide {',
          'svg.lucide {\n  filter: var(--icon-glass-halo, 0);',
        ),
      },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /posée\(s\) par AUCUNE dose/);
        assert.match(run.stderr, /--icon-glass-halo/);
      },
    );
  });

  it('la feuille qui cesse de CONSOMMER ses variables tombe aussi', () => {
    // Sans les règles de base, chaque variable posée par une dose devient une
    // variable que plus personne ne lit : le dosage n'agit plus sur rien. Les
    // trois blocs restent — c'est bien la LECTURE qui a disparu, pas le dosage.
    withPair({ sheet: SHEET.replace(/svg\.lucide \{[^}]*\}\n\n/, '') }, (run) => {
      assert.equal(run.status, 1);
      assert.match(run.stderr, /JAMAIS lue\(s\)/);
      assert.match(run.stderr, /--icon-glass-edge/);
    });
  });

  it('une variable lue SANS valeur de repli est refusée', () => {
    withPair(
      { sheet: SHEET.replace('var(--icon-glass-radius, 34%)', 'var(--icon-glass-radius)') },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /SANS valeur de repli/);
        assert.match(run.stderr, /--icon-glass-radius/);
      },
    );
  });

  it('un repli qui ne vaut pas la dose livrée est nommé, avec les deux valeurs', () => {
    withPair(
      { sheet: SHEET.replace('--icon-glass-edge: 26%;', '--icon-glass-edge: 20%;') },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /le repli de --icon-glass-edge vaut « 26% »/);
        assert.match(run.stderr, /« animated » le pose à « 20% »/);
      },
    );
  });

  it('un défaut qui n’est PAS une dose offerte est refusé', () => {
    withPair(
      { code: CODE.replace("DEFAULT_ICON_GLASS: IconGlass = 'animated'", "DEFAULT_ICON_GLASS: IconGlass = 'net'") },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /défaut « net »/);
        assert.match(run.stderr, /n’est PAS une dose offerte/);
      },
    );
  });

  it('un défaut absent est refusé (la dose livrée doit être dite)', () => {
    const noDefault = CODE.replace(
      "export const DEFAULT_ICON_GLASS: IconGlass = 'animated';\n",
      '',
    );
    withPair({ code: noDefault }, (run) => {
      assert.equal(run.status, 1);
      assert.match(run.stderr, /DEFAULT_ICON_GLASS/);
      assert.match(run.stderr, /introuvable/);
    });
  });

  it('une dose déclarée DEUX fois dans la liste est refusée', () => {
    withPair(
      { code: CODE.replace("['discreet', 'crisp', 'animated']", "['discreet', 'crisp', 'animated', 'crisp']") },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /doses déclarées DEUX fois/);
        assert.match(run.stderr, /crisp/);
      },
    );
  });

  it('deux blocs pour la même dose sont refusés', () => {
    withPair(
      {
        sheet: SHEET.replace(
          '.icon-glass-crisp {',
          '.icon-glass-crisp { --icon-glass-edge: 12%; }\n\n.icon-glass-crisp {',
        ),
      },
      (run) => {
        assert.equal(run.status, 1);
        assert.match(run.stderr, /deux blocs pour la même dose/);
        assert.match(run.stderr, /crisp/);
      },
    );
  });

  it('la prose de la feuille ne compte NI comme bloc, ni comme lecture', () => {
    const prose = SHEET.replace(
      '.icon-glass-animated {',
      '/* .icon-glass-ghost { --icon-glass-edge: 1%; } — cité, jamais déclaré\n   and a read: filter: var(--icon-glass-halo, 0); */\n\n.icon-glass-animated {',
    );
    withPair({ sheet: prose }, (run) => {
      assert.equal(run.status, 0, `un bloc en commentaire ne doit pas être un bloc : ${run.stderr}`);
    });
  });

  it('un bloc de dose CITÉ en prose ne satisfait pas la dose qui manque', () => {
    const cited = SHEET.replace(
      CRISP_BLOCK,
      '/* .icon-glass-crisp { --icon-glass-edge: 34%; --icon-glass-radius: 22%; } */\n',
    );
    withPair({ sheet: cited }, (run) => {
      assert.equal(run.status, 1, 'la prose nomme la dose, elle ne l’écrit pas');
      assert.match(run.stderr, /dose\(s\) sans bloc dans la feuille/);
      assert.match(run.stderr, /\.icon-glass-crisp/);
    });
  });

  it('la prose du code qui CITE la liste ne déclare aucune dose', () => {
    const commented = CODE.replace(
      '/** Les doses, dans l’ordre où la carte les propose. */',
      "// export const ICON_GLASS_LEVELS: readonly IconGlass[] = ['ghost', 'tint'];\n/** Les doses, dans l’ordre où la carte les propose. */",
    );
    withPair({ code: commented }, (run) => {
      assert.equal(run.status, 0, `une liste citée en commentaire n’est pas une liste : ${run.stderr}`);
    });
  });

  it('un repli écrit sur plusieurs lignes reste la dose livrée (espaces normalisés)', () => {
    withPair(
      { sheet: SHEET.replace('var(--icon-glass-radius, 34%)', 'var(--icon-glass-radius,\n      34%)') },
      (run) => {
        assert.equal(run.status, 0, `seul le FOND des valeurs est comparé : ${run.stderr}`);
      },
    );
  });

  // ── La vacuité : un refus, jamais un vert ────────────────────────────────
  it('un fichier absent est un refus (exit 2), pas un contrat tenu', () => {
    const missingCode = runGuard(join(tmpdir(), 'mama-icon-glass-absent', 'iconGlass.ts'));
    assert.equal(missingCode.status, 2, 'sans code, il n’y a pas de doses déclarées');
    assert.match(missingCode.stderr, /Rien à vérifier/);

    const missingSheet = runGuard(
      join(root, 'src/lib/iconGlass.ts'),
      join(tmpdir(), 'mama-icon-glass-absent', 'icons.css'),
    );
    assert.equal(missingSheet.status, 2, 'sans feuille, il n’y a pas de blocs à lui confronter');
    assert.match(missingSheet.stderr, /Rien à vérifier/);
    assert.match(missingSheet.stderr, /icons\.css/);
  });

  it('une feuille VIDE est un refus (exit 2)', () => {
    withPair({ sheet: '   \n\n' }, (run) => {
      assert.equal(run.status, 2);
      assert.match(run.stderr, /Rien à vérifier/);
    });
  });

  it('une feuille sans aucun bloc de dose est un refus (exit 2), pas une conformité', () => {
    const base = SHEET.slice(0, SHEET.indexOf('.icon-glass-animated'));
    withPair({ sheet: base }, (run) => {
      assert.equal(run.status, 2);
      assert.match(run.stderr, /Rien à comparer/);
      assert.match(run.stderr, /0 bloc\(s\)/);
    });
  });

  it('une liste de doses vide ou absente est un refus (exit 2)', () => {
    withPair({ code: CODE.replace("['discreet', 'crisp', 'animated']", '[]') }, (run) => {
      assert.equal(run.status, 2);
      assert.match(run.stderr, /Rien à comparer/);
      assert.match(run.stderr, /0 dose\(s\) déclarée\(s\)/);
    });
    withPair({ code: CODE.replace(/export const ICON_GLASS_LEVELS.*\n/, '') }, (run) => {
      assert.equal(run.status, 2, 'une liste introuvable n’est pas une liste vide : les deux refusent de conclure');
      assert.match(run.stderr, /Rien à comparer/);
    });
  });

  // ── Le module de comparaison, jugé directement ───────────────────────────
  it('la couche partagée nomme ses refus, y compris ceux que l’arête refuse plus tôt', () => {
    // L'arête sort en 2 dès que `levels.length === 0` : ces deux constats du
    // module restent donc inatteignables depuis la ligne de commande, et c'est
    // pourquoi la suite les juge ICI — un message que rien n'exécute n'est pas
    // une garantie, c'est une phrase.
    const empty = judgeIconGlassDoses({
      code: CODE.replace("['discreet', 'crisp', 'animated']", '[]'),
      sheet: SHEET,
    });
    assert.match(empty.problems.join('\n'), /ICON_GLASS_LEVELS` est VIDE/);

    const absent = judgeIconGlassDoses({
      code: CODE.replace(/export const ICON_GLASS_LEVELS.*\n/, ''),
      sheet: SHEET,
    });
    assert.match(absent.problems.join('\n'), /ICON_GLASS_LEVELS` est INTROUVABLE/);

    const conform = judgeIconGlassDoses({ code: CODE, sheet: SHEET });
    assert.deepEqual(conform.problems, []);
    assert.deepEqual(conform.levels, ['discreet', 'crisp', 'animated']);
    assert.equal(conform.defaultLevel, 'animated');
    assert.deepEqual(conform.blocks, ['animated', 'crisp', 'discreet']);
  });

  it('les lecteurs ne voient que ce qui est écrit — le balisage et les littéraux sont lus', () => {
    const sheet = `/* .icon-glass-ghost { --icon-glass-edge: 1%; } */\n.icon-glass-animated {\n  --icon-glass-edge: 26%;\n}\n`;
    const blocks = parseDoseBlocks(sheet);
    assert.deepEqual(
      blocks.map((b) => b.name),
      ['animated'],
      'un bloc en commentaire ne doit pas être lu comme un bloc',
    );
    assert.deepEqual(blocks[0].variables, ['edge']);

    const code = `// ICON_GLASS_LEVELS = ['ghost'];\nexport const ICON_GLASS_LEVELS = ['discreet', 'crisp', 'animated'];\n/** DEFAULT_ICON_GLASS = 'net'; */\nexport const DEFAULT_ICON_GLASS = 'animated';\n`;
    const declared = parseDeclaredDoses(code);
    assert.deepEqual(declared.levels, ['discreet', 'crisp', 'animated']);
    assert.equal(declared.defaultLevel, 'animated');
    assert.equal(declared.listDeclared, true);
  });

  it('le garde est câblé dans `npm run lint` et déclaré dans l’inventaire d’immunités', () => {
    const chain = [PKG.scripts.lint, PKG.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-icon-glass-doses\.mjs/);

    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-icon-glass-doses.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const declared = entry as { needs?: string[]; via?: string };
    const needs = declared.needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    assert.ok(needs.includes(IMMUNITY.PROSE_BLIND), 'il doit blanchir la prose');
    assert.equal(
      declared.via,
      'icon-glass-doses.mjs',
      'la cécité à la prose vit dans le module de comparaison, et l’entrée doit le NOMMER',
    );
  });
});
