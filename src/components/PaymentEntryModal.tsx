/**
 * PaymentEntryModal — Payment entry form — extracted verbatim from AppModals. Cashier picks
 * the student (live outstanding balance) + amount + date and submits;
 * pure presentational, narrow props + overlayRef.
 *
 * Le SÉLECTEUR DE CLASSE réduit la liste avant la liste déroulante : dans un
 * établissement de plusieurs centaines d'élèves, choisir un nom dans une liste
 * plate demandait de la parcourir en entier. Une RECHERCHE par nom ou matricule
 * s'y combine (intersection) : on peut taper « Awa » ou un matricule dans une
 * classe déjà filtrée. Ces deux filtres sont LOCAUX (état du formulaire) : ils
 * ne changent pas la classe d'un élève ni aucun autre écran, ils ne font que
 * restreindre ce que la liste propose.
 *
 * Chaque ligne de la liste déroulante PORTE le matricule (« Awa — MATRICULE :
 * MT-2026-42 ») : une recherche réussie se vérifie des yeux, au lieu d'un nom
 * seul qui laisse le caissier deviner si c'est bien l'élève du reçu.
 *
 * Les MOIS PAYÉS (voir src/lib/paymentMonths.ts) sont des PASTILLES, une par
 * mois de l'année scolaire, et pas une liste déroulante multiple : douze mois
 * tiennent à l'écran, et un clic dit exactement ce qu'il coche. Le mois de la
 * date est coché d'avance, donc un encaissement ordinaire reste UN geste ; la
 * ligne sous les pastilles montre le texte EXACT que le reçu imprimera, pour
 * qu'une plage ou une liste se vérifie avant l'impression, pas après.
 *
 * L'état du choix vit dans le DOMAINE (`usePayments`), pas ici : c'est lui qui
 * enregistre le paiement et remet le mois par défaut sur la date. Cette modale
 * n'en est que l'affichage.
 */
import { useMemo, useState } from 'react';
import { CreditCard, Search, X } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';
import { studentMatricule } from '../lib/studentIdentifiers';
import { formatPaidMonths, paymentMonthLabel } from '../lib/paymentMonths';
import { ALL_CLASSES, filterStudents, matchesClass, matchesSearch } from '../lib/paymentStudentFilter';

export interface PaymentEntryModalProps {
  t: TranslationDict;
  currentTheme: CurrentTheme;
  students: Student[];
  paymentStudentId: string;
  setPaymentStudentId: Dispatch<SetStateAction<string>>;
  paymentAmount: string;
  setPaymentAmount: Dispatch<SetStateAction<string>>;
  paymentDate: string;
  setPaymentDate: Dispatch<SetStateAction<string>>;
  /** Les mois proposés — ceux de l'année scolaire de la date — en `YYYY-MM`. */
  paymentMonthOptions: string[];
  /** Les mois cochés : le mois de la date tant que le caissier n'a rien touché. */
  paymentMonths: string[];
  /** Coche/décoche un mois. L'état vit dans le domaine, jamais dans la modale. */
  togglePaymentMonth: (month: string) => void;
  formatCurrency: (amount: number) => string;
  /** Les classes proposées au filtre (paires id/libellé, comme les classes actives). */
  availableClasses: { id: string; nameEn: string; nameFr: string }[];
  /** Rend le libellé d'une classe stockée sur l'élève (`1A` → « 1ère Année A »). */
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  lang: 'en' | 'fr';
  handlePaymentSubmit: (e: FormEvent) => Promise<void>;
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

export function PaymentEntryModal(props: PaymentEntryModalProps) {
  const { t, currentTheme, students, paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount, paymentDate, setPaymentDate, paymentMonthOptions, paymentMonths, togglePaymentMonth, formatCurrency, availableClasses, getGradeDisplay, lang, handlePaymentSubmit, overlayRef, onClose } = props;

  // Le texte EXACT de la ligne « Mois » du reçu — le même module, les mêmes
  // mots : ce qui se lit ici est ce qui s'imprime.
  const monthsReceiptLine = formatPaidMonths(paymentMonths, {
    label: (ym) => paymentMonthLabel(ym, t),
    count: (n) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  });

  // Au moins un mois est exigé dès lors que la liste est proposée (elle ne l'est
  // que si l'année scolaire de la date se lit) : le bouton reste alors fermé.
  const missingMonth = paymentMonthOptions.length > 0 && paymentMonths.length === 0;

  // Le filtre repart de « toutes les classes » à chaque montage du formulaire.
  const [classFilter, setClassFilter] = useState<string>(ALL_CLASSES);

  // La recherche repart vide à chaque montage, comme le filtre de classe.
  const [search, setSearch] = useState('');

  // Les classes réellement présentes dans la liste des élèves, dans l'ordre des
  // classes actives (celles qu'un élève peut porter), plus toute classe stockée
  // qui n'y figure plus — sinon un élève d'une classe retirée deviendrait
  // introuvable par le filtre.
  const classOptions = useMemo(() => {
    const present = new Set(students.map((s) => (s.grade ?? '').trim().toLowerCase()).filter(Boolean));
    const known = availableClasses
      .filter((c) => present.has(c.id.trim().toLowerCase()))
      .map((c) => ({ id: c.id, label: lang === 'en' ? c.nameEn : c.nameFr }));
    const knownIds = new Set(known.map((k) => k.id.trim().toLowerCase()));
    const extra = [...present]
      .filter((id) => !knownIds.has(id))
      .sort((a, b) => a.localeCompare(b, lang === 'en' ? 'en' : 'fr', { sensitivity: 'base' }))
      .map((id) => ({ id, label: getGradeDisplay(id, lang) }));
    return [...known, ...extra];
  }, [students, availableClasses, getGradeDisplay, lang]);

  // La classe ET la recherche se combinent (ET logique) : la liste proposée est
  // leur intersection.
  const visibleStudents = useMemo(
    () => filterStudents(students, classFilter, search),
    [students, classFilter, search],
  );

  // Après un changement de filtre (classe ou recherche), efface la sélection si
  // l'élève choisi n'est plus proposé : aucun paiement ne doit être envoyé à un
  // élève absent de la liste affichée.
  const keepSelectionOnlyIfVisible = (nextClass: string, nextSearch: string) => {
    const selected = students.find((s) => s.id === paymentStudentId);
    if (selected && !(matchesClass(selected.grade, nextClass) && matchesSearch(selected, nextSearch))) {
      setPaymentStudentId('');
    }
  };

  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-payment-entry"
      ariaLabel={t.paymentEntry}
      maxWidth="max-w-md"
      icon={<CreditCard size={24} className="text-blue-400" />}
      title={t.paymentEntry}
    >

              {/* La fenêtre est le SEUL corps de modale sans défilement, et elle
                  est la plus longue (recherche, filtre de classe, élève, deux
                  champs, les douze pastilles de mois, l'indice, la ligne du reçu,
                  le bouton). Le panneau de `ModalShell` est `overflow-hidden` :
                  ce qui dépasse la hauteur de l'écran n'est pas coupé « un peu »,
                  il devient INATTEIGNABLE — mesuré sur un écran de portable, le
                  bouton de validation tombait sous le bord bas, sans barre de
                  défilement pour l'atteindre, donc AUCUN paiement ne pouvait être
                  enregistré. Les formulaires voisins (élève, personnel) portent
                  déjà leur propre hauteur maximale et leur défilement ; ce
                  formulaire-ci les reprend, mêmes classes. */}
              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-2">
                  <label htmlFor="payment-student-search" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.searchNameOrId}</label>
                  <div className="relative">
                    <Search size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${currentTheme.muted}`} />
                    <input
                      id="payment-student-search"
                      data-slot="payment-student-search"
                      type="text"
                      value={search}
                      onChange={(e) => {
                        const nextSearch = e.target.value;
                        setSearch(nextSearch);
                        keepSelectionOnlyIfVisible(classFilter, nextSearch);
                      }}
                      placeholder={t.searchStudents}
                      className={`w-full pl-11 pr-11 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        title={t.clearSearch}
                        aria-label={t.clearSearch}
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full ${currentTheme.muted} hover:bg-slate-200/60 dark:hover:bg-white/10 transition-all`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="payment-class-filter" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.filterByClass}</label>
                  <select
                    id="payment-class-filter"
                    data-slot="payment-class-filter"
                    value={classFilter}
                    onChange={(e) => {
                      const nextClass = e.target.value;
                      setClassFilter(nextClass);
                      keepSelectionOnlyIfVisible(nextClass, search);
                    }}
                    className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  >
                    <option value={ALL_CLASSES} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.allClasses}</option>
                    {classOptions.map((c) => (
                      <option key={c.id} value={c.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="payment-student" className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.selectStudent}</label>
                  <select
                    id="payment-student"
                    required
                    value={paymentStudentId}
                    onChange={(e) => setPaymentStudentId(e.target.value)}
                    className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                  >
                    <option value="" className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{t.selectStudent}...</option>
                    {visibleStudents.map(s => {
                      const matricule = studentMatricule(s.studentId);
                      const balance = s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid;
                      return (
                        <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name}{matricule ? ` — ${t.studentId}: ${matricule}` : ''} ({formatCurrency(balance)} {t.balance})</option>
                      );
                    })}
                  </select>
                  {visibleStudents.length === 0 && (
                    <p className={`text-2xs font-semibold ${currentTheme.muted}`}>
                      {students.length === 0
                        ? t.noStudentsInSystem
                        : search.trim()
                          ? t.noStudentsFound.replace('{query}', search.trim())
                          : t.noStudentsInClass}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.amount} ({t.currency})</label>
                    <div className="relative">
                      <input 
                        required
                        type="number" 
                        min="0"
                        step="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                        placeholder="10 000"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={`text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paymentDate}</label>
                    <input 
                      required
                      type="date" 
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className={`w-full px-6 py-4 ${currentTheme.surfaceInset} border ${currentTheme.border} rounded-2xl focus:outline-none ${currentTheme.accentRing} transition-all text-sm font-semibold ${currentTheme.inkStrong}`}
                    />
                  </div>
                </div>

                {paymentMonthOptions.length > 0 && (
                  <div className="space-y-3" data-slot="payment-months">
                    <span className={`block text-2xs font-black ${currentTheme.muted} uppercase tracking-widest`}>{t.paidMonths}</span>
                    <div role="group" aria-label={t.paidMonths} className="flex flex-wrap gap-2">
                      {paymentMonthOptions.map((month) => {
                        const checked = paymentMonths.includes(month);
                        return (
                          <button
                            key={month}
                            type="button"
                            data-month={month}
                            aria-pressed={checked}
                            onClick={() => togglePaymentMonth(month)}
                            className={`px-4 py-2 rounded-xl border text-xs font-black transition-all ${
                              checked
                                ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentBorder} ${currentTheme.accentShadow}`
                                : `${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.inkStrong} ${currentTheme.rowHover}`
                            }`}
                          >
                            {paymentMonthLabel(month, t)}
                          </button>
                        );
                      })}
                    </div>
                    <p className={`text-2xs font-semibold ${currentTheme.muted}`}>{t.paidMonthsHint}</p>
                    <p className={`text-xs font-black ${missingMonth ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {missingMonth ? t.paidMonthsRequired : monthsReceiptLine}
                    </p>
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={missingMonth}
                  className={`w-full ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} py-5 rounded-2xl font-black text-sm transition-all shadow-xl ${currentTheme.accentShadow} active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}
