import type { GeneratedReceipt, ReceiptDataOptions } from './pdfReceipt';
import { studentMatricule } from './studentIdentifiers';

/**
 * Le résumé affiché au-dessus de l'aperçu — les mêmes valeurs que celles
 * imprimées sur le reçu, pour que la vérification avant téléchargement porte
 * sur ce qu'on va lire sur le papier (nom, MATRICULE, classe, montant).
 *
 * Le matricule suit la convention de `grade` : un élève dont le matricule n'est
 * pas encore arrivé (fiche créée hors ligne, en attente de drainage) affiche
 * « — » plutôt qu'une case vide.
 */
export interface ReceiptPreview extends GeneratedReceipt {
  studentName: string;
  matricule: string;
  grade: string;
  amount: number;
  lang: 'en' | 'fr';
}

let preview: ReceiptPreview | null = null;
const listeners = new Set<() => void>();

export const getReceiptPreview = () => preview;
export const subscribeReceiptPreview = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function showReceiptPreview(receipt: GeneratedReceipt, opts: ReceiptDataOptions): void {
  preview = {
    ...receipt,
    studentName: opts.student.name.trim(),
    matricule: studentMatricule(opts.student.studentId) || '—',
    grade: opts.student.grade || '—',
    amount: opts.payment.amount,
    lang: opts.lang || 'fr',
  };
  for (const listener of listeners) listener();
}

export function closeReceiptPreview(): void {
  preview = null;
  for (const listener of listeners) listener();
}
