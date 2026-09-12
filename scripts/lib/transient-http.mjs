// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/transient-http.mjs — une coupure passagère n'est pas un verdict.
//
// Mesuré le 2026-09-12 : le pixel-check PDF est passé au rouge deux fois sur un
// **504 du gateway Supabase**, alors que l'application était intacte — et le
// résidu, lui, était bien réel : la suppression du compte éphémère a pris le
// même 504, donc le compte est resté en base (le garde anti-résidus l'a signalé
// au run suivant, ce qui est son travail ; il n'aurait pas été mieux qu'il se
// taise).
//
// Ce module porte la seule décision qui manquait : **quand** réessayer.
//
//   • Réessayer un VERDICT (400, 401, 403, 409, 422) n'apprend rien et masque
//     une vraie panne : ces statuts ne sont jamais retentés — ils ressortent tels
//     quels, tout de suite.
//   • Réessayer une COUPURE (429, 502, 503, 504, erreurs réseau) rend au run sa
//     vraie valeur : la plateforme a hoqueté, l'application n'y est pour rien.
//   • Le nombre de tentatives est BORNÉ, et chaque reprise se VOIT dans le
//     journal : un run qui a repris doit le dire, sinon « vert » ne distingue
//     plus « tout allait bien » de « ça a fini par passer ».
//
// Contrat de sortie, et il est strict : à l'épuisement, on rend ce qu'on a VU —
// le dernier statut, ou l'erreur. Jamais un succès inventé, jamais une exception
// avalée. Les valeurs par défaut (tentatives, attente) sont injectables, donc la
// cadence se teste comme une décision au lieu de s'observer en attendant.
// ─────────────────────────────────────────────────────────────────────────────

/** Coupures de passerelle et limites de débit : ça se retente. */
const TRANSIENT_STATUSES = [429, 502, 503, 504];

/** Codes réseau qui veulent dire « redemande » (Node/undici + POSIX). */
const TRANSIENT_CODES = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT',
];

/** Bornes, pour qu'un « retry » ne devienne pas une boucle. */
export const MAX_ATTEMPTS = 10;
export const DEFAULT_ATTEMPTS = 4;
export const DEFAULT_WAIT_MS = 700;
export const DEFAULT_MAX_WAIT_MS = 8000;

/**
 * @param {unknown} status
 * @returns {boolean} vrai si ce statut est une coupure passagère.
 */
export const isTransientStatus = (status) => TRANSIENT_STATUSES.includes(Number(status));

/**
 * @param {unknown} error
 * @returns {boolean} vrai si cette erreur de transport vaut une nouvelle tentative.
 */
export function isTransientError(error) {
  if (!error || typeof error !== 'object') return false;
  const e = /** @type {{ name?: string, code?: string, message?: string, cause?: { code?: string } }} */ (error);
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  const code = e.code || (e.cause && e.cause.code);
  if (code && TRANSIENT_CODES.includes(String(code))) return true;
  // Node emballe les pannes réseau dans `fetch failed` : sans code reconnu, un
  // message de transport reste un candidat — mais RIEN d'autre n'est retenté.
  return /fetch failed|socket hang up|other side closed|terminated|network/i.test(String(e.message || ''));
}

/**
 * Exécuter `fn` en retentant les coupures passagères, borné et bavard.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ attempts?: number, waitMs?: number, factor?: number, maxWaitMs?: number,
 *   log?: (message: string) => void, label?: string, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withTransientRetry(fn, {
  attempts = DEFAULT_ATTEMPTS,
  waitMs = DEFAULT_WAIT_MS,
  factor = 2,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  log = () => {},
  label = '',
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const tries = Math.max(1, Math.min(Number(attempts) || DEFAULT_ATTEMPTS, MAX_ATTEMPTS));
  let lastResult;
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const result = await fn(attempt);
      if (!isTransientStatus(result && result.status)) return result;
      lastResult = result;
      lastError = null;
      if (attempt < tries) log(`${label}HTTP ${result.status} — coupure passagère, tentative ${attempt + 1}/${tries}`);
    } catch (error) {
      // Un verdict n'est pas un hoquet : il remonte tout de suite, tel quel.
      if (!isTransientError(error)) throw error;
      lastError = error;
      lastResult = undefined;
      if (attempt < tries) log(`${label}${(error && error.message) || error} — coupure passagère, tentative ${attempt + 1}/${tries}`);
    }
    if (attempt < tries) {
      await sleep(Math.min(maxWaitMs, waitMs * factor ** (attempt - 1)));
    }
  }
  // Épuisement : ce qu'on a VU, exactement — jamais un succès inventé.
  if (lastError) throw lastError;
  return lastResult;
}

/**
 * Rejouer une ÉCRITURE non idempotente sans la doubler.
 *
 * Un 504 tombe souvent APRÈS que la requête a été appliquée : rejouer un POST à
 * l'aveugle peut donc créer la ligne deux fois. C'est bénin quand une contrainte
 * d'unicité l'interdit (la reprise rend alors un conflit, visible) — et ça ne
 * l'est pas quand il n'y en a aucune, comme `public.staff` (aucune contrainte sur
 * `email`) ou `public.students` (seul `student_id` est unique, et il vaut NULL
 * sur les lignes de démo). Le doublon resterait alors invisible : le nettoyage
 * supprime par l'id rendu par la tentative gagnante, donc il ne connaîtrait
 * jamais la première ligne.
 *
 * D'où le contrat, et il est étroit : **avant chaque reprise**, `probe()` demande
 * si l'écriture est déjà passée et, si oui, c'est SON résultat qui est rendu — la
 * première tentative n'est jamais rejouée pour rien. Une sonde qui échoue, elle,
 * ne décide rien : on rejoue, comme avant. Le premier essai n'appelle jamais la
 * sonde (il n'y a rien à vérifier, et ça coûterait un aller-retour par écriture).
 *
 * @template T
 * @param {() => Promise<T>} write l'écriture, rejouée telle quelle
 * @param {() => Promise<T | null>} probe l'état déjà écrit, ou null si rien n'est passé
 * @param {Parameters<typeof withTransientRetry>[1]} [options]
 * @returns {Promise<T>}
 */
export function replayableWrite(write, probe, { log = () => {}, ...retry } = {}) {
  return withTransientRetry(async (attempt) => {
    if (attempt > 1) {
      try {
        const found = await probe();
        if (found) {
          log('écriture déjà appliquée — réutilisée (aucun doublon)');
          return found;
        }
      } catch {
        // La sonde ne décide rien : elle n'a pas pu répondre, on rejoue.
      }
    }
    return write();
  }, { ...retry, log });
}
