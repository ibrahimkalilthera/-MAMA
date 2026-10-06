/**
 * L'EXPORT DE L'HISTORIQUE DES PAIEMENTS — le CSV et le PDF de la vue FILTRÉE.
 *
 * La demande portait sur le point qui pouvait le plus mal tourner : « en
 * respectant les filtres actifs (période, action, recherche) ». Un export qui
 * refiltre pour son compte, ou qui exporte la liste complète en laissant croire
 * qu'elle est filtrée, produit un document qu'un comptable croira — et c'est
 * pire qu'un export absent. Les cas ci-dessous mesurent donc trois choses :
 *
 *   1. le CSV se construit sur les lignes qu'on lui donne, et sur elles seules —
 *      le filtre réel (`filterPaymentHistory`) appliqué en amont suffit à
 *      restreindre le fichier ;
 *   2. ses colonnes sont CELLES DE L'ÉCRAN, dans son ordre, montants signés et
 *      renvoi au détail compris ;
 *   3. le PDF imprime la MÊME phrase que l'écran sur ses filtres actifs, et
 *      porte le cachet de l'école une seule fois.
 *
 * jsPDF ne tourne pas sous happy-dom : le générateur est exécuté pour de vrai
 * contre un faux jsPDF qui n'imprime pas — il ENREGISTRE chaque texte dessiné avec
 * sa position. C'est ce qui permet d'affirmer la COLONNE où chaque valeur tombe :
 * un montant imprimé sous l'en-tête « DÉTAILS » serait faux sans qu'un test de
 * contenu le voie.
 *
 * Le module d'export, lui, est PUR : il se mesure sans DOM, sans PDF et sans
 * téléchargement.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { AuditLogEntry } from '../src/lib/auditLogger';
import {
  filterPaymentHistory,
  paymentHistoryRows,
  paymentHistorySummary,
} from '../src/lib/paymentHistory';
import { archivedPaymentFrom, paymentSnapshotMetadata } from '../src/lib/paymentUndo';
import {
  PAYMENT_HISTORY_CSV_MIME,
  buildPaymentHistoryCsv,
  describePaymentHistoryFilter,
  paymentHistoryColumnLabels,
  paymentHistoryCsvBytes,
  paymentHistoryExportFilename,
} from '../src/lib/paymentHistoryExport';
import type { PaymentHistoryExportContext } from '../src/lib/paymentHistoryExport';
import type { Payment, Student } from '../src/lib/domainTypes';
import { mockModule } from './module-mock';

const t = translations.fr as TranslationDict;

// ── faux jsPDF : il n'imprime pas, il enregistre ────────────────────────────
interface TextCall { str: string; x: number; y: number }
const texts: TextCall[] = [];
const downloads: { filename: string; bytes: Uint8Array | ArrayBuffer }[] = [];
let stampDraws = 0;

class FakeJsPDF {
  private page = 1;
  addPage(): void { this.page += 1; }
  getNumberOfPages(): number { return this.page; }
  setPage(): void {}
  setFillColor(): void {}
  setDrawColor(): void {}
  setTextColor(): void {}
  setFont(): void {}
  setFontSize(): void {}
  rect(): void {}
  roundedRect(): void {}
  line(): void {}
  splitTextToSize(text: string): string[] { return [text]; }
  text(str: string | string[], x: number, y: number): void {
    for (const s of Array.isArray(str) ? str : [str]) texts.push({ str: s, x, y });
  }
  output(): ArrayBuffer { return new ArrayBuffer(8); }
}

mockModule('jspdf', { jsPDF: FakeJsPDF });
// Le cachet et le téléchargement ne sont pas ce qu'on mesure ici — et leur
// chargement réseau rendrait les cas dépendants de la ligne du poste.
mockModule('../src/lib/pdfStamp', { drawSchoolStamp: async () => { stampDraws += 1; } });
mockModule('../src/lib/browserDownload', {
  downloadBytes: (bytes: Uint8Array | ArrayBuffer, filename: string) => { downloads.push({ filename, bytes }); },
});

const { generatePaymentHistoryPdf } = await import('../src/lib/pdfPaymentHistory');

// ── fixtures : le même historique que la suite de la vue ────────────────────
const alice: Student = {
  id: 'st1', name: 'Alice Traoré', grade: '6B', parentName: '', parentEmail: '', parentPhone: '',
  totalDue: 0, amountPaid: 0, dueDate: '2026-10-01', payments: [], notes: '',
};

const PAY: Payment = { id: 'pay1', date: '2026-10-02', amount: 4000, academicYear: '2026-2027', receiptNumber: 'REC-568556' };

const logs: AuditLogEntry[] = [
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
  {
    // Le geste d'AVANT l'instantané : montant seulement dans la phrase, ce que la
    // colonne MONTANT doit DIRE au lieu de le deviner.
    id: 'p2',
    action: 'RECORD_PAYMENT',
    targetId: 'st1',
    userName: 'Aggee Diarra',
    createdAt: '2026-09-20T09:00:00Z',
    details: 'Paiement de 6000 FCFA (reçu REC-0)',
  },
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
    // Une phrase HORS gabarit : le montant n'existe nulle part, et l'export doit
    // le DIRE au lieu de deviner — c'est la seule branche qui renvoie au détail.
    id: 'p3',
    action: 'RECORD_PAYMENT',
    targetId: 'st1',
    userName: 'Moussa Keïta',
    createdAt: '2026-08-01T09:00:00Z',
    details: 'Paiement restauré',
  },
  { id: 'x1', action: 'ADD_STUDENT', userName: 'Admin', createdAt: '2026-10-06T09:00:00Z', details: 'Fatou BOLLY' },
];

const rows = paymentHistoryRows({ logs, students: [alice] });
const context: PaymentHistoryExportContext = {
  t,
  lang: 'fr',
  formatMoney: (amount: number) => `${amount} XOF`,
};

/** Le CSV d'une liste de lignes, découpé : la première ligne est l'en-tête. */
const csvLines = (list = rows) => buildPaymentHistoryCsv(list, context).split('\r\n');

describe('export CSV — les colonnes de l’écran, et rien d’autre', () => {
  it('écrit l’en-tête de l’écran, puis une ligne par geste', () => {
    const lines = csvLines();
    assert.equal(lines.length, 1 + rows.length, 'en-tête + une ligne par geste');

    const header = lines[0];
    for (const label of paymentHistoryColumnLabels(t)) {
      assert.ok(header.includes(`"${label}"`), `la colonne « ${label} » manque à l’en-tête`);
    }
    // Les sept libellés viennent du dictionnaire, pas d'une chaîne recopiée.
    assert.ok(header.includes(`"${t.timestamp}"`) && header.includes(`"${t.receipt}"`));
    assert.ok(header.includes(`"${t.paymentHistoryCollectedBy}"`), 'la colonne qui nomme l’encaisseur est là');
    assert.equal(header.split(',').length, 7, 'sept colonnes, comme le tableau de l’écran');
  });

  it('signe une annulation, CHIFFRE une phrase lisible et renvoie au détail pour le reste', () => {
    const csv = buildPaymentHistoryCsv(rows, context);
    // Le signe est le trait d'union ASCII : le « − » de l'écran n'est pas
    // représentable dans la police WinAnsi du PDF, et l'export doit dire la même
    // chose des deux côtés (voir l'en-tête du module).
    assert.ok(csv.includes('"- 4000 XOF"'), 'l’annulation garde son signe, comme à l’écran');
    // Le geste d'avant l'instantané (REC-0, 6000 FCFA) : sa phrase porte le gabarit
    // du dépôt, donc le fichier le chiffre au lieu de renvoyer au détail.
    assert.ok(csv.includes('"6000 XOF"'), 'un geste sans instantané est chiffré depuis sa phrase');
    assert.ok(csv.includes('"REC-0"'), 'et son reçu se relit de la même phrase');
    assert.ok(csv.includes(`"${t.paymentHistoryAmountInDetails}"`), 'une phrase HORS gabarit renvoie, elle, au détail');
    assert.ok(csv.includes('"Moussa Keïta"'), 'l’encaisseur est nommé');
    assert.ok(csv.includes(`"${t.auditActionDeletePayment}"`), 'le geste est libellé, pas son code');
    assert.doesNotMatch(csv, /DELETE_PAYMENT|RECORD_PAYMENT/, 'aucun code brut ne part dans le fichier');
    assert.doesNotMatch(csv, /Fatou BOLLY/, 'un geste qui n’est pas un paiement n’entre pas dans l’export');
  });

  it('suit le filtre appliqué à l’écran — l’export ne refiltre jamais pour son compte', () => {
    const cancelled = filterPaymentHistory(rows, { action: 'DELETE_PAYMENT' });
    const csv = buildPaymentHistoryCsv(cancelled, context);
    assert.equal(cancelled.length, 1, 'le filtre de l’écran ne garde que l’annulation');
    assert.equal(csv.split('\r\n').length, 2, 'en-tête + la seule ligne filtrée');
    assert.ok(csv.includes('Moussa Keïta'), 'l’auteur de l’annulation reste lisible');
    assert.doesNotMatch(csv, /Aggee Diarra/, 'une ligne écartée par le filtre ne part PAS dans le fichier');

    // Le filtre de période, sur le même historique : les deux gestes d'octobre,
    // pas celui de septembre.
    const ranged = filterPaymentHistory(rows, { from: '2026-10-01', to: '2026-10-31' });
    assert.equal(ranged.length, 2);
    assert.equal(buildPaymentHistoryCsv(ranged, context).split('\r\n').length, 3);
  });

  it('double les guillemets, sépare par CRLF et commence par le BOM attendu par le tableur', () => {
    const quoted = paymentHistoryRows({
      logs: [{ id: 'q1', action: 'RECORD_PAYMENT', targetId: 'st1', userName: 'A "B" C', createdAt: '2026-10-02T09:00:00Z', details: 'x' }],
      students: [alice],
    });
    const csv = buildPaymentHistoryCsv(quoted, context);
    assert.ok(csv.includes('"A ""B"" C'), 'un guillemet dans un nom ne casse pas la ligne');
    assert.equal(csv.split('\n').length, 2, 'deux lignes : aucune cellule ne contient de saut de ligne brut');

    const bytes = paymentHistoryCsvBytes('a,b');
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'le BOM est écrit avant le contenu');
    assert.equal(PAYMENT_HISTORY_CSV_MIME, 'text/csv;charset=utf-8');
    assert.equal(paymentHistoryExportFilename('csv', '2026-10-06'), 'Historique_Paiements_2026-10-06.csv');
    assert.equal(paymentHistoryExportFilename('pdf', '2026-10-06'), 'Historique_Paiements_2026-10-06.pdf');
  });
});

describe('la phrase des filtres actifs — un document imprimé doit se relire seul', () => {
  it('dit qu’il n’y a AUCUN filtre quand il n’y en a pas', () => {
    assert.equal(describePaymentHistoryFilter(undefined, t, 'fr'), t.paymentHistoryPdfNoFilter);
    assert.equal(describePaymentHistoryFilter({}, t, 'fr'), t.paymentHistoryPdfNoFilter);
    assert.equal(
      describePaymentHistoryFilter({ action: 'all', from: '', to: '', search: '   ' }, t, 'fr'),
      t.paymentHistoryPdfNoFilter,
      'un filtre « toutes les actions » n’écarte rien : il n’est pas annoncé comme un filtre',
    );
  });

  it('nomme la période, l’action et la recherche — dans la langue du poste', () => {
    const note = describePaymentHistoryFilter(
      { action: 'DELETE_PAYMENT', from: '2026-10-01', to: '2026-10-05', search: 'awa' },
      t,
      'fr',
    );
    assert.ok(note.includes(t.paymentHistoryPdfPeriod), 'la période est nommée');
    assert.ok(note.includes('01/10/2026') && note.includes('05/10/2026'), 'ses deux bornes sont écrites');
    assert.ok(note.includes(t.auditActionDeletePayment), 'l’action est écrite comme la colonne ACTIONS l’écrit');
    assert.ok(note.includes(`« awa »`), 'la recherche est citée telle qu’elle a été saisie');

    const english = describePaymentHistoryFilter({ from: '2026-10-01' }, translations.en as TranslationDict, 'en');
    assert.ok(/10\/0?1\/2026/.test(english), 'la borne suit la locale du document');
    assert.match(english, /10\/0?1\/2026 — —/, 'une seule borne se lit quand même, l’autre reste vide');
  });
});

describe('le PDF de l’historique — mêmes lignes, mêmes filtres, cachet une fois', () => {
  const at = (str: string, x: number) => texts.some((call) => call.str === str && call.x === x);

  async function run(filter: Parameters<typeof describePaymentHistoryFilter>[0] = undefined) {
    texts.length = 0;
    downloads.length = 0;
    stampDraws = 0;
    const viewRows = filterPaymentHistory(rows, filter ?? {});
    await generatePaymentHistoryPdf({
      rows: viewRows,
      summary: paymentHistorySummary(viewRows),
      filter,
      formatMoney: context.formatMoney,
      lang: 'fr',
    });
    return viewRows;
  }

  it('imprime le titre, la phrase des filtres, le résumé et une colonne par champ', async () => {
    // Les trois filtres à la fois : seul le geste d'annulation les passe tous
    // (l'action, la période d'octobre, et une recherche sur le nom de l'élève).
    const filter = { action: 'DELETE_PAYMENT' as const, from: '2026-10-01', to: '2026-10-31', search: 'alice' };
    const viewRows = await run(filter);

    assert.equal(downloads.length, 1, 'un document, un téléchargement');
    assert.match(downloads[0].filename, /^Historique_Paiements_\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.equal(stampDraws, 1, 'le cachet est posé une seule fois');

    assert.ok(texts.some((c) => c.str === t.paymentHistoryPdfTitle), 'le titre du document est imprimé');
    const note = texts.find((c) => c.str.includes(t.paymentHistoryPdfActiveFilters.replace('{filters}', '')));
    assert.ok(note, 'les filtres actifs sont imprimés en tête');
    assert.ok(note!.str.includes(t.auditActionDeletePayment) && note!.str.includes('« alice »'));
    assert.ok(
      texts.some((c) => c.str.includes(t.paymentHistoryTotals.replace('{count}', String(viewRows.length)).slice(0, 20))),
      'le résumé de la caisse suit les lignes affichées',
    );

    // Les colonnes tombent là où l'en-tête les annonce : le montant sous son
    // libellé, le détail à sa place, et la valeur de l'annulation signée.
    assert.ok(at(t.receipt, 170), 'l’en-tête REÇU est dans sa colonne');
    assert.ok(at('REC-568556', 170), 'le numéro de reçu est dans cette colonne');
    // Le montant est aligné à DROITE : son abscisse enregistrée est le bord droit
    // de la colonne, le même que son en-tête (166 mm).
    assert.ok(texts.some((c) => c.x === 166 && c.str === '- 4000 XOF'), 'le montant signé est sous MONTANT');
    assert.ok(texts.some((c) => c.x === 242 && c.str.includes('Alice Traoré')), 'le détail reste dans sa colonne');
    assert.ok(texts.some((c) => c.str.includes('page 1/1')), 'le pied de page est numéroté');
  });

  it('dit « aucun filtre » et n’imprime aucune ligne quand rien n’est filtré pour de bon', async () => {
    await run(undefined);
    assert.ok(
      texts.some((c) => c.str.includes(t.paymentHistoryPdfNoFilter)),
      'sans filtre, le document le dit au lieu de rester muet',
    );
    assert.ok(texts.some((c) => c.str.includes('Aggee Diarra')), 'la liste complète, elle, est bien là');
  });
});
