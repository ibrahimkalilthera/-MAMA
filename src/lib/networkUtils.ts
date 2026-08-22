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

function isRetryableError(error: unknown): boolean {
  if (!navigator.onLine) return true;

  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error instanceof TypeError && error.message.includes('network')) return true;

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
