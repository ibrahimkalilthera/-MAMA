import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { AlertTriangle, Calendar, ClipboardList, Copy, FileText, Printer, StickyNote, Trash2, Users, X } from 'lucide-react';
import type { Student, Payment } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import { academicYearMonths, monthsCoverage, paymentMonthLabel } from '../lib/paymentMonths';
import { PaymentLedger } from './PaymentLedger';
import { PaymentMonthsBackfill } from './PaymentMonthsBackfill';
import { studentMatricule } from '../lib/studentIdentifiers';
import { ModalShell } from './ModalShell';

/**
 * Student details fiche — extracted verbatim from AppModals.
 *
 * The view-only modal behind "view student record": profile card, the
 * general/parent/medical tab bar, the mini payment ledger with per-receipt
 * PDF download, the accounting sticky note (Notes ⇄ Calendar bridge: the date
 * picker is module-local state) and the edit / print / delete / close action
 * bar. Setters arrive as narrow callbacks (onClose/onEdit/onPrint/
 * onDeleteRequest) so this component stays presentational; the overlay root
 * ref (focus trap + escape stack) is injected as overlayRef.
 */
export interface StudentDetailsModalProps {
  student: Student;
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
  currentUser: { name?: string; role?: string; username?: string } | null;
  copyToClipboard: (text: string) => void;
  handleSaveNote: (studentId: string, note: string, noteDate?: string) => Promise<void>;
  studentDetailTab: 'general' | 'parent' | 'medical';
  setStudentDetailTab: Dispatch<SetStateAction<'general' | 'parent' | 'medical'>>;
  /**
   * L'année scolaire ACTIVE de l'application (celle que l'en-tête montre).
   * Elle sert de recours quand la fiche ne porte pas d'année : sans elle, la
   * bande des mois resterait invisible pour les élèves enregistrés sans année,
   * c'est-à-dire aujourd'hui la majorité. Jamais inventée pour autant : les deux
   * valeurs sont lues par `academicYearMonths`, qui rend une liste VIDE sur une
   * année illisible (cf. src/lib/paymentMonths.ts).
   */
  selectedYear: string;
  /** The dialog root — registered in AppModals' overlay refs for the focus trap. */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
  onEdit: () => void;
  onPrint: () => void;
  /**
   * Ouvre l'ÉTAT DE RAPPROCHEMENT de cet élève (mois réglés, mois encore dus,
   * argent dû) — le document remis ou relancé, `ReconciliationModal`.
   * Absent = pas de bouton : une fiche montée ailleurs (tests, impression)
   * n'affiche pas un geste qui ne mène nulle part (même règle que
   * `onReviewDuplicates`).
   */
  onReconcile?: () => void;
  onDeleteRequest: () => void;
  /** Le rôle peut-il supprimer ? Décidé par la base (`src/lib/deleteRights.ts`). */
  canDelete: boolean;
  /**
   * Le rôle peut-il supprimer UN PAIEMENT ? Décidé par la base
   * (`src/lib/paymentRights.ts`) : `admin`, `dev` ET `econome`. Plus large que
   * `canDelete`, qui reste réservé aux tables admin.
   */
  canDeletePayment: boolean;
  /**
   * Supprime UN paiement saisi par erreur — la seule ligne, sans emporter
   * l'élève ni ses autres reçus. La base réserve ce droit aux administrateurs
   * (policy « Admin delete payments »), donc l'appel n'est proposé que quand
   * `canDeletePayment` est vrai.
   */
  onDeletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
  /**
   * Le rôle peut-il RENSEIGNER les mois d'un reçu déjà enregistré ? Décidé par
   * la base (`src/lib/paymentRights.ts`) : la policy « Admin update payments »
   * ouvre l'UPDATE de `payments` à `admin` et `dev` (`public.is_admin()`).
   *
   * ⚠️ L'économe n'y figure PAS, alors qu'il tient la caisse et supprime un
   * paiement : la base ne lui ouvre que la suppression. Le bouton lui est donc
   * caché, comme la corbeille l'était avant la migration du 2026-10-05 — un
   * bouton que la base refuse est un échec annoncé, pas empêché.
   */
  canEditPaymentMonths: boolean;
  /**
   * Renseigne les mois qu'un reçu ANTÉRIEUR à la colonne `payments.months`
   * couvrait réellement. Sa couverture était INCONNUE : ses réimpressions ne
   * nommaient que le mois de sa date, et la fiche le comptait parmi les
   * paiements « sans mois déclaré ». N'écrit QUE `months` — ni le montant, ni
   * la date, ni le reçu. Voir `updatePaymentMonths` (dataOps/payments.ts).
   */
  onUpdatePaymentMonths: (studentId: string, payment: Payment, months: string[]) => Promise<boolean>;
  /**
   * Combien de fiches partagent le NOM et la CLASSE de cet élève, cette fiche
   * comprise (voir `src/lib/duplicateStudents.ts` — le critère du contrôle de
   * clôture). Au-delà de 1, la fiche ouvre sur un avertissement : c'est ici que
   * l'école voit qu'elle doit trancher. Absent = pas de signal.
   */
  duplicateGroupSize?: number;
  /**
   * Ouvre la comparaison côte à côte des fiches homonymes (même nom + même
   * classe). Absent = pas de bouton : une fiche appelée hors de l'app (tests,
   * impression) n'affiche pas un geste qui ne mène nulle part.
   */
  onReviewDuplicates?: (student: Student) => void;
  /**
   * Le reçu MUET sur lequel cette fiche doit s'OUVRIR, quand un écran l'a
   * demandé — l'écran École des reçus muets (`SilentReceiptsView`), qui liste les
   * élèves porteurs de reçus sans mois et ouvre celui par lequel on commence.
   * L'éditeur des mois s'ouvre alors tout seul, sur ce reçu-là et sur aucun
   * autre. `null`/absent = ouverture ordinaire : rien ne s'ouvre.
   */
  focusPaymentId?: string | null;
}

export function StudentDetailsModal(props: StudentDetailsModalProps) {
  const {
    student: selectedStudent, t, lang, currentTheme, formatDate, formatCurrency,
    getGradeDisplay, generatePaymentReceiptPdf, currentUser, copyToClipboard,
    handleSaveNote, studentDetailTab, setStudentDetailTab, selectedYear, overlayRef,
    onClose, onEdit, onPrint, onReconcile, onDeleteRequest, canDelete, canDeletePayment, onDeletePayment,
    canEditPaymentMonths, onUpdatePaymentMonths,
    duplicateGroupSize, onReviewDuplicates, focusPaymentId,
  } = props;
  // ── Les MOIS DE SCOLARITÉ de cet élève ──────────────────────────────────────
  // Ce que ses paiements DÉCLARENT couvrir, et ce qui reste — calculé par la
  // brique pure (`monthsCoverage`), pas ici : c'est elle qui porte la règle, et
  // c'est elle que les tests tiennent (tests/payment-months.test.ts).
  //
  // L'année de la FICHE d'abord, celle de l'application ensuite : `||` et non
  // `??`, parce qu'une chaîne VIDE est le cas courant des fiches anciennes, pas
  // une année. Aucune des deux : la bande disparaît, au lieu d'inventer.
  const yearMonths = academicYearMonths(selectedStudent.academicYear || selectedYear);
  const coverage = monthsCoverage(selectedStudent.payments.map((p) => p.months), yearMonths);
  const coverageCount = t.monthsCoveredCount
    .replace('{covered}', String(coverage.covered.length))
    .replace('{total}', String(yearMonths.length));
  // ── Le PARCOURS DE RATTRAPAGE : les reçus MUETS, du plus ancien au plus récent
  // Le critère est celui de `coverage.undeclared` — un reçu sans mois DÉCLARÉ ne
  // dit pas ce qu'il couvre, il ne déclare pas « rien » pour autant. La liste est
  // ordonnée par la date (une date `YYYY-MM-DD` se trie en texte, et le tri est
  // STABLE : deux reçus du même jour gardent leur ordre) : on rattrape dans
  // l'ordre du calendrier, pas dans celui des clics.
  const silentPayments = selectedStudent.payments
    .filter((p) => p.id && (!p.months || p.months.length === 0))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Notes ⇄ Calendar bridge: optional date picked next to the sticky note.
  const [noteDateInput, setNoteDateInput] = useState('');
  // La suppression d'un paiement (confirmation en ligne, garde de double clic)
  // vit désormais dans le carnet lui-même (`PaymentLedger`) : c'est un état
  // purement local à une ligne, et le laisser ici obligeait à faire remonter
  // trois props pour une course qui n'existe qu'entre cette ligne et sa
  // confirmation.
  // ── Renseigner les mois d'un reçu MUET ───────────────────────────────────
  // Un reçu antérieur à la colonne `months` (ou envoyé sans cocher) ne dit pas
  // ce qu'il couvre. On ne le devine pas : on le demande à l'école, depuis la
  // ligne du carnet comme depuis le parcours de rattrapage, qui ouvrent le MÊME
  // éditeur. Un seul geste à la fois (`savingMonthsIdRef`), et l'éditeur reste
  // OUVERT si la base refuse (le toast a déjà dit pourquoi).
  //
  // Le choix lui-même vit dans `PaymentMonthsEditor` : la fiche ne garde que
  // l'identité du reçu en cours d'édition, et le composant rend les mois TRIÉS.
  const [editingMonthsPaymentId, setEditingMonthsPaymentId] = useState<string | null>(null);
  const [savingMonthsId, setSavingMonthsId] = useState<string | null>(null);
  const savingMonthsIdRef = useRef<string | null>(null);
  // D'où l'éditeur a été ouvert : la ligne du carnet, ou le parcours de
  // rattrapage. UN SEUL hôte à la fois — sans quoi le même reçu rendrait deux
  // éditeurs (vingt-quatre pastilles au lieu de douze), et le `waitForSelector`
  // du pixel-check ne saurait plus quel éditeur il juge. C'est aussi ce qui
  // décide de la suite à donner à un succès (voir `handleSaveMonths`).
  const [editorHost, setEditorHost] = useState<'ledger' | 'backfill' | null>(null);
  // `useCallback` n'est pas décoratif ici : l'effet du FOCUS ci-dessous doit
  // pouvoir l'appeler sans se rejouer à chaque rendu (la fonction ne touche que
  // deux `setState`, donc son identité n'a aucune raison de changer).
  const openMonthsEditor = useCallback((payment: Payment, host: 'ledger' | 'backfill') => {
    setEditingMonthsPaymentId(payment.id ?? null);
    setEditorHost(host);
  }, []);
  const closeMonthsEditor = () => {
    setEditingMonthsPaymentId(null);
    setEditorHost(null);
  };
  /**
   * ── Le reçu MUET qu'un autre écran a demandé d'ouvrir ────────────────────
   * L'écran École des reçus muets ouvre une fiche SUR un reçu précis
   * (`focusPaymentId`) : l'éditeur des mois doit s'ouvrir au premier rendu, sur
   * ce reçu et sur aucun autre (d'où l'hôte `backfill` : l'enregistrement
   * enchaîne alors sur le reçu muet suivant, comme le parcours le fait déjà).
   *
   * Le focus est CONSOMMÉ une fois par identifiant : l'énregistrement retire le
   * reçu de `silentPayments` et re-rend la fiche — une seconde ouverture de
   * l'éditeur que l'école vient de fermer serait un vol de clic. AppModals remet
   * `studentFileFocus` à zéro à chaque fermeture, donc le même reçu rouvert depuis
   * l'écran École rouvre bien son éditeur : c'est un NOUVEAU clic.
   *
   * Un reçu demandé qui n'est pas (ou plus) muet de CET élève ne fait rien : un
   * focus périmé n'ouvre pas un éditeur sur un reçu déjà renseigné — l'écraser
   * serait un autre geste. Et sans droit d'écrire les mois
   * (`canEditPaymentMonths`, lu sur la base), la fiche s'affiche simplement.
   */
  const consumedFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPaymentId || consumedFocusRef.current === focusPaymentId) return;
    if (!canEditPaymentMonths || yearMonths.length === 0) return;
    const target = silentPayments.find((p) => p.id === focusPaymentId);
    if (!target) return;
    consumedFocusRef.current = focusPaymentId;
    openMonthsEditor(target, 'backfill');
  }, [focusPaymentId, canEditPaymentMonths, yearMonths.length, silentPayments, openMonthsEditor]);
  const handleSaveMonths = async (payment: Payment, months: string[]) => {
    if (!payment.id || savingMonthsIdRef.current || months.length === 0) return;
    savingMonthsIdRef.current = payment.id;
    setSavingMonthsId(payment.id);
    const ok = await onUpdatePaymentMonths(selectedStudent.id, payment, months);
    savingMonthsIdRef.current = null;
    setSavingMonthsId(null);
    // Un refus laisse l'éditeur OUVERT avec le choix intact : le toast a déjà dit
    // pourquoi, et refermer effacerait le travail de l'école.
    if (!ok) return;
    // Un succès AVANCE : le parcours enchaîne sur le reçu muet suivant, dans
    // l'ordre de la liste d'AVANT l'enregistrement (le reçu qu'on vient d'écrire
    // en est retiré par son id, donc « le premier restant » EST le suivant).
    // Depuis le carnet, il n'y a pas de suite : on referme.
    const remaining = silentPayments.filter((p) => p.id !== payment.id);
    if (editorHost === 'backfill' && remaining.length > 0) {
      setEditingMonthsPaymentId(remaining[0].id ?? null);
      return;
    }
    closeMonthsEditor();
  };
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-student-details"
      ariaLabel={t.studentDetails}
      maxWidth="max-w-xl"
      header={
        <div className="h-24 relative" style={{ backgroundColor: currentTheme.header }}>
          <button
            onClick={onClose}
            className={`absolute top-6 right-6 p-2 bg-white/10 ${currentTheme.hoverSurfaceDark} text-white rounded-2xl transition-all`}
          >
            <X size={20} />
          </button>
        </div>
      }
    >

        {/* Body Content */}
        <div className="px-10 pb-10 pt-4 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {/* --- Student Card Layout --- */}
          <div className={`flex flex-col sm:flex-row items-center gap-6 p-6 rounded-3xl border ${currentTheme.border} ${currentTheme.surfaceInset}`}>
            {/* Photo Placeholder / Image */}
            <div className={`w-28 h-28 flex-shrink-0 border-2 ${currentTheme.border} rounded-3xl overflow-hidden ${currentTheme.surfaceInset} ${currentTheme.inkStrong} flex items-center justify-center relative shadow-inner`}>
              {selectedStudent.photo ? (
                <img
                  src={selectedStudent.photo}
                  alt={selectedStudent.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="text-center">
                  <Users size={32} className="mx-auto mb-1" />
                  <span className="text-3xs font-black uppercase tracking-widest">PHOTO</span>
                </div>
              )}
            </div>

            {/* Student Essential Text Details */}
            <div className="flex-1 text-center sm:text-left space-y-2">
              <div>
                {studentMatricule(selectedStudent.studentId) && (
                  <span className={`text-2xs ${currentTheme.muted} font-black uppercase tracking-widest font-mono`}>
                    {t.studentId}: {studentMatricule(selectedStudent.studentId)}
                  </span>
                )}
                <h3 id="modal-title-student-details" className={`text-2xl font-black ${currentTheme.inkStrong} tracking-tight`}>
                  {selectedStudent.name}
                </h3>
              </div>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <span className="inline-block px-3 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 rounded-xl text-xs font-black uppercase tracking-wider">
                  {getGradeDisplay(selectedStudent.grade, lang)}
                </span>

                {/* Status badge: Green for Active, Blue for Graduated, Grey for Left */}
                {(() => {
                  const statusVal = selectedStudent.status || 'Active';
                  let badgeColors = 'text-emerald-700 bg-emerald-50 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60';
                  if (statusVal === 'Graduated') badgeColors = 'text-blue-700 bg-blue-50 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/60';
                  if (statusVal === 'Left') badgeColors = 'text-slate-500 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
                  return (
                    <span className={`inline-block px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider border ${badgeColors}`}>
                      {statusVal}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Un groupe (nom + classe) de plus d'une fiche : la fiche OUVERTE dit
              ce que le registre montre, à l'endroit exact où l'école tranche.
              Le nombre est celui des fiches du groupe, cette fiche comprise. */}
          {duplicateGroupSize !== undefined && duplicateGroupSize > 1 && (
            <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30">
              <AlertTriangle size={18} className="flex-shrink-0 text-amber-600 dark:text-amber-300 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                  {t.duplicateStudentWarning.replace('{n}', String(duplicateGroupSize))}
                </p>
                {/* La phrase dit qu'il y a un problème ; ce bouton mène à
                    l'écran qui permet de le régler, sans repasser par le
                    registre pour retrouver l'autre fiche. */}
                {onReviewDuplicates && (
                  <button
                    onClick={() => onReviewDuplicates(selectedStudent)}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-2xs font-black transition-all inline-flex items-center gap-1.5"
                  >
                    <Copy size={12} className="flex-shrink-0" />
                    {t.duplicateReviewOpen}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* --- Custom Tab Bar --- */}
          <div className="flex border-b border-slate-100 no-print gap-2">
            <button
              onClick={() => setStudentDetailTab('general')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'general'
                  ? `${currentTheme.accentBorder} ${currentTheme.accentSoftText}`
                  : `${currentTheme.muted} border-transparent hover:text-slate-600 dark:hover:text-slate-200`
              }`}
            >
              {t.generalInfo}
            </button>
            <button
              onClick={() => setStudentDetailTab('parent')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'parent'
                  ? `${currentTheme.accentBorder} ${currentTheme.accentSoftText}`
                  : `${currentTheme.muted} border-transparent hover:text-slate-600 dark:hover:text-slate-200`
              }`}
            >
              {t.parentEmergency}
            </button>
            <button
              onClick={() => setStudentDetailTab('medical')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${
                studentDetailTab === 'medical'
                  ? `${currentTheme.accentBorder} ${currentTheme.accentSoftText}`
                  : `${currentTheme.muted} border-transparent hover:text-slate-600 dark:hover:text-slate-200`
              }`}
            >
              {t.medicalHistory}
            </button>
          </div>

          {/* --- Tab Panel Contents --- */}
          <div className="space-y-4">
            {studentDetailTab === 'general' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className={`p-5 ${currentTheme.surfaceInset} rounded-2xl`}>
                    <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.enrollmentDate}</span>
                    <p className={`text-sm font-bold ${currentTheme.inkStrong} mt-1`}>
                      {selectedStudent.enrollmentDate || '2026-07-16'}
                    </p>
                  </div>
                  <div className={`p-5 ${currentTheme.surfaceInset} rounded-2xl`}>
                    <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.academicYear}</span>
                    <p className={`text-sm font-bold ${currentTheme.inkStrong} mt-1`}>
                      {selectedStudent.academicYear || '2025-2026'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className={`p-4 ${currentTheme.surfaceInset} rounded-2xl text-center`}>
                    <span className={`text-3xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.totalDue}</span>
                    <p className={`text-xs font-extrabold ${currentTheme.muted} mt-1`}>
                      {formatCurrency(selectedStudent.totalDue)}
                    </p>
                  </div>
                  <div className={`p-4 ${currentTheme.surfaceInset} rounded-2xl text-center`}>
                    <span className={`text-3xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paid}</span>
                    <p className="text-xs font-extrabold text-emerald-600 mt-1">
                      {formatCurrency(selectedStudent.amountPaid)}
                    </p>
                  </div>
                  <div className={`p-4 bg-rose-50 dark:bg-rose-950/30 rounded-2xl text-center`}>
                    <span className="text-3xs font-black uppercase tracking-widest text-rose-500">{t.balance}</span>
                    <p className="text-xs font-black text-rose-600 mt-1">
                      {formatCurrency(selectedStudent.totalDue * (1 - (selectedStudent.scholarshipDiscount || 0) / 100) - selectedStudent.amountPaid)}
                    </p>
                  </div>
                </div>

                {/* ── Les MOIS DE SCOLARITÉ ─────────────────────────────────
                    Ce que les paiements de cet élève DÉCLARENT couvrir, et ce
                    qui reste. Deux états se lisent sans légende — réglé
                    (accent), à régler (neutre) — et le troisième est une
                    PHRASE, parce qu'il n'est pas un état du mois : quand un
                    paiement ne déclare rien (antérieur à la colonne `months`,
                    ou envoyé sans cocher), la couverture est INCONNUE. Sans
                    cette phrase, un mois réglé avant la colonne s'afficherait
                    « à régler » : la fiche accuserait une famille qui a payé. */}
                {yearMonths.length > 0 && (
                  <div className="space-y-2" data-slot="student-months">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.monthsCoverageTitle}</span>
                      <span className={`text-2xs font-black ${currentTheme.inkStrong}`}>{coverageCount}</span>
                    </div>
                    <div role="group" aria-label={t.monthsCoverageTitle} className="flex flex-wrap gap-1.5">
                      {yearMonths.map((month) => {
                        const paid = coverage.covered.includes(month);
                        return (
                          <span
                            key={month}
                            data-month={month}
                            data-state={paid ? 'paid' : 'due'}
                            title={paid ? t.monthCovered : t.monthToPay}
                            className={`px-2.5 py-1 rounded-xl border text-2xs font-black transition-all ${
                              paid
                                ? `${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentBorder}`
                                : `${currentTheme.surfaceInset} ${currentTheme.border} ${currentTheme.muted}`
                            }`}
                          >
                            {paymentMonthLabel(month, t)}
                          </span>
                        );
                      })}
                    </div>
                    {coverage.missing.length > 0 ? (
                      <p className={`text-2xs font-semibold ${currentTheme.muted}`}>
                        {t.monthsRemainingLabel} : {coverage.missing.map((m) => paymentMonthLabel(m, t)).join(', ')}
                      </p>
                    ) : (
                      <p className="text-2xs font-semibold text-emerald-600 dark:text-emerald-400">{t.monthsCoverageComplete}</p>
                    )}
                    {coverage.undeclared > 0 && (
                      <p data-slot="student-months-undeclared" className="text-2xs font-semibold text-amber-600 dark:text-amber-400">
                        {t.monthsUndeclaredNote.replace('{count}', String(coverage.undeclared))}
                      </p>
                    )}
                  </div>
                )}

                {/* ── LE PARCOURS DE RATTRAPAGE des reçus muets ───────────────
                    Ce que la phrase ambre ci-dessus COMPTE, ce parcours le LISTE
                    et l'enchaîne : un reçu, un enregistrement, le suivant qui
                    s'ouvre tout seul. Il ne remplace pas le geste direct du
                    carnet — les deux ouvrent le MÊME éditeur, et un seul à la
                    fois (`editorHost`). Sans droit d'écriture (`admin`/`dev`),
                    il n'y a pas de parcours : la phrase compte, et s'arrête là. */}
                {canEditPaymentMonths && yearMonths.length > 0 && silentPayments.length > 0 && (
                  <PaymentMonthsBackfill
                    silentPayments={silentPayments}
                    yearMonths={yearMonths}
                    editingPaymentId={editorHost === 'backfill' ? editingMonthsPaymentId : null}
                    saving={savingMonthsId !== null}
                    t={t}
                    currentTheme={currentTheme}
                    formatDate={formatDate}
                    formatCurrency={formatCurrency}
                    onOpen={(p) => openMonthsEditor(p, 'backfill')}
                    onSave={(p, months) => { void handleSaveMonths(p, months); }}
                    onCancel={closeMonthsEditor}
                  />
                )}

                {/* Le CARNET des paiements — extrait dans son propre composant
                    (`PaymentLedger`) pour tenir le budget de 700 lignes par
                    fichier, comme l'éditeur des mois l'a été avant lui. La fiche
                    lui passe ce qu'il ne peut pas décider seul : le droit
                    d'écrire les mois (policy UPDATE de `payments`), le droit de
                    supprimer, et QUI héberge l'éditeur déjà ouvert. */}
                <PaymentLedger
                  student={selectedStudent}
                  yearMonths={yearMonths}
                  t={t}
                  lang={lang}
                  currentTheme={currentTheme}
                  currentUser={currentUser}
                  formatDate={formatDate}
                  formatCurrency={formatCurrency}
                  generatePaymentReceiptPdf={generatePaymentReceiptPdf}
                  canEditPaymentMonths={canEditPaymentMonths}
                  canDeletePayment={canDeletePayment}
                  editingPaymentId={editingMonthsPaymentId}
                  editorHost={editorHost}
                  savingMonthsId={savingMonthsId}
                  onOpenMonths={(p) => openMonthsEditor(p, 'ledger')}
                  onSaveMonths={(p, months) => { void handleSaveMonths(p, months); }}
                  onCancelMonths={closeMonthsEditor}
                  onDeletePayment={onDeletePayment}
                />
              </div>
            )}

            {studentDetailTab === 'parent' && (
              <div className="space-y-4">
                {/* Guardian Info Card */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                  <h4 className="text-2xs font-black text-slate-400 uppercase tracking-widest">{t.guardianTitle}</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className={currentTheme.muted}>{t.parentName}</span>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>{selectedStudent.parentName}</p>
                    </div>
                    <div>
                      <span className={currentTheme.muted}>{t.phone}</span>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>{selectedStudent.parentPhone}</p>
                    </div>
                    <div className="col-span-2 border-t border-slate-100 pt-2 flex justify-between items-center">
                      <div>
                        <span className={currentTheme.muted}>{t.email}</span>
                        <p className={`font-semibold ${selectedStudent.parentEmail ? 'text-blue-600' : 'text-slate-400 italic text-xs'}`}>
                          {selectedStudent.parentEmail || (t.notProvided)}
                        </p>
                      </div>
                      {selectedStudent.parentEmail && (
                        <button
                          onClick={() => copyToClipboard(selectedStudent.parentEmail)}
                          className={`p-2 ${currentTheme.hoverAccent} text-blue-500 rounded-lg transition-all`}
                          title={t.copyEmail}
                        >
                          <Copy size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Emergency Contact Card */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl space-y-3`}>
                  <h4 className="text-2xs font-black text-rose-500 uppercase tracking-widest">{t.emergencyTitle}</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className={currentTheme.muted}>{t.contactName}</span>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>
                        {selectedStudent.emergencyContactName || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <span className={currentTheme.muted}>{t.relationshipLabel}</span>
                      <p className={`font-bold ${currentTheme.inkStrong}`}>
                        {selectedStudent.emergencyContactRelation || 'N/A'}
                      </p>
                    </div>
                    <div className="col-span-2 border-t border-slate-100 pt-2">
                      <span className={currentTheme.muted}>{t.emergencyPhoneLabel}</span>
                      <p className="font-black text-rose-600 text-sm">
                        {selectedStudent.emergencyContactPhone || 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {studentDetailTab === 'medical' && (
              <div className="space-y-4">
                {/* Previous School */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                  <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.previousSchoolHistory}</span>
                  <p className={`text-sm font-bold ${currentTheme.inkStrong} mt-1`}>
                    {selectedStudent.previousSchool || (t.noneFirstEnrollmentEntry)}
                  </p>
                </div>

                {/* Medical Notes */}
                <div className={`p-5 ${currentTheme.isDark ? 'bg-[#1e293b]/50' : 'bg-slate-50'} rounded-2xl`}>
                  <span className="text-2xs font-black uppercase tracking-widest text-rose-500">{t.medicalNotesTitle}</span>
                  <p className={`text-xs font-semibold ${currentTheme.isDark ? 'text-[#E2E8F0]/80' : 'text-slate-700'} mt-1 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700`}>
                    {selectedStudent.medicalNotes || 'None'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* --- Accounting Notes (Sticky Note) --- */}
          <div className="pt-2">
            <div className="bg-[#FEF9C3] p-6 rounded-3xl shadow-inner border border-yellow-200/50 relative transform rotate-1">
              <div className="absolute top-5 right-6 text-yellow-600/30">
                <StickyNote size={24} />
              </div>
              <h4 className="text-3xs font-black text-yellow-900 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <FileText size={12} />
                {t.accountingNotes}
              </h4>
              <textarea
                defaultValue={selectedStudent.notes}
                onBlur={(e) => {
                  const d = noteDateInput || undefined;
                  void handleSaveNote(selectedStudent.id, e.target.value, d);
                  setNoteDateInput('');
                }}
                placeholder={t.notesPlaceholder}
                className="w-full bg-transparent border-none focus:ring-0 text-xs font-bold text-yellow-900 placeholder-yellow-700/40 resize-none min-h-[80px] custom-scrollbar"
              />
              <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-1.5 text-3xs font-black text-yellow-800 uppercase tracking-widest">
                  <Calendar size={12} />
                  {t.alsoShowOnCalendar}
                  <input
                    type="date"
                    value={noteDateInput}
                    onChange={(e) => setNoteDateInput(e.target.value)}
                    className="ml-1 px-2 py-1 rounded-lg border border-yellow-300 dark:border-yellow-900/60 bg-white/80 dark:bg-slate-800 text-2xs font-bold text-yellow-900 dark:text-yellow-300 focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                  />
                </label>
                <span className="text-3xs font-black text-yellow-800/70 uppercase tracking-widest">
                  {selectedStudent.lastNoteDate ? `${t.lastUpdated}: ${formatDate(selectedStudent.lastNoteDate)}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* --- Bottom Actions Bar --- */}
          {/* Modifier · Imprimer la fiche · État de rapprochement · Supprimer ·
              Fermer — cinq gestes, donc cinq colonnes dès que l'écran est large :
              l'état de rapprochement est un DOCUMENT (mois réglés, mois encore
              dus), pas un onglet de plus, et il doit se lire à côté de
              l'impression de la fiche, pas s'y substituer. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={onEdit}
              className={`h-11 px-3 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap`}
            >
              <FileText size={16} className="flex-shrink-0" />
              <span className="truncate">{t.editProfile}</span>
            </button>

            <button
              onClick={onPrint}
              className={`h-11 px-3 bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white rounded-2xl font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap`}
            >
              <Printer size={16} className="flex-shrink-0" />
              <span className="truncate">{t.printStudentFile}</span>
            </button>

            {onReconcile && (
              <button
                data-slot="student-reconciliation-open"
                onClick={onReconcile}
                className={`h-11 px-3 ${currentTheme.accentSoft} ${currentTheme.accentSoftText} border ${currentTheme.accentBorder} ${currentTheme.hoverAccent} rounded-2xl font-black text-xs transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap`}
              >
                <ClipboardList size={16} className="flex-shrink-0" />
                <span className="truncate">{t.reconciliationOpen}</span>
              </button>
            )}

            {/* « Admin delete students » : pas de rôle, pas de bouton. */}
            {canDelete && (
              <button
                onClick={onDeleteRequest}
                className={`h-11 px-3 rounded-2xl bg-rose-600 ${currentTheme.hoverAlertSolid} text-white font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap`}
              >
                <Trash2 size={16} className="flex-shrink-0" />
                <span className="truncate">{t.deleteStudent}</span>
              </button>
            )}

            <button
              onClick={onClose}
              className={`h-11 px-3 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 ${currentTheme.hoverSurface} dark:hover:text-slate-200 rounded-2xl font-bold text-xs transition-all flex items-center justify-center whitespace-nowrap`}
            >
              {t.close}
            </button>
          </div>
        </div>
    </ModalShell>
  );
}
