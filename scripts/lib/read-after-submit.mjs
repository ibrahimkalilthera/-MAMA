/**
 * scripts/lib/read-after-submit.mjs — lire en base ce qu'un envoi de formulaire
 * vient d'écrire, sans parier sur le délai.
 *
 * WHY THIS EXISTS
 * ---------------
 * Audit de la chaîne E2E (2026-09-13) : le même défaut, recopié sept fois. Le
 * script cliquait « Enregistrer », attendait 2–3 s, lisait la table UNE fois, et
 * concluait. Or deux situations très différentes se lisaient alors identiquement :
 * « l'écriture n'est pas encore visible » (la base ou le cache d'affichage a du
 * retard) et « l'écriture n'est jamais partie » (l'application a un vrai défaut).
 * Le run rouge accusait donc l'application d'un simple retard — et un rouge qui
 * accuse à tort coûte plus cher qu'un rouge absent, parce qu'il envoie chercher
 * une régression là où il n'y a rien.
 *
 * Le salaire avait déjà sa boucle de sondage, avec le commentaire qui explique
 * pourquoi (« mesuré : le même run passait 3 fois et échouait la 4ᵉ ») ; la
 * dépense fournisseur a reçu la sienne ensuite, après avoir rougi de la même
 * façon. Les autres — la classe, l'élève, le solde, le parent, l'employé, le
 * membre du centre technique — lisaient toujours une seule fois.
 *
 * D'où cette brique, UNE pour toute la chaîne : elle lit, s'arrête dès que
 * l'état attendu est là, et sinon réessaie. Trois propriétés comptent :
 *
 *   • le PREMIER essai se fait sans attendre — quand la base est à jour (le cas
 *     courant), ce contrôle ne paie rien ;
 *   • on n'attend pas « une ligne », on attend l'ÉTAT attendu : une lecture qui
 *     rend une ligne mais pas la bonne valeur (un solde qui doit passer à
 *     50 000, un statut qui doit devenir `unpaid`) n'est pas un succès ;
 *   • le nombre de lectures est RENDU, pour que « la base a rattrapé en 7
 *     lectures » se lise au lieu de se deviner — un run qui a attendu ne raconte
 *     pas la même chose qu'un run instantané.
 *
 * PUR : `read` et `sleep` sont injectés, donc la cadence se prouve sans réseau
 * et sans attendre une seconde de vraie horloge.
 */

/** Combien de lectures au plus avant de conclure à l'absence. */
export const SETTLE_ATTEMPTS = 10;

/** Le délai entre deux lectures (le premier essai, lui, ne paie rien). */
export const SETTLE_INTERVAL_MS = 1000;

/** La première ligne d'une réponse REST, ou `null`. */
export const firstRow = (body) => (Array.isArray(body) && body.length ? body[0] : null);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lit jusqu'à ce que l'état attendu soit là.
 *
 * `isReady` reçoit ce que la lecture a RENDU (le corps de la réponse) et renvoie
 * la valeur acceptée — ou `null`/`undefined` pour dire « pas encore ». C'est lui
 * qui porte le jugement ; cette fonction ne porte que la cadence et la borne.
 *
 * Une lecture qui LÈVE n'est pas avalée : le transport qui la fournit (celui de
 * chaque script, avec ses reprises de coupures) a déjà décidé de ce qu'un 504
 * veut dire, et une erreur qui survit à ses reprises est un fait, pas un retard.
 *
 * @template T
 * @param {{ read: () => Promise<unknown>, isReady: (body: unknown) => T|null|undefined,
 *   attempts?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> }} input
 * @returns {Promise<{ value: T|null, reads: number, last: unknown }>}
 */
export async function readUntil({
  read,
  isReady,
  attempts = SETTLE_ATTEMPTS,
  intervalMs = SETTLE_INTERVAL_MS,
  sleep = defaultSleep,
}) {
  const tries = Math.max(1, Number(attempts) || SETTLE_ATTEMPTS);
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    const body = await read();
    last = body;
    const hit = isReady(body);
    if (hit !== null && hit !== undefined && hit !== false) {
      return { value: /** @type {T} */ (hit), reads: i + 1, last };
    }
    // Pas d'attente après le DERNIER essai : elle ne servirait à rien et
    // allongerait un échec déjà jugé.
    if (i < tries - 1) await sleep(intervalMs);
  }
  return { value: null, reads: tries, last };
}
