// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/duplicate-receipts.mjs — repérer un reçu saisi deux fois.
//
// Le contrôle existait sous forme de rapport À LA MAIN (RAPPORT_RECUS_DOUBLONS.md,
// 2026-10-05) : une requête jetable, un Markdown, rien de rejouable. Or une caisse
// se relit PAR PÉRIODE (fin de journée, fin de semaine, clôture de trimestre) :
// ce qui doit durer, c'est le CONTRÔLE, pas le rapport d'un jour. Ce module est
// la partie pure — les requêtes, la mise en lignes CSV et le sérialiseur — pour
// que la partie « réseau » (scripts/report-duplicate-receipts.mjs) reste mince et
// que la logique soit prouvée sans base.
//
// ─── Ce qu'on appelle « un doublon » (et ce qu'on ne prétend pas) ────────────
// Deux signaux, deux colonnes de contrôle indépendantes :
//
//   • `meme_eleve_meme_date_meme_montant` — plusieurs lignes de `payments` pour
//     le même élève, le même jour, au même montant. C'est la signature d'un
//     double clic sur « Enregistrer » ou d'un reçu réimprimé puis ressaisi.
//   • `numero_recu_reutilise` — un même `receipt_number` sur plusieurs lignes.
//     Plus fort encore, mais il suppose que le numéro ait été saisi.
//
// AUCUN des deux ne PROUVE un doublon : deux versements du même montant le même
// jour restent possibles (fratrie, acompte puis solde). Ce que l'outil rend, ce
// sont les LIGNES À REGARDER — à l'école de trancher, puis de retirer la fautive
// depuis la fiche de l'élève (le bouton « supprimer un paiement » écrit le geste
// au journal d'audit). Le prétendre « doublon confirmé » ferait supprimer des
// paiements réels : c'est l'erreur que ce vocabulaire évite.
//
// ─── Une ligne CSV = une LIGNE DE PAIEMENT, pas un « groupe » ───────────────
// Chaque ligne suspecte est écrite une fois PAR PAIEMENT concerné (et une fois
// par contrôle qui la retient : une ligne peut déclencher les deux). La feuille
// garde donc un schéma UNIFORME — une ligne = un paiement réellement en base,
// avec son `paiement_id` — au lieu de mélanger des groupes agrégés et des
// paiements : c'est la seule forme sur laquelle l'école peut agir directement.
// ─────────────────────────────────────────────────────────────────────────────

/** Le premier contrôle : même élève, même date, même montant. */
export const CONTROL_DUPLICATE = 'meme_eleve_meme_date_meme_montant';

/** Le second contrôle : un numéro de reçu porté par plusieurs lignes. */
export const CONTROL_RECEIPT = 'numero_recu_reutilise';

/**
 * Tous les paiements de la fenêtre, avec le nombre de lignes du MÊME groupe
 * (élève + date + montant). La fenêtre est paramétrée par `$1` (depuis) et `$2`
 * (jusqu'à) : `null` veut dire « pas de borne ». Les deux bornes sont répétées
 * dans le `where` ET dans la jointure, pour que le décompte porte sur ce qu'on
 * regarde — une borne appliquée d'un seul côté compterait des lignes hors
 * période et ferait croire à un doublon.
 *
 * `left join` sur `students` : un paiement dont l'élève a disparu (FK cassée)
 * doit SORTIR du rapport, pas le faire échouer en silence — d'où le
 * `coalesce(s.name, '(élève inconnu)')` côté mise en lignes.
 */
export const DUPLICATE_GROUP_SQL = `
  select p.id,
         p.student_id,
         coalesce(s.name, '(élève inconnu)') as student_name,
         coalesce(s.grade, '')                as student_grade,
         p.date,
         p.amount,
         coalesce(p.receipt_number, '')       as receipt_number,
         coalesce(p.academic_year, '')        as academic_year,
         p.created_at,
         count(*) over (partition by p.student_id, p.date, p.amount)::int as occurrences
    from public.payments p
    left join public.students s on s.id = p.student_id
   where ($1::date is null or p.date >= $1::date)
     and ($2::date is null or p.date <= $2::date)
   order by p.date, student_name, p.id
`;

/**
 * Les paiements dont le numéro de reçu est partagé, avec le nombre de lignes qui
 * le portent. Un reçu VIDE est exclu : ce n'est pas un numéro réutilisé, c'est
 * une saisie sans numéro, et les compter ensemble donnerait un faux positif sur
 * toutes les lignes anciennes.
 */
export const REUSED_RECEIPT_SQL = `
  select p.id,
         p.student_id,
         coalesce(s.name, '(élève inconnu)') as student_name,
         coalesce(s.grade, '')                as student_grade,
         p.date,
         p.amount,
         coalesce(p.receipt_number, '')       as receipt_number,
         coalesce(p.academic_year, '')        as academic_year,
         p.created_at,
         count(*) over (partition by p.receipt_number)::int as occurrences
    from public.payments p
    left join public.students s on s.id = p.student_id
   where coalesce(p.receipt_number, '') <> ''
     and ($1::date is null or p.date >= $1::date)
     and ($2::date is null or p.date <= $2::date)
   order by p.receipt_number, p.date, p.id
`;

/** Combien de paiements la fenêtre contient — le dénominateur du rapport. */
export const TOTAL_PAYMENTS_SQL = `
  select count(*)::int as n
    from public.payments p
   where ($1::date is null or p.date >= $1::date)
     and ($2::date is null or p.date <= $2::date)
`;

/**
 * Les colonnes du CSV, dans l'ordre. Les intitulés sont ceux que l'école lit
 * (français, unité incluse) ; les clés sont celles que la mise en lignes produit.
 */
export const CSV_COLUMNS = [
  { key: 'controle', header: 'controle' },
  { key: 'eleve', header: 'eleve' },
  { key: 'classe', header: 'classe' },
  { key: 'date', header: 'date_paiement' },
  { key: 'montant', header: 'montant_fcfa' },
  { key: 'recu', header: 'numero_recu' },
  { key: 'annee', header: 'annee_academique' },
  { key: 'occurrences', header: 'occurrences' },
  { key: 'saisiLe', header: 'saisi_le' },
  { key: 'paiementId', header: 'paiement_id' },
];

/** Le nombre de lignes qui partagent la clé de cette ligne (jamais un texte). */
const countOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** La date d'un `date`/`timestamptz` pg en texte court, sans dépendre du fuseau. */
const isoDay = (value) => {
  if (!value) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 10);
};

/** L'instant de saisie en ISO court — « 2026-10-05 06:48 » pour une feuille. */
const isoMinute = (value) => {
  if (!value) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 16).replace('T', ' ');
};

/**
 * Une ligne de paiement, vue par un contrôle donné.
 * @param {Record<string, unknown>} row ligne rendue par l'une des deux requêtes
 * @param {string} controle l'un des deux `CONTROL_*`
 */
function csvRow(row, controle) {
  return {
    controle,
    eleve: String(row.student_name ?? ''),
    classe: String(row.student_grade ?? ''),
    date: isoDay(row.date),
    montant: String(row.amount ?? ''),
    recu: String(row.receipt_number ?? ''),
    annee: String(row.academic_year ?? ''),
    occurrences: countOf(row.occurrences),
    saisiLe: isoMinute(row.created_at),
    paiementId: String(row.id ?? ''),
  };
}

/**
 * Les lignes à vérifier, dédoublonnées par (contrôle, paiement).
 *
 * Un paiement qui coche les DEUX contrôles apparaît deux fois, une par contrôle :
 * ce ne sont pas deux symptômes du même fait mais deux lectures différentes (le
 * même montant le même jour / le reçu réutilisé), et l'école suit chacune.
 * L'ordre est stable — par date, puis élève, puis contrôle, puis id — pour que
 * deux lancements successifs produisent le même fichier au même endroit.
 *
 * @param {{ duplicateRows?: Record<string, unknown>[], receiptRows?: Record<string, unknown>[] }} input
 * @returns {ReturnType<typeof csvRow>[]}
 */
export function flaggedRows({ duplicateRows = [], receiptRows = [] } = {}) {
  const flagged = [];
  for (const row of duplicateRows) {
    if (countOf(row.occurrences) > 1) flagged.push(csvRow(row, CONTROL_DUPLICATE));
  }
  for (const row of receiptRows) {
    if (countOf(row.occurrences) > 1) flagged.push(csvRow(row, CONTROL_RECEIPT));
  }
  const rank = { [CONTROL_DUPLICATE]: 0, [CONTROL_RECEIPT]: 1 };
  return flagged.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.eleve.localeCompare(b.eleve) ||
    rank[a.controle] - rank[b.controle] ||
    a.paiementId.localeCompare(b.paiementId),
  );
}

/**
 * Ce que le contrôle a MESURÉ, séparément du fichier.
 *
 * `groups` compte les groupes (élève+date+montant) distincts et non les lignes :
 * trois lignes du même groupe font UN groupe à regarder, et annoncer « 3 » ferait
 * croire à trois problèmes.
 *
 * @param {{ duplicateRows?: Record<string, unknown>[], receiptRows?: Record<string, unknown>[], totalPayments?: number }} input
 */
export function summarizeReport({ duplicateRows = [], receiptRows = [], totalPayments = 0 } = {}) {
  const duplicateGroups = new Set();
  for (const row of duplicateRows) {
    if (countOf(row.occurrences) > 1) {
      duplicateGroups.add(`${row.student_id}|${isoDay(row.date)}|${row.amount}`);
    }
  }
  const reusedReceipts = new Set();
  for (const row of receiptRows) {
    if (countOf(row.occurrences) > 1) reusedReceipts.add(String(row.receipt_number ?? ''));
  }
  const rows = flaggedRows({ duplicateRows, receiptRows });
  return {
    totalPayments: countOf(totalPayments),
    duplicateGroups: duplicateGroups.size,
    reusedReceipts: reusedReceipts.size,
    flaggedLines: rows.length,
  };
}

/** Une cellule CSV : toujours entre guillemets, guillemets internes doublés. */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Le CSV complet : en-tête + lignes.
 *
 * BOM UTF-8 et fins de ligne CRLF par défaut — le fichier est fait pour être
 * ouvert dans Excel sous Windows, où l'absence de BOM casse les accents
 * (« élève » lu « Ã©lÃ¨ve ») et où un LF seul reste acceptable mais pas idiomatique.
 * Les deux sont paramétrables pour que le test compare un texte déterministe.
 *
 * @param {Record<string, unknown>[]} rows
 * @param {{ columns?: { key: string, header: string }[], bom?: boolean, eol?: string }} [options]
 * @returns {string}
 */
export function toCsv(rows, { columns = CSV_COLUMNS, bom = true, eol = '\r\n' } = {}) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
  }
  return (bom ? '\ufeff' : '') + lines.join(eol) + eol;
}

/** Les critères, dits une fois — le script les imprime et le README les cite. */
export const CRITERIA = [
  `${CONTROL_DUPLICATE} : plusieurs paiements du même élève, le même jour, au même montant`,
  `${CONTROL_RECEIPT} : un même numéro de reçu porté par plusieurs paiements`,
];

// ─── La période : la semaine ISO qui vient de se clore ───────────────────────
// Le déclencheur hebdomadaire (voir .github/workflows/cash-period-receipts.yml)
// lance le contrôle le lundi : la « période de caisse » qui vient de fermer est
// la semaine ISO PRÉCÉDENTE, du lundi au dimanche. C'est le découpage que l'app
// utilise déjà pour son journal d'audit (src/lib/auditWeek.ts) : la même règle,
// pour que le CSV d'une semaine porte la clé que l'écran affiche.
//
// Calcul en UTC — une date de paiement est un jour calendaire, sans fuseau, et
// le script tourne sur un runner en heure UTC. Passer par l'heure locale ferait
// glisser la frontière d'un jour selon la machine qui l'exécute.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Le lundi (minuit UTC) de la semaine ISO qui contient `date`. */
export function mondayOf(date) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
}

/**
 * La clé ISO-8601 d'une semaine, « AAAA-Sn ».
 *
 * L'année se lit sur le JEUDI de la semaine — le jour qui décide de l'année ISO
 * (le lundi 29 déc. 2025 appartient à la semaine 1 de 2026) — et le numéro se
 * compte depuis le lundi de la semaine 1, celle qui contient le 4 janvier.
 */
export function isoWeekKey(date) {
  const monday = mondayOf(date);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week1Monday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const week = 1 + Math.round((monday.getTime() - week1Monday.getTime()) / (7 * DAY_MS));
  return `${year}-S${week}`;
}

/**
 * La semaine ISO qui vient de se CLORE, en bornes de dates incluses.
 *
 * C'est toujours la semaine PRÉCÉDENTE — `mondayOf(now)` moins sept jours — que
 * le déclencheur tourne le lundi (le cas normal), un autre jour, ou à cheval sur
 * un changement d'année : la fenêtre ne dépend jamais du jour d'exécution.
 *
 * @param {Date} [now] l'instant de référence
 * @returns {{ startIso: string, endIso: string, key: string }}
 */
export function closedWeekBounds(now = new Date()) {
  const start = new Date(mondayOf(now).getTime() - 7 * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const isoDay = (d) => d.toISOString().slice(0, 10);
  return { startIso: isoDay(start), endIso: isoDay(end), key: isoWeekKey(start) };
}
