// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/csp-origins.mjs — quelles valeurs ABSOLUES ce qu'on expédie
// contient-il, et lesquelles sont justifiées ?
//
// ─── Le fait mesuré, et ce qu'il a coûté ────────────────────────────────────
// `f434ae5` (22/08) importait Geist depuis Google Fonts. La CSP du projet est
// stricte — `style-src 'self' 'unsafe-inline'` et `font-src 'self'` (vercel.json)
// — donc la feuille était BLOQUÉE et la police ne chargeait jamais : chaque page
// logait une violation, et le texte s'affichait dans la pile système. `69a6f1f`
// (28/08) a réparé la CAUSE (auto-hébergement + preload, `public/fonts/geist/`).
//
// La première garde posée par-dessus ne regardait que DEUX directives
// (`style-src`, `font-src`). C'était le trou suivant, et il était structurel :
// la politique réellement servie peut nommer `connect-src https://….supabase.co`,
// un futur `img-src https://cdn…`, `frame-src https://…`, un `<iframe src>`
// expédié, une requête `fetch('https://…')` — **aucun n'aurait été lu**. Une
// garde qui ne regarde que les polices protège les polices.
//
// ─── Les deux règles, élargies à toutes les directives ─────────────────────
//   1. **La source** : toute valeur absolue expédiée (HTML, CSS, SVG, et le
//      TS/TSX/JS/CJS/MJS qui en produit) doit être DÉCLARÉE — origine, fichier
//      qui a le droit de la porter, et raison. Ce n'est pas « interdit par
//      principe » : c'est la conséquence directe de la politique du projet, où
//      `default-src`, `connect-src` et `img-src` ne s'ouvrent à presque rien.
//      Une valeur non déclarée est refusée, et le rapport nomme la directive
//      qui la gouvernerait.
//   2. **La politique** : chaque directive est jugée — toutes, pas deux — et un
//      jeton absolu n'est accepté que s'il est déclaré pour CETTE directive.
//      Une directive ABSENTE est jugée à la place du `default-src` quand elle en
//      hérite (le repli qui a tranché est dit), et une directive d'extraction
//      qui n'a NI ses propres jetons NI repli est un trou NOMMÉ : « aucune
//      valeur n'est déclarée » veut dire « tout est permis ». Élargir la
//      politique fait taire la violation en ouvrant la porte ; le remède est de
//      servir soi-même, jamais d'élargir.
//
// ─── Pourquoi une garde STATIQUE, quand un garde-fou Chrome existe déjà ─────
// `scripts/verify-csp-guard.mjs` ouvre le site déployé dans un vrai Chrome, se
// connecte et visite sept pages : il attrape les violations, `font-src` compris.
// Il est plus fort que ce contrôle sur SON terrain — l'origine servie — et il a
// deux angles morts que celui-ci couvre :
//   • il tourne dans `pdf-e2e`, après un build et un déploiement, avec un compte
//     éphémère en base : ici la réponse arrive en une seconde, sur un poste, sans
//     réseau ni identifiants — donc au moment où la ligne est écrite ;
//   • **l'application de bureau a désormais sa PROPRE politique**, et ce module
//     la juge aussi. Pendant longtemps `electron/main.cjs` n'en déclarait aucune
//     (mesuré : `font-src` n'apparaissait que dans `vercel.json`) : dans le paquet
//     Windows, un `@import` externe n'était bloqué par personne, et cette garde-ci
//     en était la seule barrière — une barrière qui ne tourne pas sur le poste
//     d'une école. Depuis le 2026-10-12, la politique du poste vit dans
//     `electron/csp-policy.cjs`, elle est APPLIQUÉE à l'exécution
//     (`session.webRequest.onHeadersReceived`, mesuré comme honoré sur `file://`)
//     ET écrite dans l'artefact au build (meta du `<head>`) ; ce contrôle la lit
//     par `POLICY_SOURCES`, donc le paquet n'a plus une politique que personne ne
//     relit. La règle n'a pas bougé pour autant : « aucune CSP ne me bloque »
//     n'est pas « justifié ».
//
// ─── Ce que ce module ne juge pas, et il le DIT ─────────────────────────────
//   • les polices servies par un domaine que NOUS servons (`/fonts/…`) et les
//     `data:`/`blob:` autorisés par la politique : c'est le remède, pas le défaut ;
//   • les **identifiants de namespace XML** (`xmlns="http://www.w3.org/2000/svg"`) :
//     ce sont des NOMS, jamais des requêtes, et aucun `fetch` ne peut en naître.
//     Ils sont nommés dans le rapport avec cette raison, au lieu d'être tus ou
//     d'obliger à déclarer `www.w3.org` comme si on le contactait.
//
// Et sa limite est ASSUMÉE, donc écrite : ce contrôle lit des VALEURS ÉCRITES.
// Une origine assemblée à l'exécution (une concaténation, un hôte lu d'une
// configuration, une URL reconstruite par un gabarit) ne laisse aucune valeur
// absolue dans les sources et lui échappe entièrement — c'est aussi la limite du
// contrôle de la base partagée, lue sur l'artefact construit. Un fichier qui
// ferait cela reste couvert par le garde-fou d'exécution
// (`scripts/verify-csp-guard.mjs`, qui visite le site déployé et attrape la
// violation réelle), jamais par celui-ci. Un contrôle qui tairait sa limite
// ferait passer son silence pour une garantie.
// ─────────────────────────────────────────────────────────────────────────────

// L'origine partagée n'est PAS recopiée ici : elle a déjà une définition unique
// (`scripts/lib/shared-project.mjs`), et une 17ᵉ copie du ref est exactement ce
// que ce module existe pour rendre impossible. Dérivée, les deux ne peuvent pas
// diverger.
import { SHARED_PROJECT_URL } from './shared-project.mjs';

/**
 * Les régies de polices connues, pour NOMMER l'origine dans le rapport.
 *
 * Elle ne sert pas à décider (toute origine non déclarée est refusée, quelle
 * qu'elle soit) mais à dire *pourquoi* celle-là est reconnaissable : une console
 * qui nomme « régie de polices » se répare plus vite qu'une console qui nomme
 * une URL.
 */
export const FONT_CDNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'fast.fonts.net',
  'cloud.typography.com',
  'fonts.bunny.net',
  'fonts.cdnfonts.com',
  'cdn.jsdelivr.net',
  'fonts.shopifycdn.com',
  'rsms.me',
];

/** Les extensions scannées : HTML/CSS/SVG expédiés, plus le code qui en produit. */
export const SCANNED_EXTS = ['.html', '.htm', '.css', '.ts', '.tsx', '.js', '.cjs', '.mjs', '.svg'];

/**
 * Les fichiers HTML/CSS pris comme CORPUS par défaut.
 *
 * Explicite plutôt que déduit d'une marche d'arborescence : c'est ce qu'on
 * expédie au navigateur et au paquet Windows. `dist/`, `electron-ui-dist/` et
 * `.vercel/` sont des SORTIES — les scanner accuserait un artefact obsolète
 * (mesuré : `.vercel/output/…` porte encore l'ancien `@import` de Geist).
 */
export const SHIPPED_SOURCES = ['index.html', 'src', 'public', 'electron'];

/**
 * Les fichiers qui DÉCLARENT une politique, avec le nom qu'on lui donne au rapport.
 *
 * Deux formes, parce que les deux politiques ne vivent pas au même endroit : le
 * site sert ses en-têtes depuis un JSON (`vercel.json`), le poste tient sa
 * politique dans une CONSTANTE du module que le processus principal lit —
 * `module` + `export` disent au contrôle COMMENT la lire, au lieu de la
 * recopier ici (une copie jugée à la place de l'originale serait exactement le
 * faux vert que ce dépôt pourchasse).
 */
export const POLICY_SOURCES = [
  { name: 'web (vercel.json)', file: 'vercel.json' },
  {
    name: 'bureau (electron/csp-policy.cjs)',
    file: 'electron/csp-policy.cjs',
    module: true,
    export: 'DESKTOP_CSP',
  },
];

/**
 * Les valeurs absolues EXPÉDITIONNÉES, chacune déclarée avec sa raison.
 *
 * Trois champs, et chacun ferme un trou différent :
 *   • `files`      — les fichiers qui ont le DROIT de porter cette origine. Sans
 *                    cette borne, déclarer `wa.me` une fois en ferait un
 *                    laissez-passer pour tout l'arbre : le faux vert qu'on
 *                    refuse ailleurs. Vide = « aucun littéral expédié ne la
 *                    porte » (c'est le cas de la base partagée : l'application
 *                    lit `VITE_SUPABASE_URL`, elle ne l'écrit jamais en dur).
 *   • `directives` — les directives CSP qui ont le DROIT de la nommer. Vide =
 *                    « jamais dans une politique ».
 *   • `schemes`    — les schémas autorisés (`https`, `wss`…). Absent = peu importe.
 *   • `because`    — POURQUOI. Une déclaration sans raison serait un trou
 *                    déclaratif, et c'est le même refus que les exemptions de
 *                    l'inventaire des immunités.
 *
 * Ce n'est pas une liste d'autorisations confortable : c'est l'état MESURÉ de ce
 * qu'on expédie, rendu lisible. Une valeur neuve n'y entre qu'en écrivant sa
 * raison, et une valeur existante qui apparaît dans un fichier neuf rougit.
 */
/** @type {{ origin: string, schemes?: string[], files?: string[], directives?: string[], because: string }[]} */
export const JUSTIFIED_ORIGINS = [
  {
    // Dérivée : aucune copie du ref en dur, ici non plus. Calcul pur, sans
    // appeler une fonction de CE fichier — un module qu'une suite importe ne doit
    // rien exécuter à l'import (`check:import-effects`).
    origin: new URL(SHARED_PROJECT_URL).host,
    schemes: ['https', 'wss'],
    // UN SEUL fichier a le droit de l'écrire en clair : le paquet Windows ne lit
    // AUCUN environnement (`VITE_SUPABASE_URL` n'existe pas dans un processus
    // principal empaqueté), donc sa politique doit NOMMER l'hôte. Partout
    // ailleurs, l'application continue de la lire de sa variable — et cette
    // borne par fichier est ce qui empêche la déclaration de devenir un
    // laissez-passer pour tout l'arbre.
    files: ['electron/csp-policy.cjs'],
    directives: ['connect-src'],
    because:
      'la base partagée de l’école — définie une fois dans scripts/lib/shared-project.mjs. Le paquet Windows ne lit aucun environnement : sa politique DOIT nommer cet hôte, et electron/csp-policy.cjs est le seul fichier autorisé à l’écrire (ailleurs, l’application lit VITE_SUPABASE_URL) ; un test compare ce littéral à la définition unique',
  },
  {
    origin: 'wa.me',
    schemes: ['https'],
    files: ['src/app/useParents.ts', 'electron/embedded-links.cjs'],
    directives: [],
    because:
      'la notification WhatsApp : le lien est ouvert par le système (window.open / shell.openExternal), il n’est jamais récupéré par la page',
  },
  {
    origin: 'github.com',
    schemes: ['https'],
    files: ['electron/embedded-links.cjs'],
    directives: [],
    because:
      'la page des releases, ouverte par le système depuis le bureau : c’est là qu’un humain télécharge une version, jamais une ressource chargée',
  },
  {
    origin: 'raw.githubusercontent.com',
    schemes: ['https'],
    files: ['electron/updater-policy.cjs'],
    directives: [],
    because:
      'le frein d’urgence (updates/holds.json), lu par le poste au démarrage : un commit sur main suffit à retenir une mise à jour, sans rien republier',
  },
  {
    origin: 'mama-thera-finance.vercel.app',
    schemes: ['https'],
    files: ['electron/public-origin.cjs'],
    directives: [],
    because:
      'l’origine du site servi : elle sert à RECONNAÎTRE nos propres liens (et à les ouvrir dans le navigateur) — c’est la seule définition de « chez nous » côté bureau',
  },
  {
    origin: '127.0.0.1',
    schemes: ['http'],
    files: ['electron/main.cjs'],
    directives: [],
    because:
      'le serveur de développement local, testé par un PRÉDICAT (`url.startsWith`) : aucune requête n’est faite vers cette adresse dans le paquet livré',
  },
];

/**
 * Les directives qui HÉRITENT de `default-src` (CSP3 : les fetch directives).
 * Les autres (`base-uri`, `form-action`, `frame-ancestors`, `sandbox`…) sont
 * jugées seulement quand elles sont présentes — leur absence n'ouvre rien.
 */
export const FETCH_DIRECTIVES = [
  'child-src',
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'prefetch-src',
  'script-src',
  'script-src-attr',
  'script-src-elem',
  'style-src',
  'style-src-attr',
  'style-src-elem',
  'worker-src',
];

/**
 * Les jetons acceptés sans justification, et rien d'autre.
 *
 * Volontairement MINIMAL, et c'est le ratchet : un `'unsafe-eval'`, un
 * `'sha256-…'`, un `allow-scripts` de `sandbox` ou un schéma élargi seront
 * refusés — puis déclarés avec leur raison si le projet en adopte un. Une garde
 * qu'on élargit en silence ne garde plus rien.
 */
const ALLOWED_SOURCES = new Set(["'self'", "'unsafe-inline'", "'none'", "'unsafe-hashes'", 'data:', 'blob:']);

/**
 * Les identifiants de namespace XML/XHTML : des NOMS, jamais des requêtes.
 *
 * Mesuré : `public/favicon.svg` porte `xmlns="http://www.w3.org/2000/svg"`. Le
 * déclarer comme une origine serait dire qu'on contacte le W3C.
 */
export const XML_NAMESPACE_HOSTS = ['www.w3.org'];

/**
 * Une URL absolue (`scheme://…`) ou protocole-relative (`//host/…`).
 *
 * Le `//` protocole-relatif ne doit pas être vu DANS une URL déjà complète :
 * sans la négation, `wss://api.example.com` produisait DEUX trouvailles — la
 * vraie, et son propre `//…` relu comme une seconde origine. Mesuré par le cas
 * `new WebSocket(…)` de la suite, qui en comptait deux pour un seul appel.
 */
const ABSOLUTE_URL = /(?:[a-z][a-z0-9+.-]*:\/\/|(?<![:a-z0-9+.-])\/\/)[^"'\s)>,;]+/gi;

/** Un hôte plausible : `a.b`, une IPv4, ou `localhost`. Écarte `a//b` et les chemins. */
const HOST_SHAPE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$|^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$/i;

/** Le schéma d'une URL, ou null (protocole-relative, ou pas d'URL). */
export function schemeOf(url) {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(String(url ?? ''));
  return match ? match[1].toLowerCase() : null;
}

/**
 * L'origine d'une URL, ou la forme brute si elle ne se laisse pas lire.
 * @param {unknown} url
 * @returns {string}
 */
export function originOf(url) {
  const text = String(url ?? '');
  const host = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]+)/i.exec(text)?.[1] ?? '';
  return host.toLowerCase();
}

/**
 * La (ou les) politique(s) `Content-Security-Policy` déclarée(s) par un JSON
 * d'en-têtes d'hôte (`vercel.json`).
 *
 * Lue, jamais recopiée : la politique servie n'a qu'un exemplaire, et un second
 * exemplaire finirait par s'en écarter — c'est exactement ce que ce dépôt
 * pourchasse ailleurs (`POLICY_SOURCES`, ci-dessus).
 *
 * @param {unknown} hostJson le JSON d'hôte déjà analysé
 * @returns {string[]} une valeur par en-tête déclaré (vide si aucun)
 */
export function declaredPolicies(hostJson) {
  const values = [];
  const rules = /** @type {{ headers?: { key?: string, value?: string }[] }[]} */ (hostJson)?.headers ?? [];
  for (const rule of rules) {
    for (const header of rule.headers ?? []) {
      if (/^content-security-policy$/i.test(String(header.key))) values.push(String(header.value));
    }
  }
  return values;
}

/**
 * La politique du dépôt, ÉTENDUE à une origine locale — le seul écart toléré.
 *
 * Pourquoi une dérivation existe : la politique servie nomme la base de
 * l'école (`connect-src https://<ref>.supabase.co`). Un run qui fait tourner
 * l'application sur SA PROPRE pile locale ne pourrait donc rien mesurer : le
 * navigateur refuserait chaque requête, et la garde CSP lit des violations, pas
 * des intentions. On ajoute l'origine de la pile à `connect-src` — la SEULE
 * directive concernée par un changement de base — au lieu d'élargir la
 * politique entière.
 *
 * Deux pièges fermés ici, chacun mesuré :
 *   • `http://` et `ws://` sont deux origines aux yeux d'une CSP, donc les deux
 *     sont ajoutées (Realtime ouvre une socket) ;
 *   • quand `connect-src` est ABSENTE, elle hérite des jetons de `default-src`
 *     (règle CSP). Poser `connect-src <origine>` seule retirerait donc `'self'`
 *     — la dérivation RESTREINDRAIT au lieu d'ajouter. On reprend l'héritage.
 *
 * L'appelant qui juge l'écart (la garde CSP) la compare à ce que l'hôte sert
 * réellement : une dérive non dérivée rougit, au lieu de passer pour un acquis.
 *
 * @param {string} csp la politique du dépôt
 * @param {string} origin l'origine de la pile locale (`http://127.0.0.1:54321`)
 * @returns {string} la politique à servir localement (inchangée sans origine)
 */
export function policyWithLocalStack(csp, origin) {
  const base = String(csp ?? '').trim();
  const target = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!base || !target) return base;
  const socket = target.replace(/^http/i, 'ws');
  const parts = base
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const at = parts.findIndex((p) => /^connect-src\b/i.test(p));
  if (at >= 0) {
    const [key, ...tokens] = parts[at].split(/\s+/);
    const added = [target, socket].filter((o) => !tokens.includes(o));
    parts[at] = [key, ...tokens, ...added].join(' ');
    return parts.join('; ');
  }
  const fallback = parts.find((p) => /^default-src\b/i.test(p));
  const inherited = fallback ? fallback.split(/\s+/).slice(1) : [];
  parts.push(`connect-src ${[...new Set([...inherited, target, socket])].join(' ')}`);
  return parts.join('; ');
}

/**
 * L'écart entre la politique servie et la politique du dépôt : le SEUL admis
 * étant l'origine de la pile locale.
 *
 * Il existe parce qu'une dérivation qui ne se laisse pas juger est un blanc-seing :
 * à partir du moment où l'on sert autre chose que le dépôt, il faut pouvoir dire
 * CE QUI a changé. Le verdict nomme donc les deux listes (attendu, servi) et
 * refuse tout jeton ajouté qui n'est pas une des deux formes de l'origine.
 *
 * @param {{ declared?: string, served?: string, origin?: string }} input
 * @returns {{ ok: boolean, expected: string, added: string[], removed: string[], because: string }}
 */
export function localStackGap({ declared = '', served = '', origin = '' } = {}) {
  const expected = policyWithLocalStack(declared, origin);
  const tokens = (csp) => {
    const map = {};
    for (const part of String(csp ?? '').split(';')) {
      const text = part.trim();
      if (!text) continue;
      const [key, ...rest] = text.split(/\s+/);
      map[key.toLowerCase()] = rest;
    }
    return map;
  };
  const want = tokens(expected);
  const got = tokens(served);
  const added = [];
  const removed = [];
  for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const a = want[key] ?? [];
    const b = got[key] ?? [];
    for (const token of b) if (!a.includes(token)) added.push(`${key} ${token}`);
    for (const token of a) if (!b.includes(token)) removed.push(`${key} ${token}`);
  }
  const socket = String(origin ?? '').replace(/^http/i, 'ws');
  const allowed = new Set([String(origin ?? ''), socket]);
  const unexpected = added.filter((entry) => !allowed.has(entry.split(' ').slice(1).join(' ')));
  const ok = unexpected.length === 0 && removed.length === 0;
  return {
    ok,
    expected,
    added,
    removed,
    because: ok
      ? `la politique servie est celle du dépôt, plus l'origine de la pile locale (${[...allowed].join(', ')})`
      : `la politique servie s'écarte du dépôt au-delà de l'origine locale : ` +
        [...unexpected.map((e) => `+${e}`), ...removed.map((e) => `-${e}`)].join(', '),
  };
}

/** Vrai quand l'origine est une régie de polices connue (pour le message). */
export function isFontCdn(url) {
  const host = originOf(url);
  return FONT_CDNS.some((cdn) => host === cdn || host.endsWith(`.${cdn}`));
}

/** Vrai quand l'URL est un identifiant de namespace (`xmlns`), donc un NOM. */
export function isXmlNamespace(url) {
  const host = originOf(url);
  return XML_NAMESPACE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * L'entrée qui JUSTIFIE une origine, ou null.
 *
 * Deux usages, une seule table : côté source on borne par FICHIER, côté politique
 * on borne par DIRECTIVE. Une origine déclarée pour un fichier ne l'est pas pour
 * les autres, et une origine déclarée pour `connect-src` ne l'est pas pour
 * `frame-src` — c'est ce qui empêche une déclaration de devenir un blanc-seing.
 *
 * @param {{ origin: string, path?: string | null, directive?: string | null, url?: string | null }} input
 * @returns {typeof JUSTIFIED_ORIGINS[number] | null}
 */
export function justificationFor({ origin, path = null, directive = null, url = null }) {
  const host = String(origin ?? '').toLowerCase().replace(/\.$/, '');
  const scheme = schemeOf(url);
  return (
    JUSTIFIED_ORIGINS.find((entry) => {
      if (String(entry.origin).toLowerCase() !== host) return false;
      if (entry.schemes && scheme && !entry.schemes.includes(scheme)) return false;
      if (path !== null && !(entry.files ?? []).includes(path)) return false;
      if (directive !== null && !(entry.directives ?? []).includes(directive)) return false;
      return true;
    }) ?? null
  );
}

/** La directive qu'un `<link>` gouverne, d'après ses attributs. */
function linkDirectives(tag) {
  const text = String(tag ?? '');
  const attr = (name) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(text)?.[1]?.toLowerCase() ?? '';
  const rel = attr('rel');
  const as = attr('as');
  if (rel.includes('stylesheet')) return ['style-src'];
  if (rel.includes('manifest')) return ['manifest-src'];
  if (rel.includes('icon')) return ['img-src'];
  if (rel.includes('preconnect') || rel.includes('dns-prefetch') || rel.includes('prefetch')) return ['connect-src'];
  if (rel.includes('preload') || rel.includes('modulepreload')) {
    if (as === 'font') return ['font-src'];
    if (as === 'style') return ['style-src'];
    if (as === 'script') return ['script-src'];
    if (as === 'image') return ['img-src'];
    if (as === 'fetch') return ['connect-src'];
    return [];
  }
  return [];
}

/** La directive qu'un élément gouverne, d'après son nom. */
function elementDirectives(tagName) {
  switch (String(tagName ?? '').toLowerCase()) {
    case 'script':
      return ['script-src'];
    case 'iframe':
      return ['frame-src'];
    case 'embed':
    case 'object':
      return ['object-src'];
    case 'video':
    case 'audio':
    case 'track':
      return ['media-src'];
    case 'source':
      // `<source>` sert une image OU un média : la forme ne tranche pas, et le
      // rapport le DIT au lieu de choisir à la place du lecteur.
      return ['img-src', 'media-src'];
    default:
      return ['img-src'];
  }
}

/**
 * Les endroits d'un fichier d'où une valeur ABSOLUE peut être expédiée.
 *
 * Chaque motif dit sa FORME et la ou les directives qui la gouverneraient : la
 * dernière, `origine-absolue`, est le filet — elle rattrape ce que la forme ne
 * dit pas (une constante, un littéral de gabarit), pour qu'aucune valeur ne
 * puisse être expédiée sans être nommée. Un doublon est écarté par position :
 * le motif le plus précis gagne, et le filet ne double jamais un `@import`.
 */
const REQUEST_PATTERNS = [
  {
    kind: 'import-externe',
    label: 'feuille de style distante importée',
    re: /@import\s+(?:url\()?\s*['"]?((?:https?:)?\/\/[^"'\s);]+)/gi,
    pick: (m) => ({ url: m[1], directives: ['style-src'] }),
  },
  {
    kind: 'lien-externe',
    label: 'ressource distante liée par le document',
    re: /<link\b[^>]*\bhref\s*=\s*['"]((?:https?:)?\/\/[^"'\s>]+)['"][^>]*>/gi,
    pick: (m) => ({ url: m[1], directives: linkDirectives(m[0]) }),
  },
  {
    kind: 'ressource-externe',
    label: 'ressource distante demandée par une déclaration de style',
    // Toute `url(...)` absolue : selon la déclaration qui la porte, c'est
    // `style-src`, `font-src` ou `img-src` qui tranche — les trois sont nommées.
    re: /url\(\s*['"]?((?:https?:)?\/\/[^"'\s)]+)/gi,
    pick: (m) => ({ url: m[1], directives: ['style-src', 'font-src', 'img-src'] }),
  },
  {
    kind: 'element-externe',
    label: 'ressource distante demandée par un élément',
    re: /<(img|script|iframe|embed|source|video|audio|track|object|input)\b[^>]*?\b(?:src|data|poster)\s*=\s*['"]((?:https?:)?\/\/[^"'\s>]+)['"]/gi,
    pick: (m) => ({ url: m[2], directives: elementDirectives(m[1]) }),
  },
  {
    kind: 'requete-externe',
    label: 'requête distante écrite en JavaScript',
    re: /(?:fetch|sendBeacon|importScripts|new\s+WebSocket|new\s+EventSource|new\s+Worker|new\s+SharedWorker|serviceWorker\.register)\s*\(\s*['"`]((?:https?:|wss?:)?\/\/[^'"`\s)]+)/gi,
    pick: (m) => {
      const how = m[0].toLowerCase();
      if (how.includes('websocket') || how.includes('eventsource') || how.includes('fetch') || how.includes('sendbeacon')) {
        return { url: m[1], directives: ['connect-src'] };
      }
      if (how.includes('importscripts')) return { url: m[1], directives: ['script-src', 'worker-src'] };
      return { url: m[1], directives: ['worker-src'] };
    },
  },
  {
    kind: 'ouverture-externe',
    label: 'requête distante ouverte par XMLHttpRequest',
    re: /\.open\s*\(\s*['"`][A-Z]+['"`]\s*,\s*['"`]((?:https?:)?\/\/[^'"`\s)]+)/gi,
    pick: (m) => ({ url: m[1], directives: ['connect-src'] }),
  },
  {
    kind: 'origine-absolue',
    label: 'valeur absolue expédiée — la directive dépend de son usage',
    re: ABSOLUTE_URL,
    pick: (m) => ({ url: m[0], directives: [] }),
  },
];

/** Le numéro de ligne d'un index dans un texte (1-indexé, comme un éditeur). */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * Les valeurs absolues trouvées dans les fichiers EXPÉDITS.
 *
 * Le texte reçu est supposé déjà blanchi de sa prose (`maskComments`, côté
 * contrôle) : une garde qui accuse un commentaire qui CITE la règle est une
 * garde qu'on apprend à contourner — la leçon est écrite dans ce dépôt depuis
 * l'incident du scanner naïf.
 *
 * @param {{ files?: { path: string, text: string }[] }} [input]
 * @returns {{ path: string, line: number, kind: string, label: string, url: string,
 *   host: string, scheme: string | null, fontCdn: boolean, namespace: boolean,
 *   directives: string[], snippet: string }[]}
 */
export function findExternalRequests({ files = [] } = {}) {
  const findings = [];
  for (const file of files) {
    const text = String(file?.text ?? '');
    // Un même texte peut être capturé par plusieurs motifs (l'`@import` ET son
    // `url()`) : le premier motif qui le voit est le plus précis, donc il gagne.
    const seen = new Set();
    for (const { kind, label, re, pick } of REQUEST_PATTERNS) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const { url, directives } = pick(match);
        if (!url) continue;
        const host = originOf(url);
        // Le filet ne doit pas prendre une division ou un chemin pour un hôte :
        // sans forme d'hôte, ce n'est pas une origine qu'on pourrait justifier.
        if (!HOST_SHAPE.test(host)) continue;
        const at = (match.index ?? 0) + match[0].indexOf(url);
        const key = `${at}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          path: file.path,
          line: lineAt(text, at),
          kind,
          label,
          url,
          host,
          scheme: schemeOf(url),
          fontCdn: isFontCdn(url),
          namespace: isXmlNamespace(url),
          directives,
          snippet: text.slice(Math.max(0, at - 40), at + url.length + 40).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  // Un rapport se lit deux fois de la même façon : tri stable sur le fichier,
  // puis la ligne, puis la position. Deux exécutions du même arbre rendent le
  // même ordre.
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.url.localeCompare(b.url));
}

/**
 * Ce qu'une politique DÉCLARE, directive par directive — et si elle les a
 * élargies.
 *
 * `judgedVia` nomme, pour chaque directive, celle qui a RÉELLEMENT tranché :
 * elle-même, ou `default-src` quand elle en hérite et qu'elle est absente. Un
 * rapport qui tairait le repli ferait croire qu'une directive absente ne dit
 * rien, alors qu'elle redit le `default-src`.
 *
 * `unrestricted` est l'autre moitié, et elle manquait : une directive
 * d'extraction qui n'a NI ses propres jetons NI `default-src` n'est pas
 * « silencieuse » — elle autorise TOUT. Le dire est le seul verdict honnête.
 *
 * @param {{ name?: string, csp?: string }} [input]
 * @returns {{ name: string, directives: Record<string, string[]>, judgedVia: Record<string, string | null>,
 *   widened: { directive: string, token: string, via: string }[], unrestricted: string[],
 *   namespaces: string[], judgeable: boolean }}
 */
export function auditPolicy({ name = '', csp = '' } = {}) {
  const directives = {};
  for (const raw of String(csp ?? '').split(';')) {
    const text = raw.trim();
    if (!text) continue;
    const [key, ...rest] = text.split(/\s+/);
    directives[key.toLowerCase()] = rest;
  }
  const widened = [];
  const namespaces = [];
  const unrestricted = [];
  const judgedVia = {};

  // 1. Toute directive PRÉSENTE est jugée : c'est la règle, et elle vaut pour
  //    les dix-sept directives, pas pour deux.
  for (const [directive, tokens] of Object.entries(directives)) {
    judgedVia[directive] = directive;
    for (const token of tokens) {
      const host = originOf(token) || hostWithoutScheme(token);
      // Un jeton sans forme d'hôte (`'self'`, `data:`, un mot de `sandbox`) est
      // jugé sur la liste déclarée — jamais deviné.
      if (!host) {
        if (!ALLOWED_SOURCES.has(token)) widened.push({ directive, token, via: directive });
        continue;
      }
      if (isXmlNamespace(token)) {
        namespaces.push(`${directive} ${token}`);
        continue;
      }
      if (justificationFor({ origin: host, directive, url: token })) continue;
      widened.push({ directive, token, via: directive });
    }
  }

  // 2. Les directives qui HÉRITENT de `default-src` : absentes, elles sont
  //    jugées À SA PLACE, et c'est le repli qui est nommé. Sans `default-src`
  //    non plus, elles ne sont pas « conformes » : elles sont SANS LIMITE.
  const fallback = directives['default-src'] ?? null;
  for (const directive of FETCH_DIRECTIVES) {
    if (directive in directives) continue;
    if (fallback === null) {
      unrestricted.push(directive);
      continue;
    }
    judgedVia[directive] = 'default-src';
    for (const token of fallback) {
      if (ALLOWED_SOURCES.has(token)) continue;
      const host = originOf(token) || hostWithoutScheme(token);
      if (!host) {
        widened.push({ directive, token, via: 'default-src' });
        continue;
      }
      if (isXmlNamespace(token)) {
        namespaces.push(`${directive} ← default-src ${token}`);
        continue;
      }
      if (justificationFor({ origin: host, directive, url: token })) continue;
      widened.push({ directive, token, via: 'default-src' });
    }
  }

  return {
    name,
    directives,
    judgedVia,
    widened,
    unrestricted,
    namespaces,
    // Aucune directive lisible : il n'y a RIEN à juger. Un contrôle qui
    // conclurait « aucune valeur absolue » sur une politique vide rendrait un
    // vert sur du vide.
    judgeable: Object.keys(directives).length > 0,
  };
}

/**
 * Le nom d'hôte d'un jeton de politique écrit SANS schéma (`a.example.com`,
 * `*.example.com`) ; null si ce n'est pas un hôte.
 *
 * CSP autorise les deux formes (`https://a.example.com` et `a.example.com`) :
 * ne lire que la première ferait passer une origine nommée en douce pour un
 * jeton inconnu — et le refus serait alors un faux reproche.
 *
 * @param {string} token
 * @returns {string}
 */
function hostWithoutScheme(token) {
  const text = String(token ?? '').replace(/^['"]|['"]$/g, '');
  if (!HOST_SHAPE.test(text.replace(/^\*\./, ''))) return '';
  return text.toLowerCase();
}

/**
 * Le verdict : ce qui est expédié dehors, et ce que la politique autorise.
 *
 * @param {{ files?: { path: string, text: string }[], policies?: { name?: string, csp?: string }[] }} [input]
 * @returns {{
 *   scanned: { files: number, policies: number },
 *   findings: (ReturnType<typeof findExternalRequests>[number] & { justified: boolean, because: string | null })[],
 *   undeclared: { path: string, line: number, host: string, kind: string, directives: string[] }[],
 *   namespaces: ReturnType<typeof findExternalRequests>,
 *   policies: ReturnType<typeof auditPolicy>[],
 *   unjudgeable: string[],
 *   widened: { directive: string, token: string, via: string, policy: string }[],
 *   unrestricted: { directive: string, policy: string }[],
 *   vacuous: boolean,
 *   ok: boolean,
 * }}
 */
export function judgeCspOrigins({ files = [], policies = [] } = {}) {
  // Les namespaces XML sont des NOMS : nommés, jamais comptés comme des demandes.
  const found = findExternalRequests({ files });
  const namespaces = found.filter((f) => f.namespace);
  // Le verdict est porté PAR la trouvaille : un contrôle qui le recalculerait
  // de son côté pourrait juger autre chose que ce qu'il affiche, et deux
  // lectures du même fait finiraient par diverger.
  const findings = found
    .filter((f) => !f.namespace)
    .map((f) => {
      const entry = justificationFor({ origin: f.host, path: f.path, url: f.url });
      return { ...f, justified: entry !== null, because: entry?.because ?? null };
    });
  const undeclared = findings
    .filter((f) => !f.justified)
    .map((f) => ({ path: f.path, line: f.line, host: f.host, kind: f.kind, directives: f.directives, url: f.url }));

  const audited = policies.map((policy) => auditPolicy(policy));
  const unjudgeable = audited.filter((policy) => !policy.judgeable).map((policy) => policy.name);
  const widened = audited.flatMap((policy) => policy.widened.map((w) => ({ ...w, policy: policy.name })));
  const unrestricted = audited.flatMap((policy) =>
    policy.unrestricted.map((directive) => ({ directive, policy: policy.name })),
  );

  const policyProblems = unjudgeable.length + widened.length + unrestricted.length;
  const vacuous = files.length === 0 || policies.length === 0;

  return {
    scanned: { files: files.length, policies: policies.length },
    findings,
    undeclared,
    namespaces,
    policies: audited,
    unjudgeable,
    widened,
    unrestricted,
    // Aucun fichier, ou aucune politique : le regard n'a rien atteint.
    vacuous,
    ok: !vacuous && undeclared.length === 0 && policyProblems === 0,
  };
}
