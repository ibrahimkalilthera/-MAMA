/**
 * ─── Lire du code, pas de la prose ─────────────────────────────────────────
 *
 * Ce dépôt a payé **trois fois** la même erreur : un contrôle textuel qui a lu
 * de la prose comme si c'était du code, ou l'inverse.
 *
 *   1. `check:test-integrity` a lu une fixture construite dans un template
 *      literal et y a vu des mocks inertes ;
 *   2. `check:gate-sentinels` a accusé sa propre suite, qui *parlait* d'un
 *      exemple d'impression dans un commentaire ;
 *   3. `check:test-integrity` encore, dont l'assertion « une seule définition
 *      de la marque » comptait les LECTEURS comme des définitions.
 *
 * Chaque fois, le remède a été écrit sur place — et il y avait donc quatre
 * façons de blanchir la prose, quatre jeux de règles, quatre occasions de se
 * tromper à nouveau. Ce module en fait **une seule**.
 *
 * ─── Pourquoi un scanner et pas une expression régulière ───────────────────
 *
 * `'https://exemple.fr'` contient `//`. `// l'utilisateur` contient une
 * apostrophe. Un blanchiment par regex voit l'un ou l'autre en premier et
 * avale la moitié de la ligne qui suit — c'est-à-dire du CODE, qu'on ne lit plus.
 * Le scanner de TypeScript, lui, connaît la question : il distingue commentaire,
 * chaîne, template, et la partie `${…}` d'un template reste du code visible.
 *
 * ─── La propriété tenue partout : la LONGUEUR ne bouge pas ─────────────────
 *
 * Chaque caractère remplacé devient une espace, jamais rien — sauf les sauts de
 * ligne, qui restent. Un décalage trouvé dans le texte blanchi désigne donc
 * exactement la même ligne dans le fichier d'origine, et un contrôle peut
 * toujours dire OÙ est le problème.
 *
 * ─── Et le refus de la vacuité ─────────────────────────────────────────────
 *
 * Un scan qui n'a rien lu n'est pas un scan vert : c'est un scan vide. Le
 * chemin a déjà bougé une fois (le budget de lignes vit dans `src/`, la racine
 * d'un contrôle peut disparaître), et un contrôle qui ne vérifie rien en
 * silence est pire qu'absent — il rassure. `assertScanned` sort donc en **2**,
 * avec ce qu'il cherchait et où.
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

/** Extensions de code source, pour les scans qui lisent du TypeScript. */
export const SOURCE_EXTS = /\.(ts|tsx)$/;
/** TypesScript + les feuilles de style (budget de lignes, sélecteurs CSS). */
export const CODE_EXTS = /\.(ts|tsx|css)$/;

/**
 * Ce qu'on garde autour du contenu blanchi, par sorte de littéral : les
 * délimiteurs restent lisibles (`'…'`, `` `…` ``, `` `…${ ``, `}…` ``) pour
 * qu'un contrôle qui cherche un littéral le reconnaisse encore.
 */

/**
 * Les plages à blanchir, lues sur l'ARBRE — et non sur une suite de jetons.
 *
 * Mesuré, sur un cas que ce dépôt contient vraiment : un template AVEC
 * interpolation suivi d'un template dont le contenu commence par `//`.
 *
 *   `import { it } from 'node:test';\n${OK}` +
 *   `const url = 'http://localhost/';\n` +
 *   `// mock.module('node:child_process', {});\n` +
 *
 * Après la partie `${…}`, le `}` doit être RESCANNÉ en fin de gabarit — c'est le
 * parseur qui le fait. Un scan jeton par jeton ne le fait pas : le gabarit
 * suivant est alors lu comme du CODE, et le `//` qu'il contient devient un
 * commentaire. Résultat : la ligne entière était blanchie comme de la prose, le
 * code suivant se retrouvait exposé, et le contrôle lisait exactement l'inverse
 * de ce qu'il prétend lire (« saut de suite piloté par l'OS » trouvé dans une
 * FIXTURE, donc accusé au nom du mauvais fichier).
 *
 * Les plages de littéraux viennent donc du parseur, qui rescanne ; le scanner ne
 * sert plus que aux commentaires, et un jeton de commentaire qui TOMBE DANS une
 * de ces plages est du contenu, pas un commentaire.
 *
 * @param {string} source
 * @returns {{ from: number, to: number, keepStart: number, keepEnd: number, template: boolean }[]}
 */
function literalRanges(source) {
  const file = ts.createSourceFile(
    'prose.tsx',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const ranges = [];
  const add = (node, keepStart, keepEnd, template) => {
    ranges.push({ from: node.getStart(file), to: node.getEnd(), keepStart, keepEnd, template });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, 1, 1, ts.isNoSubstitutionTemplateLiteral(node));
    } else if (ts.isTemplateExpression(node)) {
      add(node.head, 1, 2, true);
      for (const span of node.templateSpans) {
        add(span.literal, 1, ts.isTemplateTail(span.literal) ? 1 : 2, true);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return ranges;
}

/**
 * Remplace par des espaces le contenu des commentaires et des littéraux, en
 * gardant tout le reste — longueur et sauts de ligne compris.
 *
 * `literals` distingue trois besoins réels rencontrés dans ce dépôt — et la
 * nuance n'est pas cosmétique : un contrôle qui lit un SPÉCIFIEUR de module a
 * besoin du contenu des chaînes (`mock.module('node:fs')`), alors qu'un contrôle
 * qui cherche du CODE écrit ne doit surtout pas y voir une fixture :
 *
 *   • `false`          → aucun littéral touché ;
 *   • `'templates'`    → seuls les littéraux gabarits (le code écrit dans un
 *                        backtick est de la DONNÉE, pas du code) ;
 *   • `true`           → toutes les chaînes, gabarits compris.
 *
 * @param {string} text
 * @param {{ comments?: boolean, literals?: boolean | 'templates' }} [options] ce qu'on blanchit
 * @returns {string}
 */
export function maskProse(text, { comments = true, literals = true } = {}) {
  const source = String(text ?? '');
  const chars = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < chars.length; i += 1) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  };

  // Une seule lecture de l'arbre sert aux deux blanchiments : les littéraux par
  // leurs plages (les délimiteurs restent visibles), les commentaires par le
  // scanner, filtré de ce qui appartient à un littéral.
  const ranges = literalRanges(source);
  if (literals) {
    for (const { from, to, keepStart, keepEnd, template } of ranges) {
      if (literals === 'templates' && !template) continue;
      blank(from + keepStart, to - keepEnd);
    }
  }

  if (comments) {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      /* skipTrivia */ false,
      ts.LanguageVariant.JSX,
      source,
    );
    // Le scanner seul ne suffit pas, et c'est le cœur du module : après un
    // `${…}`, le `}` doit être RESCANNÉ en fin de gabarit (`rescanTemplateToken`),
    // exactement comme le fait le parseur. Sans ce rescan, tout ce qui suit une
    // interpolation est lu comme du gabarit : les commentaires RÉELS n'y sont
    // plus vus comme des commentaires (l'emoji d'un commentaire remonte alors
    // comme du JSX), et un `//` de fixture finit par être pris pour un vrai
    // commentaire. Les accolades sont donc comptées pour savoir QUEL `}` ferme
    // une interpolation, et les gabarits imbriqués sont empilés.
    // La pile porte la profondeur d'accolades EXTERIEURE au moment où chaque
    // `${…}` s'ouvre. Sans elle, une accolade déjà ouverte (le corps d'une
    // fonction, par exemple) fait classer le `}` d'une interpolation comme une
    // simple accolade de code : l'interpolation n'est jamais rescannée, tout ce
    // qui suit est lu comme du gabarit — et c'est exactement l'état mesuré ici
    // (un commentaire de 70 lignes avalé dans un jeton de gabarit).
    let openBrace = 0;
    const spanStack = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.OpenBraceToken) {
        openBrace += 1;
        continue;
      }
      if (token === ts.SyntaxKind.CloseBraceToken) {
        if (openBrace > 0) {
          openBrace -= 1;
          continue;
        }
        if (spanStack.length > 0) {
          const rescanned = scanner.reScanTemplateToken(false);
          if (rescanned === ts.SyntaxKind.TemplateTail) openBrace = spanStack.pop();
          continue;
        }
        continue;
      }
      if (token === ts.SyntaxKind.TemplateHead) {
        spanStack.push(openBrace);
        openBrace = 0;
        continue;
      }
      if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) {
        continue;
      }
      const start = scanner.getTokenPos();
      const end = scanner.getTextPos();
      // Un `//` qui TOMBE dans un littéral n'est pas un commentaire (l'URL d'un
      // exemple, un mock commenté dans une fixture) : blanchir à partir de là
      // effacerait du VRAI code, c'est-à-dire le contraire du travail demandé.
      if (ranges.some((r) => start >= r.from && start < r.to)) continue;
      blank(start, end);
    }
  }
  return chars.join('');
}

/**
 * Blanchit les commentaires seuls. Conservé sous ce nom parce que c'est celui
 * déjà utilisé (et testé) par `scripts/lib/gate-sentinels.mjs` : un garde qui
 * lit des journaux doit voir le code, pas la prose qui en parle.
 * @param {string} text
 * @returns {string}
 */
export const maskComments = (text) => maskProse(text, { comments: true, literals: false });

/**
 * Liste récursive, triée, en chemins à barres obliques (stable entre postes).
 * @param {string} root
 * @param {{ ext?: RegExp, skip?: string[] }} [options]
 * @returns {string[]}
 */
export function listFiles(root, { ext = SOURCE_EXTS, skip = ['node_modules', 'dist', '.git'] } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // racine absente : c'est la vacuité qui parle plus bas, pas ici
    }
    for (const entry of entries) {
      if (skip.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (ext.test(entry.name)) out.push(full.replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Lis un fichier et rend la version « code seul » à côté du texte d'origine.
 * @param {string} file
 * @param {{ comments?: boolean, literals?: boolean }} [options]
 * @returns {{ raw: string, code: string }}
 */
export function readMasked(file, options) {
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, code: maskProse(raw, options) };
}

/**
 * Un index de lignes : un décalage dans le texte blanchi désigne la même ligne
 * que dans l'original, puisque rien n'a bougé de place.
 * @param {string} text
 * @returns {(offset: number) => number} numéro de ligne, 1-based
 */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * La ligne brute n° `line` (1-based), sans son saut de ligne.
 * @param {string} text
 * @param {number} line
 * @returns {string}
 */
export function lineAt(text, line) {
  return String(text ?? '').split(/\r?\n/)[line - 1] ?? '';
}

/**
 * « Rien lu » : le message qui dit POURQUOI c'est un échec, ou `null` quand il y
 * a bien quelque chose à vérifier.
 *
 * Un contrôle qui ne lit rien et sort en vert est le mensonge le plus coûteux du
 * lot : il ne dit pas « je n'ai pas pu », il dit « tout va bien ».
 *
 * @param {{ length: number } | unknown[]} files
 * @param {{ what: string, root?: string }} context
 * @returns {string | null}
 */
export function vacuum(files, { what, root = null }) {
  const count = Array.isArray(files) ? files.length : Number(files?.length ?? 0);
  if (count > 0) return null;
  const where = root ? ` sous ${root}` : '';
  return [
    `❌ Rien à vérifier : 0 ${what}${where} — un scan vide n'est pas un vert.`,
    '   Vérifiez la racine du contrôle et son filtre d’extension : c’est presque toujours l’un des deux.',
  ].join('\n');
}

/**
 * Refuse la vacuité, en nommant le contrôle et sa racine. Sortie **2** (et non
 * 1) : ce n'est pas une violation trouvée, c'est une vérification impossible.
 *
 * @param {{ length: number } | unknown[]} files
 * @param {{ what: string, root?: string }} context
 * @returns {void}
 */
export function assertScanned(files, context) {
  const message = vacuum(files, context);
  if (message) {
    console.error(message);
    process.exit(2);
  }
}
