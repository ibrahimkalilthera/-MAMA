// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/audit-verdict.mjs — ce qui compte comme une MESURE d'audit, et ce
// qu'un cache a encore le droit de faire dans le verdict.
//
// DEUX FAÇONS DE RENDRE UN VERDICT SANS AVOIR MESURÉ — les deux payées le
// 2026-10-06 :
//
//   1. LE CACHE. Le job « Quality & performance guard » a été VERT en relisant un
//      cache de 23,5 h — `✅ Total audit count 7 within baseline 7 (cached, 23.5h
//      old)` — alors que le `npm ci` du MÊME job annonçait déjà
//      `16 vulnerabilities (8 moderate, 8 high)`. La clé du cache est l'empreinte
//      du lockfile, or un avis se publie SANS que le lockfile change : un cache
//      encore « frais » peut donc masquer une dette née d'une publication amont,
//      pas d'une modification de dépendances. Un cache n'est pas une mesure.
//
//   2. LA RÉPONSE D'ERREUR. `npm audit --json` écrit AUSSI du JSON sur stdout
//      quand le registre est injoignable (`{"message": …, "error": {…}}`) — et npm
//      peut sortir 0. Lu comme un rapport, ce payload n'a pas de champ
//      `vulnerabilities` : le gate annonçait alors « Production … audit clean »
//      et « Total audit count 0 », soit un arbre parfait sur un audit qui n'avait
//      RIEN regardé. Mesuré le 2026-10-06 : registre injoignable → payload
//      d'erreur sur stdout, code de sortie 0. C'est la même faute que le cache
//      périmé — un vert sans mesure — et elle était plus discrète encore.
//
// LA RÈGLE, DONC
// --------------
//   • une MESURE est un rapport npm RÉEL (`isAuditReport`) : `metadata.
//     vulnerabilities` est le seul champ que npm ne produit que là ;
//   • le gate mesure EN DIRECT d'abord, à chaque run, et n'ouvre le cache que si
//     la mesure est IMPOSSIBLE — auquel cas le verdict le DIT
//     (`cacheFallbackLabel`), avec son âge ;
//   • une entrée de cache n'est exploitable que pour l'arbre qui l'a produite
//     (version + empreinte du lockfile) et pour un âge borné — jamais « la
//     dernière ».
//
// Pure : texte in, décision out. Chaque branche de refus (JSON illisible, payload
// d'erreur, version étrangère, empreinte d'un autre arbre, horodatage illisible,
// horloge inversée, TTL dépassé) est asserée au lieu d'être espérée.
// ─────────────────────────────────────────────────────────────────────────────

/** La forme des entrées que ce dépôt écrit et relit. */
export const CACHE_VERSION = 1;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Le texte parsé est-il un RAPPORT d'audit — ou seulement du JSON ?
 *
 * `npm audit --json` imprime un payload d'erreur sur stdout quand le registre ne
 * répond pas (`{"message": …, "error": {…}}`), et il peut sortir 0 : sans ce
 * contrôle, une panne réseau se lisait « zéro vulnérabilité ». Le discriminant
 * est `metadata.vulnerabilities`, que npm ne produit que sur un rapport réel.
 *
 * @param {unknown} report
 * @returns {boolean}
 */
export function isAuditReport(report) {
  return Boolean(
    report &&
      typeof report === 'object' &&
      report.metadata &&
      typeof report.metadata === 'object' &&
      report.metadata.vulnerabilities &&
      typeof report.metadata.vulnerabilities === 'object',
  );
}

/**
 * Une entrée de cache EXPLOITABLE pour cet arbre — ou `null`.
 *
 * @param {string} rawText le contenu du fichier de cache, tel quel
 * @param {{ lockHash: string, ttlMs: number, now?: number }} options
 * @returns {{ prodVulns: unknown[], total: number, summary: unknown, ageHours: number } | null}
 */
export function usableCache(rawText, { lockHash, ttlMs, now = Date.now() }) {
  let entry;
  try {
    entry = JSON.parse(String(rawText ?? ''));
  } catch {
    return null;
  }
  if (!entry || typeof entry !== 'object') return null;
  // Une version étrangère est un contrat qu'on ne connaît pas : on ne devine pas.
  if (entry.version !== CACHE_VERSION) return null;
  // L'empreinte d'un AUTRE arbre ne dit rien de celui-ci — c'est la propriété qui
  // empêche un repli de traverser une mise à jour de dépendances.
  if (entry.lockHash !== lockHash) return null;
  const checkedAt = Date.parse(entry.checkedAt ?? '');
  if (!Number.isFinite(checkedAt)) return null;
  const age = now - checkedAt;
  // Horloge inversée (un cache daté du futur) : on refuse plutôt que de rendre un
  // âge négatif, qui passerait tous les contrôles d'âge.
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
  return {
    prodVulns: Array.isArray(entry.prodVulns) ? entry.prodVulns : [],
    total: typeof entry.total === 'number' ? entry.total : 0,
    summary: entry.summary ?? {},
    ageHours: age / HOUR_MS,
  };
}

/**
 * Le libellé d'un verdict de REPLI. Il dit les trois choses qui le distinguent
 * d'une mesure : que le chiffre vient d'un cache, de quand il date, et qu'aucune
 * mesure en direct n'a eu lieu pour ce run.
 *
 * @param {number} ageHours
 * @returns {string}
 */
export function cacheFallbackLabel(ageHours) {
  const hours = Number.isFinite(ageHours) ? ageHours.toFixed(1) : '?';
  return `(VERDICT ISSU D'UN CACHE — repli de ${hours}h, mesure en direct indisponible)`;
}
