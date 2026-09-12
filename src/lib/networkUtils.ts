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

function isRetryableError(error: unknown): boolean {
  if (!navigator.onLine) return true;

  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error instanceof TypeError && error.message.includes('network')) return true;

  // A rejected token is transient by nature (see isAuthTokenError): retry is
  // what turns the old one-shot red banner into a silent, successful load.
  if (isAuthTokenError(error instanceof Error ? error.message : String(error ?? ''))) return true;

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

export function getAppEnv(): AppEnv {
  const env = (import.meta.env.VITE_APP_ENV || 'development') as string;
  if (env === 'staging' || env === 'production') return env;
  return 'development';
}

export function isProduction(): boolean {
  return getAppEnv() === 'production';
}
