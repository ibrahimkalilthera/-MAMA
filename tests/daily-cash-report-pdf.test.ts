/**
 * LE PDF DU RAPPORT DE CAISSE, mesuré sur les OCTETS RÉELS.
 *
 * Le générateur est exécuté pour de vrai, puis sa couche texte extraite avec
 * pdf.js : ce que ce cas prouve n'est pas l'intention du code, c'est ce que le
 * document contient — la journée choisie, une ligne par caissier, le total du
 * jour, les annulations avec leur élève et leur montant signé, et le pied de page
 * numéroté. Deux pièges du dépôt y sont verrouillés :
 *
 *   • **les caractères hors WinAnsi** (une police standard de jsPDF est en
 *     Latin-1 étendu) : mesuré sur `pdfPaymentHistory.ts`, le signe « − » de
 *     l'écran s'imprimait « " » et la flèche « → » « !’ ». Aucun ne doit atteindre
 *     ce document-ci ;
 *   • **le formateur de l'écran** (`formatCurrency`, espace insécable U+00A0) doit
 *     traverser la police : le papier chiffre comme la vue.
 *
 * La journée du fixture (30 septembre 2026) n'est PAS celle du jour où le cas
 * tourne : la ligne « Journée : … » ne peut donc pas se confondre avec la date
 * d'édition du document imprimée dans le bandeau.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { formatCurrency } from '../src/lib/formatters';
import { dailyCashReport } from '../src/lib/dailyCashReport';
import { paymentHistoryRows } from '../src/lib/paymentHistory';
import { DEFAULT_PAYMENT_MOTIF, paymentMotifLabel } from '../src/lib/paymentMotifs';
import type { PaymentMotif } from '../src/lib/paymentMotifs';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, Student } from '../src/lib/domainTypes';
import { installDomGlobals } from './harness';

installDomGlobals();
const blobs: Blob[] = [];
const filenames: string[] = [];
const url = globalThis.URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
url.createObjectURL = (blob: Blob) => { blobs.push(blob); return 'blob:probe'; };
url.revokeObjectURL = () => {};
const anchorProto = document.createElement('a').constructor.prototype as unknown as {
  click: (this: HTMLAnchorElement) => void;
};
anchorProto.click = function click() { filenames.push(this.getAttribute('download') ?? ''); };

const { generateDailyCashReportPdf } = await import('../src/lib/pdfDailyCashReport');

const t = translations.fr as TranslationDict;
const DAY = '2026-09-30';

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-09-01', payments: [], notes: '',
};

const pay = (id: string, amount: number, receiptNumber: string, motif?: PaymentMotif): Payment => ({
  id, date: DAY, amount, academicYear: '2026-2027', receiptNumber, motif,
});

const logs: AuditLogEntry[] = [
  {
    id: 'd1',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: alice.id,
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: `${DAY}T08:05:00Z`,
    details: 'Paiement de 6000 FCFA (reçu REC-1)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d1', 6000, 'REC-1'))),
  },
  {
    id: 'd2',
    action: 'DELETE_PAYMENT',
    targetId: 'd1',
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: `${DAY}T09:10:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-1) supprimé — élève Alice Traoré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d1', 4000, 'REC-1'))),
  },
  {
    // Un caissier sans compte : sa ligne porte le libellé de repli, et son geste
    // reste dans le total.
    id: 'd3',
    action: 'RECORD_PAYMENT',
    targetId: alice.id,
    createdAt: `${DAY}T10:00:00Z`,
    details: 'Paiement de 4000 FCFA (reçu REC-2)',
    // Un DROIT D'INSCRIPTION : la journée mêle donc les deux motifs, et le papier
    // doit dire lequel a rapporté quoi.
    metadata: paymentSnapshotMetadata(archivedPaymentFrom(alice.id, alice.name, pay('d3', 4000, 'REC-2', 'inscription'))),
  },
];

const rows = paymentHistoryRows({ logs, students: [alice] });
const report = (day: string, source = rows) => dailyCashReport({ rows: source, day });

/** Le texte de chaque item, espace insécable normalisée (celle de `formatCurrency`). */
const norm = (value: string) => value.replace(/\u00a0/g, ' ');

interface Rendered { filename: string; pages: number; width: number; height: number; items: string[]; texts: string[]; cells: Cell[] }

/** Un item de la couche texte, avec sa position — pour lire une LIGNE du document. */
interface Cell { str: string; x: number; y: number }

async function renderPdf(day: string, lang: 'en' | 'fr' = 'fr', source = rows): Promise<Rendered> {
  blobs.length = 0;
  filenames.length = 0;
  await generateDailyCashReportPdf({ report: report(day, source), formatMoney: formatCurrency, lang });
  assert.equal(blobs.length, 1, 'un rapport, un fichier');

  const bytes = new Uint8Array(await blobs[0].arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-', 'les octets téléchargés sont un PDF');

  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const items: string[] = [];
    const cells: Cell[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        items.push(item.str);
        cells.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
    }
    const viewport = await (await doc.getPage(1)).getViewport({ scale: 1 });
    return {
      filename: filenames[0],
      pages: doc.numPages,
      width: viewport.width,
      height: viewport.height,
      items,
      texts: items.map(norm),
      cells,
    };
  } finally {
    await task.destroy();
  }
}

describe('PDF du rapport de caisse — les octets réels', () => {
  it('sort en portrait, nommé du jour rapporté, avec ses cinq colonnes', async () => {
    const { filename, pages, width, height, items } = await renderPdf(DAY);

    assert.equal(pages, 1, 'une journée de trois gestes tient sur une page');
    assert.ok(height > width, 'le rapport est en PORTRAIT : il se classe dans un classeur');
    assert.equal(filename, 'Rapport_Caisse_2026-09-30.pdf', 'le nom du fichier porte la journée rapportée');

    assert.ok(items.includes(t.dailyCashReportTitle), 'le titre du document est imprimé');
    for (const label of [
      t.dailyCashReportCashier,
      t.dailyCashReportEntries,
      t.dailyCashReportCollected,
      t.dailyCashReportCancelled,
      t.dailyCashReportNet,
    ]) {
      assert.ok(items.includes(label), `la colonne « ${label} » manque au tableau des caissiers`);
    }
  });

  it('nomme la journée rapportée — pas celle de l’imprimante', async () => {
    const { items } = await renderPdf(DAY);
    const expectedLabel = new Date(`${DAY}T00:00:00`).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    assert.ok(
      items.includes(`${t.dailyCashReportDay} : ${expectedLabel}`),
      `la ligne de journée doit porter « ${t.dailyCashReportDay} : ${expectedLabel} »`,
    );
  });

  it('regroupe par caissier et imprime le total du jour tel que l’écran le calcule', async () => {
    const { texts } = await renderPdf(DAY);
    const day = report(DAY);
    const has = (needle: string) => texts.some((text) => text.includes(norm(needle)));

    assert.equal(day.cashiers.length, 2, 'la fixture a deux caissiers (dont un sans compte)');
    assert.ok(has('Aggee Diarra'), 'le caissier nommé est imprimé');
    assert.ok(has(t.roleStaff), 'un geste sans caissier garde sa ligne, sous le libellé de repli');

    // Le total du jour, exactement la phrase de l'écran (mêmes montants, même
    // formateur) : le papier et la carte ne peuvent pas différer.
    assert.ok(
      has(
        t.dailyCashReportTotals
          .replace('{count}', String(day.count))
          .replace('{collected}', formatCurrency(day.collected))
          .replace('{cancelled}', formatCurrency(day.cancelled))
          .replace('{net}', formatCurrency(day.net)),
      ),
      'le total du jour doit être imprimé tel quel',
    );
    assert.ok(has(formatCurrency(6000)), 'l’encaissé du premier caissier est imprimé');
  });

  it('imprime les annulations du jour, signées, avec l’élève et le reçu', async () => {
    const { texts, items } = await renderPdf(DAY);
    const has = (needle: string) => texts.some((text) => text.includes(norm(needle)));

    assert.ok(has(t.dailyCashReportCancellations.replace('{count}', '1')), 'le titre compte les annulations du jour');
    assert.ok(items.includes('REC-1'), 'le reçu annulé est imprimé');
    assert.ok(items.includes('Alice Traoré'), 'l’élève de l’annulation aussi');
    assert.ok(has(`- ${formatCurrency(4000)}`), 'le montant annulé est signé');
    assert.ok(has('page 1/1'), 'le pied de page est numéroté');
    assert.equal(has(t.dailyCashReportNoCancellations), false, 'il y a une annulation : la phrase vide ne doit pas être imprimée');
  });

  it('n’imprime AUCUN caractère absent de la police du document', async () => {
    const { items } = await renderPdf(DAY);
    const unsafe = items.filter((item) => /[\u2212\u2192\u2013\u202f\u2026]/.test(item));
    assert.deepEqual(
      unsafe,
      [],
      'un caractère hors WinAnsi s’imprimerait autrement (mesuré : « − » devient « " »), sans que rien ne le dise',
    );
  });

  it('dit qu’une journée vide n’a rien encaissé, sans rien inventer', async () => {
    const { items, texts } = await renderPdf('2026-09-29', 'fr', []);
    assert.ok(items.includes(t.dailyCashReportEmpty), 'l’absence d’encaissement est écrite');
    assert.ok(items.includes(t.dailyCashReportNoCancellations), 'l’absence d’annulation aussi');
    assert.ok(
      texts.some((text) => text.includes('Total du jour')),
      'le total du jour est imprimé quand même — à zéro, il ne ment pas',
    );
    assert.equal(items.includes('Aggee Diarra'), false, 'aucun caissier n’est inventé');
  });

  // ─── La répartition par MOTIF ──────────────────────────────────────────────
  // Le motif est un fait du REÇU : le papier de la caisse doit nommer ce que
  // chaque motif a rapporté dans la journée, avec ses mots à lui (ceux du reçu
  // remis aux familles), et rappeler le motif du reçu qu'une annulation a défait.
  // Ce cas mesure les OCTETS, et il lit la LIGNE du document — le montant doit
  // être sur la même ligne que le motif qu'il additionne, pas seulement présent.
  it('imprime ce que la journée a encaissé motif par motif, et le motif des annulations', async () => {
    const { items, texts, cells } = await renderPdf(DAY);
    const has = (needle: string) => texts.some((text) => text.includes(norm(needle)));
    /** Le montant de `value` est imprimé SUR LA MÊME LIGNE que `label`. */
    const onLine = (label: string, value: string) => {
      const anchor = cells.find((cell) => cell.str === label);
      if (!anchor) return false;
      const money = norm(value);
      return cells.some((cell) => Math.abs(cell.y - anchor.y) < 1 && norm(cell.str) === money);
    };

    assert.ok(
      has(t.dailyCashReportMotifs.replace('{count}', '2')),
      'le bloc des motifs du jour est titré, et il compte les motifs présents',
    );
    assert.ok(items.includes(t.paymentMotif), 'l’en-tête MOTIF ouvre le tableau des motifs');
    assert.ok(has(formatCurrency(6000)), 'l’encaissé du premier motif est imprimé');

    // La journée a encaissé 6000 en scolarité (dont 4000 annulés) et 4000 en
    // inscription : chaque montant est sur la ligne de SON motif.
    assert.ok(
      onLine(paymentMotifLabel(DEFAULT_PAYMENT_MOTIF, t), formatCurrency(6000)),
      'la scolarité porte l’addition de ses reçus du jour',
    );
    assert.ok(
      onLine(paymentMotifLabel('inscription', t), formatCurrency(4000)),
      'et l’inscription la sienne — le papier ne mélange pas les deux',
    );
    // L'annulation dit AUSSI ce que le reçu réglait : sa ligne porte le motif.
    assert.ok(
      items.filter((item) => item === paymentMotifLabel(DEFAULT_PAYMENT_MOTIF, t)).length >= 2,
      'le motif est répété sur la ligne d’annulation, pas seulement dans la répartition',
    );
  });

  it('suit la langue du poste jusque dans le document', async () => {
    const { items } = await renderPdf(DAY, 'en');
    assert.ok(items.includes('Daily cash report'), 'le titre suit la langue');
    assert.ok(items.includes(translations.en.dailyCashReportCashier), 'les en-têtes de colonnes aussi');
    assert.ok(
      items.some((item) => item.startsWith(`${translations.en.dailyCashReportDay} : `)),
      'la ligne de journée garde son libellé anglais',
    );
  });
});
