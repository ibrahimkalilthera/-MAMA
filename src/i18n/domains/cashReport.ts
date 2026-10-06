/**
 * Domain: cashReport — le rapport de caisse journalier (la carte et son PDF).
 *
 * Extrait du domaine `admin` au moment où il a dépassé le budget de lignes de
 * `scripts/check-line-budget.mjs` (700). La scission est le remède que ce gate
 * prescrit lui-même, et ces treize clés sont les dernières arrivées : le lot se
 * détache d'autant plus proprement qu'il ne sert qu'un écran et un document, tous
 * deux dans l'onglet Historique des paiements.
 *
 * Comme les autres domaines, il exporte les deux fragments (en/fr) que
 * `src/i18n/translations.ts` fusionne ; `scripts/l10n-verify.mjs` vérifie la
 * parité, l'ABSENCE de doublon entre domaines, et le même ordre de clés dans les
 * deux langues — les deux blocs ci-dessous se lisent donc dans le même ordre.
 */
export const en = {
    dailyCashReportCancellations: "Cancellations of the day ({count})",
    dailyCashReportCancelled: "Cancelled",
    dailyCashReportCashier: "Cashier",
    dailyCashReportCollected: "Collected",
    dailyCashReportDay: "Day",
    dailyCashReportEmpty: "No collection recorded that day.",
    dailyCashReportEntries: "Entries",
    dailyCashReportNet: "Net",
    dailyCashReportNoCancellations: "No cancellation that day.",
    dailyCashReportPdfFooter: "Cash report — {date} — page {page}/{pages}",
    dailyCashReportSubtitle: "The day's collections, grouped by cashier, and the day's cancellations.",
    dailyCashReportTitle: "Daily cash report",
    dailyCashReportTotals: "Day total — {count} event(s) · collected {collected} · cancelled {cancelled} · net {net}",
};

export const fr = {
    dailyCashReportCancellations: "Annulations du jour ({count})",
    dailyCashReportCancelled: "Annulé",
    dailyCashReportCashier: "Caissier",
    dailyCashReportCollected: "Encaissé",
    dailyCashReportDay: "Journée",
    dailyCashReportEmpty: "Aucun encaissement journalisé ce jour-là.",
    dailyCashReportEntries: "Gestes",
    dailyCashReportNet: "Net",
    dailyCashReportNoCancellations: "Aucune annulation ce jour-là.",
    dailyCashReportPdfFooter: "Rapport de caisse — {date} — page {page}/{pages}",
    dailyCashReportSubtitle: "Les encaissements du jour, regroupés par caissier, et les annulations du jour.",
    dailyCashReportTitle: "Rapport de caisse du jour",
    dailyCashReportTotals: "Total du jour — {count} geste(s) · encaissé {collected} · annulé {cancelled} · net {net}",
};
