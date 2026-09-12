import { useEffect, useState } from 'react';
import { Download, RefreshCw, ShieldAlert, X } from 'lucide-react';

/**
 * Le bandeau de mise à jour du poste installé — et, au-delà du seuil de retard,
 * sa **porte fermée**.
 *
 * Pourquoi il existe : le processus principal pose bien la question, mais une
 * boîte de dialogue fermée ne revient pas — et sur un poste d'école resté
 * ouvert toute la journée, la seule trace d'une nouvelle version était un
 * message fugace. Ce bandeau-là reste à l'écran tant que la mise à jour attend,
 * donc un utilisateur qui a cliqué « Plus tard » (ou qui n'a rien vu) garde un
 * moyen de l'appliquer sans redémarrer l'application lui-même.
 *
 * Pourquoi une porte, en plus du bandeau : « Plus tard » offert indéfiniment,
 * c'est un poste qui peut rester des mois sur la même version sans que personne
 * n'ait jamais décidé de ne pas la faire. Quand le retard dépasse le seuil
 * (`electron/updater-policy.cjs` : une majeure, deux mineures, ou 45 jours de
 * publication sans installation), la décision n'appartient plus à l'utilisateur
 * du poste : le bandeau devient un écran plein, sans croix, sans « plus tard »,
 * qui ne se lève qu'en installant.
 *
 * La seule issue de secours existe là où l'obligation serait un BLOCAGE, et
 * jamais ailleurs : quand la mise à jour annoncée n'est plus joignable
 * (téléchargement en échec), continuer sans elle redevient possible — un poste
 * qu'on ne peut pas mettre à jour ne doit pas devenir un poste inutilisable.
 * Cette issue n'est atteignable que dans cet état-là : dès que la version est
 * téléchargée, elle disparaît de l'écran.
 *
 * Il ne parle que dans l'application de bureau : `window.desktop.updates`
 * n'existe pas dans un navigateur, et le site web se met à jour tout seul —
 * afficher un bouton d'installation n'aurait aucun sens pour lui.
 */

interface UpdateState {
  status?: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error';
  version?: string | null;
  currentVersion?: string | null;
  action?: 'restart' | 'open-download';
  percent?: number;
  detail?: string;
  /** Décidé par le processus principal (`updatePressure`), jamais par l'interface. */
  forced?: boolean;
  forcedCode?: 'major' | 'minor' | 'age' | 'none' | 'unknown';
  behindMajor?: number | null;
  behindMinor?: number | null;
  releaseAgeDays?: number | null;
}

interface DesktopUpdatesApi {
  getState: () => Promise<UpdateState>;
  onState: (cb: (state: UpdateState) => void) => () => void;
  install: () => Promise<unknown>;
  retry?: () => Promise<unknown>;
}

/** L'API du pont, ou null hors application de bureau. */
function desktopUpdates(): DesktopUpdatesApi | null {
  const api = (globalThis as { desktop?: { updates?: DesktopUpdatesApi } }).desktop?.updates;
  return api && typeof api.onState === 'function' ? api : null;
}

/** Le motif du retard, dit avec les chiffres du poste — jamais « une erreur est survenue ». */
function forcedReason(state: UpdateState, labels: UpdateLabels): string {
  const version = state.version ?? '';
  const current = state.currentVersion ?? '';
  if (state.forcedCode === 'major') {
    return labels.forcedMajor
      .replace('{current}', current)
      .replace('{version}', version)
      .replace('{behind}', String(state.behindMajor ?? 1));
  }
  if (state.forcedCode === 'minor') {
    return labels.forcedMinor
      .replace('{current}', current)
      .replace('{version}', version)
      .replace('{behind}', String(state.behindMinor ?? 2));
  }
  if (state.forcedCode === 'age') {
    return labels.forcedAge.replace('{version}', version).replace('{days}', String(state.releaseAgeDays ?? 0));
  }
  return labels.forcedTitle;
}

export function UpdateBanner({ labels }: { labels: UpdateLabels }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // « Continuer sans mettre à jour » : l'état est porté ici, et n'est proposé
  // qu'en cas d'échec de téléchargement (voir la porte plus bas).
  const [bypassed, setBypassed] = useState(false);

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
  const failed = state?.status === 'error';
  const forced = state?.forced === true;
  // La porte : ouverte dès qu'une mise à jour obligatoire est connue — annoncée,
  // en cours, prête, ou même en échec (pour que l'échec soit VISIBLE, au lieu
  // d'un poste qui se croit à jour parce que la porte a échoué en silence).
  const gate = forced && !bypassed && (ready || downloading || available || failed);

  const install = () => {
    setBusy(true);
    const api = desktopUpdates();
    // Une installation qui échoue ne doit pas laisser le bouton muet : l'état
    // reviendra par le pont, on relâche simplement la pression.
    void api?.install().catch(() => {}).finally(() => setBusy(false));
  };
  const retry = () => {
    setBusy(true);
    const api = desktopUpdates();
    void api?.retry?.().catch(() => {}).finally(() => setBusy(false));
  };

  if (!state) return null;

  if (gate) {
    const isRestart = state.action !== 'open-download';
    const canApply = ready;
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        data-update-gate="forced"
        className="fixed inset-0 z-[9997] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4"
      >
        <div className="w-full max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider text-[11px]">
            <ShieldAlert size={16} className="flex-shrink-0" />
            <span>{labels.forcedTitle}</span>
          </div>
          <p className="text-sm font-semibold leading-snug">{forcedReason(state, labels)}</p>
          <p className="text-[11px] text-slate-300 leading-snug">{labels.forcedNote}</p>
          {failed && (
            <p className="text-[11px] text-amber-200 leading-snug">
              {labels.forcedFailed.replace('{detail}', state.detail ?? '')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canApply && (
              <button
                type="button"
                disabled={busy}
                onClick={install}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-bold uppercase tracking-wider text-[10px] disabled:opacity-50"
              >
                {isRestart ? labels.restart : labels.download}
              </button>
            )}
            {!canApply && (
              <button
                type="button"
                disabled={busy}
                onClick={failed ? retry : install}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold uppercase tracking-wider text-[10px] disabled:opacity-50"
              >
                {failed ? labels.forcedRetry : labels.download}
              </button>
            )}
            {failed && (
              <button
                type="button"
                onClick={() => setBypassed(true)}
                className="px-2 py-1.5 text-slate-400 hover:text-slate-200 text-[10px] underline"
              >
                {labels.forcedContinue}
              </button>
            )}
            {downloading && !failed && (
              <span className="text-[11px] text-slate-300">
                {labels.downloading.replace('{percent}', String(state.percent ?? 0))}
              </span>
            )}
            {available && !failed && (
              <span className="text-[11px] text-slate-300">
                {labels.available.replace('{version}', state.version ?? '')}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!(ready || downloading || available)) return null;
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
          onClick={install}
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
  /** La porte du retard : titre, motif chiffré, règle, échec, secours. */
  forcedTitle: string;
  forcedMajor: string;
  forcedMinor: string;
  forcedAge: string;
  forcedNote: string;
  forcedFailed: string;
  forcedRetry: string;
  forcedContinue: string;
}
