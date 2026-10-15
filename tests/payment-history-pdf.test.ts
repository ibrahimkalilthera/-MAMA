/**
 * LE PDF DE L'HISTORIQUE DES PAIEMENTS, mesuré sur les OCTETS RÉELS.
 *
 * Sa suite sœur (`payment-history-export.test.ts`) exécute le générateur contre un
 * faux jsPDF : elle prouve les colonnes, la phrase des filtres et la signature des
 * appels — mais pas que le VRAI jsPDF les accepte, ni qu'une valeur imprimée y
 * SURVIT telle quelle. Le dépôt a payé cette leçon : une police standard de jsPDF
 * est encodée en WinAnsi (Latin-1 étendu), et ce qu'elle ne porte pas s'imprime
 * quand même — autrement. Mesuré ici, sur le document réel :
 *
 *   • le signe moins typographique de l'écran (« − », U+2212) sortait « " » : le
 *     document imprimait `" 4000 XOF`, et rien ne le disait ;
 *   • la flèche « → » (U+2192) sortait « !’ » dans la phrase des filtres.
 *
 * Ces deux caractères ont donc été écartés de l'export, et le présent cas les
 * INTERDIT : réintroduire l'un ou l'autre rougit ici avant d'atteindre une
 * imprimante. Le reste des faits (paysage, une page, sept colonnes, phrase des
 * filtres recopiée du dictionnaire, pied de page numéroté) est vérifié sur la
 * couche texte extraite par pdf.js — pas sur l'intention du code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { formatCurrency } from '../src/lib/formatters';
import { filterPaymentHistory, paymentHistoryRows, paymentHistorySummary } from '../src/lib/paymentHistory';
import { describePaymentHistoryFilter } from '../src/lib/paymentHistoryExport';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import type { Payment, Student } from '../src/lib/domainTypes';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import { archivedSalaryFrom, salarySnapshotMetadata } from '../src/lib/salaryUndo';
import { correctionHistoryRows } from '../src/lib/correctionHistory';
import { installDomGlobals } from './harness';

installDomGlobals();
const blobs: Blob[] = [];
const filenames: string[] = [];
const url = globalThis.URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
url.createObjectURL = (blob: Blob) => { blobs.push(blob); return 'blob:probe'; };
url.revokeObjectURL = () => {};
// Le clic du lien est neutralisé : on mesure le NOM et les OCTETS, pas la navigation.
const anchorProto = document.createElement('a').constructor.prototype as unknown as {
  click: (this: HTMLAnchorElement) => void;
};
anchorProto.click = function click() { filenames.push(this.getAttribute('download') ?? ''); };

const { generatePaymentHistoryPdf } = await import('../src/lib/pdfPaymentHistory');

const PAY: Payment = { id: 'pay1', date: '2026-10-02', amount: 4000, academicYear: '2026-2027', receiptNumber: 'REC-568556', motif: 'inscription' };

const logs: AuditLogEntry[] = [
  {
    id: 'c1',
    action: 'DELETE_PAYMENT',
    targetId: 'pay1',
    userName: 'Moussa Keïta',
    createdAt: '2026-10-05T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556) du 2026-10-02 supprimé — élève Alice Traoré',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
  {
    id: 'p1',
    action: 'RECORD_PAYMENT',
    targetType: 'payment',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    userEmail: 'aggee@mama.test',
    userRole: 'econome',
    createdAt: '2026-10-02T09:00:00Z',
    details: 'Paiement de 4000 FCFA (reçu REC-568556)',
    metadata: paymentSnapshotMetadata(archivedPaymentFrom('st1', 'Alice Traoré', PAY)),
  },
];

const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

/**
 * Les GESTES DE CORRECTION imprimés à côté des reçus : une paie retirée (montant
 * et membre dans l'instantané) et la MÊME paie rétablie — le journal ne se réécrit
 * jamais, donc les deux gestes se lisent dans l'ordre où ils ont eu lieu.
 *
 * Ils vivent dans leur propre fixture : les cas ci-dessus mesurent le document des
 * ENCAISSEMENTS, et leur ajouter des lignes de salaire aurait changé ce qu'ils
 * prouvent (le nombre de pages, la place des colonnes).
 */
const SALARY_AMOUNT = 150000;
const salarySnapshot = salarySnapshotMetadata(archivedSalaryFrom('t1', 'Awa Sy', {
  id: 'sp1', staffId: 't1', amount: SALARY_AMOUNT, date: '2026-01-31', academicYear: '2026-2027',
}));
const correctionLogs: AuditLogEntry[] = [
  {
    id: 'sal1',
    action: 'DELETE_SALARY_PAYMENT',
    targetType: 'salary_payment',
    targetId: 'sp1',
    userName: 'Moussa Keïta',
    userEmail: 'moussa@mama.test',
    userRole: 'general_manager',
    createdAt: '2026-10-07T09:00:00Z',
    details: 'Salaire de 150000 FCFA (2026-01-31) supprimé — membre Awa Sy',
    metadata: salarySnapshot,
  },
  {
    id: 'sal2',
    action: 'RESTORE_SALARY_PAYMENT',
    targetType: 'salary_payment',
    targetId: 'sp1',
    userName: 'Moussa Keïta',
    createdAt: '2026-10-07T10:00:00Z',
    details: 'Salaire de 150000 FCFA (2026-01-31) rétabli — membre Awa Sy',
    metadata: salarySnapshot,
  },
];

interface Item { str: string; x: number; y: number }

/** Le formateur simple des cas : les montants s'y lisent sans ambiguïté d'espace. */
const plainMoney = (amount: number) => `${amount} XOF`;

/** Génère le VRAI document et rend ce que sa couche texte contient, item par item. */
async function renderPdf(
  filter: Parameters<typeof describePaymentHistoryFilter>[0],
  lang: 'en' | 'fr' = 'fr',
  formatMoney: (amount: number) => string = plainMoney,
  correctionLogList: AuditLogEntry[] = [],
): Promise<{ filename: string; width: number; height: number; pages: number; items: Item[] }> {
  blobs.length = 0;
  filenames.length = 0;
  const rows = paymentHistoryRows({ logs, students: [alice] });
  const viewRows = filterPaymentHistory(rows, filter ?? {});
  await generatePaymentHistoryPdf({
    rows: viewRows,
    summary: paymentHistorySummary(viewRows),
    filter,
    corrections: correctionHistoryRows({ logs: correctionLogList }),
    formatMoney,
    lang,
  });
  assert.equal(blobs.length, 1, 'un export PDF, un fichier');

  const bytes = new Uint8Array(await blobs[0].arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-', 'les octets téléchargés sont un PDF');

  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const items: Item[] = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
      }
    }
    const viewport = await (await doc.getPage(1)).getViewport({ scale: 1 });
    return { filename: filenames[0], width: viewport.width, height: viewport.height, pages: doc.numPages, items };
  } finally {
    await task.destroy();
  }
}

const at = (items: Item[], str: string) => items.find((item) => item.str === str);
/** La même colonne que l'en-tête, à la tolérance d'arrondi de l'extraction. */
const sameColumn = (value: Item | undefined, header: Item | undefined) =>
  Boolean(value && header && Math.abs(value.x - header.x) < 2);

describe('PDF de l’historique — les octets réels', () => {
  const t = translations.fr as TranslationDict;

  it('sort en paysage, sur une seule page, avec ses huit colonnes', async () => {
    const { filename, width, height, pages, items } = await renderPdf({ from: '2026-10-01', to: '2026-10-31' });

    assert.equal(pages, 1, 'deux gestes tiennent sur une page');
    assert.ok(width > height, 'le document est en PAYSAGE : sept colonnes ne tiennent pas en portrait');
    assert.ok(Math.abs(width - 842) < 1 && Math.abs(height - 595) < 1, 'A4 paysage');
    assert.match(filename, /^Historique_Paiements_\d{4}-\d{2}-\d{2}\.pdf$/, 'le fichier remis au poste est nommé');

    for (const label of [
      t.timestamp,
      t.studentName,
      t.actions,
      t.amount2,
      t.receipt,
      t.paymentMotif,
      t.paymentHistoryCollectedBy,
      t.details,
    ]) {
      assert.ok(at(items, label), `la colonne « ${label} » manque à l’en-tête du document`);
    }
    assert.ok(at(items, t.paymentHistoryPdfTitle), 'le titre du document est imprimé');
  });

  it('imprime la phrase des filtres ACTIFS telle que l’écran la calcule', async () => {
    const filter = { from: '2026-10-01', to: '2026-10-31', action: 'DELETE_PAYMENT' as const, search: 'alice' };
    const { items } = await renderPdf(filter);

    const expected = t.paymentHistoryPdfActiveFilters.replace(
      '{filters}',
      describePaymentHistoryFilter(filter, t, 'fr'),
    );
    assert.ok(at(items, expected), `le document doit porter « ${expected} »`);
    assert.ok(expected.includes(t.auditActionDeletePayment) && expected.includes('« alice »'));

    const bare = await renderPdf(undefined);
    assert.ok(
      at(bare.items, t.paymentHistoryPdfActiveFilters.replace('{filters}', t.paymentHistoryPdfNoFilter)),
      'sans filtre, le document le DIT au lieu de rester muet',
    );
  });

  it('signe une annulation d’un caractère que la police WinAnsi PORTE', async () => {
    const { items } = await renderPdf({ action: 'DELETE_PAYMENT' });

    assert.ok(at(items, '- 4000 XOF'), 'le montant annulé est imprimé, signé');
    // Le contrôle qui compte : AUCUN caractère hors WinAnsi ne doit atteindre la
    // couche texte — c'est ainsi que « − » devenait « " » et « → » « !’ ».
    const unsafe = items.filter((item) => /[\u2212\u2192\u2013\u202f\u2026]/.test(item.str)).map((item) => item.str);
    assert.deepEqual(unsafe, [], 'un caractère absent de la police s’imprimerait autrement, sans que rien ne le dise');
  });

  it('le formateur de montants de l’écran traverse la police du document', async () => {
    // `formatCurrency` (celui que la vue passe au générateur) écrit une espace
    // insécable U+00A0 — la seule espace de Latin-1 : le cas prouve que le
    // montant imprimé est bien CELUI de l'écran, à l'espace près.
    const { items } = await renderPdf({ action: 'RECORD_PAYMENT' }, 'fr', formatCurrency);
    const screen = formatCurrency(4000).replace(/\u00a0/g, ' ');
    assert.ok(
      items.some((item) => item.str.replace(/\u00a0/g, ' ') === screen),
      `le montant « ${screen} » doit être imprimé tel que l’écran l’écrit`,
    );
  });

  it('range chaque valeur dans la colonne de son en-tête', async () => {
    const { items } = await renderPdf({ from: '2026-10-01', to: '2026-10-31' });

    assert.ok(sameColumn(at(items, 'Alice Traoré (6B)'), at(items, t.studentName)), 'l’élève est sous ÉLÈVE');
    assert.ok(sameColumn(at(items, 'REC-568556'), at(items, t.receipt)), 'le reçu est sous N° REÇU');
    assert.ok(
      sameColumn(at(items, 'Inscription'), at(items, t.paymentMotif)),
      'le motif du reçu est sous son en-tête, à côté du numéro qu’il qualifie',
    );
    assert.ok(sameColumn(at(items, 'Paiement supprimé'), at(items, t.actions)), 'le geste est sous ACTIONS');
    assert.ok(
      sameColumn(at(items, 'Moussa Keïta'), at(items, t.paymentHistoryCollectedBy)),
      'l’encaisseur est sous ENCAISSÉ PAR',
    );
    const amountHeader = at(items, t.amount2)!;
    const amount = at(items, '- 4000 XOF')!;
    assert.ok(amount.x + 5 >= amountHeader.x, 'le montant est aligné à droite, dans la colonne MONTANT');
    assert.ok(
      items.some((item) => item.x > 600 && item.str.includes('REC-568556')),
      'le détail (qui cite le reçu) reste dans la dernière colonne',
    );
    assert.ok(items.some((item) => item.str.includes('page 1/1')), 'le pied de page est numéroté');
  });

  it('imprime les corrections — signe compris — sans toucher aux encaissements', async () => {
    const bare = await renderPdf(undefined);
    const { items, pages } = await renderPdf(undefined, 'fr', plainMoney, correctionLogs);

    assert.equal(pages, bare.pages, 'la section des corrections ne déplace pas les encaissements sur une autre page');
    assert.ok(
      at(items, t.paymentHistoryCorrectionsNote.replace('{count}', '2')),
      'la section s’annonce AVANT de lister, sinon un lecteur additionnerait les deux blocs',
    );
    assert.ok(at(items, t.auditActionDeleteSalaryPayment), 'le retrait du salaire est imprimé');
    assert.ok(at(items, t.auditActionRestoreSalaryPayment), 'le rétablissement de la MÊME paie aussi');
    assert.ok(
      sameColumn(at(items, 'Awa Sy'), at(items, t.studentName)),
      'le membre tombe dans la colonne ÉLÈVE, là où un reçu met l’élève',
    );
    // Un montant RETIRÉ est signé, un montant RÉTABLI ne l'est pas : le signe dit
    // le sens du geste, et le trait d'union ASCII est celui que WinAnsi porte.
    assert.ok(items.some((item) => item.str === `- ${SALARY_AMOUNT} XOF`), 'le montant retiré est imprimé, signé');
    assert.ok(items.some((item) => item.str === `${SALARY_AMOUNT} XOF`), 'le montant rétabli est imprimé, sans signe');

    // Le contrôle de police, sur CE document : un caractère absent de WinAnsi
    // s'imprimerait autrement (mesuré : « − » sortait « " »).
    const unsafe = items.filter((item) => /[\u2212\u2192\u2013\u202f\u2026]/.test(item.str)).map((item) => item.str);
    assert.deepEqual(unsafe, [], 'aucun caractère hors de la police du document');

    // La preuve qui compte pour la caisse : rien de ce que le document SANS
    // corrections imprimait ne change — le net, les reçus et le pied de page sont
    // les mêmes textes, à l'identique.
    const before = bare.items.map((item) => item.str);
    const missing = before.filter((str) => !items.some((item) => item.str === str));
    assert.deepEqual(missing, [], 'les encaissements et le net imprimé ne bougent pas quand on ajoute des corrections');
  });

  it('suit la langue du poste jusque dans le document', async () => {
    const { items } = await renderPdf(undefined, 'en');
    assert.ok(at(items, 'PAYMENT HISTORY'), 'le titre suit la langue');
    assert.ok(at(items, translations.en.timestamp), 'les en-têtes de colonnes aussi');
    assert.ok(
      at(
        items,
        translations.en.paymentHistoryPdfActiveFilters.replace('{filters}', translations.en.paymentHistoryPdfNoFilter),
      ),
      'la phrase d’absence de filtre aussi, avec son libellé anglais',
    );
  });
});
