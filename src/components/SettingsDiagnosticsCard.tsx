/**
 * « État du poste » — la seule section des Réglages qui parle de CE poste, et
 * non de l'école.
 *
 * Elle existe parce qu'une panne chez l'école n'existait nulle part : une
 * exception laissait une console que personne n'ouvre, la file hors ligne
 * pouvait refuser des gestes sans que le bureau sache lesquels, et le lendemain
 * le support n'avait qu'une phrase — « ça a planté ». La carte montre donc les
 * incidents RETENUS localement (jamais envoyés : aucune donnée d'élève ne sort
 * d'ici, voir src/lib/incidentJournal.ts), l'état de la file, et un bouton pour
 * copier le rapport tel quel dans un courriel.
 *
 * Elle ne lit rien en base : c'est un fait du POSTE. Un incident d'une autre
 * station n'a pas à apparaître ici, et un rapport qui mélangerait deux postes
 * serait plus difficile à réparer qu'à lire.
 */
import { useEffect, useState } from 'react';
import { Activity, ClipboardCopy, Trash2 } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { clearIncidents, formatIncidentReport, readIncidents } from '../lib/incidentJournal';
import type { StationIncidentEntry } from '../lib/incidentJournal';
import { getOfflineQueueCount, getOfflineQueueFailureDetails } from '../lib/offlineQueue';

/**
 * Le pont du poste, réduit à ce que cet écran lit.
 *
 * `window.desktop` n'existe que dans l'application de bureau : sur le site, la
 * carte montre le journal de la page et s'arrête là — aucune requête, aucune
 * erreur de console pour un canal absent.
 */
interface StationIncidentsBridge {
  list?: () => Promise<{ entries?: StationIncidentEntry[] } | null>;
}

function stationIncidentsBridge(): StationIncidentsBridge | null {
  const desktop = (globalThis as { desktop?: { incidents?: StationIncidentsBridge } }).desktop;
  return desktop?.incidents ?? null;
}

export function SettingsDiagnosticsCard() {
  const { t, currentTheme } = useMainViews();
  const [incidents, setIncidents] = useState(() => readIncidents());
  // Les pannes du processus principal vivent dans un fichier du poste, pas dans
  // le stockage de la page : elles arrivent après le rendu, et leur absence
  // (site web, canal indisponible) n'est pas une erreur.
  const [station, setStation] = useState<StationIncidentEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const bridge = stationIncidentsBridge();
    if (!bridge?.list) return;
    let alive = true;
    void bridge
      .list()
      .then((result) => {
        if (!alive) return;
        setStation(Array.isArray(result?.entries) ? result.entries : []);
      })
      .catch(() => {
        /* un canal qui ne répond pas ne doit pas casser l'écran des Réglages */
      });
    return () => {
      alive = false;
    };
  }, []);
  // La file est relue au montage : un geste refusé est un incident de plus que
  // le rapport doit nommer, et il vit dans un autre magasin que le journal.
  const pending = getOfflineQueueCount();
  const refused = getOfflineQueueFailureDetails();

  const copyReport = async (): Promise<void> => {
    const report = formatIncidentReport(incidents, {}, station);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // Un poste sans presse-papiers (ou sans permission) ne doit pas laisser
      // croire que le rapport est parti : on ne dit rien de faux, et le bouton
      // reste actionnable.
      setCopied(false);
    }
  };

  const wipe = (): void => {
    clearIncidents();
    setIncidents([]);
    setCopied(false);
  };

  return (
    <div data-slot="settings-diagnostics" className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
      <h4 className={`text-sm font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.stationHealth}</h4>
      <div className={`p-6 ${currentTheme.surfaceInset} rounded-3xl border ${currentTheme.border} space-y-4`}>
        <div className="flex items-start gap-4">
          <div className={`p-3 ${currentTheme.card} rounded-2xl text-slate-600`}>
            <Activity size={24} />
          </div>
          <div className="space-y-1">
            <p className={`text-xs font-semibold ${currentTheme.muted}`}>{t.stationHealthHint}</p>
            <p className={`text-sm font-black ${currentTheme.inkStrong}`}>
              {incidents.length} {t.incidentsRetained}
            </p>
            <p className={`text-xs ${currentTheme.muted}`}>
              {t.offlineQueuePending} : {pending} · {t.offlineQueueRefused} : {refused.length}
            </p>
            {station.length > 0 && (
              <p className={`text-xs ${currentTheme.muted}`}>
                {t.stationHealthProcessCrashes} : {station.length}
              </p>
            )}
          </div>
        </div>

        {incidents.length === 0 ? (
          <p className={`text-xs ${currentTheme.muted}`}>{t.noIncidentRecorded}</p>
        ) : (
          <ul className="space-y-1">
            {incidents.slice(0, 3).map((incident) => (
              <li key={`${incident.at}-${incident.kind}-${incident.message.slice(0, 12)}`} className={`text-2xs font-mono ${currentTheme.muted} truncate`}>
                {incident.at} · {incident.kind} · {incident.message}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { void copyReport(); }}
            className={`bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white px-5 py-3 rounded-2xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-slate-800/20 active:scale-[0.98]`}
          >
            <ClipboardCopy size={16} />
            {copied ? t.incidentReportCopied : t.copyIncidentReport}
          </button>
          <button
            onClick={wipe}
            className={`${currentTheme.surfaceInset} ${currentTheme.hoverSurfaceStrong} px-5 py-3 rounded-2xl font-black text-xs transition-all flex items-center gap-2 border ${currentTheme.border}`}
          >
            <Trash2 size={16} />
            {t.clearIncidents}
          </button>
        </div>
      </div>
    </div>
  );
}
