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
 */
import { useMemo, useState } from 'react';
import { CreditCard, Search, X } from 'lucide-react';
import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { ModalShell } from './ModalShell';
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
  const { t, currentTheme, students, paymentStudentId, setPaymentStudentId, paymentAmount, setPaymentAmount, paymentDate, setPaymentDate, formatCurrency, availableClasses, getGradeDisplay, lang, handlePaymentSubmit, overlayRef, onClose } = props;

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

              <form onSubmit={handlePaymentSubmit} className="p-10 space-y-8">
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
                    {visibleStudents.map(s => (
                      <option key={s.id} value={s.id} className={currentTheme.isDark ? 'bg-[#121212]' : 'bg-white'}>{s.name} ({formatCurrency(s.totalDue * (1 - (s.scholarshipDiscount || 0) / 100) - s.amountPaid)} {t.balance})</option>
                    ))}
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

                <button 
                  type="submit"
                  className={`w-full ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} py-5 rounded-2xl font-black text-sm transition-all shadow-xl ${currentTheme.accentShadow} active:scale-[0.98]`}
                >
                  {t.submit}
                </button>
              </form>
    </ModalShell>
  );
}
