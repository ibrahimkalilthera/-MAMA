import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { CurrentTheme } from '../app/mainViewsProps';
import { translations } from '../i18n/translations';
import { downloadPreparedReceipt } from '../lib/pdfReceipt';
import { closeReceiptPreview, getReceiptPreview, subscribeReceiptPreview } from '../lib/receiptPreview';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { useFocusTrap } from '../lib/focusStack';

export function ReceiptPreviewModal({ currentTheme }: { currentTheme: CurrentTheme }) {
  const receipt = useSyncExternalStore(subscribeReceiptPreview, getReceiptPreview, () => null);
  const [renderError, setRenderError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(!!receipt, closeReceiptPreview);
  useFocusTrap(!!receipt, () => rootRef.current);

  useEffect(() => {
    if (!receipt) return;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    setRenderError(false);
    void (async () => {
      try {
        const { renderReceiptPreview } = await import('../lib/renderReceiptPreview');
        if (cancelled || !canvasRef.current) return;
        const rendering = renderReceiptPreview(receipt.bytes, canvasRef.current);
        cancelRender = rendering.cancel;
        await rendering.done;
      } catch (error) {
        if (!cancelled) { console.error('Receipt preview rendering failed:', error); setRenderError(true); }
      }
    })();
    return () => { cancelled = true; cancelRender?.(); };
  }, [receipt]);

  if (!receipt) return null;
  const t = translations[receipt.lang];
  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="receipt-preview-title"
      className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center p-4">
      <div className={`w-full max-w-4xl max-h-[95vh] overflow-y-auto rounded-3xl p-5 space-y-4 ${currentTheme.card} ${currentTheme.text} ${currentTheme.isDark ? 'dark' : ''} border ${currentTheme.border}`}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="receipt-preview-title" className="text-xl font-bold">{t.receiptPreview}</h2>
          <button type="button" onClick={closeReceiptPreview} className={`px-4 py-2 rounded-xl ${currentTheme.isDark ? 'bg-slate-800 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>{t.close}</button>
        </div>
        <p className={`text-sm ${currentTheme.muted}`}>{t.receiptPreviewHint}</p>
        <dl className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl ${currentTheme.isDark ? 'bg-slate-800 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
          <div><dt className={`text-xs ${currentTheme.muted}`}>{t.studentName}</dt><dd className={`font-bold ${currentTheme.inkStrong}`}>{receipt.studentName}</dd></div>
          <div><dt className={`text-xs ${currentTheme.muted}`}>{t.studentId}</dt><dd className={`font-bold ${currentTheme.inkStrong}`}>{receipt.matricule}</dd></div>
          <div><dt className={`text-xs ${currentTheme.muted}`}>{t.class}</dt><dd className={`font-bold ${currentTheme.inkStrong}`}>{receipt.grade}</dd></div>
          <div><dt className={`text-xs ${currentTheme.muted}`}>{t.amount}</dt><dd className={`font-bold ${currentTheme.inkStrong}`}>{receipt.amount.toLocaleString(receipt.lang === 'fr' ? 'fr-FR' : 'en-US')} FCFA</dd></div>
        </dl>
        {renderError && <p role="alert">{t.receiptPreviewFailed}</p>}
        <canvas ref={canvasRef} aria-label={t.receiptPreview} className="w-full h-auto rounded-xl bg-white" />
        <button type="button" onClick={() => { downloadPreparedReceipt(receipt); closeReceiptPreview(); }}
          className={`px-5 py-3 rounded-xl font-bold ${currentTheme.accentBg} ${currentTheme.accentText} ${currentTheme.accentHover}`}>
          {t.downloadReceipt}
        </button>
      </div>
    </div>
  );
}
