// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/gate-sentinels.mjs — un contrôle qui lit des JOURNAUX a des
// sentinelles ; qui a le droit de les imprimer ?
//
// POURQUOI CECI EXISTE
// --------------------
// `npm run check:automations` ne lit pas un état : il lit des journaux de runs et
// y cherche des marqueurs. Un marqueur est du TEXTE, donc tout ce qui l'imprime
// ressemble à une déclaration — l'incident du 2026-09-12 : `npm test` importait
// le script Dependabot, qui imprimait la marque d'inaction, et l'audit accusait
// le workflow dont le journal portait cette copie.
//
// Deux remèdes ont déjà été posés ce jour-là : la preuve porte son SUJET (le nom
// du workflow, voir scripts/lib/automation-evidence.mjs), et l'import d'un script
// ne travaille plus (scripts/lib/import-effects.mjs). Il reste la faille que
// ni l'un ni l'autre ne ferme : une suite qui imprime un marqueur DANS SON CORPS
// de test — c'est du code différé, l'import n'y est pour rien, et le journal du
// job le reçoit quand même.
//
// LA RÈGLE, DONC
// --------------
// Un marqueur n'est imprimable QUE par l'automatisation dont il est la voix, et
// les empreintes de ses lecteurs sont inventoriées ici. Tout autre imprimeur est
// un échec — avec le fichier et la ligne, parce qu'un garde qui ne dit pas où
// n'est pas réparable. L'inventaire est explicite et borné : chaque marqueur
// nomme le contrôle qui le LIT, sinon personne ne saurait à quoi sert la règle.
// ─────────────────────────────────────────────────────────────────────────────

import ts from 'typescript';

import { EVIDENCE_PREFIX } from './automation-evidence.mjs';

/**
 * Remplace le CONTENU des commentaires par des espaces, en gardant les sauts de
 * ligne — donc les numéros de ligne.
 *
 * Mesuré sur ce contrôle lui-même : son premier run a accusé la prose de sa
 * propre suite de tests, qui cite un exemple d'impression dans un commentaire.
 * Un commentaire ne s'exécute pas : le lire comme du code, c'est refaire l'erreur
 * que ce dépôt paie à répétition — le balayage naïf qui prenait un exemple de
 * fixture pour un import, la marque lue dans le titre que le runner jette. Le
 * scanner de TypeScript connaît les commentaires ; une expression régulière ne
 * les connaît pas.
 *
 * @param {string} text
 * @returns {string}
 */
export function blankComments(text) {
  const source = String(text ?? '');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.JSX,
    source,
  );
  const chars = [...source];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    for (let i = scanner.getTokenStart(); i < scanner.getTokenEnd(); i += 1) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  return chars.join('');
}

/** Ce qui écrit dans le journal d'un job : l'unique canal que les audits relisent. */
const PRINTING = /console\s*\.\s*[a-z]+|process\s*\.\s*(?:stdout|stderr)\s*\.\s*write/;

/**
 * Les sentinelles du dépôt, avec qui les émet et qui les lit.
 *
 * `emitters` est une liste BLANCHE : y ajouter un fichier doit être un acte
 * conscient, et le contrôle du contrôle (tests/gate-sentinels.test.ts) vérifie
 * que la liste n'en couvre pas un de trop.
 */
export const GATE_SENTINELS = [
  {
    token: EVIDENCE_PREFIX,
    composer: 'evidenceAnnotation',
    // Trois imprimeurs, et chacun a une raison : le producteur qui agit (le
    // rebase Dependabot), l'audit qui publie sa propre preuve (il ne s'exempte
    // pas de la règle qu'il impose), et le CLI que tous les workflows appellent.
    emitters: [
      'scripts/rebase-dependabot-prs.mjs',
      'scripts/check-automations.mjs',
      'scripts/publish-automation-evidence.mjs',
    ],
    readBy: 'scripts/check-automations.mjs',
    what: 'la preuve d’action d’une automatisation (canal structuré)',
  },
];

/** Le fichier qui DÉFINIT les sentinelles : il les nomme, il ne les imprime pas. */
export const DEFINITIONS = 'scripts/lib/automation-evidence.mjs';

/**
 * Les fichiers qui impriment une sentinelle sans en avoir le droit.
 *
 * Détection par LIGNE, et volontairement grossière : une ligne qui imprime ET qui
 * nomme la sentinelle (ou le helper qui la compose) est un constat. Un imprimeur
 * qui passerait par une variable intermédiaire échappe à cette lecture — c'est
 * écrit ici plutôt que découvert plus tard, et c'est la raison pour laquelle la
 * sentinelle STRUCTURÉE (qui porte son sujet) reste la protection de fond.
 *
 * @param {{ files?: { file: string, text: string }[], sentinels?: typeof GATE_SENTINELS }} [input]
 * @returns {{ findings: { file: string, line: number, token: string, sentinel: string, snippet: string }[],
 *   scanned: { files: number, sentinels: number } }}
 */
export function inspectSentinelPrinters({ files = [], sentinels = GATE_SENTINELS } = {}) {
  const findings = [];
  for (const { file, text } of files) {
    if (file === DEFINITIONS) continue; // il nomme les marques, il ne les émet pas
    const lines = blankComments(text).split(/\r?\n/);
    for (const sentinel of sentinels) {
      if (sentinel.emitters.includes(file)) continue;
      for (const [i, line] of lines.entries()) {
        if (!PRINTING.test(line)) continue;
        if (!line.includes(sentinel.token) && !line.includes(sentinel.composer)) continue;
        findings.push({
          file,
          line: i + 1,
          token: sentinel.token,
          sentinel: sentinel.what,
          snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  return { findings, scanned: { files: files.length, sentinels: sentinels.length } };
}

/**
 * Le rapport imprimable. Pure.
 * @param {ReturnType<typeof inspectSentinelPrinters>} result
 * @param {{ lookFor?: string }} [meta]
 * @returns {string[]}
 */
export function formatSentinelReport(result, { lookFor = 'tests/ et scripts/' } = {}) {
  const { findings, scanned } = result;
  if (scanned.files === 0 || scanned.sentinels === 0) {
    return [
      `❌ rien à juger (${scanned.files} fichier(s), ${scanned.sentinels} sentinelle(s)) — un contrôle qui n'examine rien ne prouve rien.`,
    ];
  }
  const lines = [];
  for (const f of findings) {
    lines.push(`❌ ${f.file}:${f.line} — imprime ${f.token} (${f.sentinel}).`);
    lines.push(`   ${f.snippet}`);
    lines.push(
      '   seule l’automatisation dont c’est la voix peut l’imprimer : une copie dans un autre journal',
    );
    lines.push(
      '   se lit comme une déclaration (mesuré le 2026-09-12 — voir scripts/lib/automation-evidence.mjs).',
    );
  }
  if (!findings.length) {
    lines.push(
      `✅ ${scanned.files} fichier(s) de ${lookFor} : aucun n’imprime une sentinelle qu’il ne lit pas lui-même (${scanned.sentinels} inventoriée(s)).`,
    );
  }
  return lines;
}
