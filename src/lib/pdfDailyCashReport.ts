/**
 * ─── Le rapport de caisse du jour, sur la feuille qu'on fait signer ──────────
 *
 * La carte de l'écran donne la journée ; ce document est celui qu'on imprime et
 * qu'on classe en fermant la caisse. Il reçoit le rapport DÉJÀ CALCULÉ
 * (`dailyCashReport`) au lieu de le recalculer : le papier et l'écran ne peuvent
 * donc pas afficher deux totaux différents pour la même soirée, et le jour qu'ils
 * nomment est celui que la carte avait choisi, pas celui de l'imprimante.
 *
 * Quatre décisions, et elles décident du reste :
 *
 *   • **portrait**, contrairement au PDF de l'historique : cinq colonnes de
 *     synthèse tiennent à l'aise, et un rapport de caisse se glisse dans un
 *     classeur, pas sur un bureau.
 *   • **ce qui n'est pas chiffré est DIT** : quand un caissier a des gestes sans
 *     montant structuré, la mention de total partiel est imprimée sous le tableau
 *     — un total silencieusement incomplet serait pire que pas de total.
 *   • **les caractères restent dans la police** : mesuré sur les PDF réels du
 *     dépôt, une police standard de jsPDF est en WinAnsi, donc le signe « − » de
 *     l'écran et la flèche « → » n'y survivent pas (`pdfPaymentHistory.ts` porte
 *     la mesure complète). Le signe d'un net négatif est donc le trait d'union
 *     ASCII, que les tableurs lisent d'ailleurs comme un signe.
 *   • **il sort par le SEUL émetteur de téléchargement** (`downloadBytes`) et pose
 *     le cachet de l'école SOUS le contenu, jamais par-dessus une ligne.
 */
import type { DailyCashReport } from './dailyCashReport';
import { downloadBytes } from './browserDownload';
import { drawSchoolStamp } from './pdfStamp';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface DailyCashReportPdfOptions {
  /** Le rapport de la journée (calculé par `dailyCashReport`, jamais recomposé ici). */
  report: DailyCashReport;
  /** Le formateur de montants de l'écran — le papier et la vue chiffrent pareil. */
  formatMoney: (amount: number) => string;
  lang?: 'en' | 'fr';
}

/** Couleurs alignées sur la carte d'écran (emerald / slate / rose). */
const BANNER_RGB: [number, number, number] = [6, 95, 70];
const HEADER_FILL_RGB: [number, number, number] = [241, 245, 249];
const TOTAL_FILL_RGB: [number, number, number] = [236, 253, 245];
const ROW_LINE_RGB: [number, number, number] = [226, 232, 240];
const HEADER_INK_RGB: [number, number, number] = [51, 65, 85];
const INK_RGB: [number, number, number] = [15, 23, 42];
const MUTED_INK_RGB: [number, number, number] = [100, 116, 139];
const MONEY_INK_RGB: [number, number, number] = [6, 95, 70];
const CANCEL_INK_RGB: [number, number, number] = [159, 18, 57];
/** Le cachet : 24 mm, comme les autres documents A4 du dépôt. */
const STAMP_DIAMETER = 24;

/** Page A4 portrait, en millimètres. */
const PAGE_WIDTH = 210;
const MARGIN = 14;
/** L'abscisse du centre du cachet. */
const CENTER_X = PAGE_WIDTH / 2;
/** En dessous de cette ordonnée, une ligne de tableau reste sur la page. */
const ROW_LIMIT = 250;
/** L'ordonnée du pied de page numéroté. */
const FOOTER_Y = 291;

/** Les bords droits des cinq colonnes du tableau des caissiers. */
const CASHIER_COLUMNS = { entries: 100, collected: 130, cancelled: 160, net: 196 };
/** Les abscisses des cinq colonnes de la liste des annulations. */
const CANCEL_COLUMNS = [14, 48, 76, 164];
/** Le bord droit de la colonne MONTANT des annulations. */
const CANCEL_AMOUNT_X = 160;

/** Un montant signé, dans les caractères que la police WinAnsi porte vraiment. */
function signedNet(net: number, formatMoney: (amount: number) => string): string {
  return net < 0 ? `- ${formatMoney(-net)}` : formatMoney(net);
}

export async function generateDailyCashReportPdf({
  report,
  formatMoney,
  lang = 'fr',
}: DailyCashReportPdfOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  /** La journée du rapport, écrite en toutes lettres (et non recopiée en ISO). */
  const dayMs = Date.parse(`${report.day}T00:00:00`);
  const dayLabel = Number.isFinite(dayMs)
    ? new Date(dayMs).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : report.day;

  // 1. Bandeau
  doc.setFillColor(...BANNER_RGB);
  doc.rect(0, 0, PAGE_WIDTH, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', MARGIN, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(t.dailyCashReportTitle, MARGIN, 19);
  doc.setFontSize(8);
  doc.text(
    `${t.pdfGeneratedOn} ${new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    PAGE_WIDTH - MARGIN,
    11,
    { align: 'right' },
  );

  // 2. La journée et le total, en tête — ce que l'écran dit au-dessus du tableau.
  let y = 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK_RGB);
  doc.text(`${t.dailyCashReportDay} : ${dayLabel}`, MARGIN, y);
  y += 6;

  doc.setFillColor(...TOTAL_FILL_RGB);
  doc.setDrawColor(...ROW_LINE_RGB);
  const totalsText = t.dailyCashReportTotals
    .replace('{count}', String(report.count))
    .replace('{collected}', formatMoney(report.collected))
    .replace('{cancelled}', formatMoney(report.cancelled))
    .replace('{net}', signedNet(report.net, formatMoney));
  const totalsLines = doc.splitTextToSize(totalsText, PAGE_WIDTH - MARGIN * 2 - 8) as string[];
  const totalsHeight = Math.max(8, totalsLines.length * 4 + 4);
  doc.roundedRect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, totalsHeight, 2, 2, 'FD');
  doc.setFontSize(8.5);
  doc.setTextColor(...MONEY_INK_RGB);
  doc.text(totalsLines, MARGIN + 4, y + 5.5);
  y += totalsHeight + 3;

  if (report.withoutAmount > 0) {
    // Le total du jour est PARTIEL, et le document le dit (la même phrase qu'à
    // l'écran) : un net incomplet qui se tairait serait pire que pas de net.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(180, 83, 9);
    doc.text(t.paymentHistoryWithoutAmount.replace('{count}', String(report.withoutAmount)), MARGIN, y);
    y += 4;
  }
  y += 2;

  // 3. Le tableau des caissiers — un par caissier, encaissé décroissant.
  const drawCashierHeader = () => {
    doc.setFillColor(...HEADER_FILL_RGB);
    doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...HEADER_INK_RGB);
    doc.text(t.dailyCashReportCashier, MARGIN + 2, y + 4.8);
    doc.text(t.dailyCashReportEntries, CASHIER_COLUMNS.entries, y + 4.8, { align: 'right' });
    doc.text(t.dailyCashReportCollected, CASHIER_COLUMNS.collected, y + 4.8, { align: 'right' });
    doc.text(t.dailyCashReportCancelled, CASHIER_COLUMNS.cancelled, y + 4.8, { align: 'right' });
    doc.text(t.dailyCashReportNet, CASHIER_COLUMNS.net, y + 4.8, { align: 'right' });
    y += 7;
  };
  drawCashierHeader();

  if (report.cashiers.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(t.dailyCashReportEmpty, MARGIN + 2, y + 6);
    y += 12;
  }

  report.cashiers.forEach((cashier, index) => {
    if (y > ROW_LIMIT) {
      doc.addPage();
      y = 20;
      drawCashierHeader();
    }
    if (index % 2 === 1) {
      doc.setFillColor(...ROW_LINE_RGB);
      doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 9, 'F');
    }
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.line(MARGIN, y + 9, PAGE_WIDTH - MARGIN, y + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK_RGB);
    // Un geste sans caissier identifiable garde sa ligne (le libellé de repli est
    // celui de l'historique) : un total ne doit pas perdre un geste en silence.
    doc.text(doc.splitTextToSize(cashier.name || t.roleStaff, 62)[0] ?? t.roleStaff, MARGIN + 2, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED_INK_RGB);
    const account = [cashier.email, cashier.role].filter(Boolean).join(' · ');
    if (account) doc.text(doc.splitTextToSize(account, 62)[0] ?? account, MARGIN + 2, y + 8);

    doc.setFontSize(8);
    doc.setTextColor(...MUTED_INK_RGB);
    doc.text(String(cashier.count), CASHIER_COLUMNS.entries, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...MONEY_INK_RGB);
    doc.text(formatMoney(cashier.collected), CASHIER_COLUMNS.collected, y + 4.5, { align: 'right' });
    doc.setTextColor(...(cashier.cancelled > 0 ? CANCEL_INK_RGB : MUTED_INK_RGB));
    doc.text(cashier.cancelled > 0 ? signedNet(-cashier.cancelled, formatMoney) : formatMoney(0), CASHIER_COLUMNS.cancelled, y + 4.5, { align: 'right' });
    doc.setTextColor(...(cashier.net < 0 ? CANCEL_INK_RGB : MONEY_INK_RGB));
    doc.text(signedNet(cashier.net, formatMoney), CASHIER_COLUMNS.net, y + 4.5, { align: 'right' });

    if (cashier.withoutAmount > 0) {
      // Sous son propre nom : « et N geste(s) sans montant chiffré ». Le total de
      // CETTE ligne est donc partiel, et il le dit là où on le lit.
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(180, 83, 9);
      doc.text(
        t.paymentHistoryWithoutAmount.replace('{count}', String(cashier.withoutAmount)),
        MARGIN + 2,
        y + 8,
      );
    }
    y += 9;
  });

  // 4. Les annulations du jour, une ligne chacune.
  y += 6;
  if (y > ROW_LIMIT) {
    doc.addPage();
    y = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...CANCEL_INK_RGB);
  doc.text(
    t.dailyCashReportCancellations.replace('{count}', String(report.cancellations.length)),
    MARGIN,
    y,
  );
  y += 4;

  const drawCancelHeader = () => {
    doc.setFillColor(...HEADER_FILL_RGB);
    doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...HEADER_INK_RGB);
    doc.text(t.timestamp, CANCEL_COLUMNS[0], y + 4.8);
    doc.text(t.receipt, CANCEL_COLUMNS[1], y + 4.8);
    doc.text(t.studentName, CANCEL_COLUMNS[2], y + 4.8);
    doc.text(t.amount2, CANCEL_AMOUNT_X, y + 4.8, { align: 'right' });
    doc.text(t.paymentHistoryCollectedBy, CANCEL_COLUMNS[3], y + 4.8);
    y += 7;
  };
  drawCancelHeader();

  if (report.cancellations.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(t.dailyCashReportNoCancellations, MARGIN + 2, y + 6);
    y += 12;
  }

  report.cancellations.forEach((row, index) => {
    if (y > ROW_LIMIT) {
      doc.addPage();
      y = 20;
      drawCancelHeader();
    }
    if (index % 2 === 1) {
      doc.setFillColor(...ROW_LINE_RGB);
      doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 7, 'F');
    }
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.line(MARGIN, y + 7, PAGE_WIDTH - MARGIN, y + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED_INK_RGB);
    doc.text(
      new Date(row.at).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      CANCEL_COLUMNS[0],
      y + 4.5,
    );
    doc.text(row.receiptNumber || '—', CANCEL_COLUMNS[1], y + 4.5);
    doc.setTextColor(...INK_RGB);
    doc.text(doc.splitTextToSize(row.studentName || t.paymentHistoryUnknownStudent, 44)[0] ?? '', CANCEL_COLUMNS[2], y + 4.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...CANCEL_INK_RGB);
    // Le signe vient d'une seule fonction (`signedNet`) : le montant annulé ici et
    // le net du tableau planchent donc sur le même caractère.
    doc.text(row.amount === null ? t.paymentHistoryAmountInDetails : signedNet(-row.amount, formatMoney), CANCEL_AMOUNT_X, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED_INK_RGB);
    doc.text(doc.splitTextToSize(row.actorName || t.roleStaff, 30)[0] ?? '', CANCEL_COLUMNS[3], y + 4.5);
    y += 7;
  });

  // 5. Cachet + mention officielle, SOUS le contenu.
  let stampCy = y + 18;
  if (stampCy + STAMP_DIAMETER / 2 + 8 > 289) {
    doc.addPage();
    stampCy = 34;
  }
  await drawSchoolStamp(doc, CENTER_X, stampCy, STAMP_DIAMETER);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    t.officialElectronicDocumentGeneratedByExecutiveFinanceComplexeScolaireMamaThera,
    CENTER_X,
    stampCy + STAMP_DIAMETER / 2 + 7,
    { align: 'center' },
  );

  // 6. Pied de page numéroté sur toutes les pages.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.dailyCashReportPdfFooter
        .replace('{date}', new Date().toLocaleString(locale))
        .replace('{page}', String(page))
        .replace('{pages}', String(pages)),
      CENTER_X,
      FOOTER_Y,
      { align: 'center' },
    );
  }

  downloadBytes(doc.output('arraybuffer'), `Rapport_Caisse_${report.day}.pdf`);
}
