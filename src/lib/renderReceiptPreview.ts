import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export function renderReceiptPreview(bytes: Uint8Array, canvas: HTMLCanvasElement): { done: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  const done = (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (cancelled) return;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    if (cancelled) return;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    const viewport = page.getViewport({ scale: 2 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
  })();
  return { done, cancel: () => { cancelled = true; void task?.destroy(); } };
}
