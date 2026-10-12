/**
 * ─── Le canari du collecteur CSP ────────────────────────────────────────────
 *
 * Un zéro ne vaut que si la mesure peut dire autre chose que zéro. La garde
 * d'exécution (`scripts/verify-csp-guard.mjs`) conclut « Zéro violation CSP »
 * sur la foi de deux canaux qu'elle n'avait jamais vus fonctionner :
 *
 *   1. les événements CDP `console` / `pageerror` filtrés par `CSP_RE` ;
 *   2. un écouteur `securitypolicyviolation` posé par `evaluateOnNewDocument`.
 *
 * Un canal DÉBRANCHÉ — un `evaluateOnNewDocument` refusé au lancement, un filtre
 * qui ne reconnaît plus la formulation de Chromium — rendait exactement le même
 * verdict vert qu'une application réellement propre. C'est le faux vert le plus
 * coûteux qui soit : il rassure. Le défaut est de la même famille que celui que
 * `scripts/lib/guard-immunity.mjs` poursuit chez les contrôles de source — un
 * contrôle qui ne lit rien est pire qu'un contrôle absent —, sauf qu'ici la
 * lecture est une MESURE, et qu'aucune relecture statique ne peut dire si le
 * navigateur a vraiment parlé.
 *
 * D'où le canari : à chaque run, la garde met sous le nez de ses propres
 * collecteurs un refus CONNU — un script externe que la politique du site
 * interdit — puis exige que CHACUN des deux canaux l'ait vu, en nommant la
 * ressource ET la directive qui l'a refusée (même exigence que la preuve du
 * paquet Windows, `scripts/verify-electron-csp.mjs`). Un seul canal muet, et la
 * garde ne prétend plus avoir mesuré quoi que ce soit : sortie 2, « je n'ai pas
 * pu regarder ».
 *
 * Le jugement vit ici, PUR, pour deux raisons :
 *   • une garde qui ne se juge pas elle-même ne juge rien — le verdict du canari
 *     ne peut pas être une phrase noyée dans un script de 300 lignes ;
 *   • `tests/csp-canary.test.ts` l'interroge sur des composites — deux canaux,
 *     un seul, aucun — et vérifie qu'un canari devenu NON refusable (interne à
 *     l'origine, ou sur une origine autorisée) est refusé AVANT le navigateur,
 *     sinon la garde échouerait sur son propre instrument au lieu de mesurer.
 */

/** Les deux canaux de collecte, nommés une fois pour être cités sans faute de frappe. */
export const CANARY_CHANNELS = {
  /** Les événements CDP : `page.on('console')` et `page.on('pageerror')`. */
  CONSOLE: 'console',
  /** L'écouteur in-page `securitypolicyviolation`, drainé à chaque page. */
  IN_PAGE: 'in-page',
};

/**
 * Le préfixe que la garde pose en drainant l'événement in-page — c'est LUI qui
 * distingue les deux canaux dans un tableau de violations mêlé.
 */
const IN_PAGE_MARK = '[SecurityPolicyViolationEvent]';

/**
 * L'URL du canari. `https://` EXTERNE — donc refusée par `script-src 'self'` — et
 * TLD réservé `.invalid`, qui ne résout jamais : Chromium refuse le chargement
 * AVANT toute requête, donc le canari ne dépend pas du réseau et ne peut pas
 * devenir un test de connectivité déguisé.
 */
export const CANARY_URL = 'https://csp-canary.invalid/known-violation.js';

const textOf = (signal) => (typeof signal === 'string' ? signal : String(signal?.text ?? ''));

/**
 * Ce signal parle-t-il du canari ? Sert au verdict, et au RETRAIT de notre propre
 * bruit : sans ce retrait la garde échouerait sur la violation qu'elle a
 * elle-même provoquée.
 */
export const isCanarySignal = (signal, url = CANARY_URL) => textOf(signal).includes(url);

/**
 * Le canari peut-il être refusé par la politique ? Une URL interne, ou une
 * origine autorisée, ne produirait AUCUNE violation : la garde conclurait alors
 * « collecteur muet » sur un canari valide, et accuserait son instrument à la
 * place de ses canaux. Le refus est donc écrit, et vérifié avant le lancement.
 *
 * @param {string} [url]
 * @returns {string|null} le problème, ou null si le canari est refusable par construction
 */
export function canaryUrlVerdict(url = CANARY_URL) {
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return `le canari doit être une URL EXTERNE absolue (reçu : « ${url} »)`;
  }
  const host = url.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
  if (host !== 'invalid' && !host.endsWith('.invalid')) {
    return `le canari doit viser le domaine réservé « .invalid » (reçu : « ${host} ») — un hôte réel rendrait le refus dépendant du DNS`;
  }
  return null;
}

/**
 * Le verdict du canari. `signals` = ce que la garde a collecté DEPUIS l'injection,
 * les deux canaux mêlés (leur préfixe les distingue).
 *
 * Un signal ne compte que s'il NOMME le canari ET la directive `script-src` : une
 * violation d'une autre ressource ne tient pas lieu de preuve, et un message qui
 * parle du canari sans dire ce qui l'a refusé n'apprend pas quel canal a parlé.
 *
 * @param {{ signals?: Array<{ text?: string }|string>, url?: string }} [input]
 * @returns {{ ok: boolean, seen: Record<string, boolean>, missing: string[], named: number, reason: string }}
 */
export function canaryVerdict({ signals = [], url = CANARY_URL } = {}) {
  const named = signals.map(textOf).filter((t) => t.includes(url) && /script-src/.test(t));
  const seen = {
    [CANARY_CHANNELS.CONSOLE]: named.some((t) => !t.includes(IN_PAGE_MARK)),
    [CANARY_CHANNELS.IN_PAGE]: named.some((t) => t.includes(IN_PAGE_MARK)),
  };
  const missing = Object.values(CANARY_CHANNELS).filter((channel) => !seen[channel]);
  return {
    ok: missing.length === 0,
    seen,
    missing,
    named: named.length,
    reason:
      missing.length === 0
        ? `le canari est vu par les deux canaux (${named.length} signal(aux) du refus connu)`
        : `collecteur MUET : ${missing.join(' + ')} n'a pas vu le refus connu (${url}) — ` +
          'un zéro rendu par ce collecteur ne prouverait rien',
  };
}
