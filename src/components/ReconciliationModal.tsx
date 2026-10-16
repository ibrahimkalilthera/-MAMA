/**
 * ReconciliationModal — L'ÉTAT DE RAPPROCHEMENT d'un élève, et son papier.
 *
 * Ce que la famille emporte, et ce que le secrétariat relit avant de le remettre :
 * les MOIS RÉGLÉS avec le reçu qui les déclare, les MOIS ENCORE DUS, et l'argent
 * (dû, versé, reste). La fiche élève montre déjà la bande des mois ; ce document
 * en fait un état daté, remis ou relancé.
 *
 * ─── Une seule définition du papier ────────────────────────────────────────
 * `ReconciliationSheet` est rendu DEUX fois : l'aperçu à l'écran (dans la
 * modale) et le jumeau imprimé (`hidden print:block`). Un avis officiel qui ne
 * dirait pas la même chose que ce que le secrétariat a relu serait un piège —
 * c'est la leçon du ticket de retard (`LatePaymentTicketModal`), dont les deux
 * copies sont mesurées par le même test. Ici il n'y a pas deux copies à tenir
 * d'accord : il n'y a qu'un bloc de JSX, rendu deux fois.
 *
 * ─── Pourquoi le jumeau est monté par AppShell, et non ici ─────────────────
 * L'impression d'un SEUL papier passe par un masquage de la coquille
 * (`AppShell` → classe `no-print-sheet`, règle `@media print` d'`index.css`) :
 * ce qui reste à imprimer, c'est le jumeau. Monté À L'INTÉRIEUR de la coquille,
 * il serait masqué avec elle et la page sortirait blanche ; il est donc rendu
 * en FRÈRE de la coquille, à côté des autres papiers et fenêtres hors coquille.
 * C'est aussi pourquoi ce fichier exporte deux composants : la FENÊTRE (ouverte
 * par le carnet, dans la coquille) et le PAPIER (monté par la coquille).
 *
 * ─── Ce que la modale ne décide pas ────────────────────────────────────────
 * Ni les mois, ni l'argent, ni la phrase des mois dus : tout vient de
 * `src/lib/studentReconciliation.ts`, y compris la RÉSERVE qui interdit
 * d'annoncer « encore dus » quand des reçus ne déclarent aucun mois (couverture
 * inconnue). L'écran n'a pas la possibilité d'écrire un avis malhonnête.
 */
import { ClipboardList, Printer } from 'lucide-react';
import type { Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import { academicYearMonths, paidReceiptEvidence, paymentMonthLabel } from '../lib/paymentMonths';
import { reconciliationDue, studentReconciliation } from '../lib/studentReconciliation';
import { studentMatricule } from '../lib/studentIdentifiers';
import { modalTokens } from '../lib/modalTokens';
import { ModalShell } from './ModalShell';

/** Ce que les deux faces du papier partagent : la fiche et les formateurs. */
interface ReconciliationSheetProps {
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  student: Student;
  /** L'année scolaire ACTIVE de l'application — recours quand la fiche n'en porte pas. */
  selectedYear: string;
  getGradeDisplay: (grade: string | undefined, currentLang?: 'en' | 'fr') => string;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
}

/**
 * LE PAPIER — une seule définition, deux rendus.
 *
 * L'année jugée est celle de la FICHE d'abord, celle de l'application ensuite
 * (`||`, parce qu'une année vide est le cas des fiches anciennes) : la même
 * lecture que la fiche élève, donc les mêmes mois que la bande qu'on vient de
 * regarder. Aucune des deux lisible → les mois disparaissent au lieu d'être
 * inventés, et la phrase le dit (voir `reconciliationDue`).
 */
function ReconciliationSheet({
  t, lang, currentTheme, student, selectedYear, getGradeDisplay, formatDate, formatCurrency,
}: ReconciliationSheetProps) {
  const tokens = modalTokens(currentTheme);
  const yearMonths = academicYearMonths(student.academicYear || selectedYear);
  const rec = studentReconciliation(student, yearMonths);
  const due = reconciliationDue(rec, {
    label: (ym) => paymentMonthLabel(ym, t),
    dueLine: t.reconciliationDueLine,
    dueReserved: t.reconciliationDueReserved,
    complete: t.monthsCoverageComplete,
    noYear: t.reconciliationNoYear,
  });
  const matricule = studentMatricule(student.studentId);
  const coveredCount = t.monthsCoveredCount
    .replace('{covered}', String(rec.covered.length))
    .replace('{total}', String(yearMonths.length));
  const rows: { label: string; value: string }[] = [
    { label: t.student, value: student.name },
    ...(matricule ? [{ label: t.studentId, value: matricule }] : []),
    { label: t.class, value: getGradeDisplay(student.grade, lang) },
    { label: t.parentLabel, value: student.parentName },
    { label: t.academicYear, value: student.academicYear || selectedYear },
  ];

  return (
    <div
      data-slot="reconciliation-sheet"
      className={`bg-white text-slate-900 border border-slate-300 rounded-2xl p-8 space-y-6 font-sans`}
    >
      <div className="text-center border-b border-slate-300 pb-4">
        <h1 className="font-black text-lg uppercase tracking-wider">{t.title}</h1>
        <p className="text-2xs text-slate-500">{t.subtitle}</p>
        <h2 className="font-black text-sm mt-3 uppercase tracking-widest border border-slate-300 px-3 py-1 inline-block">
          {t.reconciliationOpen}
        </h2>
      </div>

      <div className="space-y-1.5 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <span className="font-bold text-slate-500">{row.label}</span>
            <span className="font-semibold text-right">{row.value}</span>
          </div>
        ))}
      </div>

      {/* ── LES MOIS ────────────────────────────────────────────────────────
          Réglés : chaque mois AVEC le reçu qui le déclare — un état qu'on
          vérifie sur les papiers de la famille, pas une case cochée. Encore
          dus : la phrase vient du module pur, réserve comprise. */}
      <div className="border-t border-slate-300 pt-4 space-y-2">
        {yearMonths.length > 0 && (
          <>
            <div className="flex justify-between items-baseline">
              <span className="text-2xs font-black uppercase tracking-widest text-slate-500">{t.reconciliationPaidTitle}</span>
              <span className="text-2xs font-bold">{coveredCount}</span>
            </div>
            {rec.covered.length > 0 ? (
              <div className="space-y-1">
                {rec.covered.map((fact) => (
                  <div key={fact.month} className="text-2xs">
                    <span className="font-black">{paymentMonthLabel(fact.month, t)}</span>
                    {fact.receipts.map((receipt) => (
                      <span key={receipt.id ?? `${receipt.date}:${receipt.amount}`} className="block pl-3 text-slate-600">
                        {paidReceiptEvidence(receipt, t, lang)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-slate-600">
                {student.payments.length === 0 ? t.reconciliationNoReceipts : t.monthsUndeclaredNote.replace('{count}', String(rec.undeclared))}
              </p>
            )}
          </>
        )}
        {/* UNE seule phrase pour les mois, dans TOUS les cas — année lisible ou
            non : deux marqueurs pour la même phrase finiraient par diverger, et
            `data-reserved` ne dit que ce qui est vrai (un reçu muet). */}
        <p
          data-slot="reconciliation-due"
          data-reserved={due.reserved ? 'true' : undefined}
          className={`text-xs font-black ${yearMonths.length === 0 ? 'text-slate-600' : due.reserved ? 'text-amber-700' : 'text-rose-600'}`}
        >
          {due.line}
        </p>
      </div>

      {/* ── L'ARGENT ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 text-center border-t border-slate-300 pt-4">
        <div className={`${tokens.paperFillLight} p-3 rounded-xl`}>
          <span className="text-3xs font-black uppercase tracking-widest text-slate-500 block">{t.totalDue}</span>
          <span className="text-sm font-black">{formatCurrency(rec.totalDue)}</span>
        </div>
        <div className={`${tokens.paperFillLight} p-3 rounded-xl`}>
          <span className="text-3xs font-black uppercase tracking-widest text-slate-500 block">{t.paid}</span>
          <span className="text-sm font-black text-emerald-700">{formatCurrency(rec.paid)}</span>
        </div>
        <div className={`${tokens.paperFillAlert} p-3 rounded-xl`}>
          <span className="text-3xs font-black uppercase tracking-widest text-rose-600 block">{t.balance}</span>
          <span className="text-sm font-black text-rose-700">{formatCurrency(rec.balance)}</span>
        </div>
      </div>

      <p className="text-2xs text-slate-600 leading-relaxed border-t border-slate-300 pt-4">{t.reconciliationNote}</p>

      <div className="flex justify-between items-end text-2xs pt-6 border-t border-slate-200">
        <span>
          {t.generatedOn} {formatDate(new Date().toISOString())}
        </span>
        <span className="text-center">
          <span className="block font-bold">{t.officialSealSignature}</span>
          <span className="block w-40 border-b border-dashed border-slate-400 mt-6" />
        </span>
      </div>
    </div>
  );
}

export interface ReconciliationModalProps extends ReconciliationSheetProps {
  /** The dialog root — registered in AppModals' overlay refs (focus trap). */
  overlayRef: (el: HTMLElement | null) => void;
  onClose: () => void;
}

/** LA FENÊTRE — l'aperçu à l'écran et le bouton qui sort le papier. */
export function ReconciliationModal(props: ReconciliationModalProps) {
  // `t` et `currentTheme` servent AUSSI au papier : la fenêtre ne fait que
  // l'héberger, elle ne lui substitue rien.
  const { t, currentTheme, overlayRef, onClose, ...sheet } = props;
  return (
    <ModalShell
      overlayRef={overlayRef}
      onClose={onClose}
      currentTheme={currentTheme}
      titleId="modal-title-reconciliation"
      ariaLabel={t.reconciliationOpen}
      // Le papier ne s'imprime pas DANS la fenêtre : le jumeau s'en charge.
      rootClassName="no-print"
      maxWidth="max-w-xl"
      icon={<ClipboardList size={24} className="text-emerald-400" />}
      title={t.reconciliationOpen}
    >
      <div className="p-8 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
        <ReconciliationSheet t={t} currentTheme={currentTheme} {...sheet} />
        <div className="flex gap-4">
          <button
            data-slot="reconciliation-print"
            onClick={() => {
              // Laisser React peindre (et, pour un test, le temps d'un tick)
              // avant de figer la page : `print()` photographie l'instant.
              setTimeout(() => window.print(), 100);
            }}
            className={`flex-1 bg-slate-800 ${currentTheme.hoverSurfaceStrong} text-white py-4 rounded-2xl font-black text-sm transition-all shadow-xl flex items-center justify-center gap-2`}
          >
            <Printer size={18} />
            {t.reconciliationPrint}
          </button>
          <button
            onClick={onClose}
            className={`px-8 py-4 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 ${currentTheme.hoverSurface} dark:hover:text-slate-200 rounded-2xl font-bold text-sm transition-all`}
          >
            {t.close}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export type ReconciliationPrintProps = ReconciliationSheetProps;

/**
 * LE PAPIER SEUL — monté par `AppShell`, HORS de la coquille masquée à
 * l'impression (voir l'en-tête). Rien d'autre ne doit être monté ici : le
 * masquage de la coquille ne laisse passer que ce bloc.
 */
export function ReconciliationPrint(props: ReconciliationPrintProps) {
  return (
    <div className="hidden print:block print-reconciliation-container bg-white text-black p-12">
      <ReconciliationSheet {...props} />
    </div>
  );
}
