/**
 * ─── L'ÉCRAN ÉCOLE DES REÇUS MUETS : QUI, COMBIEN, DANS QUEL ORDRE ──────────
 *
 * La fiche d'un élève sait déjà compter ses reçus muets (la phrase ambre, lue sur
 * `monthsCoverage().undeclared`) et les renseigner un par un, du plus ancien au
 * plus récent (`PaymentMonthsBackfill`). Ce qui manquait, c'est l'échelle de
 * l'ÉCOLE : ces reçus sont éparpillés dans les fiches, et rien ne disait quel
 * élève en porte, combien, ni par lequel commencer. Pour le savoir, il fallait
 * ouvrir les fiches une à une et repérer chaque bouton ambre à l'œil.
 *
 * Ce module est l'agrégat, et il est PUR : ni React, ni accès réseau, ni horloge.
 * Il lit les élèves que l'application tient déjà (`MainViewsProps.students`), donc
 * il n'ajoute AUCUNE lecture en base — c'est ce qui permet à tout compte connecté
 * de voir l'écran, l'écriture des mois restant, elle, décidée par la base
 * (`src/lib/paymentRights.ts`).
 *
 * ─── Trois décisions, et pourquoi ───────────────────────────────────────────
 *
 *   1. **« Muet » n'est pas redécidé ici.** Le prédicat est
 *      `isSilentReceipt` (src/lib/paymentMonths.ts), exactement celui que
 *      `monthsCoverage().undeclared` compte. Deux définitions divergeraient, et
 *      l'écran afficherait alors un compte qui ne nomme pas les mêmes reçus que
 *      la fiche — le pire des deux mondes, puisque les deux se lisent côte à côte.
 *   2. **L'année se juge par la DATE du reçu** (`inAcademicYear`, la même règle
 *      que le tableau de bord et les archives) : un reçu de septembre 2025 n'est
 *      pas un reçu de l'année affichée, et le compter ici gonflerait le travail à
 *      faire d'une année qui n'est plus celle qu'on regarde. Une année ILLISIBLE
 *      rend une liste vide (`academicYearMonths` rend `[]`) : pas de fenêtre, pas
 *      de jugement — jamais une liste inventée.
 *   3. **Le montant est la SOMME DES REÇUS MUETS, et c'est la clé de tri.** Ce
 *      n'est pas une dette : cet argent a été encaissé. C'est le montant dont la
 *      COUVERTURE est inconnue — donc le poids de ce qui reste à documenter, et
 *      l'ordre dans lequel l'école a intérêt à s'y mettre. Les égalités se
 *      départagent par le NOMBRE de reçus (plusieurs petits reçus sont deux
 *      gestes, pas un), puis par le nom de l'élève, pour que deux postes qui
 *      regardent le même écran lisent la même liste.
 *
 * Les reçus d'une ligne sont rendus du PLUS ANCIEN au plus récent, comme le
 * parcours de rattrapage : `receipts[0]` EST celui par lequel on commence, et
 * c'est lui que l'écran ouvre dans la fiche (`focusPaymentId`).
 */
import type { Payment, Student } from './domainTypes';
import { academicYearMonths, isSilentReceipt, monthsCoverage } from './paymentMonths';
import { inAcademicYear } from './dateWindows';

/** Une ligne de l'écran École : un élève, ses reçus muets, et ce qu'ils pèsent. */
export interface SilentReceiptRow {
  student: Student;
  /**
   * Ses reçus muets de l'année jugée, du PLUS ANCIEN au plus récent. Jamais vide :
   * un élève sans reçu muet ne fait pas de ligne. `receipts[0]` est celui sur
   * lequel la fiche doit s'ouvrir.
   */
  receipts: Payment[];
  /** La somme de ces reçus — ce dont la couverture est inconnue. Clé de tri. */
  amount: number;
  /** Combien de mois de l'année ses reçus (muets ou non) déclarent couvrir. */
  covered: number;
  /** Combien de mois compte l'année jugée (12 sur une année lisible). */
  total: number;
}

/**
 * Les élèves porteurs de reçus muets, du plus gros montant non documenté au plus
 * petit — à égalité, celui qui en porte le plus, puis l'ordre des noms.
 *
 * Rendu : des lignes neuves, construites ici. Le tri ne touche donc jamais les
 * tableaux des élèves (`.filter()` en rend déjà des copies).
 */
export function silentReceiptRows(
  students: readonly Student[],
  academicYear: string,
): SilentReceiptRow[] {
  const yearMonths = academicYearMonths(academicYear);
  // Année illisible : ni fenêtre, ni mois. L'école ne doit pas lire « aucun reçu
  // muet » là où l'application ne sait simplement pas de quelle année on parle.
  if (yearMonths.length === 0) return [];

  const rows: SilentReceiptRow[] = [];
  for (const student of students) {
    const inYear = student.payments.filter((p) => inAcademicYear(p.date, academicYear));
    const receipts = inYear
      .filter((p) => isSilentReceipt(p.months))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (receipts.length === 0) continue;
    // La couverture se lit sur TOUS les reçus de l'année, pas seulement sur les
    // muets : ce qui est déjà déclaré est déjà réglé, et la ligne le dit.
    const coverage = monthsCoverage(inYear.map((p) => p.months), yearMonths);
    rows.push({
      student,
      receipts,
      amount: receipts.reduce((sum, p) => sum + p.amount, 0),
      covered: coverage.covered.length,
      total: yearMonths.length,
    });
  }

  return rows.sort((a, b) =>
    b.amount - a.amount ||
    b.receipts.length - a.receipts.length ||
    a.student.name.localeCompare(b.student.name));
}

/** La somme des montants non documentés de toutes les lignes — le pied de liste. */
export function silentReceiptsTotal(rows: readonly SilentReceiptRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

// ─── LE COMPTE DE L'ÉCOLE, ET DEPUIS QUAND ───────────────────────────────────
//
// L'écran École dit QUI porte les reçus muets ; le tableau de bord n'a pas la
// place de la liste, et n'a besoin que de deux choses : COMBIEN, et DEPUIS
// QUAND. C'est ce que publie l'agrégat ci-dessous, et il ne redécide rien :
//
//   • les lignes sont celles de `silentReceiptRows` — année jugée par la DATE du
//     reçu, « muet » = `isSilentReceipt` — donc le chiffre publié est EXACTEMENT
//     la somme de ce que l'écran liste ligne par ligne. Deux comptages séparés
//     finiraient par diverger, et l'école lirait deux fois le même travail ;
//   • la date de référence arrive en paramètre (`today`, celle des retards) :
//     aucune horloge n'est lue ici, donc un cas de test peut la fixer.

/**
 * Ce que le tableau de bord publie du rattrapage : le nombre, et l'ancienneté.
 *
 * Deux décisions :
 *
 *   1. **L'ancienneté est celle du PLUS ANCIEN** reçu muet, en JOURS. C'est le
 *      seul chiffre qui dise « depuis quand l'école attend », et il ne dépend ni
 *      du nombre de reçus ni de leur montant. Un reçu daté dans le FUTUR (saisie
 *      erronée) n'a pas d'ancienneté : l'âge est ramené à zéro plutôt que publier
 *      un « -3 jours » qui n'existe pas.
 *   2. **Trois nombres, jamais un seul** : les REÇUS (le travail, en gestes), les
 *      ÉLÈVES (les familles concernées) et la date du plus ancien. Un total nu se
 *      lirait « 12 » sans dire si ce sont douze gestes ou douze familles.
 */
export interface SilentReceiptsCatchUp {
  /** Combien de reçus muets l'école porte, toutes lignes confondues. */
  receipts: number;
  /** Combien d'élèves en portent — les familles concernées. */
  students: number;
  /** La date du reçu muet le plus ancien de l'école, ou `null` s'il n'y en a aucun. */
  oldestDate: string | null;
  /**
   * Son ancienneté en JOURS, jamais négative — `null` sans reçu MUET, ou quand
   * une des deux dates est illisible : on ne publie pas un âge qu'on n'a pas su
   * lire.
   */
  oldestDays: number | null;
}

/** Un jour, en millisecondes — la seule unité de l'ancienneté publiée. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * L'âge d'une date en jours entiers, `today` comptant comme le jour courant.
 *
 * Les dates du dépôt sont des `YYYY-MM-DD` : `Date.parse` les lit en UTC des deux
 * côtés, donc la différence est un nombre entier de jours — insensible aux
 * changements d'heure et au fuseau du poste qui regarde l'écran.
 */
function ageInDays(date: string, today: string): number | null {
  const from = Date.parse(date);
  const to = Date.parse(today);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/**
 * L'agrégat du tableau de bord : les reçus muets de l'école, leurs élèves, et
 * l'ancienneté du plus ancien.
 *
 * Sans reçu muet, tout est à zéro et l'ancienneté est `null` — jamais un âge
 * inventé pour une date qui n'existe pas. Une année illisible ne produit aucune
 * ligne (`silentReceiptRows` rend `[]`), donc le tableau de bord n'annonce rien
 * là où l'application ne sait pas de quelle année elle parle.
 */
export function silentReceiptsCatchUp(
  rows: readonly SilentReceiptRow[],
  today: string,
): SilentReceiptsCatchUp {
  let receipts = 0;
  let oldestDate: string | null = null;
  for (const row of rows) {
    receipts += row.receipts.length;
    // Les reçus d'une ligne sont déjà rangés du plus ancien au plus récent, donc
    // le plus ancien de l'école est le minimum de ces têtes — sans trier à nouveau.
    const head = row.receipts[0]?.date;
    if (head && (oldestDate === null || head < oldestDate)) oldestDate = head;
  }
  return {
    receipts,
    students: rows.length,
    oldestDate,
    oldestDays: oldestDate === null ? null : ageInDays(oldestDate, today),
  };
}

// ─── LA PASSE GROUPÉE : une classe, plusieurs élèves, UN choix de mois ────────
//
// Au guichet, un rattrapage se fait par CLASSE : les enfants d'une même classe
// ont payé les mêmes mois, et refaire le même choix de pastilles dix fois de
// suite est exactement le travail que cette passe supprime. Ce qu'elle ne
// supprime pas, c'est la règle du geste : chaque reçu est écrit SÉPARÉMENT, par
// `updatePaymentMonths` (un appel, un reçu, une entrée de journal — la base ne
// connaît pas d'écriture de masse sur `months`), et le résultat se publie reçu
// par reçu.

/**
 * Une classe qui porte des reçus muets, et ses élèves.
 *
 * Le regroupement se fait sur `student.grade` TEL QU'IL EST STOCKÉ (l'écran le
 * NOMME avec `getGradeDisplay`, qui traduit les classes personnalisées) : grouper
 * sur le libellé traduit casserait le lien dès qu'un poste travaille en anglais.
 */
export interface SilentReceiptClass {
  grade: string;
  students: SilentReceiptRow[];
}

/**
 * Les classes qui portent des reçus muets, chacune avec ses élèves dans l'ordre de
 * la liste (montant non documenté décroissant).
 *
 * Les classes sortent dans l'ordre NATUREL (« 2A » avant « 10A »), celui dans
 * lequel un surveillant les appelle — l'ordre du dictionnaire y mettrait « 10A »
 * en tête. Une classe absente (`grade` vide) forme son propre groupe, rendu « N/A »
 * par `getGradeDisplay` : ces élèves ne doivent pas disparaître de la passe.
 */
export function silentReceiptClasses(rows: readonly SilentReceiptRow[]): SilentReceiptClass[] {
  const byGrade = new Map<string, SilentReceiptRow[]>();
  for (const row of rows) {
    const grade = (row.student.grade ?? '').trim();
    const list = byGrade.get(grade);
    if (list) list.push(row);
    else byGrade.set(grade, [row]);
  }
  return [...byGrade.entries()]
    .map(([grade, students]) => ({ grade, students }))
    .sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }));
}

/** Un reçu que la passe va écrire : l'élève, et le reçu muet le PLUS ANCIEN. */
export interface SilentReceiptTarget {
  studentId: string;
  studentName: string;
  /** `receipts[0]` de la ligne — le plus ancien, celui par lequel on commence. */
  payment: Payment;
}

/**
 * Le plan de la passe : pour chaque élève RETENU, son reçu muet le plus ancien.
 *
 * L'ordre est celui de la LISTE (donc celui de l'écran : montant décroissant), pas
 * celui des clics — le compte rendu doit se relire dans l'ordre où l'école a lu la
 * liste. Un identifiant retenu qui n'est plus dans les lignes est IGNORÉ : la
 * passe n'écrit que ce qu'elle voit (un reçu renseigné entre-temps a quitté la
 * liste, et il n'a plus rien à faire ici).
 */
export function silentReceiptTargets(
  rows: readonly SilentReceiptRow[],
  studentIds: readonly string[],
): SilentReceiptTarget[] {
  const wanted = new Set(studentIds);
  const targets: SilentReceiptTarget[] = [];
  for (const row of rows) {
    if (!wanted.has(row.student.id)) continue;
    const payment = row.receipts[0];
    if (!payment) continue;
    targets.push({ studentId: row.student.id, studentName: row.student.name, payment });
  }
  return targets;
}

/**
 * Ce que le compte rendu publie, réduit à ses deux comptes.
 *
 * `refused` compte les reçus que la base a REFUSÉS (ou qui n'ont pas été
 * écrits) : le compte rendu qui n'aurait qu'un total ferait passer un refus
 * pour une réussite, exactement la faute que le reste du dépôt refuse.
 */
export interface SilentReceiptPassSummary {
  written: number;
  refused: number;
  total: number;
}

export function silentReceiptsPassSummary(
  outcomes: readonly { ok: boolean }[],
): SilentReceiptPassSummary {
  const written = outcomes.filter((o) => o.ok).length;
  return { written, refused: outcomes.length - written, total: outcomes.length };
}

// ─── LE PARCOURS ÉLÈVE PAR ÉLÈVE : tout le travail, du plus gros au plus petit ─
//
// L'écran École savait LISTER (qui porte des reçus muets, et dans quel ordre) et
// la passe groupée écrivait UN choix de mois pour toute une classe. Ce qui
// manquait, c'est le geste du comptoir quand il n'y a pas de classe à grouper :
// prendre les élèves DANS L'ORDRE DE LA LISTE — le plus gros montant non
// documenté d'abord — et renseigner leurs reçus muets l'un après l'autre, sans
// ouvrir une seule fiche. Le parcours ne remplace donc pas la passe : il la
// complète pour le travail qui n'a pas de mois commun.
//
// Ce module ne porte que la MATIÈRE du parcours — l'ordre du plan, et le verdict
// d'une étape. L'écran porte la boucle ; l'écriture reste celle de l'application
// (`updatePaymentMonths` : la fonction `public.set_payment_months` ou la file
// hors ligne), un appel par reçu, comme partout ailleurs.

/**
 * Le PLAN du parcours : chaque reçu muet à renseigner, dans l'ordre de la liste.
 *
 * Deux ordres, et chacun vient d'ailleurs — donc rien n'est réinventé ici :
 *   • les ÉLÈVES suivent celui de la liste (montant non documenté décroissant),
 *     c'est la demande : « du plus gros montant au plus petit » ;
 *   • les REÇUS d'un même élève suivent celui de sa ligne — du plus ancien au
 *     plus récent, comme le parcours d'une fiche (`PaymentMonthsBackfill`) : on
 *     rattrape dans l'ordre du calendrier, et non dans celui des clics.
 *
 * Un reçu, une étape : l'élève qui porte trois reçus muets en donne trois, et
 * chacun s'écrit séparément (la base ne connaît aucune écriture de masse de
 * `months`). Rendu : un tableau NEUF — le parcours ne touche pas aux lignes.
 */
export function silentReceiptsWalk(rows: readonly SilentReceiptRow[]): SilentReceiptTarget[] {
  const steps: SilentReceiptTarget[] = [];
  for (const row of rows) {
    for (const payment of row.receipts) {
      steps.push({ studentId: row.student.id, studentName: row.student.name, payment });
    }
  }
  return steps;
}

/**
 * Le reçu d'une étape est-il ENCORE muet ?
 *
 * Le plan est pris au départ, et la liste vit : un collègue a pu renseigner ce
 * reçu pendant que le parcours était ouvert. La ligne d'un élève ne contient que
 * ses reçus MUETS, donc « encore présent dans sa ligne » est exactement « encore
 * à documenter » — et un reçu qui n'y est plus est ÉCARTÉ, jamais écrasé :
 * réécrire des mois déjà déclarés serait un autre geste, que personne n'a
 * demandé.
 *
 * Un reçu SANS identifiant rend `false` : on ne peut ni le reconnaître dans la
 * liste vivante ni l'écrire (`set_payment_months` s'adresse à un reçu par son
 * id), donc on ne le touche pas — l'ignorer en silence serait la faute.
 */
export function walkTargetIsSilent(
  rows: readonly SilentReceiptRow[],
  target: SilentReceiptTarget,
): boolean {
  const id = target.payment.id;
  if (!id) return false;
  const row = rows.find((entry) => entry.student.id === target.studentId);
  return Boolean(row?.receipts.some((payment) => payment.id === id));
}

/**
 * Ce qu'une étape du parcours devient.
 *
 * Trois verdicts, et ils ne se confondent pas : `ok` (écrit, ou mis en FILE hors
 * ligne — `queued` le dit), `!ok && skipped === null` (la base a REFUSÉ : rien
 * n'a été écrit), et `skipped` non nul — rien n'a été tenté, avec sa raison :
 * `'stale'` (le reçu a été renseigné entre-temps : le parcours ne l'écrase pas)
 * ou `'passed'` (l'utilisateur a laissé ce reçu de côté).
 *
 * Un refus qui ne se distinguerait pas d'un reçu laissé de côté ferait lire
 * « rien à faire » là où l'école doit relire un droit ou un mois mal formé.
 */
export interface SilentReceiptWalkOutcome {
  /** La cible visée : l'élève, son nom, et le reçu muet. */
  target: SilentReceiptTarget;
  /** Les mois retenus pour un enregistrement tenté ; vide quand rien n'a été tenté. */
  months: string[];
  /** L'écrivain a rendu `true` (écrit en base, ou mis en file hors ligne). */
  ok: boolean;
  /** `true` quand cet `ok` est une mise en FILE, pas une ligne en base. */
  queued: boolean;
  /** `null` quand l'étape a été JUGÉE ; sinon, pourquoi rien n'a été écrit. */
  skipped: 'stale' | 'passed' | null;
}

/** Le compte rendu du parcours, réduit à ses trois comptes. */
export interface SilentReceiptWalkSummary {
  written: number;
  refused: number;
  skipped: number;
  total: number;
}

/**
 * Les trois comptes du compte rendu, et ils sont disjoints.
 *
 * `skipped` (rien tenté) n'est ni un écrit ni un refus, et `written` ne compte
 * que les étapes réellement écrites (en base ou en file) : un total unique, ou
 * un `skipped` fondu dans les refus, ferait passer pour un geste ce qui n'en fut
 * pas un — la faute que le reste du dépôt refuse.
 */
export function silentReceiptsWalkSummary(
  outcomes: readonly { ok: boolean; skipped: 'stale' | 'passed' | null }[],
): SilentReceiptWalkSummary {
  let written = 0;
  let refused = 0;
  let skipped = 0;
  for (const outcome of outcomes) {
    if (outcome.skipped !== null) skipped += 1;
    else if (outcome.ok) written += 1;
    else refused += 1;
  }
  return { written, refused, skipped, total: outcomes.length };
}
