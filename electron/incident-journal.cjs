/**
 * ─── Le journal des pannes du POSTE ─────────────────────────────────────────
 *
 * Le journal de `src/lib/incidentJournal.ts` couvre la PAGE : une exception qui
 * casse une zone, une promesse rejetée sans `.catch`. Il ne peut pas couvrir ce
 * qui tue le processus — un plantage du processus principal, un rendu qui
 * disparaît (écran blanc, l'application reste ouverte et ne répond plus), un
 * processus enfant qui meurt. Ce sont exactement les pannes qu'un guichet
 * raconte le lendemain par « ça a planté », et pour lesquelles il n'existait
 * aucune trace : la console d'un poste d'école n'est lue par personne.
 *
 * Ce module écrit donc la moitié qui survit à la page : un fichier local, une
 * ligne JSON par panne, dans `userData`. Trois propriétés, chacune payant un cas
 * mesuré :
 *
 *   • **borné** — un poste tourne des années ; le fichier ne garde que les
 *     `MAX_ENTRIES` dernières pannes. Un journal qui grossit sans fin finit par
 *     remplir un disque, et c'est le disque qui fait tomber l'application.
 *   • **jamais fatal** — écrire une panne ne doit pas en créer une seconde :
 *     aucune fonction ici ne jette. Un disque plein rend `false`, l'appelant
 *     continue.
 *   • **expurgé** — un message d'erreur peut citer un élève, un montant, un
 *     jeton d'URL. On garde le nom de l'erreur et son message TRONQUÉ, avec les
 *     courriels, les requêtes d'URL et les suites de chiffres masqués : un
 *     journal de diagnostic n'est pas un registre, et ne doit pas en devenir un.
 *
 * Ce que ce module NE fait pas : il n'envoie rien. Aucune donnée ne quitte le
 * poste de sa propre initiative ; l'écran des Réglages lit ce fichier et le
 * recopie dans un rapport que l'école transmet si elle le décide.
 */
const nodeFs = require('node:fs');
const { join } = require('node:path');

/** Assez pour retracer une semaine de pannes, assez peu pour ne pas peser. */
const MAX_ENTRIES = 60;

/** Un message d'erreur est une phrase, pas une pile : on borne à l'écriture. */
const MAX_MESSAGE = 300;

/** Le nom du fichier, dans `userData` (à côté des autres états du poste). */
const JOURNAL_FILE = 'incidents.jsonl';

const LONG_DIGITS = /\d{5,}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s]*/g;

/**
 * Expurger un texte libre.
 *
 * L'ordre compte : on masque d'abord les courriels (qui contiennent des
 * chiffres), puis les requêtes d'URL, puis les suites de chiffres. Une seule
 * passe dans un autre ordre laisserait passer un fragment.
 *
 * @param {unknown} raw
 * @param {number} [maxLength]
 * @returns {string}
 */
function redact(raw, maxLength = MAX_MESSAGE) {
  const singleLine = String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EMAIL, '[courriel]')
    .replace(URL_QUERY, '$1?…')
    .replace(LONG_DIGITS, '#');
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
}

/**
 * Le chemin du journal sur ce poste.
 *
 * @param {{ userDataDir: string }} input
 * @returns {string}
 */
function incidentsPath({ userDataDir }) {
  return join(userDataDir, JOURNAL_FILE);
}

/**
 * Ramener une entrée à sa forme stockée — et rien de plus.
 *
 * @param {object} raw
 * @param {number} [nowMs]
 * @returns {{at: string, kind: string, message: string}|null}
 */
function normalizeEntry(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = redact(raw.kind, 40);
  const message = redact(raw.message);
  if (!kind || !message) return null;
  const at = typeof raw.at === 'string' && raw.at ? raw.at : new Date(nowMs).toISOString();
  return { at, kind, message };
}

/**
 * Lire le journal, du plus récent au plus ancien.
 *
 * Une ligne abîmée (coupure de courant en pleine écriture) est IGNORÉE au lieu
 * de rendre tout le fichier illisible : c'est le seul fichier qu'un
 * administrateur de poste lira sans outil, et un fichier qu'on ne peut plus
 * lire est une panne de plus.
 *
 * @param {{ userDataDir: string, limit?: number, fs?: typeof nodeFs }} input
 * @returns {Array<{at: string, kind: string, message: string}>}
 */
function readIncidents({ userDataDir, limit = MAX_ENTRIES, fs = nodeFs }) {
  let raw;
  try {
    raw = fs.readFileSync(incidentsPath({ userDataDir }), 'utf8');
  } catch {
    // Fichier absent (poste neuf, ou aucune panne) : liste vide, jamais une erreur.
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = normalizeEntry(JSON.parse(line));
      if (entry) entries.push(entry);
    } catch {
      /* ligne tronquée : ignorée, les autres restent lisibles */
    }
  }
  return entries.reverse().slice(0, limit);
}

/**
 * Inscrire une panne. Rend `true` quand elle est sur le disque.
 *
 * L'écriture est SYNCHRONE : un plantage du processus principal ne laisse pas le
 * temps à une écriture asynchrone d'aboutir, et une panne non écrite est
 * exactement le silence que ce module existe pour supprimer.
 *
 * @param {{ userDataDir: string, kind: string, message: unknown, at?: string,
 *           fs?: typeof nodeFs, now?: () => number }} input
 * @returns {boolean}
 */
function appendIncident({ userDataDir, kind, message, at, fs = nodeFs, now = Date.now }) {
  try {
    const entry = normalizeEntry({ at, kind, message }, now());
    if (!entry) return false;
    const file = incidentsPath({ userDataDir });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    // La borne est appliquée APRÈS l'écriture : si la réécriture échoue, la
    // panne du moment est quand même inscrite, et le fichier sera tronqué au
    // prochain passage. Perdre la panne la plus récente serait le pire des deux
    // sens de l'erreur.
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim());
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(file, `${lines.slice(-MAX_ENTRIES).join('\n')}\n`, 'utf8');
    }
    return true;
  } catch {
    // Disque plein, dossier en lecture seule : la panne n'est pas notée, et le
    // poste continue. Un journal qui casse l'application serait une seconde panne.
    return false;
  }
}

/** Le message d'un rejet, sans appeler `toString` sur un objet libre. */
function messageOf(error) {
  if (error instanceof Error) return `${error.name}: ${error.message || '(sans message)'}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'valeur inconnue';
}

/**
 * Brancher la capture du processus principal et du cycle de vie des rendus.
 *
 * On n'INSTALLE pas un gestionnaire qui avale l'erreur : on ajoute un
 * observateur. Electron garde son propre comportement (son dialogue d'erreur
 * fatale), et nous gagnons la trace. Remplacer le comportement par défaut
 * laisserait un poste debout dans un état inconnu — pire que le crash.
 *
 * @param {{ userDataDir: string, proc?: NodeJS.Process, app?: any,
 *           write?: (input: {kind: string, message: unknown}) => boolean }} input
 * @returns {() => void} le débranchement (tests)
 */
function installProcessCapture({ userDataDir, proc = process, app, write }) {
  const record =
    write ??
    (({ kind, message }) => appendIncident({ userDataDir, kind, message }));
  const listeners = [];

  const on = (emitter, event, handler) => {
    if (!emitter || typeof emitter.on !== 'function') return;
    emitter.on(event, handler);
    listeners.push(() => {
      try {
        emitter.removeListener(event, handler);
      } catch {
        /* émetteur déjà détruit */
      }
    });
  };

  on(proc, 'uncaughtException', (error) => {
    record({ kind: 'uncaught', message: messageOf(error) });
  });
  on(proc, 'unhandledRejection', (reason) => {
    record({ kind: 'rejection', message: messageOf(reason) });
  });
  // Le rendu qui DISPARAÎT : écran blanc, fenêtre toujours ouverte. Sans cet
  // événement, la seule trace était un utilisateur qui dit « c'est figé ».
  on(app, 'render-process-gone', (_event, _contents, details) => {
    const reason = details && details.reason ? details.reason : 'inconnue';
    const code = details && details.exitCode != null ? ` (code ${details.exitCode})` : '';
    record({ kind: 'renderer-gone', message: `le rendu s’est arrêté : ${reason}${code}` });
  });
  on(app, 'child-process-gone', (_event, details) => {
    const type = details && details.type ? details.type : 'processus';
    const reason = details && details.reason ? details.reason : 'inconnue';
    record({ kind: 'child-gone', message: `${type} arrêté : ${reason}` });
  });

  return () => {
    for (const off of listeners) off();
  };
}

module.exports = {
  MAX_ENTRIES,
  MAX_MESSAGE,
  JOURNAL_FILE,
  appendIncident,
  incidentsPath,
  installProcessCapture,
  normalizeEntry,
  readIncidents,
  redact,
};
