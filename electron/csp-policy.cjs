/**
 * LA POLITIQUE DE SÉCURITÉ DU POSTE — une seule définition, deux canaux.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Le paquet Windows charge son interface depuis le DISQUE (`main.cjs` → `loadFile`,
 * donc `file://`). Jusqu'ici, ce document n'avait **aucune** politique : la CSP du
 * projet n'existait que dans `vercel.json`, c'est-à-dire pour le site servi. Un
 * `@import` externe — la panne qui a coûté six jours de console bruyante sur le
 * web (voir `scripts/lib/csp-origins.mjs`) — ne serait donc bloqué par personne
 * dans l'installeur : la garde statique le REFUSE, mais une garde statique ne
 * tourne pas sur le poste d'une école.
 *
 * ─── Ce qui a été MESURÉ avant d'écrire cette ligne ─────────────────────────
 * Dans l'Electron du dépôt (44.3.0), fenêtres cachées, sondes jetables :
 *
 *   • `session.webRequest.onHeadersReceived` TIRE pour un document `file://`
 *     (contrairement à ce que laisse croire la doc du webRequest de Chromium,
 *     où le schéma `file:` ne dispatche pas cet événement) — et un en-tête CSP
 *     qu'on y ajoute est HONORÉ : politique bloquante → 2 violations collectées,
 *     même injection en version permissive → 0. Le témoin est là pour ça : sans
 *     lui, « zéro violation » ne prouverait que la surdité du collecteur.
 *   • une meta CSP est honorée elle aussi sur `file://` (2 contre 0) : c'est le
 *     second canal, celui que le build écrit dans l'artefact.
 *   • sous cette politique, les ressources LOCALES passent : script exécuté,
 *     feuille appliquée, image chargée, police demandée — `'self'` couvre bien le
 *     disque. Ce qui est bloqué, c'est l'`@import` EXTERNE (`style-src`), une
 *     police EXTERNE (`font-src`) et tout script en ligne.
 *
 * Le corollaire a été vérifié sur le build réel : `electron-ui-dist/index.html`
 * ne contient AUCUN script en ligne (uniquement `./assets/index-*.js`), donc
 * `script-src 'self'` ne casse pas le démarrage.
 *
 * ─── Pourquoi PAS un schéma `app://` (qui aurait donné le même en-tête) ────
 * Il fonctionne (mesuré : `protocol.handle('file', …)` et un schéma privilégié
 * servent l'en-tête). Il coûte en revanche L'ORIGINE : `localStorage` porte sur
 * ce poste la file d'écritures hors ligne, les identifiants de la station,
 * l'instantané et les notes (`src/lib/offline*.ts`), et changer d'origine les
 * rendrait inaccessibles sur les postes DÉJÀ installés. On garde `file://`.
 *
 * ─── Pourquoi cette politique-là, exactement ───────────────────────────────
 * Elle MIROITE les directives de `vercel.json` — la même base partagée, les mêmes
 * polices, les mêmes images — avec deux écarts, chacun motivé :
 *
 *   • `default-src 'none'` au lieu de `'self'` : sur le disque, « même origine »
 *     n'a pas le sens qu'il a sur le web, et tout ce qui n'est pas nommé
 *     explicitement ci-dessous (`frame-src`, `media-src`, `worker-src`,
 *     `manifest-src`…) doit être fermé. C'est là qu'est le verrou.
 *   • `frame-ancestors` est ABSENT : une fenêtre de bureau ne se fait pas
 *     encadrer. Ce n'est pas un détail — une meta CSP ne peut PAS porter cette
 *     directive, et cette politique voyage par les DEUX canaux : elle doit donc
 *     n'employer que des directives exprimables des deux côtés. `sandbox`,
 *     `report-uri` et `report-to` sont exclus par la même contrainte, et
 *     `tests/electron-csp-policy.test.ts` refuse leur retour.
 *
 * Cet hôte de base est la SEULE valeur absolue de ce fichier, et elle est
 * DÉCLARÉE (`scripts/lib/csp-origins.mjs`, avec ce fichier comme porteur et sa
 * raison) : le paquet ne lit aucun environnement, donc sa politique doit nommer
 * l'hôte — mais nulle part ailleurs l'application ne l'écrit en clair, elle lit
 * `VITE_SUPABASE_URL`. Un test compare ce littéral à la définition unique
 * (`scripts/lib/shared-project.mjs`) pour que les deux ne puissent pas diverger.
 *
 * ─── Un seul canal ne suffit pas ────────────────────────────────────────────
 * L'en-tête est appliqué à l'exécution (ce fichier, via `main.cjs`) et la meta
 * est écrite dans l'artefact au build (`scripts/lib/electron-csp-meta.mjs`, qui
 * lit la MÊME constante). Si le câblage du processus principal est un jour
 * contourné ou retiré, l'installeur porte quand même sa politique.
 *
 * Note honnête sur la portée : la CSP ne gouverne QUE le rendu. Les requêtes du
 * processus principal (le frein d'urgence de l'updater, `raw.githubusercontent.com`)
 * ne sont pas concernées — aucun document ne les demande.
 */

/** Le canal « en-tête » et le canal « meta » partagent cette chaîne, et rien d'autre. */
const DESKTOP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://rpcjdohfxwukbqngbprw.supabase.co wss://rpcjdohfxwukbqngbprw.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Les directives qu'une meta CSP ne peut PAS porter (CSP3 : elles sont sans effet
 * hors d'un en-tête). La politique est écrite dans les deux canaux, donc elle n'a
 * pas le droit de les employer ; la liste est ici pour que le test la relise au
 * lieu de la recopier.
 */
const META_INCOMPATIBLE = ['frame-ancestors', 'sandbox', 'report-uri', 'report-to'];

/**
 * Le document vient-il du disque du poste (l'interface locale du paquet) ?
 *
 * C'est LA borne de ce module, et elle est étroite à dessein. Le repli HTTPS
 * (`PUBLIC_ORIGIN`) n'est pas concerné : il reçoit déjà une VRAIE CSP, en en-tête,
 * servie par Vercel — et lui appliquer la nôtre ferait pire que rien, parce que
 * `default-src 'none'` ferme `worker-src` : le service worker du site (la réserve
 * hors ligne qui ouvre l'application à froid sans réseau, `scripts/lib/service-worker.mjs`)
 * mourrait SILENCIEUSEMENT, sur un chemin que personne n'exerce au quotidien.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
function isLocalDocument(url) {
  return String(url ?? '').startsWith('file://');
}

/**
 * Les en-têtes de réponse à rendre pour une requête, politique ajoutée s'il
 * s'agit de notre document local.
 *
 * Fonction PURE (aucun `electron` requis) : c'est ce qui la rend testable hors
 * d'un navigateur, et c'est ce que le processus principal branche.
 *
 * Une politique existante n'est JAMAIS écrasée : la valeur de la nôtre est
 * AJOUTÉE à la liste. Deux politiques CSP se cumulent (le navigateur applique
 * l'intersection) ; remplacer celle d'un autre producteur pourrait donc
 * l'élargir, ce que ce module ne doit jamais faire.
 *
 * @param {{ url?: unknown, responseHeaders?: Record<string, unknown> }} input
 * @returns {Record<string, string[]>}
 */
function cspHeaders({ url = '', responseHeaders = {} } = {}) {
  /** @type {Record<string, string[]>} */
  const headers = {};
  for (const [key, value] of Object.entries(responseHeaders ?? {})) {
    headers[key] = Array.isArray(value) ? [...value.map(String)] : [String(value)];
  }
  if (!isLocalDocument(url)) return headers;

  const existing = Object.keys(headers).find((key) => key.toLowerCase() === 'content-security-policy');
  const key = existing ?? 'Content-Security-Policy';
  headers[key] = [...(headers[key] ?? []), DESKTOP_CSP];
  return headers;
}

/**
 * Brancher la politique sur une session : chaque réponse passe par le filtre, et
 * seuls nos documents locaux en reçoivent une.
 *
 * Le `session` est reçu en paramètre (jamais importé d'`electron`) : la fonction
 * est donc éprouvable avec une session factice, et `main.cjs` n'en fait qu'un
 * appel — un câblage qu'on peut lire d'un coup d'œil.
 *
 * @param {{ webRequest: { onHeadersReceived: (listener: (details: any, callback: (response: any) => void) => void) => void } }} session
 * @returns {void}
 */
function installCsp(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: cspHeaders({ url: details?.url, responseHeaders: details?.responseHeaders }),
    });
  });
}

module.exports = { DESKTOP_CSP, META_INCOMPATIBLE, isLocalDocument, cspHeaders, installCsp };
