/**
 * ─── Le journal d'audit d'une semaine, sur une page qu'on peut archiver ─────
 *
 * L'écran d'audit répond à « que s'est-il passé ? » ; ce document répond à
 * « qu'est-ce qui s'est passé CETTE semaine-là ? », et il doit pouvoir être
 * classé, imprimé et relu sans l'application. Trois décisions portent ce choix :
 *
 * **1. Il lit la même vue que l'écran.** Les postes bloqués remontent une ligne
 * chacun, et vingt postes bloqués par le même 404 sont UN incident sur l'écran
 * (`blockedIncidents.ts`). Le PDF emploie `incidentRows` — le même regroupement,
 * la même définition de « la même panne » — au lieu d'en inventer une seconde.
 * Un document qui regrouperait autrement que l'écran ferait douter des deux.
 *
 * **2. Il ne réécrit rien.** Le journal est une trace : le PDF traduit les
 * actions et les détails à la LECTURE (`auditActionLabel`, `localizeAuditDetails`),
 * exactement comme l'écran, et laisse intactes les entrées qu'il ne sait pas
 * lire. Ce qui est imprimé reste ce qui est stocké.
 *
 * **3. Il passe par le SEUL émetteur de téléchargement** (`downloadBytes`). Le
 * dépôt a payé cher un troisième chemin de sauvegarde (le reçu arrivé deux fois) :
 * un module ne pose jamais `link.download`, il demande à l'émetteur.
 *
 * La fenêtre ne vient PAS d'ici : elle est calculée par `auditWeek.ts`, et passée
 * en paramètre — le même objet fenêtre sert à compter les entrées et à interdire
 * les autres, donc le titre du document et son contenu ne peuvent pas diverger
 * (compter « semaine 39 » sur une liste filtrée autrement est le défaut qu'un PDF
 * d'archive ne pardonne pas).
 */
import type { AuditLogEntry } from './auditLogger';
import type { AuditWeek } from './auditWeek';
import { auditWeekFilename } from './auditWeek';
import { incidentRows } from './blockedIncidents';
import { auditActionLabel, localizeAuditDetails } from './auditDisplay';
import { downloadBytes } from './browserDownload';
import { drawSchoolStamp } from './pdfStamp';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface AuditJournalPdfOptions {
  /** Les entrées de LA semaine (déjà filtrées — voir `entriesInWeek`). */
  entries: AuditLogEntry[];
  /** La fenêtre, pour le titre et le nom de fichier. */
  week: AuditWeek;
  lang?: 'en' | 'fr';
}

/** Couleurs du bandeau, alignées sur ledit écran d'audit (emerald / slate). */
const BANNER_RGB: [number, number, number] = [6, 95, 70];
const ROW_LINE_RGB: [number, number, number] = [226, 232, 240];

export async function generateAuditJournalPdf({ entries, week, lang = 'fr' }: AuditJournalPdfOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const locale = lang === 'fr' ? 'fr-FR' : 'en-US';
  const list = Array.isArray(entries) ? entries : [];
  const rows = incidentRows(list);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  const dateTime = (iso: string | null | undefined): string => {
    const ms = Date.parse(String(iso ?? ''));
    return Number.isFinite(ms) ? new Date(ms).toLocaleString(locale) : '—';
  };
  const dayLabel = (date: Date): string =>
    date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  // 1. Bandeau d'en-tête
  doc.setFillColor(...BANNER_RGB);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('COMPLEXE SCOLAIRE MAMA THERA', margin, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(
    t.auditWeeklyJournalPdfTitle.replace('{week}', week.key),
    margin,
    20,
  );
  doc.setFontSize(8.5);
  doc.text(
    t.auditWeeklyJournalPdfPeriod.replace('{from}', dayLabel(week.start)).replace('{to}', dayLabel(week.end)),
    margin,
    26,
  );
  doc.text(
    `${t.pdfGeneratedOn} ${new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    pageWidth - margin,
    12,
    { align: 'right' },
  );

  // 2. Trois compteurs : ce que la semaine a produit, en un regard.
  const incidentCount = rows.filter((row) => row.kind === 'incident').length;
  const actors = new Set(list.map((entry) => entry.userEmail || entry.userName || '—'));
  const cards: Array<{ label: string; value: string; fill: [number, number, number]; ink: [number, number, number] }> = [
    {
      label: t.auditWeeklyJournalPdfEntries,
      value: String(list.length),
      fill: [236, 253, 245],
      ink: [6, 95, 70],
    },
    {
      label: t.auditWeeklyJournalPdfIncidents,
      value: String(incidentCount),
      fill: incidentCount > 0 ? [255, 241, 242] : [248, 250, 252],
      ink: incidentCount > 0 ? [159, 18, 57] : [71, 85, 105],
    },
    {
      label: t.auditWeeklyJournalPdfActors,
      value: String(actors.size),
      fill: [239, 246, 255],
      ink: [30, 64, 175],
    },
  ];
  const boxWidth = (contentWidth - 8) / 3;
  cards.forEach((card, index) => {
    const x = margin + index * (boxWidth + 4);
    doc.setFillColor(...card.fill);
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.roundedRect(x, 36, boxWidth, 20, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...card.ink);
    doc.text(card.label.toUpperCase(), x + 4, 42);
    doc.setFontSize(13);
    doc.text(card.value, x + 4, 52);
  });

  let y = 64;

  // 3. Tableau des lignes, incidents regroupés comme sur l'écran.
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text(t.timestamp, margin + 4, y + 5);
  doc.text(t.staffUser, margin + 48, y + 5);
  doc.text(t.actions, margin + 86, y + 5);
  doc.text(t.details, margin + 122, y + 5);
  y += 7;

  if (rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(t.auditWeeklyJournalEmpty, margin + 4, y + 8);
    y += 16;
  }

  rows.forEach((row, index) => {
    if (y > 262) {
      doc.addPage();
      y = 20;
    }
    const isIncident = row.kind === 'incident';
    // Le détail est calculé UNE fois : la hauteur de la ligne et son texte ne
    // peuvent donc pas décrire deux choses différentes.
    const details = isIncident
      ? `${t.auditIncidentMotif} : ${row.incident.motif} — ${t.auditIncidentCount.replace('{count}', String(row.incident.stations.length))} · ${t.auditIncidentStations} : ${row.incident.stations.join(', ')} · ${t.auditIncidentOccurrences.replace('{count}', String(row.incident.occurrences))}`
      : localizeAuditDetails(row.log.details, lang) || '—';
    const wrappedDetails = doc.splitTextToSize(details, contentWidth - 111) as string[];
    const rowHeight = Math.max(7.5, wrappedDetails.length * 3.6 + 3.5);

    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(dateTime(isIncident ? row.incident.lastAt : row.log.createdAt), margin + 4, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    if (isIncident) {
      doc.text(String(row.incident.stations.length), margin + 48, y + 4.5);
    } else {
      const who = row.log.userName || row.log.userEmail || '—';
      doc.text(doc.splitTextToSize(who, 34).slice(0, 2), margin + 48, y + 4.5);
    }

    doc.setTextColor(isIncident ? 159 : 30, isIncident ? 18 : 64, isIncident ? 57 : 175);
    doc.text(
      doc.splitTextToSize(
        isIncident ? t.auditIncidentAction.replace('{code}', auditActionLabel(row.incident.code, t)) : auditActionLabel(row.log.action, t),
        33,
      ).slice(0, 2),
      margin + 86,
      y + 4.5,
    );

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(wrappedDetails, margin + 122, y + 4.5);

    y += rowHeight;
  });

  // 4. Pied de page + cachet, sur la dernière page.
  if (y > 250) {
    doc.addPage();
    y = 30;
  }
  await drawSchoolStamp(doc, pageWidth / 2, y + 20, 24);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t.auditWeeklyJournalPdfFooter
        .replace('{date}', new Date().toLocaleString(locale))
        .replace('{page}', String(page))
        .replace('{pages}', String(pages)),
      pageWidth / 2,
      291,
      { align: 'center' },
    );
  }

  downloadBytes(doc.output('arraybuffer'), auditWeekFilename(week));
}
