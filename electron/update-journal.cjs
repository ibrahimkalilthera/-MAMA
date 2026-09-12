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
 *
 * ─── Et c'est aussi la FILE D'ATTENTE du poste ──────────────────────────────
 *
 * Écrire le blocage ne suffit pas : il faut qu'il REMONTE. Or un poste d'école
 * démarre bloqué sans personne de connecté — c'est même le cas normal —, et à
 * cet instant l'envoi au journal d'audit est structurellement impossible. Les
 * entrées ne sont donc pas perdues : elles attendent (`reportedAt` nul), et le
 * prochain démarrage CONNECTÉ les emporte (`pendingReports` / `markReported`).
 *
 * Trois décisions portent cette file, et chacune évite un défaut précis :
 *   • **une identité par panne** (`entryKey` : code, version visée, version
 *     installée) — la vérification revient toutes les 30 minutes, donc un poste
 *     bloqué des semaines inscrit des dizaines de fois le même fait ; les
 *     envoyer tous rendrait le journal d'audit illisible, et un journal qu'on
 *     cesse de lire ne signale plus rien. `occurrences` conserve ce que la
 *     déduplication ne doit pas perdre : combien de fois le poste a buté.
 *   • **on ne marque que ce qui est PARTI** — un envoi raté reste en file ;
 *     marquer d'avance effacerait la panne d'un poste à cause d'une panne de
 *     réseau, ce qui est le pire des deux sens de l'erreur.
 *   • **le marquage n'est jamais fatal** — un disque plein rend
 *     `{ marked: 0, written: false }`, l'entrée reste en file, et le poste la
 *     renverra. Un doublon vaut mieux qu'un silence.
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
    // La seule marque de la FILE D'ATTENTE : l'instant où cette panne a été
    // remontée au journal d'audit. Null = jamais partie. Une entrée écrite avant
    // l'existence de ce champ n'a pas de `reportedAt` — et c'est exact : elle
    // n'est jamais partie, donc elle doit être remontée.
    reportedAt: raw.reportedAt == null ? null : String(raw.reportedAt),
  };
}

/**
 * L'identité d'un blocage, dans le journal.
 *
 * Même code, même version visée et même version installée ⇒ même panne. C'est
 * ce qui permet de dédupliquer la file : la vérification revient toutes les 30
 * minutes, donc un poste bloqué des semaines inscrit des dizaines de fois le
 * MÊME fait — les envoyer tous remplirait le journal d'audit de la même panne
 * jusqu'à le rendre illisible, et un journal qu'on cesse de lire ne signale
 * plus rien. La version fait partie de l'identité pour la raison déjà retenue
 * côté interface : un blocage sur une version PLUS RÉCENTE est une information
 * neuve.
 *
 * @param {object} entry
 * @returns {string}
 */
function entryKey(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const at = (v) => (v == null ? '' : String(v));
  return `${at(e.code)}|${at(e.version)}|${at(e.currentVersion)}`;
}

/**
 * Ce qui reste à REMONTER : les blocages inscrits sur ce poste qu'aucun envoi
 * n'a encore emportés.
 *
 * C'est la file d'attente du poste. Elle existe parce que le cas normal d'un
 * poste d'école est de démarrer bloqué SANS personne de connecté : à cet
 * instant, l'envoi au journal d'audit est impossible, et une entrée qui ne
 * saurait pas attendre serait perdue — c'est-à-dire exactement le silence que
 * ce mécanisme existe pour réparer.
 *
 * Dédupliqué par identité (`entryKey`), du plus récent au plus ancien, borné par
 * `limit`. `occurrences` garde ce que la déduplication ne doit PAS perdre :
 * combien de fois le poste a buté, sans quoi « bloqué 40 fois » se lirait comme
 * « bloqué une fois ».
 *
 * @param {string} file
 * @param {{ fs?: typeof nodeFs, limit?: number }} [options]
 * @returns {object[]}
 */
function pendingReports(file, { fs = nodeFs, limit = 20 } = {}) {
  const all = readEntries(file, { fs, limit: MAX_ENTRIES });
  const reported = new Set();
  for (const entry of all) {
    if (entry.reportedAt) reported.add(entryKey(entry));
  }
  const counts = new Map();
  for (const entry of all) {
    const key = entryKey(entry);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  const seen = new Set();
  const max = Math.max(0, Number(limit) || 0);
  for (const entry of all) {
    if (out.length >= max) break;
    const key = entryKey(entry);
    if (reported.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, key, occurrences: counts.get(key) || 1 });
  }
  return out;
}

/**
 * Marquer comme REMONTÉS les blocages qui sont réellement partis — et rien de
 * plus.
 *
 * Deux précautions, et chacune a une raison : on ne marque que les clés qu'on
 * donne (un envoi raté doit RESTER en file, sinon la panne d'un poste serait
 * effacée par la panne du réseau), et on ne jette pas la réécriture — un
 * disque plein rend `{ marked: 0, written: false }`, et le poste renverra le
 * même blocage au prochain démarrage connecté. C'est le bon côté de l'erreur :
 * un doublon vaut mieux qu'un silence.
 *
 * @param {string} file
 * @param {string[]} keys
 * @param {{ fs?: typeof nodeFs, at?: string, maxEntries?: number }} [options]
 * @returns {{ marked: number, written: boolean }}
 */
function markReported(file, keys, { fs = nodeFs, at = new Date().toISOString(), maxEntries = MAX_ENTRIES } = {}) {
  const wanted = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key)));
  if (!wanted.size) return { marked: 0, written: false };
  try {
    // Ordre d'écriture (du plus ancien au plus récent) : la troncature garde
    // ensuite les entrées les plus RÉCENTES, comme partout ailleurs.
    const entries = readEntries(file, { fs, limit: MAX_ENTRIES }).reverse();
    // Pas de journal du tout ⇒ rien à marquer, et surtout pas de fichier créé
    // pour rien : un marquage ne doit pas faire apparaître un état.
    if (!entries.length) return { marked: 0, written: false };
    let marked = 0;
    for (const entry of entries) {
      if (!wanted.has(entryKey(entry))) continue;
      entry.reportedAt = at;
      marked += 1;
    }
    const kept = entries.slice(-Math.max(0, maxEntries));
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, kept.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return { marked, written: true };
  } catch {
    return { marked: 0, written: false };
  }
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
  entryKey,
  pendingReports,
  markReported,
};
