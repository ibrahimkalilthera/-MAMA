/**
 * Network Utilities for MAMA THERA Finance Suite
 * 
 * Provides retry logic, offline detection, and error formatting
 * designed for reliable operation on intermittent internet connections
 * (e.g., Bamako, Mali).
 */

// ─── Retry with Exponential Backoff ──────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Wraps an async function with exponential backoff retry logic.
 * Retries on network errors and 5xx server errors.
 * 
 * Default: 3 retries with delays of 1s → 2s → 4s
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, onRetry } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on non-retryable errors
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't retry after max attempts
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      onRetry?.(attempt + 1, error);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * A rejected TOKEN, as opposed to a refused request.
 *
 * PostgREST answers `PGRST300` (« a JWT secret is missing from the
 * configuration ») / `PGRST301` (« provided JWT couldn't be decoded ») when it
 * cannot verify the token, and GoTrue says `JWT issued at future` when the
 * machine that signed in has a clock ahead of the server. All three mean the
 * same thing to the app: the token that went out is not usable *right now* — the
 * client refreshes it in the background, and a clock-skewed PC gets a fresh one
 * on the next attempt. That is why the login-screen banner used to appear once,
 * in red, and vanish when the user pressed « Réessayer » (measured: the E2E
 * scripts drive the packaged desktop app and had to click that button in a loop).
 *
 * A wrong key or a real permission refusal (`42501`) is NOT this: retrying it
 * would only delay the same verdict.
 *
 * @param message the raw error text, as Supabase wrote it
 * @returns true when the failure is a token that needs (and gets) a refresh
 */
export function isAuthTokenError(message: string): boolean {
  const text = String(message ?? '');
  // No "does it mention a token?" pre-filter: the wording that matters most,
  // `PGRST301: JWSError JWSInvalidSignature`, names the token NOWHERE — it says
  // JWS. That gate made the first version of this classifier answer `false` for
  // the very case it was written for, which is exactly how the red banner would
  // have survived the fix.
  return (
    // PostgREST: JWT secret missing / JWT undecodable / request without the key.
    /PGRST30[0-2]/i.test(text) ||
    // The JOSE/JWT family, including GoTrue's `JWT issued at future` and
    // JSWS (a signature that does not verify, which is what a revoked secret or
    // a half-refreshed token looks like from here).
    /\bjwt\b|\bjws[a-z]*\b/i.test(text) ||
    /\bissued at future\b/i.test(text) ||
    // A bearer token that the server considers past its expiry.
    /\b(?:token|jwt)\b[^.]{0,40}?\bexpired\b|\bexpired\b[^.]{0,40}?\b(?:token|jwt)\b/i.test(text)
  );
}

/**
 * Distinguish « the server refused » from « the server was not reached ».
 *
 * That difference decides which of the two sign-in paths runs: a refused
 * password must be REPORTED (never answered by the local verifier), while an
 * unreachable server is exactly the case the offline sign-in exists for. A
 * browser that has lost its network reports it as a fetch failure —
 * `TypeError: Failed to fetch` — sometimes surfaced by supabase-js as a
 * retryable fetch error with status 0, and Electron adds its own wording
 * (`net::ERR_INTERNET_DISCONNECTED`).
 *
 * @param error  the thrown value or the `error` returned by supabase-js
 * @param online navigator.onLine, injected so this stays testable
 */
export function isConnectivityFailure(error: unknown, online?: boolean): boolean {
  const isOnline = online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  if (!isOnline) return true;
  if (error === null || error === undefined) return false;

  if (CONNECTIVITY_TEXT.test(errorText(error))) return true;

  // supabase-js wraps an unreachable host in an error carrying status 0, and a
  // gateway that answered for a dead upstream (502/503/504, plus Cloudflare's
  // 520-530 — the same list auth-js itself calls NETWORK_ERROR_CODES) did not
  // judge the request either. None of these is a verdict about the password.
  const status = errorStatus(error);
  return status === 0 || (status !== undefined && INFRASTRUCTURE_STATUS.has(status));
}

/**
 * « Le serveur a RÉPONDU, et il refuse » — à distinguer de « je n'ai pas pu
 * joindre le serveur ».
 *
 * C'est ce verdict-là, et lui seul, qui interdit de consulter le vérificateur
 * local : répondre localement à un refus du serveur (mot de passe faux, compte
 * désactivé) transformerait une empreinte périmée en porte d'entrée.
 *
 * L'inverse est tout aussi important, et c'est la correction de fond : tout ce
 * qui n'est PAS un refus explicite doit pouvoir descendre au vérificateur. Tant
 * que la porte hors ligne exigeait un verdict positif de `isConnectivityFailure`
 * (« la panne est bien un problème de réseau »), une seule forme d'erreur mal
 * reconnue suffisait à enfermer l'utilisateur dehors : il voyait « Failed to
 * fetch » — le message brut du transport — sur un écran de connexion, sans
 * réseau pour se rattraper et sans savoir que son poste, lui, savait qui il est.
 *
 * La liste est donc volontairement étroite (400/401/403/422/429, ou le code et
 * le libellé que GoTrue renvoie pour un refus), et un 5xx, un statut absent, un
 * objet inattendu ou un mot de passe faux côté vérificateur local gardent la
 * porte ouverte.
 */
export function isServerRefusal(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const text = errorText(error);
  const code = errorCode(error);
  if (code && SERVER_REFUSAL_CODE.test(code)) return true;
  if (SERVER_REFUSAL_TEXT.test(text)) return true;
  const status = errorStatus(error);
  return status === 400 || status === 401 || status === 403 || status === 422 || status === 429;
}

/**
 * Le texte d'une erreur, quelle que soit sa forme.
 *
 * `error instanceof Error` est FAUX plus souvent qu'on ne le croit : une erreur
 * franchie par le pont IPC d'Electron, sérialisée en JSON, ou construite à la
 * main (`{ message, status }`) n'est pas une instance d'`Error`, et
 * `String(error)` rend alors « [object Object] » — le mot « fetch » n'y est plus
 * lisible, donc la panne réseau devenait invisible et se lisait comme un refus
 * du serveur. On lit donc les champs, dans l'ordre où les deux serveurs les
 * écrivent (`.message` pour fetch, `.msg`/`error_description` pour GoTrue), et
 * `String()` n'est tenté que sous garde — sur un objet sans `toString`, il
 * lève.
 */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return '';
  if (typeof error !== 'object') {
    try {
      return String(error);
    } catch {
      return '';
    }
  }
  const fields = error as { message?: unknown; msg?: unknown; error_description?: unknown; code?: unknown; name?: unknown };
  // Le MESSAGE d'abord, et lui seul quand il existe : c'est le libellé que le
  // serveur ou le navigateur a écrit, donc celui qu'il faut citer à l'écran.
  // `name`/`code` ne servent qu'en secours (une erreur réduite à son nom, un code
  // GoTrue), et `String()` seulement en dernier — il lève sur un objet sans
  // conversion en chaîne, et une classification ne doit jamais faire échouer
  // l'appelant.
  for (const value of [fields.message, fields.msg, fields.error_description]) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  for (const value of [fields.code, fields.name]) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  try {
    return String(error);
  } catch {
    return '';
  }
}

/** Le statut HTTP porté par une erreur, s'il y en a un (jamais `NaN`). */
function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** Le code d'erreur (GoTrue : `invalid_credentials`, PostgREST : `42501`…). */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Pannes de transport — le serveur n'a rien jugé. */
const CONNECTIVITY_TEXT = /failed to fetch|fetch failed|network ?error|load failed|timed? ?out|timeout|econnrefused|econnreset|enotfound|eai_again|name_not_resolved|err_internet|err_network|err_connection|err_name|net::err_|unreachable|offline|no internet|failed to load resource|bad gateway|service unavailable|gateway time-?out/i;

/** Verdicts du serveur : jamais répondus par le vérificateur local. */
const SERVER_REFUSAL_TEXT = /invalid login credentials|invalid_credentials|email not confirmed|email_not_confirmed|user_banned|user is banned|too many requests|too_many_requests|over_request_rate_limit|rate limit|weak_password|invalid password/i;

const SERVER_REFUSAL_CODE = /^(?:invalid_credentials|email_not_confirmed|user_banned|too_many_requests|over_request_rate_limit|weak_password|invalid_password)$/i;

/** Un intermédiaire a répondu pour un amont mort : pas un verdict non plus. */
const INFRASTRUCTURE_STATUS = new Set<number>([500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]);

function isRetryableError(error: unknown): boolean {
  if (!navigator.onLine) return true;

  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error instanceof TypeError && error.message.includes('network')) return true;

  // A rejected token is transient by nature (see isAuthTokenError): retry is
  // what turns the old one-shot red banner into a silent, successful load.
  if (isAuthTokenError(errorText(error))) return true;

  // Supabase/PostgREST errors
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    // Retry on server errors and rate limits, not on client errors (4xx)
    return status >= 500 || status === 429;
  }

  return false;
}

// ─── Online/Offline Detection ────────────────────────────────────────────────

/**
 * Returns current online status.
 * Note: navigator.onLine can have false positives (connected to LAN but no internet),
 * but it reliably detects false (no network at all).
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

// ─── The station-level offline gate ─────────────────────────────────────────

/**
 * « Cette station ne peut PAS joindre le serveur », au niveau du MODULE.
 *
 * Le crochet `useSupabaseData` connaît deux raisons de ne rien envoyer : plus de
 * réseau, ou une **session hors ligne** (connexion par le vérificateur local,
 * donc sans jeton). Tant que l'état vivait dans ce seul crochet, les modules qui
 * écrivent en dehors de lui — les notes du calendrier, le journal d'audit, la
 * déclaration d'année — ne pouvaient pas poser la même question : ils tentaient
 * l'écriture, elle échouait, et la saisie était PERDUE au lieu d'être mise en
 * file. C'est ce vide que ce drapeau comble : `useAuth` le pose dès que la
 * session devient hors ligne, exactement la valeur que `useSupabaseData` reçoit
 * en option, donc les deux ne peuvent pas diverger.
 */
let offlineSessionActive = false;

/** Posé par `useAuth` (voir src/lib/useAuth.ts) — jamais lu ailleurs qu'ici. */
export function setOfflineSessionActive(active: boolean): void {
  offlineSessionActive = Boolean(active);
}

/**
 * Vrai quand une écriture ne peut pas partir MAINTENANT : pas de réseau, ou une
 * session hors ligne pas encore rétablie. C'est la question à poser AVANT toute
 * écriture, et la seule qu'un module hors du crochet de données puisse poser.
 */
export function isStationOffline(): boolean {
  if (offlineSessionActive) return true;
  if (typeof navigator === 'undefined') return false;
  // `=== false` et non `!navigator.onLine` : `onLine` n'existe pas partout
  // (Node, runner de tests), et `!undefined` vaut vrai — une station parfaitement
  // connectée se serait déclarée hors ligne, et tout aurait été mis en file
  // silencieusement. Seul un `false` EXPLICITE veut dire « pas de réseau ».
  return navigator.onLine === false;
}

/**
 * Registers callbacks for online/offline transitions.
 * Returns a cleanup function.
 */
export function onConnectivityChange(
  callbacks: { onOnline?: () => void; onOffline?: () => void }
): () => void {
  const handleOnline = () => callbacks.onOnline?.();
  const handleOffline = () => callbacks.onOffline?.();

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

// ─── Error Formatting ────────────────────────────────────────────────────────

type Language = 'en' | 'fr';

interface FormattedError {
  title: string;
  message: string;
  isRetryable: boolean;
}

/**
 * Translates Supabase/network errors into user-friendly bilingual messages.
 */
export function formatSupabaseError(
  error: { message?: string; code?: string; status?: number } | string | null,
  lang: Language = 'en'
): FormattedError {
  if (!error) {
    return {
      title: lang === 'en' ? 'Unknown Error' : 'Erreur inconnue',
      message: lang === 'en' ? 'An unexpected error occurred.' : 'Une erreur inattendue s\'est produite.',
      isRetryable: false,
    };
  }

  const msg = typeof error === 'string' ? error : (error.message || '');
  const code = typeof error === 'string' ? '' : (error.code || '');
  const status = typeof error === 'string' ? 0 : (error.status || 0);

  // Token rejected FIRST: `jwt secret` / `JWT issued at future` is not a
  // connectivity problem, and the network branch below would swallow it (its
  // own wording is the generic « vérifiez votre connexion », which sends the
  // user to the wrong remedy on a machine whose clock is simply off).
  //
  // Token rejected (JWT secret / undecodable JWT / clock skew) — the one case
  // where the user can actually do something about it on the machine.
  if (isAuthTokenError(msg)) {
    return {
      title: lang === 'en' ? 'Session Token Rejected' : 'Jeton de session refusé',
      message:
        lang === 'en'
          ? `The server did not accept the session token. The retry is automatic; if it persists, check this PC's date and time — a clock that is off makes every freshly issued token look invalid. (${msg})`
          : `Le serveur n'a pas accepté le jeton de session. La nouvelle tentative est automatique ; si cela persiste, vérifiez la date et l'heure de ce PC — une horloge décalée fait paraître invalide tout jeton fraîchement émis. (${msg})`,
      isRetryable: true,
    };
  }

  // Network / connectivity errors
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch') || !navigator.onLine) {
    return {
      title: lang === 'en' ? 'Connection Error' : 'Erreur de connexion',
      message: lang === 'en'
        ? 'Unable to reach the server. Please check your internet connection and try again.'
        : 'Impossible de joindre le serveur. Vérifiez votre connexion internet et réessayez.',
      isRetryable: true,
    };
  }

  // Rate limit
  if (status === 429) {
    return {
      title: lang === 'en' ? 'Too Many Requests' : 'Trop de requêtes',
      message: lang === 'en'
        ? 'Please wait a moment before trying again.'
        : 'Veuillez patienter un instant avant de réessayer.',
      isRetryable: true,
    };
  }

  // Server error
  if (status >= 500) {
    return {
      title: lang === 'en' ? 'Server Error' : 'Erreur serveur',
      message: lang === 'en'
        ? 'The server encountered an error. Please try again later.'
        : 'Le serveur a rencontré une erreur. Veuillez réessayer plus tard.',
      isRetryable: true,
    };
  }

  // Row Level Security / permission errors
  if (code === '42501' || msg.includes('permission') || msg.includes('policy')) {
    return {
      title: lang === 'en' ? 'Permission Denied' : 'Accès refusé',
      message: lang === 'en'
        ? 'You do not have permission to perform this action.'
        : 'Vous n\'avez pas la permission d\'effectuer cette action.',
      isRetryable: false,
    };
  }

  // Duplicate key
  if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
    return {
      title: lang === 'en' ? 'Duplicate Entry' : 'Doublon détecté',
      message: lang === 'en'
        ? 'This record already exists. Please check and try again.'
        : 'Cet enregistrement existe déjà. Veuillez vérifier et réessayer.',
      isRetryable: false,
    };
  }

  // Foreign key violation
  if (code === '23503' || msg.includes('foreign key') || msg.includes('referenced')) {
    return {
      title: lang === 'en' ? 'Reference Error' : 'Erreur de référence',
      message: lang === 'en'
        ? 'This record is linked to other data. Please remove related records first.'
        : 'Cet enregistrement est lié à d\'autres données. Supprimez d\'abord les enregistrements liés.',
      isRetryable: false,
    };
  }

  // Fallback
  return {
    title: lang === 'en' ? 'Error' : 'Erreur',
    message: msg || (lang === 'en' ? 'An unexpected error occurred.' : 'Une erreur inattendue s\'est produite.'),
    isRetryable: false,
  };
}

// ─── App Environment ─────────────────────────────────────────────────────────

export type AppEnv = 'development' | 'staging' | 'production';

/**
 * L'environnement d'un build, déduit du MODE que Vite a réellement compilé.
 *
 * MESURÉ le 2026-09-13 sur l'installeur publié : l'application Windows livrée
 * se déclarait `development` (`function Ge(){return`development`}` dans son
 * bundle). La cause n'est pas un choix mais un fichier : `.env.production` est
 * gitignoré, donc le build du runner ne l'a pas, donc
 * `import.meta.env.VITE_APP_ENV` valait `undefined` et le repli répondait
 * `development`. Conséquence visible : la pastille bleue « DEV » dans l'app
 * installée chez l'école — un build de PRODUCTION qui se présente comme un
 * environnement de test, et aucun contrôle ne pouvait le voir (la base, elle,
 * était bien la bonne).
 *
 * `MODE` est posé par Vite lui-même — `vite build` → `production`,
 * `--mode staging` → `staging`, `vite dev` → `development` — donc il est
 * toujours présent, et un build de production ne peut plus se déclarer autre
 * chose, même sans aucun fichier `.env`. `VITE_APP_ENV` reste PRIORITAIRE :
 * c'est le seul moyen d'être explicite là où le mode ne suffit pas (un build
 * `production` servi comme pré-version, par exemple).
 */
export function appEnvFrom(viteEnv: { VITE_APP_ENV?: string; MODE?: string } | undefined): AppEnv {
  const raw = viteEnv?.VITE_APP_ENV || viteEnv?.MODE || '';
  if (raw === 'staging' || raw === 'production') return raw;
  return 'development';
}

export function getAppEnv(): AppEnv {
  return appEnvFrom(import.meta.env);
}

export function isProduction(): boolean {
  return getAppEnv() === 'production';
}
