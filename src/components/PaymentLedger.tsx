/**
 * PaymentLedger — le MINI-CARNET DES PAIEMENTS de la fiche élève.
 *
 * Extrait de `StudentDetailsModal` (qui était passé au-dessus du budget de 700
 * lignes par fichier, `check-line-budget.mjs`), comme `PaymentMonthsEditor`
 * l'avait été avant lui : la fiche garde le profil, les onglets et la bande des
 * mois ; le carnet devient une unité à part.
 *
 * Ce que ce carnet porte, et que la fiche lui délègue :
 *
 *   • **une ligne par reçu**, du plus récent au plus ancien (`reverse`) — c'est
 *     l'ordre de lecture d'un carnet de caisse : ce qui vient d'entrer d'abord ;
 *   • **le geste « Renseigner les mois »**, offert sur les seules lignes qui ne
 *     déclarent AUCUN mois (`!p.months || p.months.length === 0`) et seulement
 *     avec le droit (`canEditPaymentMonths`) et une année lisible. C'est le
 *     pendant direct du parcours de rattrapage (`PaymentMonthsBackfill`) : les
 *     deux ouvrent le MÊME éditeur, et la fiche garantit qu'un seul est rendu
 *     (`editorHost`) ;
 *   • **le reçu PDF**, par le chemin réel de l'application (aperçu puis
 *     téléchargement) ;
 *   • **la suppression d'un paiement**, avec sa confirmation EN LIGNE — pas de
 *     dialogue navigateur — et la garde de double clic.
 *
 * ─── Ce qui vit ICI, et pourquoi ───────────────────────────────────────────
 * L'état de la suppression (`pendingDeletePaymentId`, `deletingPaymentId` et sa
 * `ref`) appartient au carnet : personne d'autre n'a besoin de savoir qu'une
 * ligne attend confirmation, et le garde-fou du double clic protège une course
 * qui n'existe qu'entre cette ligne et le bouton qui la confirme. Le laisser
 * dans la fiche obligerait à faire remonter trois props pour un état purement
 * local.
 *
 * Le composant reste PUREMENT présentatif : il ne parle ni à Supabase, ni aux
 * droits — `canEditPaymentMonths` / `canDeletePayment` sont décidés en amont
 * (`src/lib/paymentRights.ts`, `src/lib/deleteRights.ts`), et un bouton que la
 * base refuse est un échec annoncé, pas empêché.
 *
 * Les marqueurs sont ceux du pixel-check E2E (`scripts/verify-pdf-download.mjs`,
 * mode `recu-muet`) : `data-slot="payment-months-fill"` sur le geste des mois. Ce
 * mode lit la fiche par CLÉ, jamais par un libellé traduit.
 */
import { useRef, useState } from 'react';
import { Calendar, Receipt, Trash2 } from 'lucide-react';
import type { Payment, Student } from '../lib/useSupabaseData';
import type { CurrentTheme } from '../app/mainViewsProps';
import type { TranslationDict } from '../i18n/translations';
import type { ReceiptDataOptions } from '../lib/pdfReceipt';
import { PaymentMonthsEditor } from './PaymentMonthsEditor';

export interface PaymentLedgerProps {
  /** L'élève dont on lit le carnet (le reçu PDF a besoin de la fiche entière). */
  student: Student;
  /** Les douze mois de l'année jugée — sans eux, il n'y a pas de mois à cocher. */
  yearMonths: string[];
  t: TranslationDict;
  lang: 'en' | 'fr';
  currentTheme: CurrentTheme;
  currentUser: { name?: string; role?: string; username?: string } | null;
  formatDate: (dateStr: string) => string;
  formatCurrency: (amount: number) => string;
  generatePaymentReceiptPdf: (opts: ReceiptDataOptions) => Promise<void>;
  /** Le rôle peut-il renseigner les mois d'un reçu (policy UPDATE de `payments`) ? */
  canEditPaymentMonths: boolean;
  /** Le rôle peut-il supprimer un paiement (« Payment deleters delete payments ») ? */
  canDeletePayment: boolean;
  /** Le reçu dont l'éditeur est ouvert, et QUI l'héberge (le carnet, ou le parcours). */
  editingPaymentId: string | null;
  editorHost: 'ledger' | 'backfill' | null;
  /** Un enregistrement de mois est en vol pour ce reçu. */
  savingMonthsId: string | null;
  /** Ouvre l'éditeur des mois DEPUIS LE CARNET (l'hôte sera `ledger`). */
  onOpenMonths: (payment: Payment) => void;
  onSaveMonths: (payment: Payment, months: string[]) => void;
  onCancelMonths: () => void;
  /** Supprime le reçu ; rend `false` si la base a refusé (le toast a dit pourquoi). */
  onDeletePayment: (studentId: string, payment: Payment) => Promise<boolean>;
}

export function PaymentLedger(props: PaymentLedgerProps) {
  const {
    student, yearMonths, t, lang, currentTheme, currentUser, formatDate, formatCurrency,
    generatePaymentReceiptPdf, canEditPaymentMonths, canDeletePayment,
    editingPaymentId, editorHost, savingMonthsId,
    onOpenMonths, onSaveMonths, onCancelMonths, onDeletePayment,
  } = props;

  // Suppression d'un paiement : une confirmation EN LIGNE (pas de dialogue
  // navigateur) puis l'appel. `deletingPaymentId` désactive le bouton pendant
  // l'aller-retour et `deletingPaymentIdRef` ferme la course d'un double clic —
  // le second appel verrait « zéro ligne supprimée » et crierait à tort
  // « droits insuffisants » (même garde que le formulaire de paiement).
  const [pendingDeletePaymentId, setPendingDeletePaymentId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const deletingPaymentIdRef = useRef<string | null>(null);
  const handleDeletePayment = async (payment: Payment) => {
    if (!payment.id || deletingPaymentIdRef.current) return;
    deletingPaymentIdRef.current = payment.id;
    setDeletingPaymentId(payment.id);
    const ok = await onDeletePayment(student.id, payment);
    deletingPaymentIdRef.current = null;
    setDeletingPaymentId(null);
    // Succès : la ligne a quitté la liste, on referme la confirmation. Échec :
    // on la laisse ouverte (le toast a déjà dit pourquoi).
    if (ok) setPendingDeletePaymentId(null);
  };

  return (
    <div className="space-y-2">
      <span className={`text-2xs font-black uppercase tracking-widest ${currentTheme.muted}`}>{t.paymentHistoryLedger}</span>
      {/* L'éditeur des mois est plus haut que trois lignes de reçu :
          dans la fenêtre d'origine (6 rem) ses pastilles et son
          bouton de validation tombaient hors du cadre. La fenêtre
          s'ouvre pendant l'édition, et reprend sa taille ensuite. */}
      <div className={`space-y-2 ${editingPaymentId ? 'max-h-80' : 'max-h-24'} overflow-y-auto pr-2 custom-scrollbar`}>
        {student.payments.length > 0 ? (
          [...student.payments].reverse().map((p, idx) => (
            <div key={`${p.date}-${p.amount}-${idx}`} className={`flex items-center justify-between p-3 ${currentTheme.surfaceInset} rounded-xl text-xs`}>
              {pendingDeletePaymentId === p.id ? (
                /* Confirmation EN LIGNE (pas de dialogue navigateur) :
                   la phrase dit ce qui part, et le journal en gardera
                   la trace sous « Paiement supprimé ». */
                <div className="flex flex-col gap-2 w-full">
                  <span className="text-2xs font-bold text-rose-600">
                    {t.deletePaymentConfirm
                      .replace('{amount}', formatCurrency(p.amount))
                      .replace('{receipt}', p.receiptNumber || 'N/A')}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { void handleDeletePayment(p); }}
                      disabled={deletingPaymentId === p.id}
                      className="px-2 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded text-2xs font-bold transition-all"
                    >
                      {t.deletePayment}
                    </button>
                    <button
                      onClick={() => setPendingDeletePaymentId(null)}
                      className={`px-2 py-1 border ${currentTheme.border} ${currentTheme.muted} hover:text-slate-600 rounded text-2xs font-bold transition-all`}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : editingPaymentId === p.id && editorHost === 'ledger' ? (
                /* Renseigner les mois — l'éditeur REMPLACE la ligne,
                   comme la confirmation de suppression : un seul
                   geste à l'écran à la fois. */
                <PaymentMonthsEditor
                  yearMonths={yearMonths}
                  initialMonths={p.months ?? []}
                  t={t}
                  currentTheme={currentTheme}
                  saving={savingMonthsId === p.id}
                  onSave={(months) => { void onSaveMonths(p, months); }}
                  onCancel={onCancelMonths}
                />
              ) : (
                <>
                  <div className="flex flex-col">
                    <span className={currentTheme.muted}>{formatDate(p.date)}</span>
                    {p.receiptNumber && <span className="text-2xs text-slate-400 font-mono">{t.receiptNoShort} {p.receiptNumber}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-600">+{formatCurrency(p.amount)}</span>
                    {/* Le reçu NE DÉCLARE aucun mois : ses
                        réimpressions ne nomment que le mois de sa
                        date, et la famille repart avec un papier
                        incomplet. C'est le seul cas où l'école doit
                        compléter, donc le seul où le bouton
                        apparaît — dans la couleur de la phrase qui
                        compte ces reçus juste au-dessus. Il faut
                        aussi une année lisible : sans elle, il n'y
                        a pas de mois à proposer. */}
                    {canEditPaymentMonths && p.id && yearMonths.length > 0 && (!p.months || p.months.length === 0) && (
                      <button
                        data-slot="payment-months-fill"
                        onClick={() => onOpenMonths(p)}
                        className="px-2 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 hover:bg-amber-100 dark:hover:bg-amber-950/60 rounded text-2xs font-bold transition-all flex items-center gap-1"
                        title={t.paymentMonthsEdit}
                      >
                        <Calendar size={12} /> {t.paymentMonthsEdit}
                      </button>
                    )}
                    <button
                      onClick={() => generatePaymentReceiptPdf({
                        student,
                        payment: p,
                        lang,
                        cashierName: currentUser?.name || 'Administration'
                      })}
                      className={`px-2 py-1 ${currentTheme.accentBg} ${currentTheme.accentHover} ${currentTheme.accentText} rounded text-2xs font-bold transition-all shadow-sm flex items-center gap-1`}
                      title={t.downloadReceiptPdf}
                    >
                      <Receipt size={12} /> {t.receipt2}
                    </button>
                    {/* « Payment deleters delete payments » : pas de rôle
                        (admin, dev ou econome), pas de bouton. Le libellé
                        accompagne l'icône — une corbeille seule se lit comme
                        un ornement — et la pastille reprend la forme du bouton
                        « Reçu » voisin. */}
                    {canDeletePayment && p.id && (
                      <button
                        onClick={() => setPendingDeletePaymentId(p.id ?? null)}
                        className="px-2 py-1 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-950/60 rounded text-2xs font-bold transition-all flex items-center gap-1"
                        title={t.deletePayment}
                      >
                        <Trash2 size={12} /> {t.deletePayment}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <p className={`text-xs ${currentTheme.muted} italic p-2`}>{t.noPayments}</p>
        )}
      </div>
    </div>
  );
}
