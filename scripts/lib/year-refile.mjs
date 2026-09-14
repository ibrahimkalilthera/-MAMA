// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/year-refile.mjs — reclasser des lignes d'une année scolaire à une
// autre : ce qui doit être VRAI avant d'écrire, et ce qui doit l'être après.
//
// Pourquoi un module à part : c'est la partie qu'un test peut tenir. Le script
// qui appelle la base ne se juge que par une exécution réelle (et la seule base
// joignable est celle de l'école), donc tout ce qui peut être décidé sans réseau
// vit ici — les refus, et le verdict.
//
// Le contexte de l'incident (2026-09-13) : deux littéraux se partageaient la
// vérité de l'année. L'application s'ouvrait sur « 2026-2027 » et filtrait
// dessus ; le formulaire d'élève naissait en « 2024-2025 » et écrivait ça. Un
// élève enregistré était donc EN BASE et invisible, ce qui se lit « mes données
// ont disparu ». Le code qui a produit ça est corrigé ; ce module répare ce
// qu'il a écrit, sans jamais deviner l'année cible.
// ─────────────────────────────────────────────────────────────────────────────

const clean = (value) => String(value ?? '').trim();

/** Les noms d'années d'un roster d'`academic_years` (ou des chaînes nues). */
export function knownYears(rows = []) {
  return (rows ?? [])
    .map((row) => clean(row?.year_name ?? row))
    .filter(Boolean);
}

/**
 * Pourquoi ce reclassement serait refusé — la liste est vide quand il peut être
 * appliqué.
 *
 * Aucun défaut silencieux : `--from` et `--to` sont EXIGÉS tous les deux. Un
 * `--to` par défaut (« l'année courante ») serait commode et dangereux : la
 * « courante » peut être fausse, et un reclassement se décide en regardant ce
 * qu'on déplace.
 *
 * @param {{ from?: string, to?: string, years?: (string|{year_name?: string})[] }} input
 * @returns {string[]}
 */
export function refileRefusals({ from, to, years = [] } = {}) {
  const problems = [];
  const source = clean(from);
  const target = clean(to);
  if (!source) {
    problems.push('--from <année> requis : sans année de départ, le reclassement viserait toute la base à la fois.');
  }
  if (!target) {
    problems.push('--to <année> requis : une année cible se décide, elle ne se devine pas.');
  }
  if (source && target && source === target) {
    problems.push(`--from et --to valent « ${source} » : il n’y a rien à reclasser.`);
  }
  const roster = knownYears(years);
  if (target && roster.length > 0 && !roster.includes(target)) {
    problems.push(
      `« ${target} » n’existe pas dans academic_years (${roster.join(', ')}) — ` +
        'une année doit exister avant de pouvoir recevoir des lignes.',
    );
  }
  return problems;
}

/**
 * Le verdict APRÈS écriture : les lignes sont-elles réellement passées d'une
 * année à l'autre ?
 *
 * Une mutation qui répond 200 et ne déplace rien est un faux vert, et c'est
 * exactement la famille de panne que ce dépôt traque. On recompte donc les deux
 * années : l'ancienne doit être VIDE et la nouvelle doit contenir au moins ce
 * qu'on lui a envoyé (elle peut déjà en contenir d'autres).
 *
 * @param {{ from?: string, to?: string, moved?: number, afterFrom?: number|null, afterTo?: number|null }} input
 * @returns {string[]}
 */
export function refileVerdict({ from, to, moved = 0, afterFrom = null, afterTo = null } = {}) {
  const problems = [];
  if (!Number.isFinite(moved) || moved <= 0) {
    problems.push(`aucune ligne ne portait « ${clean(from)} » : il n’y avait rien à reclasser.`);
  }
  if (!Number.isFinite(afterFrom) || afterFrom !== 0) {
    problems.push(
      `il reste ${Number.isFinite(afterFrom) ? afterFrom : '?'} ligne(s) sur « ${clean(from)} » ` +
        'après le reclassement — l’écriture n’a pas tout déplacé.',
    );
  }
  if (!Number.isFinite(afterTo) || afterTo < moved) {
    problems.push(
      `« ${clean(to)} » ne porte que ${Number.isFinite(afterTo) ? afterTo : '?'} ligne(s) ` +
        `alors que ${moved} viennent d’y être déplacées — le compte ne se referme pas.`,
    );
  }
  return problems;
}
