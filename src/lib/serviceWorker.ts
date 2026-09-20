/**
 * L'enregistrement du service worker — et les cas où il ne faut PAS le faire.
 *
 * Le worker lui-même est GÉNÉRÉ au build (`scripts/lib/service-worker.mjs` →
 * `dist/sw.js`) : il garde la coquille et tous les modules du build en réserve,
 * pour que le site s'ouvre à froid sans réseau (et qu'un reçu s'imprime, jsPDF
 * compris, alors que le réseau est coupé).
 *
 * Ce module ne décide que d'une chose : l'enregistrer ou non. Trois refus, chacun
 * pour une raison mesurée :
 *
 *   • `file:` — l'application de BUREAU charge son interface depuis le disque
 *     (`electron/main.cjs` → `loadFile`). Un service worker ne s'y enregistre pas,
 *     et le chemin absolu `/sw.js` n'y mènerait nulle part : mieux vaut ne rien
 *     tenter que lire une erreur au démarrage de chaque poste.
 *   • hors production — `vite dev` ne produit pas `sw.js` : l'enregistrer
 *     demanderait un fichier qui n'existe pas, et un worker mis en réserve pendant
 *     le développement servirait ensuite du code périmé (le pire des deux mondes).
 *   • contexte non sécurisé ou navigateur sans `serviceWorker` — un enregistrement
 *     est de toute façon impossible.
 *
 * `updateViaCache: 'none'` : le navigateur ne doit JAMAIS lire le worker depuis son
 * cache HTTP. Sans ça, un `sw.js` mis en cache pourrait survivre à un déploiement,
 * et le poste resterait sur l'ancienne réserve alors que le site est à jour — la
 * version périmée qu'on cherche justement à ne pas servir. Le reste est protégé
 * par le worker lui-même (coquille « réseau d'abord »).
 */
/**
 * Le chemin servi du worker : `dist/sw.js`, à la racine de l'origine.
 *
 * Écrit ici plutôt qu'importé du générateur (`scripts/lib/service-worker.mjs`) :
 * ce générateur importe `node:fs` et `node:path`, et l'importer depuis un module
 * du navigateur ferait entrer ces modules externes dans le bundle client (Vite le
 * signalait : « externalized for browser compatibility »). Deux écritures, donc,
 * mais jamais libres : `tests/service-worker.test.ts` relit `SW_FILE_NAME` dans le
 * générateur et refuse que les deux divergent.
 */
export const SERVICE_WORKER_URL = '/sw.js';

export interface ServiceWorkerEnv {
  /** `location.protocol` (injecté : c'est ce qui rend la décision testable). */
  protocol?: string;
  /** Build de production ? (`import.meta.env.PROD` par défaut.) */
  isProd?: boolean;
  /** `isSecureContext` — un service worker exige HTTPS (ou localhost). */
  secureContext?: boolean;
  /** `'serviceWorker' in navigator`. */
  supported?: boolean;
}

/** Décidé par des faits injectables, pour que les trois refus soient testables. */
export function shouldRegisterServiceWorker(env: ServiceWorkerEnv = {}): boolean {
  const protocol = env.protocol ?? (typeof location === 'undefined' ? '' : location.protocol);
  if (protocol === 'file:') return false;

  const isProd = env.isProd ?? Boolean(import.meta.env?.PROD);
  if (!isProd) return false;

  const secure = env.secureContext
    ?? (typeof isSecureContext === 'undefined' ? false : isSecureContext);
  if (!secure) return false;

  return env.supported ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
}

/**
 * Combien de temps on attend avant de redemander le worker.
 *
 * Mesuré dans un vrai navigateur (deux déploiements successifs, un seul profil) :
 * le navigateur DEMANDE bien le nouveau `sw.js` à chaque ouverture — le journal du
 * serveur montre une requête par déploiement, et le nouveau worker prend la main
 * sans qu'aucun geste soit demandé. Le trou n'est donc pas là. Il est dans l'autre
 * cas : un onglet RESTÉ OUVERT pendant un déploiement ne recharge rien, donc ne
 * redemande rien ; sa réserve reste celle de la veille jusqu'à ce qu'on y revienne.
 *
 * D'où cette vérification explicite, bornée à une toutes les quinze minutes : une
 * requête de quelques kilo-octets pour que le poste repose sur un fait, pas sur un
 * espoir. La coquille étant « réseau d'abord », elle ne peut de toute façon jamais
 * servir une version périmée tant que la ligne est là : ce qu'on rattrape ici, c'est
 * la réserve qui servira le jour où la ligne tombe.
 */
export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

interface UpdatableRegistration {
  update: () => Promise<unknown>;
}

/**
 * Le demandeur de mise à jour, sorti du crochet DOM pour être éprouvable : c'est
 * lui qui décide QUAND on redemande le worker, et cette décision n'a pas besoin
 * d'un navigateur pour être vérifiée (horloge et worker sont injectés).
 *
 * Il rend `true` quand il a réellement demandé : l'appelant comme le test peuvent
 * donc distinguer « vérifié » de « épargné » — sans quoi un étranglement silencieux
 * serait indiscernable d'une vérification qui n'a jamais eu lieu.
 */
export function createUpdateRequester(options: {
  registration: UpdatableRegistration;
  intervalMs?: number;
  now?: () => number;
}) {
  const intervalMs = options.intervalMs ?? SERVICE_WORKER_UPDATE_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  let lastRequest = Number.NEGATIVE_INFINITY;

  return function requestUpdate(): boolean {
    const at = now();
    if (at - lastRequest < intervalMs) return false;
    lastRequest = at;
    // `async` plutôt que `.catch()` sur le retour : `update()` peut aussi lever
    // tout de suite (pas de réseau au moment de l'appel), et un rejet non capté
    // ferait remonter une erreur d'enregistrement que l'utilisateur n'a pas à voir.
    void (async () => {
      try {
        await options.registration.update();
      } catch {
        /* pas de réseau : la prochaine vérification réessaiera */
      }
    })();
    return true;
  };
}

/**
 * Enregistre le worker après le premier rendu, sans jamais retarder ni casser
 * l'application : un échec d'enregistrement ne prive l'utilisateur d'aucune
 * fonctionnalité, il prive seulement le poste de la réserve hors ligne.
 */
export function registerServiceWorker(): void {
  if (!shouldRegisterServiceWorker()) return;
  if (typeof document === 'undefined') return;

  const register = () => {
    void navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { updateViaCache: 'none' })
      .then((registration) => {
        const requestUpdate = createUpdateRequester({ registration });
        // À l'ouverture, puis à chaque retour sur l'onglet : le poste redemande
        // lui-même son worker au lieu d'attendre que le navigateur y pense.
        requestUpdate();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') requestUpdate();
        });
      })
      .catch((err) => {
        console.warn('[MAMA THERA] Service worker non enregistré :', err);
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
