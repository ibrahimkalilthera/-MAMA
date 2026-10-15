/**
 * ─── L'historique des paiements, sur une page qu'une caisse peut archiver ────
 *
 * Ce document répond à la même question que l'écran, et il doit pouvoir être
 * classé, imprimé et relu sans l'application. Trois décisions portent ce choix :
 *
 * **1. Il ne refiltre rien.** Les lignes arrivent DÉJÀ filtrées par l'écran
 * (`filterPaymentHistory`) : le document imprime la question telle qu'elle a été
 * posée, et l'écrit en tête (« Période : … · Action : … · Recherche : … ») pour
 * qu'un lecteur qui n'a que la feuille sache sur quoi elle a été tirée. Un PDF qui
 * afficherait un total sans dire son filtre est un total qu'on ne peut pas
 * contester.
 *
 * **2. Il dessine les MÊMES cellules que le CSV.** `paymentHistoryCells` met la
 * ligne de l'écran en texte une seule fois ; le CSV l'écrit, ce document la
 * dessine. Le papier et le tableur ne peuvent donc pas nommer autrement le même
 * encaissement.
 *
 * **3. Il passe par le SEUL émetteur de téléchargement** (`downloadBytes`) et
 * pose le cachet de l'école en bas du contenu — jamais au-dessus d'une ligne.
 *
 * L'écart assumé, et il se voit : le tableau est en PAYSAGE. Huit colonnes
 * (horodatage, élève, action, montant, reçu, motif, encaissé par, détails) ne
 * tiennent pas en portrait sans tronquer les détails, et un détail tronqué est
 * exactement ce qu'une caisse relit. Le paysage garde les huit colonnes, comme
 * l'écran.
 *
 * Le MOTIF est la colonne qui manquait : elle dit ce que la famille est venue
 * régler, dans les mots du reçu (`paymentMotifLabel`), donc un document classé se
 * relit sans avoir à rouvrir le papier remis au comptoir.
 */
import type { PaymentHistoryFilter, PaymentHistoryRow, PaymentHistorySummary } from './paymentHistory';
import { correctionHistorySummary, type CorrectionHistoryRow } from './correctionHistory';
import { downloadBytes } from './browserDownload';
import { drawSchoolStamp } from './pdfStamp';
import {
  correctionHistoryCells,
  describePaymentHistoryFilter,
  paymentHistoryCells,
  paymentHistoryColumnLabels,
  paymentHistoryExportFilename,
} from './paymentHistoryExport';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface PaymentHistoryPdfOptions {
  /** Les lignes de l'ÉCRAN, déjà filtrées (jamais la liste complète). */
  rows: PaymentHistoryRow[];
  /** Le résumé qui accompagne ces lignes à l'écran (`paymentHistorySummary`). */
  summary: PaymentHistorySummary;
  /** Les filtres actifs, pour écrire en tête sur quoi le document a été tiré. */
  filter?: PaymentHistoryFilter;
  /** Le formateur de montants de l'écran — le papier et la vue ne peuvent pas diverger. */
  formatMoney: (amount: number) => string;
  /**
   * Les GESTES DE CORRECTION de la même vue (salaires et dépenses retirés,
   * salaires rétablis), tels que `correctionHistoryRows` les rend.
   *
   * Ils sont imprimés dans une section à part, après les encaissements, et leur
   * total ne touche PAS le net de caisse : un salaire ou une dépense retiré n'est
   * pas un encaissement. Le document le dit en tête de section — un lecteur qui
   * aurait additionné les deux blocs aurait un chiffre faux.
   */
  corrections?: CorrectionHistoryRow[];
  lang?: 'en' | 'fr';
}

/** Couleurs alignées sur l'écran d'historique (emerald / slate / rose). */
const BANNER_RGB: [number, number, number] = [6, 95, 70];
const HEADER_FILL_RGB: [number, number, number] = [241, 245, 249];
const ROW_FILL_RGB: [number, number, number] = [248, 250, 252];
const ROW_LINE_RGB: [number, number, number] = [226, 232, 240];
const HEADER_INK_RGB: [number, number, number] = [51, 65, 85];
const INK_RGB: [number, number, number] = [15, 23, 42];
const MUTED_INK_RGB: [number, number, number] = [100, 116, 139];
const SUMMARY_INK_RGB: [number, number, number] = [6, 95, 70];
/** Le cachet : 24 mm, comme les autres documents A4 du dépôt. */
const STAMP_DIAMETER = 24;

/** Page A4 en paysage, en millimètres. */
const PAGE_WIDTH = 297;
const PAGE_HEIGHT = 210;
const MARGIN = 12;
/** Les abscisses de gauche des huit colonnes (voir `paymentHistoryColumnLabels`). */
const COLUMN_X = [12, 46, 84, 116, 156, 180, 210, 248];
/**
 * L'endroit où la colonne DÉTAILS s'arrête — la largeur du repli de texte.
 *
 * 37 mm, et non 43 : la colonne MOTIF a pris ses six millimètres. Les détails se
 * replient sur une ligne de plus quand il le faut (la hauteur de ligne suit leur
 * repli), là où une colonne de motif trop étroite aurait ÉCRÊTÉ le mot du reçu —
 * un papier qui ne dit qu'à moitié ce qui a été réglé ne sert à rien.
 */
const DETAILS_WIDTH = 37;
/** Abscisse de la ligne « bullet » du titre en bandeau. */
const BANNER_TEXT_X = 148.5;

/** En dessous de cette ordonnée, une ligne de tableau est dessinée. */
const ROW_LIMIT = 188;
/** En dessous de cette ordonnée, le bloc cachet + mention reste sur la page. */
const BLOCK_LIMIT = 158;

export async function generatePaymentHistoryPdf({
  rows,
  summary,
  filter,
  corrections = [],
  formatMoney,
  lang = 'fr',
}: PaymentHistoryPdfOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const list = Array.isArray(rows) ? rows : [];
  const correctionList = Array.isArray(corrections) ? corrections : [];
  const context = { t, lang, formatMoney };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // 1. Bandeau : l'école, le titre du document, et la date d'édition.
  doc.setFillColor(...BANNER_RGB);
  doc.rect(0, 0, PAGE_WIDTH, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', MARGIN, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(t.paymentHistoryPdfTitle, MARGIN, 19);
  doc.setFontSize(8.5);
  doc.text(
    `${t.pdfGeneratedOn} ${new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    PAGE_WIDTH - MARGIN,
    11,
    { align: 'right' },
  );

  // 2. Les filtres ACTIFS et le résumé de la caisse — ce que l'écran dit au-dessus
  //    du tableau, écrit ici pour qu'un lecteur sans application le relise.
  let y = 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...SUMMARY_INK_RGB);
  doc.text(t.paymentHistoryPdfActiveFilters.replace('{filters}', describePaymentHistoryFilter(filter, t, lang)), MARGIN, y);
  y += 5.5;
  doc.setFontSize(8);
  doc.setTextColor(...INK_RGB);
  doc.text(
    t.paymentHistoryTotals
      .replace('{count}', String(summary.count))
      .replace('{collected}', formatMoney(summary.collected))
      .replace('{cancelled}', formatMoney(summary.cancelled))
      .replace('{net}', formatMoney(summary.net)),
    MARGIN,
    y,
  );
  y += 5.5;
  if (summary.withoutAmount > 0) {
    // Le total est PARTIEL, et le document le dit au lieu de laisser croire à un
    // net complet — la même phrase qu'à l'écran.
    doc.setTextColor(180, 83, 9);
    doc.text(t.paymentHistoryWithoutAmount.replace('{count}', String(summary.withoutAmount)), MARGIN, y);
    y += 5.5;
  }
  y += 2;

  // 3. Le tableau : en-tête dessiné UNE fois, puis redessiné en tête de chaque
  //    page — un tableau qui reprend sans ses colonnes se relit de travers.
  const labels = paymentHistoryColumnLabels(t);
  const drawHeader = () => {
    doc.setFillColor(...HEADER_FILL_RGB);
    doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...HEADER_INK_RGB);
    labels.forEach((label, index) => {
      // Le MONTANT se lit à droite, comme la colonne de l'écran.
      if (index === 3) doc.text(label, COLUMN_X[3] + 36, y + 4.8, { align: 'right' });
      else doc.text(label, COLUMN_X[index], y + 4.8);
    });
    y += 7;
  };
  drawHeader();

  /**
   * Dessine une ligne du tableau — les encaissements ET les corrections passent
   * par ICI : deux boucles écrites à la main auraient fini par dessiner deux
   * tableaux différents dans le même document.
   */
  const drawRow = (cells: string[], index: number) => {
    if (y > ROW_LIMIT) {
      doc.addPage();
      y = 18;
      drawHeader();
    }
    // Le détail est le seul texte qui puisse déborder : c'est lui qui décide de
    // la hauteur de la ligne (un repli sur trois lignes ne chevauchera pas la
    // ligne suivante). Il est la DERNIÈRE cellule — son rang suit l'en-tête, il
    // n'est donc pas écrit en dur ailleurs qu'ici.
    const details = doc.splitTextToSize(cells[7], DETAILS_WIDTH) as string[];
    const rowHeight = Math.max(6.5, details.length * 3.4 + 3);

    if (index % 2 === 1) {
      doc.setFillColor(...ROW_FILL_RGB);
      doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, rowHeight, 'F');
    }
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.line(MARGIN, y + rowHeight, PAGE_WIDTH - MARGIN, y + rowHeight);

    cells.forEach((cell, column) => {
      if (column === 7) return;
      doc.setFont('helvetica', column === 3 ? 'bold' : 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...(column === 0 ? MUTED_INK_RGB : INK_RGB));
      const width = (column === 3 ? 36 : COLUMN_X[column + 1] - COLUMN_X[column]) - 2;
      // Deux lignes au plus pour les cellules courtes : elles sont faites pour
      // tenir, et une troisième ligne déborderait sur la suivante.
      const wrapped = doc.splitTextToSize(cell, width).slice(0, 2);
      if (column === 3) doc.text(wrapped, COLUMN_X[3] + 36, y + 4.2, { align: 'right' });
      else doc.text(wrapped, COLUMN_X[column], y + 4.2);
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED_INK_RGB);
    doc.text(details, COLUMN_X[7], y + 4.2);

    y += rowHeight;
  };

  list.forEach((row, index) => drawRow(paymentHistoryCells(row, context), index));

  // 3 bis. Les GESTES DE CORRECTION, dans leur propre section : ils ne sont pas
  //       des encaissements, et le bloc le dit AVANT de les lister pour qu'aucun
  //       lecteur ne les additionne au net ci-dessus.
  if (correctionList.length > 0) {
    const totals = correctionHistorySummary(correctionList);
    if (y > ROW_LIMIT - 12) {
      doc.addPage();
      y = 18;
    } else {
      y += 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(180, 83, 9);
    doc.text(t.paymentHistoryCorrectionsNote.replace('{count}', String(totals.count)), MARGIN, y);
    y += 5.5;
    drawHeader();
    correctionList.forEach((row, index) => drawRow(correctionHistoryCells(row, context), index));
  }

  // 4. Cachet + mention officielle, SOUS le contenu (jamais par-dessus une ligne) :
  //    une page trop pleine déplace le bloc entier sur une page neuve.
  let stampCy = y + 18;
  if (stampCy + STAMP_DIAMETER / 2 + 8 > PAGE_HEIGHT - 4) {
    doc.addPage();
    stampCy = 34;
  }
  await drawSchoolStamp(doc, BANNER_TEXT_X, stampCy, STAMP_DIAMETER);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    t.officialElectronicDocumentGeneratedByExecutiveFinanceComplexeScolaireMamaThera,
    BANNER_TEXT_X,
    stampCy + STAMP_DIAMETER / 2 + 7,
    { align: 'center' },
  );

  // 5. Pied de page numéroté sur TOUTES les pages.
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.paymentHistoryPdfFooter
        .replace('{date}', new Date().toLocaleString(locale))
        .replace('{page}', String(page))
        .replace('{pages}', String(pages)),
      BANNER_TEXT_X,
      PAGE_HEIGHT - 6,
      { align: 'center' },
    );
  }

  downloadBytes(doc.output('arraybuffer'), paymentHistoryExportFilename('pdf'));
}
