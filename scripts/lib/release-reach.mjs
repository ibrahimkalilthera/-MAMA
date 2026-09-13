// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-reach.mjs — à quoi le canal ENGAGE un poste.
//
// La question n'est pas « quel est le dernier release ? » mais « qu'est-ce qu'un
// poste resté sur telle version recevrait ? », et elle se pose version par
// version : chaque version publiée est une POPULATION de postes. Une tête peut
// être parfaitement cohérente pendant qu'une population entière sort du chemin.
//
// D'où deux tris qui doivent dire la même chose que le client : un brouillon et
// une PRÉ-version ne portent aucun poste, et seul un numéro STRICTEMENT
// supérieur déclenche une mise à jour.
// ─────────────────────────────────────────────────────────────────────────────
import { compareVersions, versionParts } from './release-version.mjs';

/**
 * Ce qu'on a besoin de savoir d'un release pour décider lequel les postes voient.
 * @typedef {{ tag_name?: string, draft?: boolean, prerelease?: boolean,
 *   published_at?: string, created_at?: string }} ReleaseLike
 */

/**
 * Le release le plus récent que les POSTES peuvent réellement voir.
 *
 * « Le plus récent » n'est pas « le plus récent tag » : un brouillon est
 * INVISIBLE pour `electron-updater`, donc un brouillon plus récent qu'un release
 * publié ne change rien pour un poste — c'est même le cas normal d'une
 * publication en cours. Le tri porte donc sur les releases PUBLIÉS, et sur la
 * date de publication (celle que le poste voit), pas sur l'ordre de l'API.
 *
 * Et une PRÉ-VERSION n'est pas « publiée » au sens où un poste la lit : c'est
 * l'endpoint que l'updater interroge qui la met hors du canal stable
 * (`/releases/latest` ignore `prerelease`, comme le client lui-même). La garder
 * faisait donc désigner à NOTRE tri une version qu'aucun poste ne verra jamais.
 * Mesuré le 2026-09-13 avec une pré-version de sonde : la ligne de divergence
 * reprochait à l'endpoint du poste un désaccord qui venait d'ici — c'est-à-dire
 * qu'elle accusait le canal d'une imprécision qui était la nôtre, et un tri qui
 * désigne ce que personne ne peut voir ne juge plus ce que les postes lisent.
 *
 * @param {ReleaseLike[]} [releases]
 * @returns {ReleaseLike|null} null si aucun release n'est publié — le canal est muet
 */

export function pickLatestPublished(releases = []) {
  const list = (Array.isArray(releases) ? releases : []).filter(
    (r) => r && r.draft !== true && r.prerelease !== true && typeof r.tag_name === 'string' && r.tag_name,
  );
  if (!list.length) return null;
  const when = (r) => {
    const ms = Date.parse(String(r.published_at || r.created_at || ''));
    return Number.isFinite(ms) ? ms : 0;
  };
  return list.slice().sort((a, b) => when(b) - when(a))[0];
}

/**
 * ─── Un poste resté sur une ANCIENNE version recevrait-il la plus récente ? ──
 *
 * La question du canal n'est pas « la version en tête est-elle cohérente ? » mais
 * « les postes DÉJÀ INSTALLÉS reçoivent-ils quelque chose ? », et les deux ne se
 * confondent pas : chaque version publiée est une population de postes, et une
 * population qui n'est plus routée ne le dit jamais. Le défaut typique est
 * silencieux : une version publiée reste dans le canal, la tête change de sens
 * (elle est plus ancienne, ou hors canal stable), et les postes concernés ne
 * reçoivent plus RIEN — sans qu'aucun job ne rougisse, puisque la tête, elle,
 * est parfaitement cohérente.
 *
 * « Reçoit la plus récente » se décide exactement comme le fait le client, et
 * cette décision a deux moitiés :
 *   • **quelle version le canal NOMME** — `head`, tel que l'endpoint que le
 *     poste interroge (`/releases/latest`, `Accept: application/json`) le
 *     répond. Ce n'est pas forcément la plus haute version publiée, et c'est
 *     précisément là que les deux se séparent ;
 *   • **une comparaison de versions** — `electron-updater` ne propose la tête à
 *     un poste que si elle est STRICTEMENT supérieure à ce qu'il exécute. Un
 *     poste en 1.0.5 devant une tête 1.0.4 n'est pas « à jour » : il est
 *     définitivement en dehors du chemin.
 *
 * D'où un verdict PAR VERSION publiée, et pas un verdict sur la tête :
 *   • `head > poste`   → reçoit la tête (sauf retenue par le frein, et c'est un
 *                        état VOULU, donc nommé et non refusé) ;
 *   • `head === poste` → c'est la tête, il n'y a rien à installer ;
 *   • `head < poste` (ou tête illisible) → il ne reçoit PLUS RIEN, et c'est un
 *                        défaut, pas une opinion.
 *
 * Les pré-versions publiées sont comptées à part : elles sont invisibles pour le
 * canal stable (`/releases/latest` les ignore, comme l'updater), donc elles ne
 * portent aucun poste — mais elles sont NOMMÉES, parce qu'un release publié que
 * personne ne lit est exactement le genre de fait que ce dépôt refuse de taire.
 *
 * @param {{ published?: { tag_name?: string, draft?: boolean, prerelease?: boolean }[],
 *   headTag?: unknown, holds?: string[] }} [input]
 * @returns {{ head: string|null, newest: string|null,
 *   clients: { version: string, target: string|null, receives: boolean, held: boolean, detail: string }[],
 *   invisible: string[], problems: string[], warnings: string[] }}
 */

export function deliveryReach({ published = [], headTag = null, holds = [] } = {}) {
  const problems = [];
  const warnings = [];
  const list = (Array.isArray(published) ? published : []).filter((r) => r && r.draft !== true);
  const stableOf = (r) => (r.prerelease === true ? null : String(r.tag_name ?? '').replace(/^v/, '').trim());
  const readable = (version) => version && versionParts(version) !== null;

  const invisible = list.filter((r) => r.prerelease === true).map((r) => String(r.tag_name ?? '').trim());
  const versions = [];
  for (const release of list) {
    const version = stableOf(release);
    if (!readable(version)) continue;
    if (!versions.includes(version)) versions.push(version);
  }
  versions.sort((a, b) => compareVersions(b, a));

  const newest = versions[0] ?? null;
  const head = readable(String(headTag ?? '').replace(/^v/, '').trim())
    ? String(headTag ?? '').replace(/^v/, '').trim()
    : null;

  // Ce qui est refusé : un canal qui n'a plus de tête lisible (un poste ne peut
  // rien recevoir), ou une tête qui n'est pas un release publié du canal stable
  // (donc que personne ne lira — le cas d'un brouillon promu nulle part).
  if (!head) {
    problems.push(
      'aucune version nommée par le canal — l’endpoint que le poste interroge ne répond aucune version : ' +
        'il ne recevra RIEN (côté client : ERR_UPDATER_NO_PUBLISHED_VERSIONS)',
    );
  } else if (!versions.includes(head)) {
    problems.push(
      `le canal nomme « ${head} », qui n’est pas un release publié du canal stable — ` +
        'un poste lit donc une tête qui n’existe pour personne',
    );
  }

  const held = new Set((Array.isArray(holds) ? holds : []).map((v) => String(v ?? '').trim()));
  const clients = [];
  for (const version of versions) {
    if (version === head) {
      clients.push({ version, target: head, receives: true, held: false, detail: 'c’est la tête : rien à installer' });
      continue;
    }
    if (head && compareVersions(head, version) === 1) {
      const retained = held.has(head);
      clients.push({
        version,
        target: head,
        receives: !retained,
        held: retained,
        detail: retained
          ? `la tête ${head} est RETENUE par le frein d’urgence : ce poste ne la recevra pas tant que la retenue est là`
          : `reçoit ${head}`,
      });
      if (retained) {
        warnings.push(
          `les postes en ${version} ne recevront pas ${head} tant qu’elle est retenue par le frein ` +
            '(c’est le frein qui agit, pas le canal)',
        );
      }
      continue;
    }
    clients.push({
      version,
      target: head,
      receives: false,
      held: false,
      detail: head
        ? `ne reçoit PLUS RIEN : le canal nomme ${head}, qui n’est PAS plus récente que ${version}`
        : 'ne reçoit PLUS RIEN : le canal ne nomme aucune version',
    });
    problems.push(
      `un poste resté en ${version} ne recevrait plus rien : le canal nomme « ${head ?? '—'} » — ` +
        'chaque version publiée est une population de postes, et celle-là est sortie du chemin',
    );
  }

  // La tête n'est pas forcément la plus HAUTE version publiée : le tri du client
  // (l'endpoint) et la plus haute version ne se confondent pas, et quand ils
  // divergent, c'est une information de première importance — un poste sur la
  // version la plus haute ne verra jamais rien de plus récent.
  if (head && newest && compareVersions(head, newest) === -1) {
    problems.push(
      `la tête lue (${head}) n’est PAS la version la plus haute publiée (${newest}) — ` +
        'un poste sur cette dernière ne verra jamais de mise à jour',
    );
  }
  for (const tag of invisible) {
    warnings.push(`${tag} est publié en PRÉ-VERSION : invisible pour un poste, donc aucun poste ne le lit`);
  }

  return { head, newest, clients, invisible, problems, warnings };
}
