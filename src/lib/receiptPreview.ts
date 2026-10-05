import type { GeneratedReceipt, ReceiptDataOptions } from './pdfReceipt';

export interface ReceiptPreview extends GeneratedReceipt {
  studentName: string;
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
