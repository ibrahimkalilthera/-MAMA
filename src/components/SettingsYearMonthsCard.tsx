/**
 * ─── Les MOIS de l'année scolaire, réglés par l'école ────────────────────────
 *
 * Section des Paramètres — même découpe et même contrat que `SettingsSchoolCard`
 * (données et action par le contexte, droit relu sur `isAdminRole`).
 *
 * POURQUOI CE RÉGLAGE EXISTE. L'application réclamait à chaque famille les frais
 * de DOUZE mois, septembre → août, pour toutes les écoles. Ce n'est pas la forme
 * d'une année malienne : elle va le plus souvent de septembre à juin, parfois
 * d'octobre à juin quand la rentrée glisse, parfois jusqu'en juillet quand les
 * compositions se terminent tard. Les deux mois de trop ne sont pas un détail
 * d'affichage : le reçu les nommait, la fiche les comptait encore dus, et
 * l'état de rapprochement remis à la famille réclamait des frais que l'école
 * n'avait jamais fixés.
 *
 * CE QUE LA SECTION N'INVENTE PAS. La plage lue est celle de la base
 * (`academic_years.start_month`/`end_month`, que `yearMonths` résout) : l'écran
 * n'a pas de valeur par défaut à lui. Tant que personne n'a touché au réglage,
 * le brouillon affiche donc la plage réellement en vigueur — y compris une
 * année qui va jusqu'en août (`end_month = 8`), qu'un défaut codé en dur dans
 * l'écran aurait écrasée au premier enregistrement d'un autre champ.
 *
 * UN ENREGISTREMENT A TROIS ISSUES, et l'écran les dit : « enregistré »,
 * « mis en file hors ligne » et « refusé » ne veulent pas dire la même chose
 * pour l'école. Le bouton, lui, ne s'offre que pour une plage DIFFÉRENTE de
 * celle en vigueur : réécrire la même paire ne fait rien, et le geste doit se
 * lire comme un changement.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { isAdminRole } from '../lib/deleteRights';
import {
  DEFAULT_SCHOOL_MONTHS,
  MONTH_KEYS,
  academicYearMonths,
  paymentMonthLabel,
} from '../lib/paymentMonths';

/** Le numéro de mois (1..12) porté par un `YYYY-MM` — jamais un `NaN` publié. */
function monthOf(ym: string, fallback: number): number {
  const m = Number(ym.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : fallback;
}

export function SettingsYearMonthsCard() {
  const { t, currentTheme, auth, selectedYear, yearMonths, saveYearMonths } = useMainViews();
  // La même liste que `public.is_admin()` — l'écriture d'`academic_years` est
  // réservée par la policy, donc l'écran ne propose pas un geste que la base
  // refuserait.
  const canWrite = isAdminRole(auth?.profile?.role);

  // La plage EN VIGUEUR vient des lignes de la base (via `yearMonths`) : c'est
  // aussi celle que les reçus réclament en ce moment.
  const monthsInForce = useMemo(() => yearMonths(selectedYear), [yearMonths, selectedYear]);
  const savedStart = monthsInForce.length
    ? monthOf(monthsInForce[0], DEFAULT_SCHOOL_MONTHS.startMonth)
    : DEFAULT_SCHOOL_MONTHS.startMonth;
  const savedEnd = monthsInForce.length
    ? monthOf(monthsInForce[monthsInForce.length - 1], DEFAULT_SCHOOL_MONTHS.endMonth)
    : DEFAULT_SCHOOL_MONTHS.endMonth;

  const [start, setStart] = useState(savedStart);
  const [end, setEnd] = useState(savedEnd);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'saved' | 'queued' | 'refused' | null>(null);

  useEffect(() => {
    // La plage arrive de la base, donc après le premier rendu (c'est la session
    // qui lit). Le brouillon la suit — mais jamais après une saisie en cours.
    if (!touched) {
      setStart(savedStart);
      setEnd(savedEnd);
    }
  }, [savedStart, savedEnd, touched]);

  // L'APERÇU est le calcul de l'application lui-même (`academicYearMonths`), pas
  // un comptage d'écran : ce que le bloc montre est exactement ce que les reçus
  // dérouleront.
  const draftMonths = academicYearMonths(selectedYear, { startMonth: start, endMonth: end });
  const preview = draftMonths
    .map((ym) => `${paymentMonthLabel(ym, t)} ${ym.slice(0, 4)}`)
    .join(' · ');
  const changed = start !== savedStart || end !== savedEnd;

  const save = async () => {
    if (!canWrite || !changed || saving) return;
    setSaving(true);
    const result = await saveYearMonths(start, end);
    setSaving(false);
    setStatus(result);
    if (result !== 'refused') setTouched(false);
  };

  const statusText =
    status === 'saved'
      ? t.schoolMonthsSaved
      : status === 'queued'
        ? t.schoolMonthsQueued
        : status === 'refused'
          ? t.schoolMonthsRefused
          : null;

  return (
    <div data-slot="settings-year-months" className={`space-y-4 pt-8 border-t ${currentTheme.border}`}>
      <div>
        <h4 className={`text-base font-black ${currentTheme.inkStrong} flex items-center gap-2`}>
          <CalendarRange size={20} className="text-blue-500" />
          {t.schoolMonthsTitle}
        </h4>
        <p className={`text-xs ${currentTheme.muted} mt-0.5`}>{t.schoolMonthsHint}</p>
      </div>

      {canWrite ? (
        <div className={`p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.surfaceInset} space-y-4`}>
          <p className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>
            {t.academicYear}: {selectedYear || '—'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className={`block text-2xs font-bold ${currentTheme.muted}`}>{t.schoolMonthsStart}</span>
              <select
                data-year-months-start
                value={start}
                onChange={(event) => {
                  setTouched(true);
                  setStatus(null);
                  setStart(Number(event.target.value));
                }}
                className={`w-full p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
              >
                {MONTH_KEYS.map((key, index) => (
                  <option key={key} value={index + 1} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>
                    {t[key]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className={`block text-2xs font-bold ${currentTheme.muted}`}>{t.schoolMonthsEnd}</span>
              <select
                data-year-months-end
                value={end}
                onChange={(event) => {
                  setTouched(true);
                  setStatus(null);
                  setEnd(Number(event.target.value));
                }}
                className={`w-full p-3.5 text-xs font-bold rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-800'}`}
              >
                {MONTH_KEYS.map((key, index) => (
                  <option key={key} value={index + 1} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>
                    {t[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* L'aperçu : les mois que les reçus nommeront, dans l'ordre de l'année.
              Sur une année absente (aucune année de travail lue), il n'y a rien à
              montrer : le bloc le DIT au lieu d'afficher douze mois supposés. */}
          {draftMonths.length > 0 ? (
            <p data-year-months-preview className={`text-xs font-bold ${currentTheme.inkStrong}`}>
              {t.schoolMonthsPreview.replace('{months}', preview)}
            </p>
          ) : (
            <p data-year-months-preview="empty" className={`text-xs font-bold ${currentTheme.muted}`}>
              {t.schoolMonthsNoYear}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!changed || saving}
              className={`px-4 py-2.5 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50`}
            >
              {t.schoolMonthsSave}
            </button>
          </div>

          {statusText && (
            <p
              data-year-months-status={status}
              className={`text-xs font-bold ${
                status === 'saved'
                  ? 'text-slate-800 dark:text-emerald-400'
                  : status === 'refused'
                    ? 'text-rose-500'
                    : currentTheme.muted
              }`}
            >
              {statusText}
            </p>
          )}
        </div>
      ) : (
        <p className={`text-xs font-bold ${currentTheme.muted}`}>{t.schoolMonthsAdminOnly}</p>
      )}
    </div>
  );
}
