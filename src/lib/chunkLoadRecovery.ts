/**
 * Recovery for failed dynamic imports (chunk load errors).
 *
 * A lazy view/section imports its JS on demand. When that fetch fails — the
 * dev server restarted, a deploy replaced the hashed chunk, the network
 * blipped — the browser rejects the import and `React.lazy` MEMORISES the
 * rejection: remounting the subtree replays the same rejected promise, so an
 * ErrorBoundary "retry" that only clears state cannot recover. The real
 * recovery is a page reload, which is exactly what Vite recommends for its
 * `vite:preloadError` event.
 *
 * The failure mode to avoid is a reload LOOP (server down ⇒ reload ⇒ same
 * error). `recoverFromChunkLoadError` therefore allows at most one reload per
 * window, tracked in storage the caller supplies (sessionStorage in the app,
 * a fake in tests); when the guard suppresses a reload the caller surfaces the
 * error instead of looping.
 */

/** Clé de garde anti-boucle : date du dernier rechargement tenté. */
export const RELOAD_GUARD_KEY = 'school-finance-chunk-reload-at';

/** Écart minimal entre deux rechargements automatiques pour la même panne. */
export const RELOAD_MIN_GAP_MS = 15000;

/** Les formes du message selon les navigateurs / bundlers. */
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
];

/** Vrai quand l'erreur est un import dynamique / chunk non récupéré. */
export const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
};

/** Un rechargement est permis sans horodatage exploitable, ou après l'écart minimal. */
export const shouldAutoReload = (now: number, last: number, minGapMs = RELOAD_MIN_GAP_MS): boolean => {
  if (!Number.isFinite(last)) return true;
  return now - last > minGapMs;
};

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Recharge AU PLUS UNE FOIS par fenêtre. Renvoie true si un rechargement a été
 * demandé, false si le garde l'a supprimé (un rechargement récent n'a rien
 * réglé : l'appelant doit alors montrer l'erreur au lieu de boucler).
 */
export const recoverFromChunkLoadError = (
  now: number,
  storage: RecoveryStorage,
  reload: () => void,
  minGapMs = RELOAD_MIN_GAP_MS,
): boolean => {
  // Une clé absente (ou illisible) n'est PAS l'époque 0 : sans ce soin,
  // `Number(null) === 0` ferait passer le premier rechargement pour récent.
  const raw = storage.getItem(RELOAD_GUARD_KEY);
  const last = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  if (!shouldAutoReload(now, last, minGapMs)) return false;
  storage.setItem(RELOAD_GUARD_KEY, String(now));
  reload();
  return true;
};

/** La surface de `window` dont le gestionnaire global a besoin (minimale, testable). */
export interface ChunkRecoveryWindow {
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
  location: { reload(): void };
  sessionStorage: RecoveryStorage;
}

/**
 * Branche `vite:preloadError` sur un rechargement gardé. Appelé une fois depuis
 * le point d'entrée ; no-op quand la fenêtre n'expose pas addEventListener.
 */
export const registerChunkLoadRecovery = (
  win: ChunkRecoveryWindow | undefined,
  now: () => number = Date.now,
): void => {
  if (!win || typeof win.addEventListener !== 'function') return;
  win.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    recoverFromChunkLoadError(now(), win.sessionStorage, () => win.location.reload());
  });
};
