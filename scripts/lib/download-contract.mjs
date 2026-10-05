// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/download-contract.mjs — un aperçu ajouté sans l'E2E qui le suit
// est un pixel-check qui attend un fichier que rien n'émet.
//
// ─── Ce qui s'est payé le 2026-10-05 ────────────────────────────────────────
// La 1.0.23 a doté le reçu des parents d'un APERÇU : « Télécharger Reçu PDF »
// n'enregistre plus, il publie le reçu dans une modale, et le fichier ne part
// qu'au SECOND clic (« Télécharger le reçu »). Le script `verify-pdf-download.mjs`
// cliquait encore le seul premier bouton puis attendait le PDF : 60 s à vide,
// run rouge sur la seule étape « reçu parent », alors que la paie — qui
// télécharge toujours d'un trait — passait ses 9/9.
//
// Le défaut n'était pas le pixel-check : il était dans le CONTRAT entre deux
// fichiers. Un générateur PDF a UNE sortie terminale, et elle a changé de
// nature (direct → aperçu) sans que le script qui le pilote l'apprenne. Rien,
// dans le dépôt, ne RELIAIT ces deux bouts : la modale, le libellé du bouton de
// confirmation, et l'attente du script vivaient chacun de leur côté.
//
// ─── Le contrat que ce module juge ──────────────────────────────────────────
// Un générateur `src/lib/pdf*.ts` sort par l'un de ces deux chemins :
//   • **direct** — il appelle `downloadBytes` (via un `download*`) : le clic
//     suffit, l'E2E n'a qu'à attendre le fichier ;
//   • **aperçu** — il ouvre un `show*Preview` : le fichier ne part qu'au clic de
//     confirmation DANS la modale. L'E2E doit donc connaître ce second clic.
//
// Dès qu'un générateur ouvre un aperçu, trois liens doivent tenir, et chacun est
// vérifiable sur le disque :
//   1. il est DÉCLARÉ (`PREVIEW_FLOWS`) — sinon son E2E l'ignore ;
//   2. sa modale REND le bouton de confirmation (le libellé est résolu par clé
//      d'i18n, dans les deux langues) ;
//   3. le script E2E CLIQUE ce libellé (une étape de confirmation nommée).
//
// ─── La prose n'est pas du code ─────────────────────────────────────────────
// Ce module lit la version BLANCHIE des commentaires (`source-text.mjs`) : le
// commentaire de l'E2E qui CITE « Télécharger le reçu » ne compte pas — seul le
// motif réellement testé compte. C'est exactement le piège que ce dépôt a payé
// trois fois, et cette garde existe pour ne pas en ajouter un quatrième.
//
// ─── Et la limite, qu'il faut dire ──────────────────────────────────────────
// C'est un contrôle de TEXTE : il attrape l'aperçu non déclaré et l'étape E2E
// manquante, il ne joue pas le clic. La preuve d'exécution appartient au run
// (`pdf-e2e.yml`), pas au texte — mais un texte est là pour que le run ne parte
// pas condamné.
// ─────────────────────────────────────────────────────────────────────────────
import { maskComments } from './source-text.mjs';

/** Un appel d'ouverture d'aperçu : `showReceiptPreview(`, `showXPreview(`… */
const PREVIEW_CALL = /\b(show[A-Za-z$_][\w$]*Preview)\s*\(/g;

/**
 * L'inventaire des flux qui passent par un aperçu, et l'étape E2E qui les suit.
 *
 * Chaque entrée lie trois fichiers et un libellé — c'est cette liaison qui
 * manquait le 2026-10-05. Ajouter un aperçu à un autre flux impose d'ajouter son
 * entrée : le contrôle refuse un `show*Preview` non déclaré.
 */
export const PREVIEW_FLOWS = [
  {
    generator: 'src/lib/pdfReceipt.ts',
    /** La fonction qui publie le reçu dans l'aperçu (appelée par le générateur). */
    opener: 'showReceiptPreview',
    /** La modale qui rend le bouton de confirmation. */
    modal: 'src/components/ReceiptPreviewModal.tsx',
    /** La clé d'i18n du bouton de confirmation (résolue FR + EN). */
    labelKey: 'downloadReceipt',
    /** Le script E2E qui doit cliquer cette confirmation avant d'attendre le fichier. */
    e2e: 'scripts/verify-pdf-download.mjs',
  },
];

/** Le fichier d'i18n où sont résolus les libellés (FR et EN ensemble). */
export const I18N_FILE = 'src/i18n/domains/finance.ts';

/** Échappe une chaîne pour l'utiliser dans une expression régulière. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Les noms d'aperçus ouverts par une source (code seul, prose blanchie).
 * @param {string} source
 * @returns {string[]}
 */
export function findPreviewOpeners(source) {
  const code = maskComments(source);
  return [...code.matchAll(PREVIEW_CALL)].map((m) => m[1]);
}

/**
 * La sortie terminale d'un générateur : aperçu, téléchargement direct, ou rien.
 *
 * L'aperçu l'emporte : un générateur qui ouvre un aperçu appelle aussi
 * `downloadBytes` (dans l'action de confirmation), donc l'ordre compte.
 * @param {string} source
 * @returns {{ kind: 'preview'|'direct'|'unknown', openers: string[] }}
 */
export function classifyGenerator(source) {
  const code = maskComments(source);
  const openers = [...code.matchAll(PREVIEW_CALL)].map((m) => m[1]);
  if (openers.length) return { kind: 'preview', openers };
  if (/\bdownload[A-Za-z$_][\w$]*\s*\(/.test(code)) return { kind: 'direct', openers: [] };
  return { kind: 'unknown', openers: [] };
}

/**
 * Les valeurs d'une clé d'i18n (une par langue), lues sur le code seul.
 * @param {string} source
 * @param {string} key
 * @returns {string[]}
 */
export function labelsFor(source, key) {
  const code = maskComments(source);
  const re = new RegExp(`^\\s*${escapeRe(key)}\\s*:\\s*["']([^"']+)["']`, 'gm');
  return [...code.matchAll(re)].map((m) => m[1]);
}

/**
 * Juge le contrat aperçu ↔ E2E sur les sources fournies.
 *
 * @param {{
 *   generators?: { path: string, source: string }[],   // tous les src/lib/pdf*.ts
 *   flows?: typeof PREVIEW_FLOWS,
 *   files?: Record<string, string>,                    // chemin → source (modale, E2E, i18n)
 *   i18nFile?: string,
 * }} input
 * @returns {{ problems: string[], classified: { preview: string[], direct: string[], unknown: string[] }, flowsChecked: string[] }}
 */
export function judgeDownloadContract({
  generators = [],
  flows = PREVIEW_FLOWS,
  files = {},
  i18nFile = I18N_FILE,
} = {}) {
  const problems = [];
  const classified = { preview: [], direct: [], unknown: [] };
  const byPath = new Map(generators.map((g) => [g.path, g.source]));
  const openersByPath = new Map();

  for (const g of generators) {
    const verdict = classifyGenerator(g.source);
    classified[verdict.kind].push(g.path);
    openersByPath.set(g.path, verdict.openers);
  }

  const declared = new Set(flows.map((f) => f.generator));

  // 1. Un aperçu NON DÉCLARÉ : c'est l'incident lui-même — le générateur change
  //    de sortie terminale et personne ne prévient l'E2E.
  for (const [path, openers] of openersByPath) {
    if (openers.length > 0 && !declared.has(path)) {
      problems.push(
        `${path} : ouvre un aperçu (${openers.join(', ')}) mais n'est pas déclaré dans PREVIEW_FLOWS — ` +
          "l'E2E qui le pilote ignore le clic de confirmation et attendra un fichier que rien n'émet (incident 2026-10-05, reçu parent).",
      );
    }
  }

  const flowsChecked = [];
  for (const flow of flows) {
    const source = byPath.get(flow.generator);
    if (source === undefined) {
      problems.push(
        `l'inventaire déclare « ${flow.generator} », introuvable dans le corpus des générateurs — retirez l'entrée (une garantie sur du code disparu vaut moins que rien).`,
      );
      continue;
    }
    const openers = openersByPath.get(flow.generator) ?? [];
    if (openers.length === 0) {
      problems.push(
        `${flow.generator} : déclaré comme aperçu, mais n'ouvre plus aucun \`show*Preview\` — ` +
          "l'inventaire et l'étape de confirmation de l'E2E doivent être retirés ensemble.",
      );
      continue;
    }
    if (!openers.includes(flow.opener)) {
      problems.push(
        `${flow.generator} : l'aperçu déclaré « ${flow.opener} » n'est plus appelé (aperçus trouvés : ${openers.join(', ')}).`,
      );
      continue;
    }

    // 2. La modale doit RENDRE le bouton de confirmation.
    const modal = files[flow.modal];
    if (modal === undefined) {
      problems.push(`modale d'aperçu illisible : ${flow.modal} — impossible de vérifier le bouton de confirmation.`);
    } else if (!new RegExp(`\\bt\\.${escapeRe(flow.labelKey)}\\b`).test(maskComments(modal))) {
      problems.push(
        `${flow.modal} : n'affiche pas le bouton de confirmation « t.${flow.labelKey} » — ` +
          "l'E2E ne trouverait aucun libellé à cliquer dans l'aperçu.",
      );
    }

    // 3. Le libellé doit exister dans les DEUX langues (FR et EN).
    const labels = labelsFor(files[i18nFile] ?? '', flow.labelKey);
    if (labels.length < 2) {
      problems.push(
        `${i18nFile} : « ${flow.labelKey} » n'a que ${labels.length} libellé(s) — ` +
          "le FR et l'EN sont requis, sinon l'E2E ne matche le bouton que dans une seule langue.",
      );
    }

    // 4. L'E2E doit CLICKER ce libellé avant d'attendre le fichier.
    const e2e = files[flow.e2e];
    if (e2e === undefined) {
      problems.push(`script E2E illisible : ${flow.e2e} — impossible de vérifier l'étape de confirmation.`);
      continue;
    }
    const matcher = labels.length ? new RegExp(labels.map(escapeRe).join('|'), 'i') : null;
    if (!matcher || !matcher.test(maskComments(e2e))) {
      problems.push(
        `${flow.e2e} : ne clique pas la confirmation « ${labels[0] ?? flow.labelKey} » de l'aperçu — ` +
          "l'app ouvre un aperçu avant de télécharger, donc ce script attend un fichier qui ne partira jamais (incident 2026-10-05).",
      );
      continue;
    }
    flowsChecked.push(flow.generator);
  }

  return { problems, classified, flowsChecked };
}
