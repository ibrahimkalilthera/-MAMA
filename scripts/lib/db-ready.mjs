// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/db-ready.mjs — LA BASE PEUT-ELLE PORTER CE BUILD ?
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// L'ordre « la base d'abord, le build ensuite » n'était vérifié que d'un côté :
// le déploiement du SITE (`deploy.yml`, sa quatrième porte) refuse de publier
// quand une migration déclarée n'est pas en base. Le BUILD DE BUREAU, lui,
// n'avait aucune porte de ce genre — alors que c'est lui qui atteint le parc :
// un installeur publié avant sa migration équipe tous les postes d'une
// application qui écrit dans une table absente, et une publication ne se
// reprend pas (les postes équipés gardent leurs octets).
//
// Mesuré le 2026-10-14, sur le battement de version du parc : la table
// `station_versions` et sa fonction devaient exister AVANT qu'un poste puisse
// déclarer sa version. Rien, dans la chaîne du build, ne l'exigeait — la seule
// chose qui l'exigeait était le déploiement du site, c'est-à-dire un AUTRE
// canal, sur un AUTRE déclencheur. C'est précisément la dépendance que ce
// module retire : le publieur juge désormais lui-même la base qu'il va nourrir.
//
// ─── LES TROIS QUESTIONS, ET PAS UNE (mesuré le 2026-10-16) ──────────────────
// Ce module n'a d'abord posé qu'UNE question — « les COLONNES déclarées
// existent-elles ? » (`check:hosted-schema`, canal PostgREST, clé anon) — et
// cette question unique a été MESURÉE insuffisante le jour même où le réglage
// « nom de l'école » est arrivé : la migration `20261022000000_school_name.sql`
// n'ajoute AUCUNE colonne, seulement une contrainte `CHECK`. Le contrôle des
// colonnes sortait **vert** pendant que `check:db-objects` sortait **rouge** en
// nommant `public.app_settings.app_settings_school_name_check` ABSENT du
// catalogue. Un push dans cet état aurait donc été « base prête » pour le
// publieur et pour le déploiement du site, alors que la base n'avait pas la
// règle que le build embarque. Les trois familles d'objets restantes sont
// chacune un défaut différent, et aucune n'est visible des deux autres :
//
//   • les INDEX, CONTRAINTES et DÉCLENCHEURS (`check:db-objects`) : une
//     contrainte absente laisse entrer ce que le dépôt refuse d'écrire, un
//     déclencheur absent est plus silencieux encore ;
//   • les POLITIQUES (`check:rls-policies`) : une politique absente refuse une
//     écriture que l'écran propose — le défaut du 2026-10-14, où personne hors
//     `is_admin()` ne pouvait enregistrer une préférence d'affichage.
//
// ─── Ce qu'il juge, et par quel canal ────────────────────────────────────────
// Le verdict vient des contrôles qui existent DÉJÀ (`DB_READY_SCRIPTS`) : ce
// module ne sonde RIEN lui-même, il traduit des codes de sortie en REFUS ou en
// autorisation. C'est la règle du dépôt — deux listes dériveraient l'une de
// l'autre —, donc ce qui est jugé reste `supabase/migrations/`, lu par le même
// parseur que `db:snapshot` et `check:hosted-schema`.
//
// ─── La sémantique des deux refus, et pourquoi elle est BINAIRE ici ──────────
// `deploy.yml` distingue « la base est en retard » (ROUGE) de « je n'ai pas pu
// regarder » (NEUTRE, exit 78) : un déploiement de site est reproductible, donc
// une panne de lecture y est un incident passager. Ici, les deux REFUSENT.
// Ce n'est pas une incohérence, c'est la différence de conséquence : publier un
// installeur est une ÉCRITURE irréversible sur le parc, et il n'existe pas de
// bouton pour la défaire. « Je n'ai pas pu regarder » ne peut donc pas autoriser
// un geste que « la base est en retard » interdit — et les deux refus sont
// DITS différemment, parce qu'ils n'envoient pas réparer la même chose.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les contrôles qui répondent à la question, DANS L'ORDRE, et ce que chacun
 * regarde.
 *
 * La liste est exportée — et vérifiée par la suite de tests — pour qu'un
 * renommage d'un seul côté rougisse au lieu de faire autoriser le publieur en
 * silence : un gate qui appelle un script absent doit REFUSER, pas passer pour
 * vert. Les trois scripts sont ceux que la veille `public-rls-watch` exécute
 * déjà, et ceux que les deux chaînes de publication interrogent avant leur
 * build : une seule liste, donc, lue par quatre endroits.
 */
export const DB_READY_SCRIPTS = [
  {
    script: 'scripts/check-hosted-schema.mjs',
    label: 'les colonnes',
    because:
      'un poste équipé interroge CETTE base : publié d’abord, ce build écrirait dans une table ' +
      'ou une colonne qui n’existe pas — et une publication ne se reprend pas',
    remedy:
      'la clé anon du `.env` du dépôt suffit à poser la question (`npm run check:hosted-schema`)',
  },
  {
    script: 'scripts/check-db-objects.mjs',
    label: 'les index, les contraintes et les déclencheurs',
    because:
      'une contrainte absente laisse entrer ce que l’application refuse d’écrire, et un ' +
      'déclencheur absent remplit en silence une colonne que plus aucun écran n’écrit',
    remedy:
      'ce contrôle lit les catalogues par connexion directe (`npm run check:db-objects`) : il lui ' +
      'faut `SUPABASE_DB_PASSWORD`, et il ne lit aucune donnée',
  },
  {
    script: 'scripts/check-rls-policies.mjs',
    label: 'les politiques RLS',
    because:
      'une politique absente refuse une écriture que l’écran propose — l’écran ment sans le ' +
      'savoir, et la base répond 42501 au moment du geste',
    remedy:
      'ce contrôle lit les politiques par connexion directe (`npm run check:rls-policies`) : il lui ' +
      'faut `SUPABASE_DB_PASSWORD`, et il ne lit aucune donnée',
  },
];

/**
 * Le contrôle des COLONNES — le premier de la liste, et celui dont le nom est
 * cité par les messages historiques. Conservé à part pour qu'un renommage d'un
 * seul côté rougisse (voir la suite de tests).
 */
export const DB_READY_SCRIPT = DB_READY_SCRIPTS[0].script;

/** Sortie d'un contrôle : la base est EN RETARD — un défaut nommé. */
export const STATUS_DELAYED = 1;

/** Sortie d'un contrôle : aucun verdict possible (réseau, clé absente, réponse inconnue). */
export const STATUS_UNVERIFIED = 2;

/** Le remède d'un retard : c'est la BASE qu'on corrige, jamais le build. */
export const APPLY_HINT =
  'la correction est une migration appliquée à la base, jamais un build republié : ' +
  '`npm run db:apply -- supabase/migrations/<fichier>.sql` (elle prouve AVANT et APRÈS, ' +
  'dans une transaction), puis relancez `npm run release:publish`';

/** Le libellé d'un contrôle (son nom court), pour NOMMER ce qui refuse. */
function labelOf(script) {
  return DB_READY_SCRIPTS.find((entry) => entry.script === script)?.label ?? script;
}

/**
 * Les lignes du contrôle à MONTRER dans le refus.
 *
 * Le rapport utile est en FIN de sortie (le verdict, puis la liste des objets en
 * retard, puis le rappel du remède), donc on garde la fin. Les lignes `✅`
 * sont retirées : dans un refus, elles ne disent rien de ce qu'il faut corriger
 * et repoussent hors de l'écran ce qui compte. `limit` borne ce qu'un journal
 * de CI affiche — un refus qu'on ne lit pas est un refus qu'on ne répare pas.
 *
 * @param {unknown} output la sortie du contrôle (stdout et stderr réunis)
 * @param {number} [limit]
 * @returns {string[]}
 */
export function quoteVerdict(output, limit = 20) {
  return String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() && !line.includes('✅'))
    .slice(-limit);
}

/**
 * Le verdict d'UN contrôle : traduit son code de sortie, et rien de plus.
 *
 * Pure : elle ne sonde rien, ne lit rien, et ne connaît ni le réseau ni le
 * disque. Le code de sortie n'a PAS de valeur par défaut, et c'est délibéré :
 * un appelant qui ne le fournit pas (erreur sans `status`, processus tué par un
 * signal) se retrouve avec `NaN`, donc REFUSÉ. Une valeur par défaut à zéro
 * aurait fait de « je ne sais pas » un « c'est bon » — le seul défaut que ce
 * gate ne peut pas se permettre.
 *
 * @param {{ script?: string, code?: number|null, output?: string }} probe
 * @returns {{ ok: boolean, kind: 'ready'|'delayed'|'unverified', label: string, output: string, note: string }}
 */
function judgeOneProbe({ script = DB_READY_SCRIPT, code, output = '' } = {}) {
  // `null` et `undefined` sont ramenés à NaN, jamais à zéro : un `execFileSync`
  // tué par un signal rend `status: null`, et le lire comme « sortie 0 »
  // autoriserait le publieur exactement quand on ne sait rien.
  const status = Number(code ?? NaN);
  const label = labelOf(script);
  if (status === 0) return { ok: true, kind: 'ready', label, output: String(output ?? ''), note: '' };
  if (status === STATUS_DELAYED) {
    return { ok: false, kind: 'delayed', label, output: String(output ?? ''), note: '' };
  }
  const why =
    status === STATUS_UNVERIFIED
      ? 'le contrôle n’a pas pu rendre de verdict (réseau, clé absente, réponse inconnue)'
      : `le contrôle est sorti en ${Number.isFinite(status) ? status : '?'}, un code que ce gate ne connaît pas`;
  return { ok: false, kind: 'unverified', label, output: String(output ?? ''), note: why };
}

/**
 * Le verdict : ce build a-t-il le droit de partir vers l'ensemble du parc ?
 *
 * Accepte UN contrôle (`{ code, output }`, la forme historique) ou PLUSIEURS
 * (`{ probes: [{ script, code, output }] }`). La règle est la même dans les deux
 * cas : il faut que TOUS soient verts, un seul refus suffit, et le refus NOMME
 * les contrôles concernés — un refus qui ne dit pas quelle question a échoué
 * envoie chercher au mauvais endroit.
 *
 * @param {{ code?: number|null, output?: string, probes?: { script?: string, code?: number|null, output?: string }[] }} [input]
 * @returns {{ ok: boolean, verdict: 'ready'|'delayed'|'unverified', title: string, problems: string[] }}
 */
export function judgeDbReady({ code, output = '', probes } = {}) {
  const list = Array.isArray(probes) ? probes : [{ code, output }];
  const judged = list.map((probe) => judgeOneProbe(probe));
  const refused = judged.filter((probe) => !probe.ok);

  if (refused.length === 0) {
    return { ok: true, verdict: 'ready', title: '', problems: [] };
  }

  const delayed = refused.filter((probe) => probe.kind === 'delayed');
  const unverified = refused.filter((probe) => probe.kind === 'unverified');
  const named = refused.map((probe) => probe.label).join(' », « ');

  if (delayed.length > 0) {
    // La ligne de tête reste CELLE DE LA QUESTION COLONNES quand elle est seule
    // à refuser (les messages du dépôt la citent), et elle NOMME les contrôles
    // dès qu'ils sont plusieurs : « la base est en retard » sans dire sur quoi
    // ferait appliquer la mauvaise moitié.
    const title =
      refused.length === 1 && delayed[0].label === labelOf(DB_READY_SCRIPT)
        ? 'publication refusée — la base hébergée ne porte pas les migrations que ce build embarque'
        : `publication refusée — la base hébergée ne porte pas ce que les migrations déclarent (« ${named} »)`;
    const problems = [
      ...delayed.flatMap((probe) => [
        `contrôle : ${probe.label} (${list.find((p) => labelOf(p?.script) === probe.label)?.script ?? DB_READY_SCRIPT}) — la base est EN RETARD`,
        ...quoteVerdict(probe.output),
      ]),
      'un poste équipé interroge CETTE base : publié d’abord, ce build écrirait dans une table ' +
        'ou une colonne qui n’existe pas — et une publication ne se reprend pas',
      APPLY_HINT,
    ];
    for (const probe of unverified) {
      problems.push(
        `et le contrôle « ${probe.label} » n’a pas pu rendre de verdict : ${probe.note} — ` +
          'un refus faute de preuve n’est pas un faux rouge, il vient en plus du retard ci-dessus',
      );
    }
    return { ok: false, verdict: 'delayed', title, problems };
  }

  const reasons = unverified.map((probe) => `« ${probe.label} » : ${probe.note}`);
  return {
    ok: false,
    verdict: 'unverified',
    title: 'publication refusée — aucun verdict sur la base hébergée',
    problems: [
      `« je n’ai pas pu regarder » n’est pas « c’est bon » : ${reasons.join(' ; ')}`,
      'un refus faute de preuve n’est pas un faux rouge : c’est un geste irréversible qu’on n’engage pas sans elle',
      ...unverified.flatMap((probe) => quoteVerdict(probe.output)),
      ...DB_READY_SCRIPTS.map((entry) => `- « ${entry.label} » : ${entry.remedy}`),
    ],
  };
}
