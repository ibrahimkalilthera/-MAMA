/**
 * ─── La PROMESSE D'OCTETS du flux, et ce qu'un poste peut en vérifier ────────
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Un poste ne se met pas à jour sur une version : il se met à jour sur une
 * PROMESSE D'OCTETS. `latest.yml` annonce, pour chaque fichier, une taille et un
 * sha512, et `electron-updater` refuse tout ce qui n'y répond pas. Ce refus-là
 * est correct — mais il était **muet sur la CAUSE** : un échec de téléchargement
 * (réseau de l'école, proxy, coupure) et un fichier livré qui n'est PAS celui
 * qu'on annonce se retrouvaient sous le même motif, `download`.
 *
 * Les deux ont des remèdes opposés. Le premier se répare sur le poste (réessayer,
 * ouvrir le réseau) ; le second ne se répare QUE sur le canal — réessayer depuis
 * l'école ne changera jamais ces octets-là, et **tous les postes sont concernés**.
 * Confondre les deux envoie l'administrateur chercher la panne au mauvais
 * endroit, ce que ce dépôt refuse partout ailleurs.
 *
 * D'où ce module : il lit la promesse (le `latest.yml` du flux, exactement comme
 * le poste le lit), il hache les octets réellement reçus, et il rend un VERDICT
 * NOMMÉ. La lecture du réseau et l'écriture restent chez l'appelant, la décision
 * est ici — pure, donc chaque branche se prouve sans poste ni canal.
 *
 * POURQUOI UN LECTEUR PROPRE ICI. Les scripts de CI lisent le même fichier avec
 * `scripts/lib/latest-yml.mjs` (ESM), que le processus principal d'Electron ne
 * peut pas `require` : le module n'est pas empaqueté, et un `require` d'ESM au
 * démarrage ajouterait une dépendance de runtime à l'application. Deux lecteurs,
 * donc — et un test qui les confronte sur le MÊME texte, parce que deux lecteurs
 * du même fichier qui divergeraient en silence rendraient ce verdict faux sans
 * que rien ne rougisse.
 */
const { createHash } = require('node:crypto');
const { createReadStream, existsSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

/** Le nom du flux, tel qu'electron-updater le demande (`latest.yml`). */
const FEED_FILE = 'latest.yml';

/**
 * Où lire la promesse, sur CE poste.
 *
 * L'URL est dérivée de la MÊME source que le flux lui-même — `app-update.yml`,
 * écrit par electron-builder à l'empaquetage — et non recopiée ici. Un mode
 * preuve peut tout rediriger (`UPDATER_FEED_URL`), ce qui permet de jouer un
 * flux menteur sans rien publier.
 *
 * @param {{ feedOverride?: unknown, appUpdateYml?: unknown }} input
 * @returns {string|null} l'URL de `latest.yml`, ou null quand elle est indéterminable.
 */
function feedUrlFrom({ feedOverride = null, appUpdateYml = null } = {}) {
  const override = String(feedOverride ?? '').trim();
  if (override) {
    try {
      const base = override.endsWith('/') ? override : `${override}/`;
      return new URL(FEED_FILE, base).href;
    } catch {
      /* URL invalide : indéterminable, jamais devinée */
    }
  }
  const text = String(appUpdateYml ?? '');
  const url = /^\s*url:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(text)?.[1];
  if (!url) return null;
  try {
    return new URL(FEED_FILE, url.endsWith('/') ? url : `${url}/`).href;
  } catch {
    return null;
  }
}

/**
 * Lire `latest.yml` (le sous-ensemble fixe d'electron-builder).
 *
 * Même contrat que `scripts/lib/latest-yml.mjs` : une version, une liste de
 * fichiers (`url`, `sha512`, `size`), un `path` et un `sha512` de tête. Un
 * fichier sans `url` n'est pas un fichier (le garder ferait passer une liste vide
 * pour une liste pleine), et un flux sans version ni `path` est ILLISIBLE — dit
 * `null`, jamais un objet vide qui se lirait comme « rien à annoncer ».
 *
 * @param {unknown} text
 * @returns {{ version: string, files: { url: string, sha512: string, size: number|null }[],
 *   path: string, sha512: string } | null}
 */
function parseFeed(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const result = { version: '', files: [], path: '', sha512: '' };
  let inFiles = false;
  let current = null;
  const clean = (v) => String(v ?? '').trim().replace(/^['"]|['"]$/g, '');
  const assign = (entry, key, value) => {
    if (key === 'url') entry.url = value;
    if (key === 'sha512') entry.sha512 = value;
    if (key === 'size') entry.size = Number.isFinite(Number(value)) ? Number(value) : null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const key = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const item = /^\s*-\s*([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const field = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (key && !/^\s/.test(line)) {
      inFiles = key[1] === 'files';
      const value = clean(key[2]);
      if (key[1] === 'version') result.version = value;
      if (key[1] === 'path') result.path = value;
      if (key[1] === 'sha512') result.sha512 = value;
      continue;
    }
    if (inFiles && item) {
      current = { url: '', sha512: '', size: null };
      result.files.push(current);
      assign(current, item[1], clean(item[2]));
      continue;
    }
    if (inFiles && field && current) assign(current, field[1], clean(field[2]));
  }
  result.files = result.files.filter((f) => f.url);
  if (!result.version || !result.path) return null;
  return result;
}

/**
 * La promesse du flux pour LE fichier d'une version annoncée.
 *
 * `fileName` d'abord (le chemin exact que le flux nomme), sinon l'entrée qui
 * porte la version : c'est elle qu'un poste télécharge pour s'installer, et la
 * choisir par le numéro plutôt que par « la première ligne » évite de prouver une
 * promesse qui ne concerne pas ce qui a été reçu.
 *
 * @param {unknown} text
 * @param {{ fileName?: string|null, version?: string|null }} [input]
 * @returns {{ url: string, sha512: string, size: number|null, version: string }|null}
 */
function feedEntryFor(text, { fileName = null, version = null } = {}) {
  const feed = parseFeed(text);
  if (!feed) return null;
  const wanted = String(fileName ?? '').trim();
  const target = String(version ?? '').trim();
  const entry =
    (wanted ? feed.files.find((f) => f.url === wanted) : null) ??
    (target ? feed.files.find((f) => f.url.includes(`-${target}-`)) : null) ??
    feed.files.find((f) => /-setup\.exe$/i.test(f.url)) ??
    null;
  if (!entry) return null;
  return { url: entry.url, sha512: entry.sha512, size: entry.size, version: feed.version };
}

/** Un digest abrégé : lisible dans un journal, jamais confondable. */
const short = (digest) => String(digest ?? '').slice(0, 12) + '…';

/**
 * LE VERDICT — ce que ces octets disent de la promesse.
 *
 * @param {{ entry?: { url?: string, sha512?: string, size?: number|null }|null,
 *   served?: { file?: string, sha512?: string, size?: number }|null,
 *   updaterDetail?: string|null }} input
 * @returns {{ fault: boolean, code: 'checksum'|'download'|'none'|'unknown', detail: string }}
 */
function checksumVerdict({ entry = null, served = null, updaterDetail = null } = {}) {
  const name = String(entry?.url ?? served?.file ?? 'le fichier annoncé');
  const announced = String(entry?.sha512 ?? '').trim();

  // 1. Notre propre preuve, quand on peut la faire : des octets COMPLETS dont
  //    l'empreinte n'est pas celle qu'on promet. Ce n'est pas un téléchargement
  //    qui a échoué, c'est un fichier qui n'est pas celui qu'on annonce.
  if (entry && served && Number.isFinite(served.size) && entry.size !== null && entry.size !== undefined) {
    if (served.size !== entry.size) {
      return {
        fault: false,
        code: 'download',
        detail:
          `téléchargement incomplet : ${served.size} octet(s) reçus sur ${entry.size} annoncés pour ${name} — ` +
          'la promesse du flux n’est pas jugée sur des octets tronqués',
      };
    }
    if (announced && served.sha512 && served.sha512 !== announced) {
      return {
        fault: true,
        code: 'checksum',
        detail:
          `le canal annonce ${short(announced)} mais sert ${short(served.sha512)} pour ${name} ` +
          `(${served.size} octet(s), taille conforme) — les octets sont COMPLETS et ce ne sont pas ceux promis : ` +
          'tous les postes qui installeront cette version recevront autre chose que ce qui est annoncé',
      };
    }
    return { fault: false, code: 'none', detail: `octets conformes à la promesse du flux pour ${name}` };
  }

  // 2. Quand on ne peut pas re-hacher (la bibliothèque a déjà écarté le fichier),
  //    l'échec qu'elle nomme elle-même reste une preuve : elle a comparé les octets
  //    à la promesse du flux et les a refusés. On le NOMME, et on joint ce que
  //    NOUS avons lu du flux — c'est ce qui distingue « le canal ment » de
  //    « le réseau a lâché », et c'est la raison du message dans le journal.
  const detail = String(updaterDetail ?? '');
  if (/sha512|checksum|int[éeè]grit/i.test(detail)) {
    return {
      fault: true,
      code: 'checksum',
      detail:
        `la bibliothèque de mise à jour a REFUSÉ les octets reçus${announced ? ` (le flux annonce ${short(announced)})` : ''} : ` +
        `${detail.slice(0, 200)} — le remède est sur le CANAL, pas sur ce poste`,
    };
  }

  // 3. Sinon : un échec de téléchargement ordinaire. Rien n'accuse le canal.
  return {
    fault: false,
    code: 'unknown',
    detail: `promesse du flux non confrontée aux octets reçus pour ${name} — l’échec reste un échec de téléchargement`,
  };
}

/**
 * Hacher un fichier EN FLUX (129 Mo ne tiennent pas en mémoire pour rien).
 *
 * Un fichier absent ou illisible rend `null` — jamais un digest vide, qui se
 * lirait comme « conforme ».
 *
 * @param {string} file
 * @returns {Promise<{ file: string, sha512: string, size: number }|null>}
 */
function hashFile(file) {
  return new Promise((resolve) => {
    let size = 0;
    const hash = createHash('sha512');
    const stream = createReadStream(file);
    stream.on('error', () => resolve(null));
    stream.on('data', (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', () => resolve({ file, sha512: hash.digest('base64'), size }));
  });
}

/**
 * Le fichier tel qu'il reste sur le disque après une tentative.
 *
 * electron-updater télécharge dans `<cacheUpdater>/pending/` (et parfois à la
 * racine du cache). On cherche le nom EXACT annoncé par le flux, jamais « le plus
 * gros fichier du dossier » : hacher autre chose que le fichier annoncé rendrait
 * un verdict sur un innocent.
 *
 * @param {{ cacheDir: string, fileName: string }} input
 * @returns {string|null}
 */
function cachedDownload({ cacheDir, fileName }) {
  const wanted = String(fileName ?? '').trim();
  if (!wanted || !existsSync(cacheDir)) return null;
  for (const dir of [join(cacheDir, 'pending'), cacheDir]) {
    const candidate = join(dir, wanted);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * La décision complète, telle que le processus principal l'utilise : lire la
 * promesse du flux, hacher ce qui reste sur le disque, et rendre le verdict.
 *
 * Chaque étape qui ne peut pas aboutir rend `unknown` — c'est-à-dire « on
 * n'accuse pas le canal ». Le silence n'est pas un verdict, et une accusation
 * sans preuve serait pire que pas d'accusation du tout : elle enverrait
 * l'administrateur corriger un release qui n'a rien fait.
 *
 * @param {{ feedUrl: string|null, cacheDir: string, fileName?: string|null, version?: string|null,
 *   updaterDetail?: string|null, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ fault: boolean, code: string, detail: string }>}
 */
async function inspectUpdateFailure({
  feedUrl = null,
  cacheDir = '',
  fileName = null,
  version = null,
  updaterDetail = null,
  fetchImpl = fetch,
} = {}) {
  let entry = null;
  if (feedUrl) {
    try {
      const res = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) entry = feedEntryFor(await res.text(), { fileName, version });
    } catch {
      /* flux injoignable : on retombe sur le message de la bibliothèque */
    }
  }
  const file = entry ? cachedDownload({ cacheDir, fileName: entry.url }) : null;
  const served = file ? await hashFile(file) : null;
  return checksumVerdict({ entry, served, updaterDetail });
}

module.exports = {
  FEED_FILE,
  parseFeed,
  feedUrlFrom,
  feedEntryFor,
  checksumVerdict,
  hashFile,
  cachedDownload,
  inspectUpdateFailure,
};
