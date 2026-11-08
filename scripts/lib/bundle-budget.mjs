/**
 * ─── Le budget d'octets d'un morceau livré, en UNE table ────────────────────
 *
 * Le seul plafond de performance du dépôt est un SCORE Lighthouse global
 * (`PERF_THRESHOLD`, défaut 0,70). Un score est une moyenne : un morceau peut
 * DOUBLER de taille pendant qu'un autre maigrit, et l'audit reste vert. Le jour
 * où l'école ouvre l'application sur une connexion de Bamako, c'est pourtant le
 * morceau qui décide, pas la moyenne — et le téléphone d'un caissier ne lit pas
 * le rapport Lighthouse.
 *
 * Ce module ne mesure rien lui-même : il ne connaît ni `dist/`, ni Vite, ni le
 * disque. Le contrôle qui l'utilise (`scripts/check-bundle-budget.mjs`) lit les
 * fichiers produits, passe leurs tailles, et ce module les JUGE. La séparation
 * n'est pas une élégance : c'est ce qui permet de prouver la règle sur des
 * morceaux fabriqués, sans construire le projet.
 *
 * Un budget n'est pas une cible. Il est posé un peu au-dessus de ce que le
 * morceau pèse AUJOURD'HUI, pour que la prochaine dépendance importée par
 * mégarde se voie — pas pour forcer une réécriture. Le dépassement nomme le
 * fichier ET la famille : « vendor » ne dit pas quoi retirer, « vendor-abc.js :
 * 512 Ko > 420 Ko » le dit.
 */

/**
 * Budgets en KILO-OCTETS, par famille de morceau.
 *
 * Les valeurs suivent le découpage réel de `vite.config.ts` (`manualChunks`) :
 * l'index (l'application elle-même), le socle React/Supabase, le rendu PDF
 * (jspdf + pdf-lib + pdfjs), les graphiques (recharts), l'import Excel (xlsx),
 * les icônes (lucide), la feuille de style, et le reste. Elles sont GÉNÉREUSES
 * À DESSEIN : un budget trop serré se ferait relever au premier correctif, puis
 * désactiver — un garde qu'on désactive ne garde rien.
 */
export const CHUNK_BUDGETS_KB = {
  index: 500,
  vendor: 420,
  pdf: 900,
  charts: 400,
  excel: 520,
  icons: 120,
  css: 180,
  other: 250,
};

/**
 * LES VALEURS SONT MESURÉES, PAS DEVINÉES.
 *
 * Premier jet de cette table : des budgets posés « à vue », qui refusaient le
 * build SAIN du 2026-11-08 sur cinq morceaux (`App` 456 Ko, `es` 506, `BarChart`
 * 367, `xlsx` 481, feuille 160) — un garde rouge sur l'arbre intact s'apprend à
 * être contourné, jamais à être lu. Chaque valeur ci-dessus est donc le poids
 * réel du plus gros morceau de sa famille dans ce build, plus une marge étroite :
 * `index` 456 → 500, `charts` 367 → 400, `excel` 481 → 520, `css` 160 → 180.
 * `vendor` (377), `pdf` (506), `icons` (aucun morceau livré aujourd'hui) et
 * `other` (195, `html2canvas`) gardaient déjà leur marge.
 *
 * La prochaine dépendance importée par mégarde se verra donc contre une mesure,
 * et non contre un chiffre rond choisi pour faire joli.
 */

/**
 * La famille d'un morceau, d'après le nom que Vite lui donne
 * (`assets/index-AbC123.js`, `assets/vendor-AbC123.js`, `assets/pdfReceipt-…`).
 *
 * L'ordre des tests compte : un fichier `pdf-…css` n'existe pas aujourd'hui,
 * mais une feuille de style reste une feuille de style quoi qu'elle serve.
 * Le nom est jugé en minuscules, sans le dossier : le chemin d'un morceau peut
 * changer (`dist/assets/`), sa famille ne doit pas dépendre de lui.
 */
export function chunkFamily(fileName) {
  const name = String(fileName ?? '').split(/[\\/]/).pop() ?? '';
  const lower = name.toLowerCase();
  if (lower.endsWith('.css')) return 'css';
  // `es-*.js` : c'est le morceau du rendu PDF (pdfjs-dist, build « legacy »),
  // dont l'entrée s'appelle `es` dans le paquet. Le nom ne le dit pas — la
  // MESURE le dit : ce fichier (506 Ko) contient `PDFDocument`, et il n'apparaît
  // qu'après avoir ouvert un reçu. Sans cette règle, il tomberait dans « other »
  // et forcerait à relever le budget de tous les morceaux divers pour un seul
  // paquet PDF.
  if (lower.startsWith('es-')) return 'pdf';
  // `pdfReceipt`, `pdfPaymentHistory`, `pdfDailyCashReport` : tous les morceaux
  // de rendu PDF portent `pdf` en tête. Les bibliothèques qu'ils chargent
  // (jspdf, pdf-lib, pdfjs) sont nommées `vendor` par Vite si le découpage
  // manuel les y met ; c'est la FAMILLE du morceau livré qui compte, pas son
  // contenu.
  if (lower.startsWith('pdf') || lower.includes('pdf')) return 'pdf';
  if (lower.startsWith('vendor')) return 'vendor';
  // `BarChart-*.js` est le morceau de recharts : Vite le nomme d'après le
  // composant qui l'importe, pas d'après le paquet — d'où `chart` et pas
  // seulement `charts`.
  if (lower.startsWith('charts') || lower.includes('recharts') || lower.includes('chart')) return 'charts';
  if (lower.startsWith('excel') || lower.includes('xlsx')) return 'excel';
  if (lower.startsWith('icons') || lower.includes('lucide')) return 'icons';
  // L'APPLICATION elle-même : son entrée (`index-*`) et le morceau que Vite
  // nomme `App-*` (le shell + les vues chargées avec lui). `AppModals-*` n'est
  // PAS l'entrée : le préfixe est `app-`, pas `app`.
  if (lower.startsWith('index') || lower.startsWith('app-')) return 'index';
  return 'other';
}

/**
 * Mesure des morceaux réels.
 *
 * `bytes` est la taille SUR LE DISQUE (déjà compressée par le serveur ou non :
 * ce module ne juge que ce qu'on lui donne). Les kilo-octets sont arrondis au
 * dixième pour la lecture, mais la comparaison au budget se fait sur la valeur
 * EXACTE — arrondir avant de comparer ferait passer 420,04 Ko pour 420,0 et
 * laisserait un dépassement invisible.
 */
export function measureChunks(files) {
  return (files ?? []).map((file) => {
    const bytes = Number(file?.bytes);
    const kb = Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 : 0;
    const family = chunkFamily(file?.path);
    const budgetKb = CHUNK_BUDGETS_KB[family];
    return {
      family,
      path: String(file?.path ?? ''),
      kb: Math.round(kb * 10) / 10,
      budgetKb,
      over: kb > budgetKb,
    };
  });
}

/**
 * Le verdict : quels morceaux dépassent, et lequel est le pire.
 *
 * `tolerance` est une FRACTION (0,05 = 5 %) : elle existe pour absorber un
 * arrondi de build, pas pour excuser une dépendance ajoutée. Elle ne s'applique
 * qu'au verdict, jamais à ce qui est affiché — un morceau à 421 Ko pour un budget
 * de 420 reste écrit « 421 Ko > 420 Ko », même si la tolérance l'absout.
 *
 * `worst` est le dépassement de plus grand RAPPORT (kb / budget), pas celui de
 * plus grand écart : un morceau d'icônes à 200 Ko pour 120 est plus grave qu'un
 * index à 360 pour 350, alors que l'écart en Ko est plus petit.
 */
export function budgetVerdict(measured, opts = {}) {
  const tolerance = Math.max(0, Number(opts?.tolerance) || 0);
  const problems = [];
  let worst = null;
  let worstRatio = 0;
  for (const chunk of measured ?? []) {
    const ratio = chunk.budgetKb > 0 ? chunk.kb / chunk.budgetKb : 0;
    if (ratio > 1 + tolerance) {
      problems.push(`${chunk.path} : ${chunk.kb} Ko > ${chunk.budgetKb} Ko (famille ${chunk.family})`);
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worst = chunk.path;
      }
    }
  }
  return { ok: problems.length === 0, problems, worst };
}

/**
 * Le rapport lisible — une ligne par morceau mesuré, familles dans l'ordre de la
 * table, puis le verdict. Il est court parce qu'il finit dans un journal de CI
 * qu'on lit en diagonale, et il porte toujours l'unité : un nombre nu ne dirait
 * pas s'il s'agit d'octets ou de kilo-octets.
 */
export function formatBudgetReport(measured, verdict) {
  const order = Object.keys(CHUNK_BUDGETS_KB);
  const rows = [...(measured ?? [])].sort((a, b) => {
    const fa = order.indexOf(a.family);
    const fb = order.indexOf(b.family);
    return fa === fb ? a.path.localeCompare(b.path) : fa - fb;
  });
  const lines = ['Budget d’octets par morceau livré :'];
  for (const row of rows) {
    const mark = row.over ? '❌' : '✅';
    lines.push(`  ${mark} ${row.family.padEnd(8)} ${row.path} — ${row.kb} Ko / ${row.budgetKb} Ko`);
  }
  if (verdict?.ok) {
    lines.push(`✅ tous les morceaux tiennent leur budget (${rows.length} mesuré(s))`);
  } else {
    lines.push(`❌ ${verdict?.problems?.length ?? 0} dépassement(s) — pire : ${verdict?.worst ?? 'inconnu'}`);
  }
  return lines.join('\n');
}
