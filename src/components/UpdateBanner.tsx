import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldAlert, X } from 'lucide-react';

import type { BlockedUpdate, ReportOutcome } from '../lib/desktopUpdateReport';

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
 * Et une porte fermée ne doit pas être un SILENCE. Le processus principal
 * inscrit chaque blocage dans le journal local du poste
 * (`electron/update-journal.cjs`, qui marche sans session ni réseau) ; ce
 * bandeau fait la seconde moitié — il SIGNALE le blocage au journal d'audit,
 * une fois par blocage, pour que l'administrateur n'ait pas à aller voir chaque
 * machine, et il offre le journal local quand l'envoi est impossible (poste
 * bloqué avant toute connexion).
 *
 * Il ne parle que dans l'application de bureau : `window.desktop.updates`
 * n'existe pas dans un navigateur, et le site web se met à jour tout seul —
 * afficher un bouton d'installation n'aurait aucun sens pour lui.
 */

/** L'état poussé par le processus principal — exporté : c'est le contrat du pont. */
export interface UpdateState {
  /**
   * `held` = version retenue (frein d'urgence, `electron/updater-policy.cjs`) :
   * le processus principal a décidé de ne pas la livrer. L'interface ne montre
   * RIEN — ce n'est pas une panne à signaler à l'utilisateur, c'est une décision
   * qui ne lui appartient pas —, mais l'état existe pour qu'un bandeau ne
   * s'affiche jamais par accident sur une version qu'on refuse d'installer.
   */
  status?: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'error' | 'held';
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
  /**
   * Le blocage constaté par le processus principal (`gateFailure`), ou null.
   * Posé à part de `forced` : une installation qui n'a pas abouti est un
   * blocage MÊME sans obligation en cours — c'est un fait, pas une opinion sur
   * le retard.
   */
  blocked?: BlockedUpdate | null;
}

interface DesktopUpdatesApi {
  getState: () => Promise<UpdateState>;
  onState: (cb: (state: UpdateState) => void) => () => void;
  install: () => Promise<unknown>;
  retry?: () => Promise<unknown>;
  journal?: () => Promise<{ path?: string; station?: string; entries?: unknown[] }>;
  openJournal?: () => Promise<{ ok?: boolean; path?: string }>;
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

export function UpdateBanner({
  labels,
  onReport,
}: {
  labels: UpdateLabels;
  /**
   * Envoie le blocage au journal d'audit et rend ce qui s'est réellement passé.
   * Injecté : ce composant ne connaît ni Supabase ni la session — il montre, il
   * ne décide pas, et il ne prétend jamais qu'un envoi a réussi.
   */
  onReport?: (state: UpdateState) => Promise<ReportOutcome>;
}) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  // « Continuer sans mettre à jour » : l'état est porté ici, et n'est proposé
  // qu'en cas d'échec de téléchargement (voir la porte plus bas).
  const [bypassed, setBypassed] = useState(false);
  // Le sort du signalement : null = pas encore tenté. Stocké, et non déduit,
  // parce qu'un « je l'ai signalé » doit être la conséquence d'un envoi.
  const [reported, setReported] = useState<ReportOutcome | null>(null);
  // Un seul signalement par blocage : la vérification revient toutes les 30 min,
  // et remplir le journal d'audit de la même panne le rendrait illisible.
  const reportedFor = useRef<string | null>(null);

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

  const blockKey = state?.blocked ? `${state.blocked.code}|${state.version ?? ''}` : null;
  useEffect(() => {
    if (!blockKey || reportedFor.current === blockKey) return;
    reportedFor.current = blockKey;
    let alive = true;
    void (async () => {
      try {
        const outcome = await onReport?.(state as UpdateState);
        if (alive) setReported(outcome ?? { sent: false, detail: '' });
      } catch {
        // Un envoi raté doit se voir : sans ça, l'écran afficherait « pas encore
        // signalé » pour toujours, sans dire pourquoi.
        if (alive) setReported({ sent: false, detail: '' });
      }
    })();
    return () => { alive = false; };
  }, [blockKey, onReport, state]);

  const openJournal = () => { void desktopUpdates()?.openJournal?.().catch(() => {}); };

  const ready = state?.status === 'downloaded';
  const downloading = state?.status === 'downloading';
  const available = state?.status === 'available';
  const failed = state?.status === 'error';
  const forced = state?.forced === true;
  const blocked = state?.blocked ?? null;
  // La porte : ouverte dès qu'une mise à jour obligatoire est connue — annoncée,
  // en cours, prête, ou même en échec (pour que l'échec soit VISIBLE, au lieu
  // d'un poste qui se croit à jour parce que la porte a échoué en silence).
  //
  // Et ouverte aussi sur un BLOCAGE constaté sans obligation en cours : une
  // installation tentée qui n'a pas abouti est exactement ce qu'un poste doit
  // dire, et ce serait la masquer que de n'afficher que l'obligation.
  const gate = (forced || !!blocked) && !bypassed && (ready || downloading || available || failed || !!blocked);

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
    // Le remède n'est pas le même selon la cause : une installation qui n'a pas
    // abouti se remède en revérifiant (la version est peut-être déjà là), un
    // téléchargement échoué aussi, tandis qu'une porte satisfaisable s'applique.
    const needsCheck = failed || blocked?.code === 'install';
    const secondary = canApply ? install : needsCheck ? retry : install;
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
            <span>{forced ? labels.forcedTitle : labels.blockedTitle}</span>
          </div>
          <p className="text-sm font-semibold leading-snug">
            {forced ? forcedReason(state, labels) : labels.blockedDetail.replace('{detail}', blocked?.detail ?? '')}
          </p>
          {forced && <p className="text-[11px] text-slate-300 leading-snug">{labels.forcedNote}</p>}
          {failed && (
            <p className="text-[11px] text-amber-200 leading-snug">
              {labels.forcedFailed.replace('{detail}', state.detail ?? '')}
            </p>
          )}
          {blocked && (
            <div className="space-y-1" data-update-block={blocked.code}>
              {forced && (
                <p className="text-[11px] text-amber-200 leading-snug">
                  {labels.blockedDetail.replace('{detail}', blocked.detail)}
                </p>
              )}
              <p
                className="text-[11px] text-slate-300 leading-snug"
                data-update-report={reported ? (reported.sent ? 'sent' : 'local') : 'pending'}
              >
                {!reported
                  ? labels.blockedReportPending
                  : reported.sent
                    ? labels.blockedReportSent
                    : labels.blockedReportLocal.replace('{path}', blocked.journal ?? '')}
              </p>
            </div>
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
                onClick={secondary}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold uppercase tracking-wider text-[10px] disabled:opacity-50"
              >
                {needsCheck ? labels.forcedRetry : labels.download}
              </button>
            )}
            {blocked && (
              <button
                type="button"
                onClick={openJournal}
                className="px-2 py-1.5 text-slate-300 hover:text-white text-[10px] underline"
              >
                {labels.blockedJournal}
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
  /** Le blocage constaté, et son signalement à l'administrateur. */
  blockedTitle: string;
  blockedDetail: string;
  blockedReportPending: string;
  blockedReportSent: string;
  blockedReportLocal: string;
  blockedJournal: string;
}
