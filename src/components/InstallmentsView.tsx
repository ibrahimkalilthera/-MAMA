/**
 * InstallmentsView — l'écran du RESTE DÛ, élève par élève et mois par mois.
 *
 * ─── Pourquoi cet écran ─────────────────────────────────────────────────────
 * Un versement partiel se décide au guichet, famille par famille : le caissier
 * voit le reste dû des mois qu'il vient de cocher (`installmentTarget`), et le
 * reçu dit ce qui reste. Ce qui manquait, c'est la vue de l'ÉCOLE : quelles
 * familles ont commencé à payer sans solder, sur quels mois, et pour combien.
 * Sans elle, la relance se fait de mémoire, et une famille qui repasse devant
 * l'école n'est relancée que si quelqu'un se souvient d'elle.
 *
 * ─── Ce qu'il ne fait pas ───────────────────────────────────────────────────
 *   • **Aucun calcul à lui.** L'agrégat vit dans
 *     `src/lib/outstandingInstallments.ts`, qui interroge la SEULE règle du
 *     guichet (`installmentTarget`, `src/lib/paymentInstallments.ts`) : les frais
 *     des mois entamés, moins les versements partiels déjà reçus dessus. Un mois
 *     soldé disparaît de la liste — c'est le travail qui reste, pas l'historique ;
 *   • **Aucune écriture.** La ligne ne promet pas d'encaisser : elle OUVRE la
 *     fiche de l'élève (`setSelectedStudent`), où le guichet saisit le complément
 *     avec les mêmes boutons qu'hier. Un écran de relance qui écrirait un
 *     paiement sans que la famille soit là serait un reçu pour de l'argent absent ;
 *   • **Aucun droit nouveau.** Il ne lit que les élèves que l'application tient
 *     déjà (`students`, `payments`), les mêmes lignes que la fiche élève — donc
 *     il n'ouvre aucun accès en base, et tout compte connecté peut voir qui doit
 *     quoi. Ce qui reste fermé, c'est l'ÉCRITURE, décidée ailleurs.
 *
 * ─── Les marqueurs ─────────────────────────────────────────────────────────
 * `data-slot="installments"` (la racine), `installments-empty`,
 * `installments-total` (la pastille de synthèse), `installments-row` (un élève,
 * avec `data-student`), `installments-month` (un mois de cet élève, avec
 * `data-month`), `installments-undeclared` (la phrase des versements sans mois).
 * Une phrase traduite change, un marqueur non : les tests lisent ceux-ci.
 */
import { useMemo, useState } from 'react';
import { HandCoins, Search, Wallet } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';
import { paymentMonthLabel } from '../lib/paymentMonths';
import { filterOutstanding, outstandingInstallments } from '../lib/outstandingInstallments';

export function InstallmentsView() {
  const {
    t, currentTheme, students, formatCurrency, formatDate, getGradeDisplay, setSelectedStudent,
  } = useMainViews();
  const [search, setSearch] = useState('');

  // Le rapport complet, calculé une fois par jeu d'élèves ; la recherche ne fait
  // que le RESTREINDRE (même règle, mêmes totaux), elle ne le recalcule pas.
  const report = useMemo(() => outstandingInstallments(students), [students]);
  const shown = useMemo(() => filterOutstanding(report, search), [report, search]);

  const summary = t.installmentsTotal
    .replace('{students}', String(shown.students.length))
    .replace('{amount}', formatCurrency(shown.total));

  return (
    <div data-slot="installments" className="space-y-4">
      <div className={`${currentTheme.card} p-6 rounded-2xl border ${currentTheme.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className={`text-lg font-bold flex items-center gap-2 ${currentTheme.inkStrong}`}>
              <HandCoins size={20} className="flex-shrink-0" />
              {t.installmentsTitle}
            </h3>
            <p className={`text-xs font-semibold mt-1 max-w-2xl ${currentTheme.muted}`}>
              {t.installmentsHint}
            </p>
          </div>
          {shown.students.length > 0 && (
            <span
              data-slot="installments-total"
              className="text-2xs font-black uppercase tracking-widest px-2 py-1 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-900/60 whitespace-nowrap"
            >
              {summary}
            </span>
          )}
        </div>

        {report.students.length > 0 && (
          <div className="mt-4 relative">
            <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.installmentsSearch}
              aria-label={t.installmentsSearch}
              className={`w-full pl-9 pr-4 py-2 text-sm font-semibold rounded-xl border ${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.inkStrong} focus:outline-none ${currentTheme.accentRing}`}
            />
          </div>
        )}
      </div>

      {/* Les versements partiels qui ne déclarent aucun mois : ils pèsent sur la
          caisse sans pouvoir être rattachés à un mois — donc hors de tout total
          ci-dessus. Le chiffre est DIT, jamais replié dans la somme. */}
      {report.undeclared > 0 && (
        <p
          data-slot="installments-undeclared"
          className={`text-2xs font-semibold ${currentTheme.muted}`}
        >
          {t.installmentsUndeclared.replace('{count}', String(report.undeclared))}
        </p>
      )}

      {shown.students.length === 0 ? (
        <div
          data-slot="installments-empty"
          className={`${currentTheme.card} p-8 rounded-2xl border ${currentTheme.border} text-center`}
        >
          <Wallet size={28} className={`mx-auto mb-2 ${currentTheme.muted}`} />
          <p className={`text-sm font-bold ${currentTheme.inkStrong}`}>
            {report.students.length === 0 ? t.installmentsEmpty : t.installmentsNoMatch}
          </p>
          {report.students.length === 0 && (
            <p className={`text-2xs font-semibold mt-1 ${currentTheme.muted}`}>{t.installmentsEmptyHint}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.students.map((row) => {
            const student = students.find((s) => s.id === row.studentId);
            const open = () => {
              if (student) setSelectedStudent(student);
            };
            return (
              <div
                key={row.studentId}
                data-slot="installments-row"
                data-student={row.studentId}
                className={`${currentTheme.card} p-4 rounded-2xl border ${currentTheme.border} space-y-3`}
              >
                <button
                  type="button"
                  onClick={open}
                  disabled={!student}
                  title={t.viewStudentRecord}
                  className={`w-full text-left flex flex-wrap items-center justify-between gap-3 rounded-xl transition-all ${currentTheme.rowHover} disabled:cursor-default`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className={`font-bold ${currentTheme.inkStrong}`}>{row.studentName}</span>
                    <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                      {getGradeDisplay(row.grade)} · {t.installmentsMonths.replace('{count}', String(row.months.length))}
                    </span>
                  </div>
                  <span className="font-bold text-amber-800 dark:text-amber-300">
                    {t.installmentsStudentTotal.replace('{amount}', formatCurrency(row.remaining))}
                  </span>
                </button>

                <ul className="space-y-1">
                  {row.months.map((month) => (
                    <li
                      key={month.month}
                      data-slot="installments-month"
                      data-month={month.month}
                      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 rounded-xl border ${currentTheme.border} ${currentTheme.surfaceInset}`}
                    >
                      <span className={`text-xs font-black ${currentTheme.inkStrong}`}>
                        {paymentMonthLabel(month.month, t)}
                      </span>
                      <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                        {t.installmentsDue.replace('{amount}', formatCurrency(month.due))}
                        {' · '}
                        {t.installmentsPaid.replace('{amount}', formatCurrency(month.paid))}
                      </span>
                      <span className="text-xs font-black text-amber-800 dark:text-amber-300">
                        {t.installmentsRemaining.replace('{amount}', formatCurrency(month.remaining))}
                      </span>
                      {month.lastDate && (
                        <span className={`text-2xs font-semibold ${currentTheme.muted}`}>
                          {t.installmentsLast.replace('{date}', formatDate(month.lastDate))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
