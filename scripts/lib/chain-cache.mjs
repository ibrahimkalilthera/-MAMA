/**
 * ─── Pourquoi la chaîne se rejoue pour rien ─────────────────────────────────
 *
 * Mesuré : la chaîne qualité coûte 75–87 s (`node_modules/.cache/chain-timings.json`,
 * 20 runs, lint ≈ 43 s, tests ≈ 32 s, audit ≈ 0,1 s en cache / 30 s sinon). Or
 * elle tourne **deux fois par changement** : `pre-commit`, puis `pre-push` —
 * sur exactement le même contenu, celui que le commit vient de figer. Soit
 * ≈ 2 min 40 de plus par push, sans qu'aucun octet n'ait été revérifié.
 *
 * ─── Ce que ce module décide ────────────────────────────────────────────────
 *
 * L'unité de vérification n'est pas « l'événement » mais **l'arbre de contenu** :
 * `git write-tree` rend un identifiant déterministe de ce qui est indexé, et
 * `HEAD^{tree}` après un commit en est l'exacte copie. Si cet identifiant a déjà
 * été vérifié vert, rejouer la chaîne ne peut rien apprendre de neuf — le seul
 * risque serait de rejouer un contenu qui a changé depuis.
 *
 * Quatre conditions, et chacune ferme un trou :
 *   1. **couverture** — les maillons demandés doivent être inclus dans ce qui a
 *      été vérifié. Un `pre-commit` vert sur `lint+test+audit` ne vaut pas pour
 *      un `pre-push` qui demanderait `build` en plus ; l'inverse, si.
 *   2. **identité** — le même oid d'arbre. C'est ce qui empêche de faire passer
 *      un contenu neuf pour un contenu validé.
 *   3. **propreté** — la chaîne lit la copie de travail, pas l'index : une
 *      modification **non indexée** (index ≠ copie de travail) invalide la
 *      vérification. Le test est explicite (`dirty`) et n'est jamais deviné ici :
 *      c'est le seul critère qui dépend de l'état du dépôt.
 *   4. **runtime** — même majeur Node : un vert obtenu sous 22 ne dit rien de 24.
 * Plus une **péremption** (24 h) : au-delà, on rejoue, parce qu'un cache qui
 * n'expire jamais finit par couvrir un environnement qui a changé sans que le
 * contenu, lui, ait bougé (dépendances globales, fuseau, réseau).
 *
 * ─── Ce que ce module ne fait PAS ───────────────────────────────────────────
 *
 * Il ne décide jamais « vert » : il décide seulement « déjà vérifié pour ce
 * contenu ». Un `QUALITY_FORCE=1` force le rejeu, et l'absence de cache, de
 * runtime lisible ou d'oid fait rejouer — le doute penche toujours vers le
 * travail, jamais vers le raccourci.
 *
 * (Index ≠ copie de travail est le bon critère, et non « différent de HEAD » :
 * au `pre-commit`, index et copie de travail sont identiques par construction —
 * c'est justement ce qui vient d'être mis en scène — alors qu'un fichier modifié
 * APRÈS le `git add` ne serait pas celui que la chaîne lirait.)
 */

/** Durée de validité d'un vert (24 h), au-delà on rejoue. */
export const CHAIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Nom du fichier dans `node_modules/.cache/` (ignoré par git). */
export const CHAIN_CACHE_FILE = 'chain-green.json';

/**
 * Fusionne des listes de maillons sans doublons ni ordre implicite.
 * @param {readonly string[]} steps
 * @returns {string[]}
 */
export const normalizeSteps = (steps = []) => [...new Set(steps)].sort();

/**
 * Décide si la chaîne peut être sautée.
 *
 * @param {{
 *   cache?: { treeOid?: string, at?: number, nodeMajor?: string | null, steps?: string[] } | null,
 *   treeOid?: string | null,
 *   steps?: string[],
 *   nodeMajor?: string | null,
 *   dirty?: boolean,
 *   nowMs?: number,
 *   ttlMs?: number,
 *   force?: boolean,
 * }} input
 * @returns {{ skip: boolean, reason: string }}
 */
export function chainCacheVerdict({
  cache = null,
  treeOid = null,
  steps = [],
  nodeMajor = null,
  dirty = true,
  nowMs = Date.now(),
  ttlMs = CHAIN_CACHE_TTL_MS,
  force = false,
} = {}) {
  if (force) return { skip: false, reason: 'QUALITY_FORCE : rejeu exigé' };
  if (!cache || typeof cache !== 'object') return { skip: false, reason: 'aucun vert enregistré' };
  if (!treeOid) return { skip: false, reason: 'arbre illisible (git write-tree) — rien à comparer' };
  if (cache.treeOid !== treeOid) {
    return { skip: false, reason: `contenu différent (${String(cache.treeOid).slice(0, 8)} ≠ ${treeOid.slice(0, 8)})` };
  }
  if (nodeMajor && cache.nodeMajor && cache.nodeMajor !== nodeMajor) {
    return { skip: false, reason: `majeur Node différent (${cache.nodeMajor} → ${nodeMajor})` };
  }
  const recorded = normalizeSteps(cache.steps);
  const missing = normalizeSteps(steps).filter((s) => !recorded.includes(s));
  if (missing.length > 0) return { skip: false, reason: `maillon(s) jamais vérifié(s) : ${missing.join(', ')}` };
  if (dirty) {
    return { skip: false, reason: 'modifications non indexées : la chaîne lirait autre chose' };
  }
  const age = nowMs - Number(cache.at ?? 0);
  if (!Number.isFinite(age) || age > ttlMs) {
    return { skip: false, reason: `vert trop ancien (${Math.round(age / 3600000)} h > ${Math.round(ttlMs / 3600000)} h)` };
  }
  return { skip: true, reason: `déjà vérifié : ${recorded.join(', ')} sur cet arbre` };
}

/**
 * L'enregistrement à écrire après un vert. Toujours complet (jamais un
 * incrément partiel) : les maillons vérifiés sont ceux qui viennent de passer.
 *
 * @param {{ treeOid: string, steps: string[], nodeMajor?: string | null, nowMs?: number }} input
 * @returns {{ treeOid: string, at: number, nodeMajor: string | null, steps: string[] }}
 */
export function chainGreenRecord({ treeOid, steps = [], nodeMajor = null, nowMs = Date.now() }) {
  return { treeOid, at: nowMs, nodeMajor: nodeMajor ?? null, steps: normalizeSteps(steps) };
}

/**
 * Le majeur Node épinglé, lu dans `.nvmrc` (« 22 » ou « 22.23.2 » → « 22 »).
 * Illisible ⇒ null, et un null ne fait jamais sauter la chaîne par erreur :
 * `chainCacheVerdict` n'exige l'égalité que si LES DEUX côtés la connaissent.
 * @param {string} text
 * @returns {string | null}
 */
export function nodeMajorOf(text) {
  const match = String(text ?? '').trim().match(/^v?(\d+)/);
  return match ? match[1] : null;
}
