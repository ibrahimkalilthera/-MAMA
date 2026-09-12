import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

/**
 * Le bandeau de mise à jour du poste installé.
 *
 * Pourquoi il existe : le processus principal pose bien la question, mais une
 * boîte de dialogue fermée ne revient pas — et sur un poste d'école resté
 * ouvert toute la journée, la seule trace d'une nouvelle version était un
 * message fugace. Ce bandeau-là reste à l'écran tant que la mise à jour attend,
 * donc un utilisateur qui a cliqué « Plus tard » (ou qui n'a rien vu) garde un
 * moyen de l'appliquer sans redémarrer l'application lui-même.
 *
 * Il ne parle que dans l'application de bureau : `window.desktop.updates`
 * n'existe pas dans un navigateur, et le site web se met à jour tout seul —
 * afficher un bouton d'installation n'aurait aucun sens pour lui.
 */

interface UpdateState {
  status?: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error';
  version?: string | null;
  action?: 'restart' | 'open-download';
  percent?: number;
  detail?: string;
}

interface DesktopUpdatesApi {
  getState: () => Promise<UpdateState>;
  onState: (cb: (state: UpdateState) => void) => () => void;
  install: () => Promise<unknown>;
}

/** L'API du pont, ou null hors application de bureau. */
function desktopUpdates(): DesktopUpdatesApi | null {
  const api = (globalThis as { desktop?: { updates?: DesktopUpdatesApi } }).desktop?.updates;
  return api && typeof api.onState === 'function' ? api : null;
}

export function UpdateBanner({ labels }: { labels: UpdateLabels }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = desktopUpdates();
    if (!api) return;
    let alive = true;
    // L'état est demandé AU MONTAGE en plus de l'abonnement : la fenêtre peut
    // s'ouvrir après que l'application a déjà téléchargé la mise à jour, et
    // s'abonner seul ne rattraperait pas cet événement passé.
    void api.getState().then((s) => { if (alive) setState(s); }).catch(() => {});
    const off = api.onState((s) => { if (alive) setState(s); });
    return () => { alive = false; off?.(); };
  }, []);

  const ready = state?.status === 'downloaded';
  const downloading = state?.status === 'downloading';
  const available = state?.status === 'available';
  if (!state || !(ready || downloading || available)) return null;
  // « Masquer » ne vaut que pour les états d'annonce et de progression :
  // signaler qu'un téléchargement avance, c'est du bruit si l'utilisateur s'en
  // fiche. Une mise à jour PRÊTE ne se masque pas — elle est déjà téléchargée,
  // l'action tient en un clic, et la cacher reviendrait à garder la version
  // pour soi. C'est cohérent avec le fait que la croix n'existe que hors prêt.
  if (dismissed && !ready) return null;

  const isRestart = state.action !== 'open-download';
  const message = ready
    ? isRestart
      ? labels.ready.replace('{version}', state.version ?? '')
      : labels.readyManual.replace('{version}', state.version ?? '')
    : downloading
      ? labels.downloading.replace('{percent}', String(state.percent ?? 0))
      : labels.available.replace('{version}', state.version ?? '');

  return (
    <div
      role="status"
      className="fixed top-11 left-2 z-[9996] flex items-center gap-2 bg-emerald-700 text-white text-[11px] font-bold px-3 py-2 rounded-xl shadow-lg max-w-[min(92vw,520px)]"
    >
      {isRestart && ready ? <RefreshCw size={14} className="flex-shrink-0" /> : <Download size={14} className="flex-shrink-0" />}
      <span>{message}</span>
      {ready && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            const api = desktopUpdates();
            // Une installation qui échoue ne doit pas laisser le bouton muet :
            // l'état reviendra par le pont, on relâche simplement la pression.
            void api?.install().catch(() => {}).finally(() => setBusy(false));
          }}
          className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded-md uppercase tracking-wider text-[10px] disabled:opacity-50"
        >
          {isRestart ? labels.restart : labels.download}
        </button>
      )}
      {!ready && (
        <button
          type="button"
          aria-label={labels.dismiss}
          onClick={() => setDismissed(true)}
          className="p-0.5 hover:bg-white/20 rounded-md"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** Les libellés, injectés : le composant ne connaît ni la langue ni le dictionnaire. */
export interface UpdateLabels {
  available: string;
  downloading: string;
  ready: string;
  readyManual: string;
  restart: string;
  download: string;
  dismiss: string;
}
