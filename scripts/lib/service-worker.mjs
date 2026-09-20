/**
 * scripts/lib/service-worker.mjs — le build écrit un SERVICE WORKER qui garde le
 * build ENTIER en réserve, pour que le site s'ouvre à froid sans réseau.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le poste installé charge son interface depuis le disque (`electron/main.cjs` →
 * `loadFile`), donc il s'ouvre toujours. Le site hébergé, lui, ne s'ouvre à froid
 * que si le NAVIGATEUR a gardé la coquille ET les modules qu'elle demande : sans
 * service worker, une coupure de réseau suivie d'une fermeture d'onglet rend
 * l'application inaccessible — y compris l'impression d'un reçu, dont le code
 * (jsPDF) arrive en module à la demande, donc par le réseau.
 *
 * LES QUATRE RÈGLES QUE CE WORKER APPLIQUE, et pourquoi
 * -----------------------------------------------------
 *   1. JAMAIS un tiers. Toute requête d'une autre origine est laissée au réseau,
 *      sans être lue ni écrite : la base (Supabase) est une autre origine, et un
 *      cache de réponses de base serait une copie de données d'école hors de son
 *      contrôle — et un piège à données périmées.
 *   2. Les NAVIGATIONS sont « réseau d'abord » (avec un délai court), la copie
 *      locale n'étant que le recours hors ligne. C'est ce qui fait qu'une version
 *      en ligne n'est JAMAIS servie périmée : la coquille vient du serveur à
 *      chaque ouverture, et les modules portent une empreinte dans leur nom.
 *   3. Les MODULES et les fichiers du build sont « réserve d'abord » : leur nom
 *      contient leur contenu (`assets/App-<hash>.js`), donc une copie ne peut pas
 *      mentir sur ce qu'elle contient.
 *   4. On ne jette pas la réserve du build PRÉCÉDENT tout de suite : un onglet
 *      resté ouvert travaille sur l'ancien build et va demander, plus tard, des
 *      modules à la demande (un bulletin, un reçu) qui n'existent que dans
 *      l'ancienne réserve. La mise à jour les laisserait sans fichier au pire
 *      moment. On garde donc la réserve courante ET la précédente, et on jette le
 *      reste.
 *
 * LE CHOIX DE `skipWaiting` SANS `clients.claim`, et ce qu'il évite
 * ------------------------------------------------------------------
 * Le nouveau worker s'installe et se met en réserve tout de suite (la prochaine
 * ouverture est donc déjà la bonne), mais il ne prend PAS le contrôle des pages
 * déjà ouvertes : une page en cours de saisie n'est pas rechargée, et n'est pas
 * non plus servie à moitié par deux versions. Sa réserve du build précédent est
 * conservée (règle 4), donc ses modules continuent d'arriver.
 *
 * LE FONCTIONNEMENT N'EST ÉCRIT QU'UNE FOIS
 * -----------------------------------------
 * `prunePlan` est la seule partie subtile (garder la réserve qu'un onglet peut
 * encore demander). Le worker généré l'embarque par `toString()` : ce qui tourne
 * dans le navigateur est LITTÉRALEMENT la fonction testée ici, pas une seconde
 * écriture qui dériverait de la première. Un test le vérifie explicitement.
 */

export const SW_FILE_NAME = 'sw.js';

/** Préfixe des réserves de cette application — les autres ne sont pas touchées. */
export const CACHE_PREFIX = 'mama-thera-';

/** Le shell hors ligne : ce que sert une navigation quand le réseau ne répond pas. */
export const SHELL_URL = '/index.html';

/** Délai au-delà duquel une navigation en ligne bascule sur la copie locale. */
export const NAVIGATION_TIMEOUT_MS = 3000;

/** Fichiers du build qui ne sont PAS mis en réserve (le worker lui-même). */
const NOT_PRECACHED = new Set([SW_FILE_NAME]);

/**
 * La liste des fichiers à mettre en réserve, depuis les chemins du dossier
 * `dist/` (relatifs, séparateur `/`).
 *
 * Le worker lui-même est exclu : le navigateur va le chercher tout seul, et le
 * mettre en réserve ferait qu'un worker périmé se servirait lui-même.
 */
/**
 * @param {string[]} [paths] chemins relatifs du dossier de build
 * @returns {string[]} chemins absolus, triés, servis par l'origine
 */
export function collectPrecacheEntries(paths = []) {
  const entries = paths
    .map((p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, ''))
    .filter((p) => p && !NOT_PRECACHED.has(p))
    .map((p) => `/${p}`);
  return [...new Set(entries)].sort();
}

/** Un sha de commit : 7 à 40 caractères hexadécimaux. */
const SHA_LIKE = /^[0-9a-f]{7,40}$/i;

/**
 * Empreinte du contenu d'une liste (FNV-1a 32 bits, hex) — stable et lisible.
 *
 * @param {string[]} [entries]
 * @returns {string}
 */
export function fingerprint(entries = []) {
  let hash = 0x811c9dc5;
  for (const text of entries) {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * L'identité du build mis en réserve.
 *
 * Le sha du commit quand il est connu (le workflow de déploiement le pose), sinon
 * l'empreinte de la liste des fichiers : un build local doit changer d'identité
 * quand son contenu change, exactement comme un build de CI change de commit.
 *
 * @param {{ sha?: string, entries?: string[] }} [input]
 * @returns {string}
 */
export function buildVersion({ sha = '', entries = [] } = {}) {
  const clean = String(sha).trim();
  if (SHA_LIKE.test(clean)) return clean.toLowerCase();
  return `h${fingerprint(entries)}`;
}

/**
 * Le nom de la réserve : version + horodatage (l'horodatage sert à ordonner).
 *
 * @param {string} version
 * @param {number} stamp
 * @returns {string}
 */
export function cacheName(version, stamp) {
  return `${CACHE_PREFIX}${version}-${stamp}`;
}

/**
 * Que faut-il garder, que faut-il jeter, à l'activation ?
 *
 * ⚠️ FONCTION VOLONTAIREMENT AUTONOME (`var`, `function`), car elle est embarquée
 * telle quelle dans le worker généré (`toString()`) : elle ne doit dépendre
 * d'aucune variable extérieure, sinon la copie embarquée lèverait à l'exécution.
 *
 * Ce qui est décidé : la réserve COURANTE et la plus récente des autres réserves
 * de cette application (celle d'un onglet resté ouvert) sont gardées ; les plus
 * anciennes sont jetées. Les réserves d'une autre application ne sont ni gardées
 * ni jetées : elles ne sont pas les nôtres.
 *
 * @param {string[]} cacheNames
 * @param {string} currentName
 * @returns {{ keep: string[], drop: string[] }}
 */
export function prunePlan(cacheNames, currentName) {
  var prefix = 'mama-thera-';
  var stampOf = function (name) {
    var index = name.lastIndexOf('-');
    var value = Number(name.slice(index + 1));
    return isFinite(value) ? value : 0;
  };
  var others = cacheNames.filter(function (name) {
    return name.indexOf(prefix) === 0 && name !== currentName;
  });
  others.sort(function (a, b) {
    return stampOf(b) - stampOf(a);
  });
  return {
    keep: [currentName].concat(others.slice(0, 1)),
    drop: others.slice(1),
  };
}

/**
 * Le code du service worker, mis en forme pour ce build.
 *
 * @param {{ version: string, entries: string[], stamp: number }} input
 *   `entries` = chemins absolus servis par l'origine (voir collectPrecacheEntries)
 * @returns {string} le code du worker
 */
export function renderServiceWorker({ version, entries, stamp }) {
  const current = cacheName(version, stamp);
  return `/**
 * Service worker de ${version} — GÉNÉRÉ par scripts/lib/service-worker.mjs.
 * Ne pas modifier à la main : le fichier est réécrit à chaque build.
 */
const VERSION = ${JSON.stringify(version)};
const CURRENT_CACHE = ${JSON.stringify(current)};
const SHELL_URL = ${JSON.stringify(SHELL_URL)};
const NAVIGATION_TIMEOUT_MS = ${NAVIGATION_TIMEOUT_MS};
const PRECACHE = ${JSON.stringify(entries, null, 0)};

${prunePlan.toString()}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CURRENT_CACHE);
    // Fichier par fichier : un seul manquant (une police retirée, un fichier
    // optionnel) ne doit pas faire échouer l'installation ENTIÈRE, ce qui
    // laisserait le poste sans aucune réserve hors ligne.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response && response.ok) await cache.put(url, response);
      } catch (error) {
        // Un fichier non mis en réserve n'empêche pas l'installation.
      }
    }));
    // La réserve est prête : la prochaine ouverture sera déjà le bon build.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const plan = prunePlan(await caches.keys(), CURRENT_CACHE);
    await Promise.all(plan.drop.map((name) => caches.delete(name)));
    // AUCUN « claim » des pages déjà ouvertes : aucune n'est rechargée au milieu
    // d'une saisie, et sa réserve (le build précédent) est conservée par prunePlan.
  })());
});

/** La requête appartient-elle à cette origine ? Sinon : jamais touchée. */
function isOwnOrigin(url) {
  return url.origin === self.location.origin;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Recherche dans TOUTES les réserves : un onglet peut demander l'ancien build. */
async function matchAnywhere(request) {
  const current = await caches.open(CURRENT_CACHE);
  const local = await current.match(request);
  if (local) return local;
  return (await caches.match(request)) || undefined;
}

/** Réseau d'abord (coquille toujours fraîche en ligne), réserve en recours. */
async function networkFirstShell(request) {
  try {
    const fresh = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CURRENT_CACHE);
      await cache.put(SHELL_URL, fresh.clone());
      return fresh;
    }
    throw new Error('réponse non exploitable');
  } catch (error) {
    const cached = await matchAnywhere(new Request(SHELL_URL));
    if (cached) return cached;
    return Response.error();
  }
}

/** Réserve d'abord (le nom du fichier porte son empreinte), réseau sinon. */
async function cacheFirst(request) {
  const cached = await matchAnywhere(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CURRENT_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Une écriture n'est jamais servie depuis une réserve.
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  // Un autre domaine (la base Supabase, par exemple) : laissé au réseau, sans
  // être lu ni écrit. Une copie de réponses de base serait une copie de données
  // d'école, et une réponse périmée servie à l'écran.
  if (!isOwnOrigin(url)) return;
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  const isBuildFile = url.pathname.indexOf('/assets/') === 0 || PRECACHE.indexOf(url.pathname) !== -1;
  if (isBuildFile) event.respondWith(cacheFirst(request));
});
`;
}

/**
 * Le plugin Vite : écrit `dist/sw.js` après la fin du bundle, quand la liste des
 * fichiers produits est complète.
 *
 * Il n'écrit RIEN quand l'interface est construite en chemins relatifs
 * (`--base=./`, le build de bureau) : ce build-là est chargé depuis le disque
 * (`file:`), où un service worker ne s'enregistre pas — un worker dont les
 * chemins ne correspondraient à rien serait un piège, pas une sécurité.
 *
 * @param {{ sha?: string, now?: () => number, log?: (message: string) => void, warn?: (message: string) => void }} [options]
 * @returns {{ name: string, configResolved: (config: { base?: string, build?: { outDir?: string } }) => void, closeBundle: () => Promise<void> }}
 */
export function serviceWorkerPlugin({
  sha = process.env.BUILD_SHA || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '',
  now = () => Date.now(),
  log = console.log,
  warn = console.warn,
} = {}) {
  let base = '/';
  let outDir = 'dist';
  let enabled = true;
  return {
    name: 'service-worker',
    configResolved(config) {
      base = config.base || '/';
      outDir = config.build?.outDir || 'dist';
      enabled = base === '/' || base === '';
      if (!enabled) {
        warn(`[service-worker] base « ${base} » : aucun service worker écrit (build chargé depuis le disque).`);
      }
    },
    async closeBundle() {
      if (!enabled) return;
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dir = path.resolve(process.cwd(), outDir);

      const walk = async (current, prefix = '') => {
        const found = [];
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
          const next = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) found.push(...await walk(path.join(current, entry.name), next));
          else found.push(next);
        }
        return found;
      };

      let files;
      try {
        files = await walk(dir);
      } catch (error) {
        // Échouer ICI est volontaire : un déploiement sans réserve hors ligne
        // passerait sinon pour un déploiement normal, et la perte ne se verrait
        // qu'au premier jour sans réseau.
        throw new Error(`[service-worker] impossible de lire le build (${dir})`, { cause: error });
      }
      const entries = collectPrecacheEntries(files);
      const version = buildVersion({ sha, entries });
      const stamp = now();
      const source = renderServiceWorker({ version, entries, stamp });
      await fs.writeFile(path.join(dir, SW_FILE_NAME), source, 'utf8');
      log(`[service-worker] ${SW_FILE_NAME} écrit pour ${version} — ${entries.length} fichier(s) en réserve.`);
    },
  };
}
