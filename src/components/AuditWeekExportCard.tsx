/**
 * ─── Réglages → Sauvegarde : l'archive hebdomadaire du journal d'audit ──────
 *
 * Extrait de SettingsView.tsx pour une raison mesurable : ce fichier est au
 * budget de lignes (`scripts/check-line-budget.mjs`, 700), et une carte de plus
 * écrite en son sein l'aurait fait dépasser. La carte est donc autonome — elle
 * lit son contexte elle-même — et l'écran ne gagne qu'une ligne.
 *
 * Elle vit dans les RÉGLAGES parce que c'est là que « chaque fin de semaine »
 * se range : une tâche d'archive, à côté de l'export complet des données, pas au
 * milieu d'un écran de consultation. L'onglet Réglages est déjà réservé aux rôles
 * admin et dev (`auth.isAdmin`, qui couvre les deux — voir `deleteRights.ts`),
 * donc la carte hérite de ce droit au lieu d'en inventer un second.
 *
 * Deux choix qui font la différence entre un bouton et une archive :
 *   • les entrées viennent d'une requête BORNÉE par la semaine
 *     (`fetchAuditJournalRange`), pas des cent dernières entrées chargées pour
 *     l'écran : une semaine chargée serait autrement tronquée en silence ;
 *   • ce qui est annoncé avant le clic est ce qui sera écrit : le compte affiché
 *     est celui des entrées réellement chargées pour la semaine choisie.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, ShieldCheck } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { auditWeekOf, auditWeekFilename, recentAuditWeeks } from '../lib/auditWeek';
import { generateAuditJournalPdf } from '../lib/pdfAuditJournal';
import { recordWeekArchive } from '../lib/auditArchive';
import type { AuditLogEntry } from '../lib/auditLogger';
import type { AuditWeek } from '../lib/auditWeek';

/** Combien de semaines on peut rattraper : deux mois d'archives en arrière. */
const OFFERED_WEEKS = 8;

export function AuditWeekExportCard() {
  const { t, lang, currentTheme, fetchAuditJournalRange, auth } = useMainViews();
  // La liste est figée au montage : les clés de semaine ne bougent pas sous les
  // pieds de la sélection pendant que l'administrateur choisit sa fenêtre.
  const weeks = useMemo(() => recentAuditWeeks(new Date(), OFFERED_WEEKS), []);
  const [selectedKey, setSelectedKey] = useState(() => weeks[0]!.key);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);

  const selected: AuditWeek = weeks.find((week) => week.key === selectedKey) ?? weeks[0]!;

  const load = useCallback(
    async (week: AuditWeek) => {
      setLoading(true);
      setError(false);
      try {
        setEntries(await fetchAuditJournalRange(week.startIso, week.endIso));
      } catch {
        setEntries([]);
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchAuditJournalRange],
  );

  // Une requête par semaine choisie — et au montage, pour que le compte affiché
  // soit le vrai avant le premier clic.
  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  const onDownload = async () => {
    setGenerating(true);
    setError(false);
    try {
      await generateAuditJournalPdf({ entries, week: selected, lang });
    } catch {
      setError(true);
      return;
    } finally {
      setGenerating(false);
    }
    // L'archive s'inscrit ELLE-MÊME dans le journal : c'est la seule preuve
    // partagée qu'une semaine est classée, et le rappel de la cloche la lit (voir
    // src/lib/auditArchive.ts). Écrite APRÈS la génération — un PDF qui a échoué
    // ne doit pas éteindre le rappel — et sans bloquer : hors ligne, l'entrée
    // part en file comme n'importe quel autre geste.
    void recordWeekArchive(
      selected,
      auditWeekFilename(selected),
      auth?.profile
        ? { id: auth.profile.id, email: auth.profile.email, full_name: auth.profile.fullName, role: auth.profile.role }
        : null,
    );
  };

  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const shortDay = (date: Date) => date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const weekLabel = (week: AuditWeek) => `${t.auditWeeklyJournalWeek} ${week.isoWeek} · ${shortDay(week.start)} – ${shortDay(week.end)}`;

  const countText = loading
    ? t.syncing
    : entries.length === 0
    ? t.auditWeeklyJournalEmpty
    : t.auditWeeklyJournalCount.replace('{count}', String(entries.length));

  return (
    <div className={`p-8 ${currentTheme.isDark ? 'bg-emerald-900/10' : 'bg-slate-50'} rounded-[2.5rem] border ${currentTheme.border} flex flex-col gap-5`}>
      <div className="flex items-center gap-4">
        <div className={`p-4 ${currentTheme.card} rounded-3xl text-emerald-600 shadow-lg`}>
          <ShieldCheck size={32} />
        </div>
        <div>
          <p className={`text-lg font-black ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}>
            {t.auditWeeklyJournalTitle}
          </p>
          <p className={`text-xs ${currentTheme.muted}`}>{t.auditWeeklyJournalSubtitle}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative">
          <select
            aria-label={t.auditWeeklyJournalWeek}
            value={selectedKey}
            onChange={(event) => setSelectedKey(event.target.value)}
            className={`appearance-none cursor-pointer pl-4 pr-10 py-2.5 ${currentTheme.card} border ${currentTheme.border} rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-xs font-bold ${currentTheme.isDark ? 'text-emerald-500' : 'text-slate-800'}`}
          >
            {weeks.map((week) => (
              <option key={week.key} value={week.key}>
                {weekLabel(week)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${currentTheme.muted}`} />
        </div>

        <button
          onClick={() => void onDownload()}
          disabled={entries.length === 0 || loading || generating}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 active:scale-95"
        >
          <Download size={16} />
          {t.auditWeeklyJournalDownload}
        </button>

        <button
          onClick={() => void load(selected)}
          title={t.refreshLogs}
          className={`p-2.5 rounded-xl border ${currentTheme.border} ${currentTheme.card} ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-600'} transition-all text-xs font-bold`}
        >
          <span>↻</span>
        </button>
      </div>

      <p className={`text-[11px] font-bold ${currentTheme.muted}`}>{countText}</p>
      {error && (
        <p className="text-[11px] font-black text-rose-500">{t.auditWeeklyJournalFailed}</p>
      )}
    </div>
  );
}
