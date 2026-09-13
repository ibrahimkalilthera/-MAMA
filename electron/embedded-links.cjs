/**
 * LES URL QUE L'APPLICATION EMBARQUE — une seule définition, et un inventaire.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `RELEASES_URL` était écrite en clair dans `electron/main.cjs`, comme l'était
 * l'origine publique avant elle. Une URL en clair dans le code du poste est un
 * lien que PERSONNE ne relit : elle part dans chaque installeur, et un lien mort
 * ne se découvre qu'au moment où un utilisateur clique dessus — c'est-à-dire au
 * pire moment, sur un poste portable qui n'a justement que ce lien pour se
 * remettre à jour. Le dépôt a déjà payé ce prix une fois, avec une origine
 * publique morte (`HTTP 404 DEPLOYMENT_NOT_FOUND`) pendant que tout était vert.
 *
 * Un lien embarqué n'est pourtant pas jugé comme un autre, et c'est pourquoi cet
 * inventaire porte une CATÉGORIE par lien. « Ce lien marche » ne veut pas dire la
 * même chose pour une application qu'on sert, pour une page de téléchargement
 * qu'on ne sert pas, et pour le domaine d'un tiers : juger les trois par la même
 * règle donnerait soit des contrôles toujours rouges (le tiers qui répond 429 à
 * un runner), soit des contrôles toujours verts (un 200 d'erreur pris pour un
 * service). Chaque catégorie porte donc SES refus, nommés dans
 * `scripts/lib/embedded-links.mjs`.
 *
 *   • `app`          — l'origine que le poste charge quand son interface locale
 *     ne démarre pas. Elle doit RÉPONDRE, servir l'APPLICATION (la coquille, pas
 *     une page d'erreur en 200) et servir ses MODULES (une coquille dont le
 *     bundle est en 404 est un écran blanc).
 *   • `release-page` — la page de téléchargement du poste portable. Elle n'est
 *     pas la nôtre, mais le GESTE qu'elle doit permettre l'est : atteindre les
 *     versions. Un 404 (dépôt supprimé, renommé, rendu privé) ou un 200 qui
 *     atterrit ailleurs qu'une page de version ne permettent ce geste ni l'un ni
 *     l'autre.
 *   • `third-party`  — le domaine des liens de notification. On ne juge que ce
 *     qu'on peut tenir contre lui : qu'il RÉPONDE (DNS, TLS, un statut HTTP). Son
 *     code et son contenu ne sont pas les nôtres, et un contrôle qui les
 *     jugerait produirait des rouges qui ne disent rien de nos installeurs.
 *
 * Le `.cjs` est le seul format que le processus principal d'Electron (`require`)
 * et un script de contrôle (`createRequire`) partagent sans build — même raison
 * que `public-origin.cjs`, qui reste le propriétaire de l'origine embarquée.
 *
 * Chaque entrée porte aussi OÙ le lien est utilisé : une refus qui ne dit pas
 * quel geste il casse fait chercher au mauvais endroit.
 */

const { PUBLIC_ORIGIN } = require('./public-origin.cjs');

// Où atterrit un poste qui ne peut pas s'auto-installer (portable) : le lien
// doit être celui des VERSIONS, pas une page d'accueil où rien ne se télécharge.
const RELEASES_URL = 'https://github.com/ibrahimkalilthera/-MAMA/releases/latest';

// La base des liens de notification d'un parent (`src/app/useParents.ts`) : le
// pays, le numéro et le texte sont ajoutés par l'application, la base est
// embarquée telle quelle. Un test confronte les deux écritures.
const WHATSAPP_URL = 'https://wa.me/';

/**
 * L'INVENTAIRE — ce que le contrôle relit, et rien d'autre.
 *
 * Un lien embarqué qui n'est pas ici n'est pas vérifié, donc il est nommé ici :
 * `unlisted` est un refus, pas un oubli silencieux (c'est la règle du dépôt —
 * « nommé plutôt qu'omis »).
 *
 * @type {{ id: string, url: string, kind: 'app'|'release-page'|'third-party',
 *   where: string, why: string }[]}
 */
const EMBEDDED_LINKS = [
  {
    id: 'fallback-ui',
    url: PUBLIC_ORIGIN,
    kind: 'app',
    where: 'repli de l’interface locale — `electron/main.cjs` bascule dessus quand son `loadFile` échoue',
    why: 'un poste dont l’interface locale ne démarre pas n’a plus AUCUN repli si cette origine ne répond pas — et rien ne le dit avant qu’un utilisateur ne s’en plaigne',
  },
  {
    id: 'releases-page',
    url: RELEASES_URL,
    kind: 'release-page',
    where: 'bouton « Ouvrir la page de téléchargement » d’un poste PORTABLE, et l’action de mise à jour qu’un portable peut exécuter',
    why: 'un portable ne s’auto-installe pas : cette page est son seul moyen de reprendre une version, donc un lien mort ici laisse des postes sans porte de sortie',
  },
  {
    id: 'whatsapp',
    url: WHATSAPP_URL,
    kind: 'third-party',
    where: 'liens de notification d’un parent (`src/app/useParents.ts`)',
    why: 'le lien est fabriqué par l’application et ouvert par le poste : si la base ne résout plus, toutes les notifications échouent sans que rien ne le signale',
  },
];

module.exports = { PUBLIC_ORIGIN, RELEASES_URL, WHATSAPP_URL, EMBEDDED_LINKS };
