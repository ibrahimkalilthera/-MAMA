// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/duplicate-students.mjs — repérer un élève inscrit deux fois.
//
// Le contrôle des reçus (scripts/lib/duplicate-receipts.mjs) relit la CAISSE. Il
// ne pouvait rien dire du REGISTRE, et c'est là que le défaut a été mesuré le
// 2026-10-06 : deux groupes de `public.students` y partagent un nom ET une
// classe — « Safiatou COULIBALY » en 5A, « Fatoumata COULIBALY » en 8A — avec des
// fiches qui diffèrent (un « Tuteur » d'un côté, la mère de l'autre). Personne ne
// les avait vus parce qu'aucun contrôle ne regardait cette table.
//
// ─── Le critère, et ce qu'il ne prouve PAS ──────────────────────────────────
// Un groupe suspect = plusieurs lignes de `public.students` qui portent le même
// NOM (insensible à la casse, espaces de bord retirés) dans la même CLASSE. C'est
// la signature d'une double inscription — la même famille qui repasse au bureau,
// ou un import rejoué.
//
// Il ne PROUVE pas un doublon : deux homonymes dans une même classe existent, et
// c'est fréquent — 423 élèves ont donné exactement deux groupes. Ce que ce
// contrôle rend, ce sont les FICHES À REGARDER, avec de quoi trancher : matricule,
// parent, téléphone, total dû, montant déjà payé, statut, année, date
// d'inscription et date de saisie. C'est l'école qui décide, depuis la fiche ; un
// outil qui supprime un élève réel ferait un dégât irréparable, pas un nettoyage.
//
// ─── Pourquoi le registre ENTIER, sans borne de période ─────────────────────
// Le contrôle des reçus est borné à la semaine close parce qu'une caisse se clôt.
// Un doublon d'INSCRIPTION ne se périme pas avec la semaine : une fiche en double
// créée en septembre reste à vérifier en novembre. Le registre se relit donc en
// entier, à chaque passage — et un doublon non résolu continue d'apparaître, ce
// qui est exactement ce qu'on veut d'une liste de choses à trancher.
//
// ─── Un nom vide n'est pas un doublon ───────────────────────────────────────
// Deux fiches sans nom dans la même classe ne partagent rien : les grouper ferait
// un faux groupe sur tout un registre incomplet. Elles sont donc écartées du
// contrôle (comme un reçu vide l'est de « numéro réutilisé ») — la fiche
// incomplète est un autre problème, que ce contrôle ne prétend pas régler.
// ─────────────────────────────────────────────────────────────────────────────

/** Le troisième contrôle du rapport : même nom, même classe. */
export const CONTROL_STUDENT_NAME_GRADE = 'meme_nom_meme_classe';

/**
 * Toutes les fiches de la fenêtre — non, du REGISTRE — avec le nombre de lignes
 * du même groupe (nom + classe).
 *
 * `count(*) over (partition by …)` plutôt qu'un `group by` : le rapport veut UNE
 * LIGNE PAR FICHE (l'école agit sur une fiche, pas sur un agrégat) et le compte
 * des lignes du groupe. Les colonnes de DISCRIMINATION sont là pour ça : sans
 * elles, la feuille dirait « ces deux-là se ressemblent » sans donner de quoi
 * trancher, et quelqu'un supprimerait la mauvaise.
 *
 * L'ordre est stable (nom, classe, date de saisie, id) pour que deux passages
 * produisent le même fichier au même endroit.
 *
 * `lower(trim(p.name))` des DEUX côtés (partition et tri) : une espace de bord ne
 * doit pas ouvrir un second groupe, et la casse ne fait pas deux élèves.
 */
export const DUPLICATE_STUDENT_SQL = `
  select p.id,
         p.name,
         coalesce(p.grade, '')            as grade,
         coalesce(p.student_id, '')       as matricule,
         coalesce(p.parent_name, '')      as parent_name,
         coalesce(p.parent_phone, '')     as parent_phone,
         p.total_due,
         p.amount_paid,
         coalesce(p.status, '')           as status,
         coalesce(p.academic_year, '')    as academic_year,
         p.enrollment_date,
         p.created_at,
         count(*) over (partition by lower(trim(p.name)), coalesce(p.grade, ''))::int as occurrences
    from public.students p
   where coalesce(trim(p.name), '') <> ''
   order by lower(trim(p.name)), coalesce(p.grade, ''), p.created_at, p.id
`;

/** Combien de fiches le registre contient — le dénominateur du rapport. */
export const TOTAL_STUDENTS_SQL = `
  select count(*)::int as n
    from public.students p
   where coalesce(trim(p.name), '') <> ''
`;

/**
 * Les colonnes du CSV du registre, dans l'ordre. Intitulés en français, unité
 * incluse, comme ceux des reçus : c'est la feuille que le bureau lit.
 */
export const STUDENT_CSV_COLUMNS = [
  { key: 'controle', header: 'controle' },
  { key: 'eleve', header: 'eleve' },
  { key: 'classe', header: 'classe' },
  { key: 'matricule', header: 'matricule' },
  { key: 'parent', header: 'parent' },
  { key: 'telephone', header: 'telephone' },
  { key: 'totalDu', header: 'total_du_fcfa' },
  { key: 'dejaPaye', header: 'deja_paye_fcfa' },
  { key: 'statut', header: 'statut' },
  { key: 'annee', header: 'annee_academique' },
  { key: 'occurrences', header: 'occurrences' },
  { key: 'inscritLe', header: 'inscrit_le' },
  { key: 'saisiLe', header: 'saisi_le' },
  { key: 'eleveId', header: 'eleve_id' },
];

/** Le nombre de lignes qui partagent la clé de cette ligne (jamais un texte). */
const countOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Une date pg en jour court, sans dépendre du fuseau. */
const isoDay = (value) => {
  if (!value) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 10);
};

/** L'instant de saisie en ISO court — « 2026-10-05 17:26 » pour une feuille. */
const isoMinute = (value) => {
  if (!value) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 16).replace('T', ' ');
};

/**
 * Une fiche d'élève, vue par le contrôle.
 * @param {Record<string, unknown>} row ligne rendue par `DUPLICATE_STUDENT_SQL`
 */
function studentCsvRow(row) {
  return {
    controle: CONTROL_STUDENT_NAME_GRADE,
    eleve: String(row.name ?? ''),
    classe: String(row.grade ?? ''),
    matricule: String(row.matricule ?? ''),
    parent: String(row.parent_name ?? ''),
    telephone: String(row.parent_phone ?? ''),
    totalDu: String(row.total_due ?? ''),
    dejaPaye: String(row.amount_paid ?? ''),
    statut: String(row.status ?? ''),
    annee: String(row.academic_year ?? ''),
    occurrences: countOf(row.occurrences),
    inscritLe: isoDay(row.enrollment_date),
    saisiLe: isoMinute(row.created_at),
    eleveId: String(row.id ?? ''),
  };
}

/**
 * Les fiches à vérifier : une ligne par ÉLÈVE dont le groupe compte plus d'une
 * ligne, dans l'ordre stable de la requête.
 *
 * @param {{ studentRows?: Record<string, unknown>[] }} input
 * @returns {ReturnType<typeof studentCsvRow>[]}
 */
export function flaggedStudentRows({ studentRows = [] } = {}) {
  return studentRows.filter((row) => countOf(row.occurrences) > 1).map(studentCsvRow);
}

/**
 * Ce que le registre a MESURÉ, séparément du fichier.
 *
 * `duplicateGroups` compte les groupes (nom + classe) DISTINCTS, pas les fiches :
 * deux fiches du même groupe font UN cas à trancher, et annoncer « 2 » ferait
 * croire à deux problèmes.
 *
 * @param {{ studentRows?: Record<string, unknown>[], totalStudents?: number }} input
 */
export function summarizeStudents({ studentRows = [], totalStudents = 0 } = {}) {
  const duplicateGroups = new Set();
  for (const row of studentRows) {
    if (countOf(row.occurrences) > 1) {
      duplicateGroups.add(`${String(row.name ?? '').toLowerCase().trim()}|${String(row.grade ?? '')}`);
    }
  }
  return {
    totalStudents: countOf(totalStudents),
    duplicateGroups: duplicateGroups.size,
    flaggedLines: flaggedStudentRows({ studentRows }).length,
  };
}

/** Les critères du registre, dits une fois — le script les imprime. */
export const CRITERIA_STUDENTS = [
  `${CONTROL_STUDENT_NAME_GRADE} : plusieurs fiches du même nom (casse et espaces ignorés) dans la même classe`,
];
