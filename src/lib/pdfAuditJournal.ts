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
 * **4. UNE LIGNE SAISIE HORS LIGNE SE LIT EN ROUGE, et elle dit ses deux dates.**
 * Un geste fait sans réseau n'atteint la base qu'à la reconnexion : imprimé
 * comme les autres, il se lirait « fait le lundi 8 h 05 » alors qu'il a été fait
 * le dimanche 22 h 50, et rien ne dirait qu'il a attendu. La ligne porte donc sa
 * date de GESTE, la mention de son origine et l'instant où elle a atteint la
 * base — en rouge, pour qu'un coup d'œil suffise à séparer ce qui a été fait sur
 * le poste de ce qui a été écrit au retour du câble. Le drapeau vient de
 * `auditOffline.ts` (jamais d'un texte deviné), et la décision de style est une
 * fonction PURE (`auditPdfRowContent`) : c'est elle que les tests mesurent.
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
import type { AuditRow } from './blockedIncidents';
import { isOfflineEntry, offlineOriginNote, offlineOriginOf } from './auditOffline';
import type { OfflineOrigin } from './auditOffline';
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
const TIME_INK: [number, number, number] = [100, 116, 139];
const WHO_INK: [number, number, number] = [15, 23, 42];
const LOG_INK: [number, number, number] = [30, 64, 175];
const INCIDENT_INK: [number, number, number] = [159, 18, 57];
const DETAILS_INK: [number, number, number] = [71, 85, 105];
/** Le rouge d'une ligne saisie sans réseau — la seule couleur qui la signale. */
export const OFFLINE_INK_RGB: [number, number, number] = [185, 28, 28];

/** Ce qu'une ligne du PDF porte, couleurs comprises — calculé, puis dessiné. */
export interface AuditPdfRowContent {
  at: string;
  /** L'acteur, ou `null` pour un incident (qui affiche un compte de postes). */
  who: string | null;
  /** Le nombre de postes d'un incident, ou `null` pour une entrée. */
  whoCount: number | null;
  label: string;
  details: string;
  timeInk: [number, number, number];
  whoInk: [number, number, number];
  labelInk: [number, number, number];
  detailsInk: [number, number, number];
  /** Non nul quand la ligne a été SAISIE hors ligne : elle est alors rouge. */
  offline: OfflineOrigin | null;
}

/**
 * Le contenu d'une ligne du PDF — la DÉCISION, séparée du dessin.
 *
 * Pure à dessein : la seule chose qui décide qu'une ligne est rouge est ce
 * `recordedOffline` lu par `offlineOriginOf`, et un test peut le vérifier sans
 * ouvrir un PDF. Le dessin, lui, ne fait plus que poser ces valeurs.
 *
 * @param row la ligne (une entrée, ou un incident regroupé)
 * @param t les traductions du poste
 * @param lang la langue du document
 * @param format comment écrire un instant ISO (le formateur local du PDF)
 */
export function auditPdfRowContent(
  row: AuditRow,
  t: TranslationDict,
  lang: 'en' | 'fr',
  format: (iso: string) => string,
): AuditPdfRowContent {
  if (row.kind === 'incident') {
    const incident = row.incident;
    return {
      at: format(incident.lastAt),
      who: null,
      whoCount: incident.stations.length,
      label: t.auditIncidentAction.replace('{code}', auditActionLabel(incident.code, t)),
      details: `${t.auditIncidentMotif} : ${incident.motif} — ${t.auditIncidentCount.replace('{count}', String(incident.stations.length))} · ${t.auditIncidentStations} : ${incident.stations.join(', ')} · ${t.auditIncidentOccurrences.replace('{count}', String(incident.occurrences))}`,
      timeInk: TIME_INK,
      whoInk: WHO_INK,
      labelInk: INCIDENT_INK,
      detailsInk: DETAILS_INK,
      offline: null,
    };
  }
  const log = row.log;
  const origin = offlineOriginOf(log);
  const details = localizeAuditDetails(log.details, lang) || '—';
  return {
    at: format(log.createdAt),
    who: log.userName || log.userEmail || '—',
    whoCount: null,
    label: auditActionLabel(log.action, t),
    // Les deux dates se suivent dans la MÊME cellule : « saisi hors ligne le X ·
    // synchronisé le Y ». Un lecteur qui n'a que le PDF ne peut pas autrement
    // savoir que la ligne a attendu la ligne.
    details: origin
      ? `${details} · ${offlineOriginNote(origin, format, { captured: t.auditOfflineRowCaptured, synced: t.auditOfflineRowSynced })}`
      : details,
    timeInk: origin ? OFFLINE_INK_RGB : TIME_INK,
    whoInk: origin ? OFFLINE_INK_RGB : WHO_INK,
    labelInk: origin ? OFFLINE_INK_RGB : LOG_INK,
    detailsInk: origin ? OFFLINE_INK_RGB : DETAILS_INK,
    offline: origin,
  };
}

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

  // 2. Quatre compteurs : ce que la semaine a produit, en un regard. Le dernier
  //    compte les SAISIES HORS LIGNE, et s'allume en rouge dès qu'il y en a une —
  //    une semaine sans réseau se voit au premier coup d'œil sur l'archive.
  const incidentCount = rows.filter((row) => row.kind === 'incident').length;
  const offlineCount = list.filter((entry) => isOfflineEntry(entry)).length;
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
    {
      label: t.auditWeeklyJournalPdfOffline,
      value: String(offlineCount),
      fill: offlineCount > 0 ? [254, 242, 242] : [248, 250, 252],
      ink: offlineCount > 0 ? OFFLINE_INK_RGB : [71, 85, 105],
    },
  ];
  const boxWidth = (contentWidth - 12) / 4;
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
    // Le contenu est calculé UNE fois — texte ET couleurs : la hauteur de la
    // ligne et ce qu'elle dit ne peuvent donc pas décrire deux choses
    // différentes, et le rouge d'une saisie hors ligne vient d'un seul endroit
    // (`auditPdfRowContent`).
    const content = auditPdfRowContent(row, t, lang, dateTime);
    const wrappedDetails = doc.splitTextToSize(content.details, contentWidth - 111) as string[];
    const rowHeight = Math.max(7.5, wrappedDetails.length * 3.6 + 3.5);

    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }
    doc.setDrawColor(...ROW_LINE_RGB);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...content.timeInk);
    doc.text(content.at, margin + 4, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...content.whoInk);
    if (content.whoCount !== null) {
      doc.text(String(content.whoCount), margin + 48, y + 4.5);
    } else {
      doc.text(doc.splitTextToSize(content.who || '—', 34).slice(0, 2), margin + 48, y + 4.5);
    }

    doc.setTextColor(...content.labelInk);
    doc.text(doc.splitTextToSize(content.label, 33).slice(0, 2), margin + 86, y + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...content.detailsInk);
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
