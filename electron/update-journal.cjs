/**
 * ─── Le journal d'un poste bloqué par la porte ─────────────────────────────
 *
 * La porte du retard (`electron/updater-policy.cjs`) empêche un poste de
 * continuer tant qu'une mise à jour obligatoire n'est pas appliquée. C'est
 * voulu — sauf que l'échec, lui, était muet : le processus principal écrivait
 * ses événements dans la console, c'est-à-dire nulle part pour qui n'ouvre pas
 * les outils de développement. Un poste d'école pouvait donc rester bloqué
 * derrière la porte des semaines sans que personne ne sache POURQUOI, ni même
 * qu'il l'était.
 *
 * Ce module est la moitié qui marche TOUJOURS : un fichier local, écrit sans
 * session, sans réseau, sans dépendance à Supabase. L'autre moitié (l'envoi au
 * journal d'audit) exige un utilisateur connecté ; celle-ci ne peut pas échouer
 * pour cette raison, donc elle est la première qui doit exister.
 *
 * Trois propriétés, et chacune paie un cas réel :
 *   • **borné** — le poste d'une école tourne des années ; un journal qui
 *     grossit sans fin finit par remplir un disque, donc on garde les
 *     `MAX_ENTRIES` dernières entrées, et ce sont les plus récentes qui
 *     survivent (un journal tronqué par l'ancien côté ne dit rien) ;
 *   • **jamais fatal** — écrire un journal ne doit pas empêcher une mise à jour.
 *     Aucune fonction ici ne jette : un disque plein rend `false`, et l'appelant
 *     continue ;
 *   • **lisible à la main** — une ligne = un objet JSON, et une ligne abîmée
 *     (coupure de courant en pleine écriture) est ignorée à la lecture au lieu
 *     de rendre tout le fichier illisible. C'est le seul fichier que
 *     l'administrateur d'un poste lira sans outil.
 */
const nodeFs = require('node:fs');
const { join, dirname } = require('node:path');

/** Assez pour retracer des semaines de tentatives, assez peu pour ne pas remplir un disque. */
const MAX_ENTRIES = 200;

/** Un `detail` est un message d'erreur, pas un roman : on borne à l'écriture. */
const MAX_DETAIL = 500;

/** Le nom du fichier, dans `userData` (à côté des autres états du poste). */
const JOURNAL_FILE = 'update-journal.jsonl';

/**
 * @param {{ userDataDir: string }} input
 * @returns {string} chemin du journal sur ce poste.
 */
function journalPath({ userDataDir }) {
  return join(userDataDir, JOURNAL_FILE);
}

/**
 * Ramener une entrée à sa forme stockée — et rien de plus.
 *
 * Pas de champs libres recopiés : ce qui n'est pas dans ce contrat est perdu,
 * parce qu'un journal qui accepte n'importe quoi devient illisible au moment
 * précis où on le lit (une panne).
 *
 * @param {object} raw
 * @param {number} [nowMs]
 * @returns {object|null} l'entrée normalisée, ou null si elle ne dit rien.
 */
function normalizeEntry(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(raw.code ?? '').trim();
  if (!code) return null;
  const at = typeof raw.at === 'string' && raw.at ? raw.at : new Date(nowMs).toISOString();
  const detail = String(raw.detail ?? '').trim().slice(0, MAX_DETAIL);
  return {
    at,
    code,
    // Les versions peuvent manquer (un poste dont l'état n'a jamais été lu) :
    // elles valent alors null, jamais la chaîne « null ».
    version: raw.version == null ? null : String(raw.version),
    currentVersion: raw.currentVersion == null ? null : String(raw.currentVersion),
    appVersion: raw.appVersion == null ? null : String(raw.appVersion),
    station: raw.station == null ? null : String(raw.station),
    detail,
  };
}

/**
 * Les entrées déjà écrites, de la plus récente à la plus ancienne.
 *
 * Une ligne illisible est IGNORÉE : la dernière ligne d'un fichier coupé en
 * pleine écriture est le cas normal après un crash, et perdre l'historique
 * entier à cause d'elle serait exactement le silence qu'on répare.
 *
 * @param {string} file
 * @param {{ fs?: typeof nodeFs, limit?: number }} [options]
 * @returns {object[]}
 */
function readEntries(file, { fs = nodeFs, limit = 50 } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return []; // pas encore de journal — pas une erreur
  }
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = normalizeEntry(/** @type {object} */ (safeParse(trimmed)));
    if (entry) entries.push(entry);
  }
  return entries.reverse().slice(0, Math.max(0, Number(limit) || 0));
}

/** @param {string} line @returns {object|null} */
function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Ajouter une entrée, en gardant le fichier borné.
 *
 * Réécriture complète (au lieu d'un `append` sec) parce que c'est la seule
 * façon de borner un fichier sans le lire à chaque fois : au plus
 * `MAX_ENTRIES` lignes courtes, donc un coût invisible à l'échelle d'un
 * événement de mise à jour.
 *
 * @param {string} file
 * @param {object} entry
 * @param {{ fs?: typeof nodeFs, maxEntries?: number, nowMs?: number }} [options]
 * @returns {boolean} vrai si l'entrée est écrite — jamais une exception.
 */
function appendEntry(file, entry, { fs = nodeFs, maxEntries = MAX_ENTRIES, nowMs = Date.now() } = {}) {
  const normalized = normalizeEntry(entry, nowMs);
  if (!normalized) return false;
  try {
    const kept = readEntries(file, { fs, limit: Math.max(0, maxEntries - 1) }).reverse();
    kept.push(normalized);
    const text = kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return true;
  } catch {
    // Un journal qu'on ne peut pas écrire (disque plein, droits) ne doit pas
    // empêcher la mise à jour : l'appelant continue, et la porte reste décidée
    // par la politique, jamais par ce module.
    return false;
  }
}

module.exports = {
  MAX_ENTRIES,
  MAX_DETAIL,
  JOURNAL_FILE,
  journalPath,
  normalizeEntry,
  readEntries,
  appendEntry,
};
