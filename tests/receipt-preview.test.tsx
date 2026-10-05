import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';
import { mockModule } from './module-mock';
const renders: Uint8Array[] = [];
mockModule('../src/lib/renderReceiptPreview.ts', {
  renderReceiptPreview: (bytes: Uint8Array) => { renders.push(bytes); return { done: Promise.resolve(), cancel: () => {} }; },
});
const { ReceiptPreviewModal } = await import('../src/components/ReceiptPreviewModal');
import { generatePaymentReceiptPdf } from '../src/lib/pdfReceipt';
import { closeReceiptPreview, getReceiptPreview } from '../src/lib/receiptPreview';
import { translations } from '../src/i18n/translations';

for (const lang of ['fr', 'en'] as const) {
  it(`receipt preview (${lang}): exact PDF, student summary, no download before confirmation, cleanup on close`, async () => {
    const win = installDomGlobals();
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    renders.length = 0;
    const downloads: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalClick = win.HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { assert.ok(blob instanceof Blob); blobs.push(blob); return `blob:preview-${blobs.length}`; };
    URL.revokeObjectURL = (url) => { revoked.push(url); };
    win.HTMLAnchorElement.prototype.click = function () { downloads.push(this.getAttribute('download') || ''); };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const opts = {
      lang,
      student: { id: 's1', name: 'Awa Mariam Traoré', grade: '1A', parentName: 'Parent distinct', parentPhone: '', parentEmail: '', totalDue: 100000, amountPaid: 25000, dueDate: '', payments: [], notes: '' },
      payment: { amount: 25000, date: '2026-10-04', receiptNumber: 'REC-PREVIEW' },
      template: readFileSync(new URL('../public/templates/recu-parent.pdf', import.meta.url)),
    };
    try {
      await act(async () => root.render(createElement(ReceiptPreviewModal, { currentTheme: makeProps().currentTheme })));
      await act(async () => { await generatePaymentReceiptPdf(opts); });
      assert.deepEqual(downloads, [], 'opening preview never downloads');
      const preview = getReceiptPreview();
      assert.ok(preview);
      assert.ok(container.querySelector('canvas'));
      assert.equal(blobs.length, 0, 'canvas preview creates no download URL');
      assert.match(container.querySelector('dl')?.textContent || '', /Awa Mariam Traoré/);
      assert.match(container.querySelector('dl')?.textContent || '', /1A/);
      assert.match(container.querySelector('dl')?.textContent || '', /25[\s,]*000 FCFA/);
      assert.ok(!container.textContent?.includes('Parent distinct'));
      assert.deepEqual(renders[0], preview.bytes);
      const close = [...container.querySelectorAll('button')].find(b => b.textContent === translations[lang].close);
      assert.ok(close);
      act(() => close.click());
      assert.equal(container.querySelector('[role="dialog"]') !== null, false);
      assert.deepEqual(downloads, [], 'closing does not download');
      assert.deepEqual(revoked, []);
      await act(async () => { await generatePaymentReceiptPdf(opts); });
      const download = [...container.querySelectorAll('button')].find(b => b.textContent === translations[lang].downloadReceipt);
      assert.ok(download);
      act(() => download.click());
      assert.deepEqual(downloads, ['Recu_REC-PREVIEW_Awa_Mariam_Traoré.pdf']);
      assert.equal(getReceiptPreview(), null);
      assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), renders[1], 'download is the preview PDF, not a regeneration');
    } finally {
      act(() => { closeReceiptPreview(); root.unmount(); });
      container.remove();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      win.HTMLAnchorElement.prototype.click = originalClick;
    }
  });
}
