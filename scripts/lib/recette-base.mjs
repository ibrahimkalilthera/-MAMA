// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/recette-base.mjs — où la recette a le droit d'écrire des lignes.
//
// Le partage production/recette, tranché et mesuré (2026-09-14) :
//
//   • la base partagée (`rpcjdohfxwukbqngbprw`) est la SEULE que l'application
//     sait lire — c'est la décision « une seule base pour tout le monde », et
//     elle a coûté une refonte pour être vraie ;
//   • le projet de recette déclaré (`vulbmmzhcmnzswcvswfk`) répond encore
//     (HTTP 401, mesuré le 2026-09-14) mais l'application ne pointe pas dessus :
//     y faire tourner les cycles demanderait un SECOND déploiement de l'app,
//     donc pas aujourd'hui ;
//   • les cycles E2E écrivent donc dans la base partagée — ce qui prouve le
//     chemin réel, et ce qui a rempli le journal d'audit de 432 lignes de bruit
//     de recette avant la mise en service.
//
// D'où la règle, la seule qui protège l'école sans casser la preuve : la recette
// écrit tant que la base est LIBRE de données d'école ; dès la première ligne
// réelle, elle REFUSE d'écrire et dit pourquoi, avec les deux issues possibles.
// Un garde-fou qui rougit au bon moment vaut mieux qu'un partage qu'on oublie.
//
// La fonction de jugement est PURE : elle est ce qui décide, donc elle se teste
// (tests/recette-base.test.ts) au lieu de se relire.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les tables qui portent une SAISIE de l'école.
 *
 * Volontairement exclues : `user_profiles` (les comptes existent avant l'école),
 * `academic_years` (une année est ouverte par l'app elle-même) et `audit_logs`
 * (le journal est le récit, pas la donnée — et il est fait pour être purgé).
 */
export const SCHOOL_TABLES = [
  'students',
  'parents',
  'staff',
  'payments',
  'expenses',
  'salary_payments',
  'vendor_expenses',
];

/**
 * Compte les lignes des tables métier — la seule chose que ce module lit.
 *
 * Un comptage qui échoue n'est PAS un zéro : la table est absente du résultat et
 * listée dans `unread`, sinon une passerelle en panne ferait passer une base
 * pleine pour une base libre, c'est-à-dire autoriserait l'écriture au pire
 * moment. La lecture est bornée à zéro ligne (`Range: 0-0`) : seul le total du
 * `content-range` est lu, aucune donnée d'école ne transite par ici.
 *
 * @param {{base: string, key: string, fetchImpl?: typeof fetch, tables?: string[]}} input
 * @returns {Promise<{counts: Record<string, number>, unread: string[]}>}
 */
export async function readSchoolCounts({ base, key, fetchImpl = fetch, tables = SCHOOL_TABLES } = {}) {
  const counts = {};
  const unread = [];
  for (const table of tables) {
    try {
      const res = await fetchImpl(`${String(base).replace(/\/$/, '')}/rest/v1/${table}?select=id`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
      });
      const range = res.headers.get('content-range') ?? '';
      const total = range.includes('/') ? Number(range.split('/')[1]) : Number.NaN;
      if (!res.ok || !Number.isFinite(total)) unread.push(`${table} (HTTP ${res.status})`);
      else counts[table] = total;
    } catch (error) {
      unread.push(`${table} (${error?.cause?.code ?? error?.message ?? 'injoignable'})`);
    }
  }
  return { counts, unread };
}

/**
 * La recette peut-elle écrire ici ?
 *
 * @param {object} input
 * @param {Record<string, number|string|null>} input.counts  lignes par table (nombre ou texte)
 * @param {boolean} [input.allow]  dérogation explicite d'un humain (jamais la CI)
 * @returns {{ok: boolean, cause: string, detail: string, tables: Array<{table: string, rows: number}>}}
 */
export function recetteWriteVerdict({ counts = {}, allow = false } = {}) {
  const read = (table) => {
    const raw = counts[table];
    // Absent, `null` ou vide = NON LU. Un `Number('')` vaut 0, et ce zéro-là est
    // précisément le faux ami qui autoriserait l'écriture sur une table qu'on n'a
    // jamais interrogée.
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
  };

  // Un comptage incomplet n'est PAS une base libre : sans chiffre sur une table,
  // on ne peut pas affirmer qu'aucune donnée d'école ne l'habite, donc on refuse.
  // (C'est la règle de tout le dépôt : un contrôle qui ne peut pas regarder ne
  // félicite personne.)
  const unread = SCHOOL_TABLES.filter((table) => read(table) === null);
  if (unread.length) {
    return {
      ok: false,
      cause: 'comptage incomplet',
      detail: `table(s) non lue(s) : ${unread.join(' · ')} — sans chiffre, on n’autorise pas l’écriture`,
      tables: [],
    };
  }

  const filled = SCHOOL_TABLES.map((table) => ({ table, rows: read(table) })).filter((t) => t.rows > 0);

  if (!filled.length) {
    return {
      ok: true,
      cause: 'base libre de données d’école',
      detail: `les ${SCHOOL_TABLES.length} table(s) métier sont vides : la recette peut écrire, et ses lignes seront balayées par ses propres préfixes`,
      tables: [],
    };
  }

  const named = filled.map((t) => `${t.table} ${t.rows}`).join(' · ');
  if (allow) {
    return {
      ok: true,
      cause: 'dérogation explicite',
      detail: `la base porte des données d’école (${named}) et l’écriture a été autorisée à la main — la recette va écrire À CÔTÉ de données réelles`,
      tables: filled,
    };
  }

  return {
    ok: false,
    cause: 'la base porte des données d’école',
    detail:
      `lignes réelles mesurées : ${named}. Les cycles de recette n’écrivent plus ici : ` +
      'leurs élèves, parents, employés, paiements et dépenses de démonstration se mêleraient ' +
      'aux saisies de l’école, et un nettoyage râté les y laisserait. Deux issues — pointer la ' +
      'recette sur son propre projet Supabase (aujourd’hui « vulbmmzhcmnzswcvswfk » répond, mais ' +
      'il faudrait un second déploiement de l’app qui le lise), ou assumer le partage avec ' +
      '`--allow` en sachant ce que cela veut dire.',
    tables: filled,
  };
}
