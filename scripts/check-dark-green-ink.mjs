/**
 * Dark-ink gate — « une encre verte sous un `isDark` » ne doit pas revenir.
 *
 * Le dépôt a payé ce bug une fois : la convention d'encre d'un texte était
 * `currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'`. La branche
 * sombre portait donc un VERT — un accent de marque — sur les thèmes sombres
 * (midnight, slate) dont l'accent est l'ambre ou le bleu, pas le vert. Le
 * remap `!important` d'un thème ne peut rien contre ce vert : il ne connaît
 * que son propre accent, et la classe existe bel et bien.
 *
 * La migration d'encre a porté ces branches sur `currentTheme.inkStrong`
 * (l'encre neutre qui suit le thème). Ce contrôle est ce qui empêche la
 * convention de revenir par un copier-coller.
 *
 * ─── Le ternaire peut s'étaler sur plusieurs lignes ────────────────────────
 *
 * La forme naïve — `isDark` et la classe sur la MÊME ligne — est lue ligne à
 * ligne. Mais un ternaire formatté s'écrit souvent sur trois lignes :
 *
 *     const cls = currentTheme.isDark
 *       ? currentTheme.inkStrong
 *       : 'text-emerald-500';
 *
 * Ici `isDark` et `text-emerald-500` ne partagent AUCUNE ligne : le scan ligne
 * à ligne passe inévitablement à côté. Un second passage lit donc l'ARBRE :
 * chaque expression conditionnelle dont la CONDITION nomme `isDark` voit ses
 * deux branches inspectées, et une encre verte dans une branche posée sur une
 * AUTRE ligne que la condition est accusée. Le grain reste le même
 * (fichier, classe), et les branches d'un ternaire imbriqué — vues deux fois,
 * puisque le texte de la branche extérieure les contient — sont dédoublonnées.
 *
 * ─── Ce qui est interdit, et pourquoi seulement ça ─────────────────────────
 *
 * Une ligne qui nomme `isDark` ne doit pas porter de `text-emerald-*`. C'est
 * exactement la forme de l'ancienne convention : un ternaire piloté par le
 * thème qui choisit l'ENCRE d'un texte. Sur une telle ligne, le vert est un
 * accent déguisé en encre — il appartient au thème, donc à `inkStrong`.
 *
 * Le motif est étroit À DESSEIN. Le vert sémantique de l'application (« payé »,
 * « soldé », toasts de succès, badges) vit sur des lignes SANS `isDark`, et
 * souvent en variante `dark:text-emerald-400` : ces lignes-là ne sont pas
 * lues ici, et c'est ce qui garde le contrôle utile plutôt que bruyant. Un
 * contrôle qui interdirait tout `text-emerald-*` forcerait à choisir entre
 * « conforme » et « lisible » ; celui-ci ne tranche que la convention qui a
 * réellement fauté.
 *
 * ─── L'allowlist est une dette, pas une permission ─────────────────────────
 *
 * Chaque entrée NOMME le fichier, la CLASSE et la RAISON. Le grain est le
 * couple (fichier, classe), jamais le fichier : une exception accordée à une
 * bannière color-codée ne doit pas blanchir une régression ailleurs dans le
 * même fichier. Et quand l'exception disparaît du code, l'entrée devient
 * PÉRIMÉE et le contrôle ÉCHOUE jusqu'à sa suppression — chaque retrait est un
 * diff visible dans le commit qui le gagne, et la liste ne peut pas pourrir en
 * silence. C'est la même règle que scripts/check-theme-accents.mjs.
 *
 * ─── Lire du code, et refuser la vacuité ───────────────────────────────────
 *
 * La prose est blanchie par la couche partagée (`scripts/lib/source-text.mjs`) :
 * un commentaire qui CITE `'text-emerald-500'` (l'en-tête de ce fichier, la
 * JSDoc de `mainViewsProps.ts`) ne doit pas être accusé. Les lignes blanchies
 * gardent leurs offsets, donc `file:ligne` désigne la bonne ligne.
 *
 * Et un scan qui ne lit AUCUNE ligne `isDark` n'est pas un scan vert : c'est un
 * scan dont le motif a disparu. Il sort en **2**, en le disant, plutôt que de
 * rassurer en silence — la même discipline que partout ici.
 *
 * Usage: node scripts/check-dark-green-ink.mjs   (branché sur `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { SOURCE_EXTS, assertScanned, listFiles, maskComments } from './lib/source-text.mjs';

const ROOT = process.env.CHECK_DARK_GREEN_INK_ROOT || 'src';

/**
 * La dette de l'allowlist se juge sur l'ARBRE RÉEL. Une suite de tests pointe
 * ce contrôle sur une racine de fixtures : les exceptions du dépôt n'y existent
 * pas, et les déclarer « périmées » serait un faux échec. Le scan des violations
 * reste, lui, pleinement actif sur n'importe quelle racine.
 */
const scanningRealTree = path.resolve(ROOT) === path.resolve('src');

/** La convention protégée : une ligne qui choisit son encre selon le thème. */
const IS_DARK = /\bisDark\b/;

/**
 * L'encre verte, quelle qu'en soit la teinte et l'opacité (`text-emerald-300/80`,
 * `text-emerald-400`, `text-emerald-800`…). `\b` final : `-600` ne doit pas
 * matcher le préfixe d'un `-6000`.
 */
const GREEN_INK = /\btext-emerald-\d+(?:\/\d+)?\b/g;

/**
 * Les encres vertes trouvées dans un ternaire `isDark` MULTI-LIGNE.
 *
 * Le scan ligne à ligne exige que `isDark` et la classe partagent une ligne ;
 * un ternaire formatté sur trois lignes lui échappe. Cette passe comble ce
 * trou en lisant l'ARBRE (sur la source déjà blanchie des commentaires, pour
 * que la prose citant la convention ne soit pas accusée). On retient les
 * expressions conditionnelles dont la CONDITION nomme `isDark`, on inspecte
 * leurs deux branches, et on signale une encre verte posée sur une autre ligne
 * que la condition. Un ternaire imbriqué est vu deux fois (le texte de la
 * branche extérieure contient la branche intérieure) : le dédoublonnage des
 * violations s'en charge.
 *
 * @param {string} masked  source blanchie des commentaires (littéraux conservés)
 * @param {import('typescript').ScriptKind} kind
 * @returns {{ line: number, token: string }[]}
 */
function multilineInk(masked, kind) {
  const out = [];
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile('scan', masked, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  } catch {
    return out; // une source illisible n'est pas un vert : la vacuité parle plus bas
  }
  const lineOf = (pos) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = (node) => {
    if (ts.isConditionalExpression(node) && IS_DARK.test(node.condition.getText(sourceFile))) {
      const condLine = lineOf(node.condition.getStart(sourceFile));
      for (const branch of [node.whenTrue, node.whenFalse]) {
        const text = branch.getText(sourceFile);
        const base = branch.getStart(sourceFile);
        for (const hit of text.matchAll(GREEN_INK)) {
          const line = lineOf(base + hit.index);
          if (line !== condLine) out.push({ line, token: hit[0] });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/**
 * Les exceptions tolérées : `file` + `token` + `reason`. Une entrée dont le
 * couple (fichier, classe) n'est plus trouvé sur une ligne `isDark` est
 * PÉRIMÉE — le contrôle échoue jusqu'à sa suppression.
 *
 * VIDE : la bannière de rôles de SettingsUsersCard a été migrée vers les jetons
 * d'accent (le rôle « administrateur » suit désormais le thème au lieu de coder
 * sa couleur en vert), donc ses deux encres vertes sous `isDark` n'existent
 * plus. La liste reste un tableau pour qu'une future exception doive se NOMMER
 * ici avec sa raison, plutôt que de blanchir une ligne en silence.
 */
const ALLOWLIST = [];

const files = listFiles(ROOT, { ext: SOURCE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });

const allowed = new Map(ALLOWLIST.map((entry) => [`${entry.file}::${entry.token}`, entry.reason]));
const seen = new Set();
const reported = new Set();

const violations = [];
let darkLines = 0;

/**
 * Enregistre une encre verte trouvée sous `isDark` : l'allowlist la blanchit,
 * sinon elle devient une violation, dédoublonnée par (fichier, ligne, classe)
 * pour qu'un ternaire imbriqué vu deux fois ne soit rapporté qu'une fois.
 */
function record(key, line, token, rawLines) {
  const id = `${key}::${token}`;
  if (allowed.has(id)) {
    seen.add(id);
    return;
  }
  const dedupe = `${key}:${line}:${token}`;
  if (reported.has(dedupe)) return;
  reported.add(dedupe);
  violations.push(`${key}:${line} → ${token}\n      ${(rawLines[line - 1] ?? '').trim().slice(0, 160)}`);
}

// La clé d'un fichier est DÉPÔT-RELATIVE, jamais dépendante de la forme de la
// racine : `listFiles` rend `src/…` pour une racine relative et un chemin
// absolu pour une racine absolue, et une allowlist écrite en chemins dépôt ne
// doit pas dépendre de ce détail d'appel.
const repoKey = (file) => path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, '/');

for (const file of files) {
  const key = repoKey(file);
  const raw = fs.readFileSync(file, 'utf8');
  // Commentaires blanchis, littéraux CONSERVÉS : une classe vit dans une chaîne,
  // et c'est exactement ce qu'on veut lire. La longueur et les lignes ne bougent
  // pas, donc `file:ligne` ci-dessous désigne la ligne d'origine.
  const masked = maskComments(raw);
  const maskedLines = masked.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  // 1. Le ternaire sur UNE ligne : `isDark` et la classe se partagent la ligne.
  for (let i = 0; i < maskedLines.length; i += 1) {
    const line = maskedLines[i];
    if (!IS_DARK.test(line)) continue;
    darkLines += 1;
    for (const hit of line.matchAll(GREEN_INK)) {
      record(key, i + 1, hit[0], rawLines);
    }
  }
  // 2. Le ternaire ÉTALÉ : `isDark` sur une ligne, la classe sur une autre.
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  for (const { line, token } of multilineInk(masked, kind)) {
    record(key, line, token, rawLines);
  }
}

// Un scan vide n'est pas un vert : si plus aucune ligne `isDark` n'est lue, le
// motif que ce contrôle protège a disparu — à retirer, ou à corriger.
if (darkLines === 0) {
  console.error(
    `❌ Rien à vérifier : aucune ligne \`isDark\` lue sous ${ROOT} — un scan vide n'est pas un vert.`,
  );
  console.error(
    '   Si la convention `isDark` a été retirée du code, retirez ce contrôle ; sinon vérifiez sa racine.',
  );
  process.exit(2);
}

const stale = scanningRealTree
  ? ALLOWLIST.map((entry) => `${entry.file}::${entry.token}`).filter((id) => !seen.has(id))
  : [];

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error(
    '❌ Encre verte (`text-emerald-*`) sur une ligne pilotée par `isDark` — elle ne suivra pas le thème :',
  );
  for (const v of violations) console.error(`   ${v}`);
  console.error('   → utilisez currentTheme.inkStrong (l’encre neutre qui suit le thème).');
}

if (stale.length > 0) {
  failed = true;
  console.error(
    '❌ Entrée(s) PÉRIMÉE(S) dans ALLOWLIST — le couple (fichier, classe) n’est plus une encre verte sous `isDark` :',
  );
  for (const id of stale) console.error(`   ${id}`);
  console.error('   → retirez l’entrée dans le commit qui l’a gagnée.');
}

if (failed) process.exit(1);

console.log(
  `✅ Aucune encre verte sous \`isDark\` hors allowlist (${files.length} fichier(s) .ts/.tsx, ` +
    `${darkLines} ligne(s) isDark, ${ALLOWLIST.length} exception(s) motivée(s)).`,
);
