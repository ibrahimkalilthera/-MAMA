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
// ─── Ce qu'il juge, et par quel canal ────────────────────────────────────────
// Le verdict vient du contrôle qui existe déjà (`scripts/check-hosted-schema.mjs`) :
// ce module ne sonde RIEN lui-même, il traduit un code de sortie en REFUS ou en
// autorisation. C'est la règle du dépôt — deux listes de tables dériveraient
// l'une de l'autre —, donc la liste jugée reste `supabase/migrations/`, lue par
// le même parseur que `db:snapshot` et `check:hosted-schema`.
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
 * Le contrôle qui sait dire si une migration déclarée manque en base.
 *
 * Le nom est exporté — et vérifié par la suite de tests — pour qu'un renommage
 * d'un seul côté rougisse au lieu de faire autoriser le publieur en silence : un
 * gate qui appelle un script absent doit REFUSER, pas passer pour vert.
 */
export const DB_READY_SCRIPT = 'scripts/check-hosted-schema.mjs';

/** Sortie du contrôle : la base est EN RETARD — un défaut nommé, table par table. */
export const STATUS_DELAYED = 1;

/** Sortie du contrôle : aucun verdict possible (réseau, clé absente, réponse inconnue). */
export const STATUS_UNVERIFIED = 2;

/** Le remède d'un retard : c'est la BASE qu'on corrige, jamais le build. */
export const APPLY_HINT =
  'la correction est une migration appliquée à la base, jamais un build republié : ' +
  '`npm run db:apply -- supabase/migrations/<fichier>.sql` (elle prouve AVANT et APRÈS, ' +
  'dans une transaction), puis relancez `npm run release:publish`';

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
 * Le verdict : ce build a-t-il le droit de partir vers le parc ?
 *
 * Pure : elle ne sonde rien, ne lit rien, et ne connaît ni le réseau ni le
 * disque. C'est ce qui la rend testable sans base — et c'est aussi ce qui
 * garantit qu'un code de sortie INCONNU refuse au lieu de passer : un gate qui
 * laisse passer ce qu'il ne comprend pas est un gate qui n'existe pas.
 *
 * Le code de sortie n'a PAS de valeur par défaut, et c'est délibéré : un
 * appelant qui ne le fournit pas (erreur sans `status`, processus tué par un
 * signal) se retrouve avec `NaN`, donc REFUSÉ. Une valeur par défaut à zéro
 * aurait fait de « je ne sais pas » un « c'est bon » — le seul défaut que ce
 * gate ne peut pas se permettre.
 *
 * @param {{ code?: number|null, output?: string }} [input] code de sortie du contrôle et sa sortie
 * @returns {{ ok: boolean, verdict: 'ready'|'delayed'|'unverified', title: string, problems: string[] }}
 */
export function judgeDbReady({ code, output = '' } = {}) {
  // `null` et `undefined` sont ramenés à NaN, jamais à zéro : un `execFileSync`
  // tué par un signal rend `status: null`, et le lire comme « sortie 0 »
  // autoriserait le publieur exactement quand on ne sait rien.
  const status = Number(code ?? NaN);
  if (status === 0) {
    return { ok: true, verdict: 'ready', title: '', problems: [] };
  }
  const quoted = quoteVerdict(output);

  if (status === STATUS_DELAYED) {
    return {
      ok: false,
      verdict: 'delayed',
      title: 'publication refusée — la base hébergée ne porte pas les migrations que ce build embarque',
      problems: [
        ...quoted,
        'un poste équipé interroge CETTE base : publié d’abord, ce build écrirait dans une table ' +
          'ou une colonne qui n’existe pas — et une publication ne se reprend pas',
        APPLY_HINT,
      ],
    };
  }

  const why =
    status === STATUS_UNVERIFIED
      ? 'le contrôle n’a pas pu rendre de verdict (réseau, clé absente, réponse inconnue)'
      : `le contrôle est sorti en ${Number.isFinite(status) ? status : '?'}, un code que ce gate ne connaît pas`;
  return {
    ok: false,
    verdict: 'unverified',
    title: 'publication refusée — aucun verdict sur la base hébergée',
    problems: [
      `« je n’ai pas pu regarder » n’est pas « c’est bon » : ${why}`,
      'un refus faute de preuve n’est pas un faux rouge : c’est un geste irréversible qu’on n’engage pas sans elle',
      ...quoted,
      'la clé anon du `.env` du dépôt suffit à poser la question (`npm run check:hosted-schema`) — ' +
        'ce contrôle ne lit aucune donnée, il ne fait que nommer des tables et des colonnes',
    ],
  };
}
