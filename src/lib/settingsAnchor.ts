/**
 * ─── L'ancre profonde du journal d'audit ────────────────────────────────────
 *
 * La carte d'archive vit dans les Réglages, et les Réglages sont une page
 * longue : la carte occupait le bas d'une section déjà remplie par « Exporter
 * les données ». Le rappel de la cloche ouvrait bien les Réglages — mais
 * s'arrêtait à la porte, et il fallait encore chercher la carte à la main. Un
 * rappel qui n'amène pas à l'endroit du geste est une devinette ; cette ancre
 * ferme ce dernier pas.
 *
 * **Le fragment d'URL, et pas un état partagé.** Le clic pose `#audit-archive`,
 * les Réglages s'ouvrent, et la carte se désigne elle-même (défilement + halo).
 * Un fragment se lit, se partage et survit à un rechargement, il ne provoque
 * aucun rechargement dans une application SANS routeur, et il ne fait pas
 * apparaître un second état à côté de `activeTab` — l'application n'a qu'une
 * navigation, elle doit rester la seule.
 *
 * **La lecture est PURE** (une chaîne → un booléen) donc mesurable sans DOM ;
 * seuls les deux gestes qui le demandent touchent au navigateur.
 *
 * **L'ancre est CONSOMMÉE, jamais permanente.** `consumeAuditArchiveAnchor`
 * efface le fragment dès qu'il l'a lu : sans cela, revenir aux Réglages plus
 * tard rejouerait le défilement et le halo à chaque visite, et un repère qui
 * crie toujours ne repère plus rien.
 */

/** Le fragment qui désigne « Réglages → Sauvegarde → Journal d'audit ». */
export const AUDIT_ARCHIVE_ANCHOR = 'audit-archive';

/** Ce fragment désigne-t-il l'ancre du journal d'audit ? (pur, sans DOM) */
export function isAuditArchiveAnchor(hash: string | null | undefined): boolean {
  // Espaces d'abord : un fragment lu d'une adresse collée arrive souvent encadré,
  // et un dièse en tête est la seule forme que `location.hash` peut porter.
  return String(hash ?? '').trim().replace(/^#/, '').trim() === AUDIT_ARCHIVE_ANCHOR;
}

/** Demande l'ancre : le prochain écran de Réglages monté s'y rendra. */
export function requestAuditArchiveAnchor(): void {
  if (typeof window === 'undefined') return;
  try {
    window.location.hash = AUDIT_ARCHIVE_ANCHOR;
  } catch {
    // Un fragment refusé n'annule pas la navigation : le clic a déjà ouvert les
    // Réglages. L'ancre est un confort, jamais une condition d'arrivée.
  }
}

/**
 * Consomme l'ancre : vrai UNE fois si elle est demandée, puis l'efface.
 *
 * @returns vrai si l'écran qui appelle doit se désigner (défiler + halo)
 */
export function consumeAuditArchiveAnchor(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isAuditArchiveAnchor(window.location.hash)) return false;
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    // Repli : un fragment vidé laisse une URL propre même si l'historique refuse
    // d'être réécrit (les deux gestes visent le même état — plus de fragment).
    window.location.hash = '';
  }
  return true;
}
