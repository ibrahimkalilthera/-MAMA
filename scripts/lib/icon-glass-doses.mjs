/**
 * ─── Le contrat de dosage du verre des icônes, en UNE comparaison ───────────
 *
 * Le réglage « verre des icônes » a deux moitiés qui vivent dans deux fichiers
 * et deux langages :
 *
 *   • le CODE (`src/lib/iconGlass.ts`) déclare les doses OFFERTES
 *     (`ICON_GLASS_LEVELS`) et celle qui est le DÉFAUT (`DEFAULT_ICON_GLASS`) —
 *     c'est cette liste que la carte des Préférences itère et que l'état
 *     persiste ;
 *   • la FEUILLE (`src/themes/icons.css`) écrit les blocs `.icon-glass-<dose>`
 *     qui donnent un sens visuel à chaque nom, en posant les variables
 *     `--icon-glass-*` que les règles de base consomment.
 *
 * Rien, dans le langage ni dans le typage, ne relie les deux. Une dose ajoutée
 * au code sans bloc dans la feuille s'affiche dans le menu et ne fait RIEN
 * (le nom ne rencontre aucune règle) ; un bloc écrit pour une dose que le code
 * n'offre pas est une règle morte que personne ne peut atteindre ; une variable
 * posée par une dose mais jamais lue est un réglage qui ne règle rien ; une
 * variable lue mais posée par aucune dose n'est plus une dose, c'est un repli
 * déguisé ; et un repli qui ne vaut pas la dose livrée fait que la page CHANGE
 * d'aspect avant l'hydratation, ou dans un fragment monté hors de la racine.
 *
 * Ce module porte la comparaison, et rien d'autre : il lit deux textes, il est
 * PUR, et ses manquements sont NOMMÉS (dose, variable, fichier). Le contrôle
 * (`scripts/check-icon-glass-doses.mjs`) est l'arête d'entrée/sortie ; la suite
 * (`tests/icon-glass-doses-guard.test.ts`) le juge sur des sources fabriquées
 * ET sur les fichiers réels — une règle qu'aucune falsification ne fait rougir
 * est de la décoration.
 *
 * ─── Lire du code, pas de la prose ─────────────────────────────────────────
 *
 * Les deux corpus sont des textes où la prose CITE exactement ce qu'on cherche :
 * l'en-tête de la feuille parle de `.icon-glass-crisp`, et la JSDoc du module
 * cite `'discreet'`. Les commentaires sont donc blanchis — par la couche
 * partagée, jamais par une copie locale : `maskComments` pour le TypeScript
 * (les noms de dose sont des LITTÉRAUX, donc conservés : c'est la donnée même),
 * `maskMarkupComments` pour la feuille (en CSS, seuls le bloc de commentaire
 * slash-étoile et les délimiteurs HTML sont des commentaires — une double barre
 * oblique n'en est jamais un).
 */

import { maskComments, maskMarkupComments } from './source-text.mjs';

/** Les valeurs sont comparées à espaces près : seul le FOND doit être identique. */
const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Les doses déclarées par le code : la liste offerte, et celle qui est le défaut.
 *
 * @param {string} code source de `src/lib/iconGlass.ts` (ou d'un fixture)
 * @returns {{ levels: string[], defaultLevel: string | null, listDeclared: boolean }}
 */
export function parseDeclaredDoses(code) {
  const masked = maskComments(code);
  const list = masked.match(/ICON_GLASS_LEVELS[^=]*=\s*\[([^\]]*)\]/);
  const levels = [];
  if (list) {
    for (const m of list[1].matchAll(/['"]([a-z0-9-]+)['"]/g)) levels.push(m[1]);
  }
  const fallback = masked.match(/DEFAULT_ICON_GLASS[^=]*=\s*['"]([a-z0-9-]+)['"]/);
  return {
    levels,
    defaultLevel: fallback ? fallback[1] : null,
    listDeclared: Boolean(list),
  };
}

/**
 * Les blocs de dose écrits dans la feuille : `.icon-glass-<dose> { … }`.
 *
 * Le motif exige que la classe soit immédiatement suivie de `{` : les règles de
 * PORTÉE (`:is(.icon-glass-discreet, .icon-glass-crisp) .nav-item svg.lucide {`),
 * qui décrivent comment la matière s'applique, ne sont donc pas prises pour des
 * déclarations de dose — elles ne définissent rien, elles consomment.
 *
 * @param {string} sheet source de `src/themes/icons.css`
 * @returns {{ name: string, variables: string[], values: Map<string, string> }[]}
 */
export function parseDoseBlocks(sheet) {
  const masked = maskMarkupComments(sheet);
  const blocks = [];
  for (const m of masked.matchAll(/\.icon-glass-([a-z0-9-]+)\s*\{([^{}]*)\}/g)) {
    const body = m[2];
    const values = new Map();
    for (const d of body.matchAll(/--icon-glass-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      values.set(d[1], norm(d[2]));
    }
    blocks.push({ name: m[1], variables: [...values.keys()], values });
  }
  return blocks;
}

/**
 * Les variables que la feuille CONSOMME, avec la valeur de repli écrite à côté.
 *
 * @param {string} sheet
 * @returns {{ name: string, fallback: string | null }[]}
 */
export function parseReadVariables(sheet) {
  const masked = maskMarkupComments(sheet);
  const reads = [];
  for (const m of masked.matchAll(/var\(\s*--icon-glass-([a-z0-9-]+)\s*(?:,\s*([^)]*?))?\s*\)/g)) {
    reads.push({ name: m[1], fallback: m[2] === undefined ? null : norm(m[2]) });
  }
  return reads;
}

/**
 * Juge la divergence entre les doses du code et les blocs de la feuille.
 *
 * @param {{ code: string, sheet: string }} input
 * @returns {{
 *   problems: string[],
 *   levels: string[],
 *   defaultLevel: string | null,
 *   blocks: string[],
 * }}
 */
export function judgeIconGlassDoses({ code, sheet }) {
  const problems = [];
  const { levels, defaultLevel, listDeclared } = parseDeclaredDoses(code);
  const blocks = parseDoseBlocks(sheet);
  const reads = parseReadVariables(sheet);

  // ── 1. La liste du code, et son défaut ────────────────────────────────────
  if (!listDeclared) {
    problems.push(
      'la liste `ICON_GLASS_LEVELS` est INTROUVABLE dans le code — les doses offertes ne sont pas déclarées',
    );
  } else if (levels.length === 0) {
    problems.push('la liste `ICON_GLASS_LEVELS` est VIDE — aucune dose offerte, donc aucun réglage');
  }
  if (levels.length !== new Set(levels).size) {
    const seen = new Set();
    const twice = levels.filter((l) => (seen.has(l) ? true : (seen.add(l), false)));
    problems.push(`doses déclarées DEUX fois : ${[...new Set(twice)].join(', ')}`);
  }
  if (!defaultLevel) {
    problems.push('`DEFAULT_ICON_GLASS` est introuvable — la dose livrée n’est pas déclarée');
  } else if (levels.length > 0 && !levels.includes(defaultLevel)) {
    problems.push(
      `le défaut « ${defaultLevel} » n’est PAS une dose offerte : la classe posée sur la racine du shell ne rencontrerait aucun bloc`,
    );
  }

  // ── 2. Les deux sens : chaque dose a son bloc, chaque bloc a sa dose ──────
  const blockNames = blocks.map((b) => b.name);
  const declared = new Set(levels);
  const written = new Set(blockNames);
  const missing = levels.filter((l) => !written.has(l));
  const orphan = blockNames.filter((b) => !declared.has(b));
  if (missing.length > 0) {
    problems.push(
      `dose(s) sans bloc dans la feuille : ${missing.map((d) => `.icon-glass-${d}`).join(', ')}`,
    );
  }
  if (orphan.length > 0) {
    problems.push(
      `bloc(s) ORPHELIN(S) — aucune dose déclarée de ce nom : ${orphan
        .map((d) => `.icon-glass-${d}`)
        .join(', ')}`,
    );
  }
  if (blockNames.length !== written.size) {
    const seen = new Set();
    const twice = blockNames.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
    problems.push(`deux blocs pour la même dose : ${[...new Set(twice)].join(', ')}`);
  }

  // ── 3. Une dose qui ne pose rien n'est pas une dose ───────────────────────
  for (const block of blocks) {
    if (block.variables.length === 0) {
      problems.push(
        `.icon-glass-${block.name} ne pose AUCUNE variable \`--icon-glass-*\` — une dose qui ne change rien au lieu d’en doser une`,
      );
    }
  }

  // ── 4. Les variables : posée mais jamais lue, lue mais jamais posée ───────
  const readNames = new Set(reads.map((r) => r.name));
  const writtenVariables = new Map();
  for (const block of blocks) {
    for (const v of block.variables) {
      if (!writtenVariables.has(v)) writtenVariables.set(v, []);
      writtenVariables.get(v).push(block.name);
    }
  }
  const neverRead = [...writtenVariables.keys()].filter((v) => !readNames.has(v));
  if (neverRead.length > 0) {
    problems.push(
      `variable(s) posée(s) par une dose mais JAMAIS lue(s) par la feuille : ${neverRead
        .map((v) => `--icon-glass-${v}`)
        .join(', ')}`,
    );
  }
  const neverWritten = [...readNames].filter((v) => !writtenVariables.has(v));
  if (neverWritten.length > 0) {
    problems.push(
      `variable(s) lue(s) par la feuille mais posée(s) par AUCUNE dose : ${neverWritten
        .map((v) => `--icon-glass-${v}`)
        .join(', ')} — ce n’est plus une dose, c’est un repli déguisé`,
    );
  }

  // ── 5. Le repli EST la dose livrée, et il existe toujours ─────────────────
  // Deux affirmations que la feuille écrit elle-même en prose (« les valeurs de
  // repli sont la dose livrée » / « un fragment monté sans la classe rend ce qui
  // a été livré »). Une prose n'est pas une garantie : ici elle en devient une.
  const withoutFallback = [...new Set(reads.filter((r) => r.fallback === null).map((r) => r.name))];
  if (withoutFallback.length > 0) {
    problems.push(
      `variable(s) lue(s) SANS valeur de repli : ${withoutFallback
        .map((v) => `--icon-glass-${v}`)
        .join(', ')} — un rendu hors dose (page avant hydratation, fragment de test) ne rendrait rien`,
    );
  }
  const delivered = blocks.find((b) => b.name === defaultLevel);
  if (delivered) {
    for (const [variable, value] of delivered.values) {
      for (const read of reads.filter((r) => r.name === variable && r.fallback !== null)) {
        if (read.fallback !== value) {
          problems.push(
            `le repli de --icon-glass-${variable} vaut « ${read.fallback} » alors que la dose livrée « ${defaultLevel} » le pose à « ${value} » — hors dose, la page ne rend pas ce qui a été livré`,
          );
        }
      }
    }
  }

  return { problems, levels, defaultLevel, blocks: blockNames };
}
