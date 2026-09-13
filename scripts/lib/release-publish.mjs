// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/release-publish.mjs — LE PLAN de publication d'un release.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le dépôt publiait avec `electron-builder --publish always`, et ce chemin a
// PAYÉ DEUX FOIS le même défaut : electron-builder ouvre **un release par
// cible** (une passe pour le NSIS, une pour le portable), donc deux brouillons
// pour le même tag, l'un portant le blockmap, l'autre `latest.yml` et les exe.
// Les artefacts sont alors **répartis entre deux releases**, et aucun outil ne
// les rassemble : promouvoir le mauvais publie un release SANS `latest.yml`,
// c'est-à-dire une mise à jour que personne ne voit. Les deux fois, il a fallu
// une main humaine sur l'API pour consolider puis promouvoir.
//
// La correction n'est pas de mieux consolider après coup : c'est de ne plus
// jamais laisser un outil tiers décider de la forme du release. Le publieur
// (`scripts/publish-release.mjs`) téléverse lui-même les octets qu'il vient de
// vérifier, un par un, dans **un seul** release. Ce module porte la décision —
// pure, donc testable sans réseau :
//
//   create      aucun release pour ce tag → en créer un, en brouillon
//   reuse       un brouillon existe → n'y téléverser que ce qui manque
//   consolidate plusieurs brouillons (l'héritage d'electron-builder) → garder
//               UNE cible, supprimer les autres, téléverser le reste
//   refuse      un release est DÉJÀ publié, rien à téléverser, ou un artefact
//               annoncé qui n'existe NULLE PART (ni disque, ni brouillon)
//
// « Par construction » veut dire ceci : le plan décrit **exactement** l'ensemble
// vérifié — `upload` pour ce qui manque ou ne correspond pas, `remove` pour ce
// qui est en trop. À la fin, le release contient les octets vérifiés et rien
// d'autre, quel que soit l'état dans lequel on l'a trouvé.
//
// ─── Pourquoi un digest, et pourquoi son absence RETÉLÉVERSE ────────────────
// « Ne pas retéléverser ce qui est déjà là » est une optimisation, et une
// optimisation qui se trompe publie les mauvais octets : une taille égale ne
// prouve pas des octets égaux. On ne saute donc un téléversement que si l'API
// donne un `digest` qui correspond à l'empreinte calculée localement ; sans
// `digest` (API qui ne le renvoie pas), on ne peut RIEN affirmer, donc on
// retéléverse. Le côté sûr est toujours de téléverser.
// ─────────────────────────────────────────────────────────────────────────────

/** Le préfixe du digest renvoyé par l'API des actifs GitHub. */
const DIGEST_PREFIX = 'sha256:';

/**
 * L'API dit-elle que cet actif EST ces octets ?
 *
 * Trois conditions, et chacune est un refus de conclure : une taille qui
 * diffère, un `digest` absent, un `digest` qui ne commence pas par `sha256:`.
 * Aucune n'est une erreur — c'est « je ne sais pas », qui se traite comme « il
 * faut téléverser ».
 *
 * @param {{ size?: number, digest?: string }|null|undefined} asset
 * @param {{ size?: number, sha256?: string }|null|undefined} local
 * @returns {boolean}
 */
export function assetMatchesLocal(asset, local) {
  if (!asset || !local) return false;
  if (!Number.isInteger(asset.size) || asset.size !== local.size) return false;
  const digest = String(asset.digest ?? '').toLowerCase();
  const sha256 = String(local.sha256 ?? '').toLowerCase();
  if (!digest.startsWith(DIGEST_PREFIX) || !sha256) return false;
  return digest.slice(DIGEST_PREFIX.length) === sha256;
}

/**
 * Combien d'artefacts attendus ce release porte-t-il DÉJÀ ?
 *
 * C'est ce qui choisit la cible d'une consolidation : garder le brouillon le
 * plus complet évite de retéléverser ce qui est en place, et rend le choix
 * indépendant de l'ordre (arbitraire) dans lequel l'API rend les releases.
 */
function assetsAlreadyThere(release, expected) {
  const names = new Set((release?.assets ?? []).map((a) => a?.name));
  return expected.filter((name) => names.has(name)).length;
}

/**
 * Le brouillon vers lequel consolider, et pourquoi celui-là.
 *
 * Critère : le plus d'artefacts attendus déjà présents. Départage : le plus
 * ANCIEN (`created_at`), parce qu'un brouillon plus récent est plus souvent
 * celui qu'une passe vient d'ouvrir — et à égalité parfaite, l'identifiant, pour
 * que deux exécutions du même plan gardent la même cible (un plan qui change de
 * cible selon l'humeur du réseau n'est pas un plan).
 *
 * @param {object[]} drafts
 * @param {string[]} expected
 * @returns {object|null}
 */
export function pickConsolidationTarget(drafts = [], expected = []) {
  const list = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const byAssets = assetsAlreadyThere(b, expected) - assetsAlreadyThere(a, expected);
    if (byAssets !== 0) return byAssets;
    const byAge = Date.parse(String(a.created_at ?? '')) - Date.parse(String(b.created_at ?? ''));
    if (Number.isFinite(byAge) && byAge !== 0) return byAge;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  })[0];
}

/**
 * Ce que des brouillons en DOUBLE peuvent encore apporter à la cible.
 *
 * Consolider ne doit pas dépendre du dossier local : un artefact attendu peut
 * n'exister QUE dans un brouillon hérité — le blockmap que la passe NSIS avait
 * téléversé, sur une machine dont le `release/` a été nettoyé depuis, ou une
 * reprise faite ailleurs. Sans ce rapatriement, « consolider » voudrait dire
 * « supprimer l'autre brouillon, et tant pis pour ses octets », c'est-à-dire la
 * perte silencieuse que ce module existe pour empêcher.
 *
 * Le DISQUE reste la source préférée : ses octets sont ceux qu'on vient de
 * vérifier, et les reprendre ne coûte aucun aller-retour destructeur (un
 * brouillon est un état à réparer, pas une source de confiance). Un artefact
 * n'est donc repris d'un brouillon que si le disque ne peut pas le fournir, et
 * c'est le gate du brouillon — qui rehashe les octets TÉLÉVERSÉS contre
 * `latest.yml` — qui juge ce qu'on a réuni.
 *
 * @param {{ target?: object|null, drafts?: object[], expected?: string[],
 *   local?: Map<string, unknown> }} input
 * @returns {{ name: string, releaseId: number|string, size: number|null }[]}
 */
export function salvagePlan({ target = null, drafts = [], expected = [], local = new Map() } = {}) {
  const targetNames = new Set((target?.assets ?? []).filter(Boolean).map((a) => a?.name));
  const sources = (Array.isArray(drafts) ? drafts : []).filter((r) => r && r.id !== target?.id);
  const out = [];
  for (const name of expected) {
    if (targetNames.has(name) || local.has(name)) continue;
    for (const draft of sources) {
      const asset = (draft.assets ?? []).filter(Boolean).find((a) => a?.name === name);
      if (asset) {
        out.push({ name, releaseId: draft.id, size: Number.isInteger(asset.size) ? asset.size : null });
        break;
      }
    }
  }
  return out;
}

/**
 * Le plan complet : quoi créer, quoi téléverser, quoi retirer, quoi réunir, quoi
 * supprimer.
 *
 * @param {{ version: string, releases?: object[], expected?: string[],
 *   local?: Map<string, { size: number, sha256: string }> }} input
 *   `releases` ne contient QUE les releases portant le tag de cette version.
 * @returns {{ action: 'create'|'reuse'|'consolidate'|'refuse', target: object|null,
 *   tag: string, deleteIds: (number|string)[], upload: string[],
 *   salvage: { name: string, releaseId: number|string, size: number|null }[],
 *   remove: string[], skip: string[], problems: string[] }}
 */
export function publicationPlan({ version, releases = [], expected = [], local = new Map() } = {}) {
  const tag = `v${String(version ?? '').trim()}`;
  const base = { target: null, tag, deleteIds: [], upload: [], salvage: [], remove: [], skip: [], problems: [] };

  // Un plan vide serait un plan vert : on refuse de conclure sur rien à publier.
  // C'est la règle de non-vacuité, et elle a un sens concret ici — un
  // `latest.yml` illisible rendrait une liste d'artefacts vide, et publier
  // « rien » ressemblerait à un succès.
  if (!expected.length) {
    return {
      ...base,
      action: 'refuse',
      problems: ['aucun artefact à publier — un release vide ne peut rien apporter à un poste'],
    };
  }

  const list = (Array.isArray(releases) ? releases : []).filter(Boolean);
  const published = list.filter((r) => r.draft !== true);
  if (published.length) {
    // Le même refus que la porte du tag, à l'endroit où on publie : un numéro
    // publié ne peut pas changer de contenu, donc « republier » n'atteint aucun
    // poste et laisserait deux binaires sous un même numéro.
    return {
      ...base,
      action: 'refuse',
      problems: [
        `${tag} est DÉJÀ publié — un même numéro ne peut pas changer de contenu : ` +
          'aucun poste ne verrait la différence. Montez la version.',
      ],
    };
  }

  const drafts = list.filter((r) => r.draft === true);
  const target = drafts.length ? pickConsolidationTarget(drafts, expected) : null;
  const salvage = salvagePlan({ target, drafts, expected, local });
  const salvaged = new Set(salvage.map((s) => s.name));

  // Le refus d'un artefact introuvable se juge APRÈS le rapatriement : un fichier
  // absent du disque peut être dans un brouillon en double, et refuser là ferait
  // payer à l'humain exactement le geste que ce module vient d'outiller.
  const missing = expected.filter((name) => !local.has(name) && !salvaged.has(name));
  if (missing.length) {
    return {
      ...base,
      action: 'refuse',
      problems: missing.map(
        (name) =>
          `artefact annoncé mais introuvable : « ${name} » n'est ni sur ce disque ni dans un brouillon — rien à téléverser`,
      ),
    };
  }

  if (!drafts.length) {
    return { ...base, action: 'create', upload: [...expected] };
  }

  const deleteIds = drafts.filter((r) => r.id !== target?.id).map((r) => r.id);
  const assets = (target?.assets ?? []).filter(Boolean);
  const byName = new Map(assets.map((a) => [a.name, a]));

  // Deux sources, et une seule par artefact : `upload` depuis le disque (ce
  // qu'on a vérifié), `salvage` depuis un brouillon en double (ce qu'il faut
  // d'abord rapatrier). Un artefact réuni n'est donc jamais téléversé deux fois.
  const upload = [];
  const skip = [];
  for (const name of expected) {
    const asset = byName.get(name);
    if (asset && assetMatchesLocal(asset, local.get(name))) skip.push(name);
    else if (!salvaged.has(name)) upload.push(name);
  }
  // Ce qui est en trop sort : à la fin, le release contient les octets vérifiés
  // et RIEN d'autre. Un installeur d'une autre version laissé là est le fichier
  // qu'un humain téléchargera à la main.
  const remove = assets.map((a) => a.name).filter((name) => !expected.includes(name));

  return {
    ...base,
    action: drafts.length > 1 ? 'consolidate' : 'reuse',
    target,
    deleteIds,
    upload,
    salvage,
    remove,
    skip,
  };
}
