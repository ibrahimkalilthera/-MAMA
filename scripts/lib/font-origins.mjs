// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/font-origins.mjs — une police (ou une feuille) externe est-elle
// demandée par ce qu'on EXPÉDIE ?
//
// ─── Le fait mesuré, et ce qu'il a coûté ────────────────────────────────────
// `f434ae5` (22/08) importait Geist depuis Google Fonts. La CSP du projet est
// stricte — `style-src 'self' 'unsafe-inline'` et `font-src 'self'` (vercel.json)
// — donc la feuille était BLOQUÉE et la police ne chargeait jamais : chaque page
// logait une violation, et le texte s'affichait dans la pile système. `69a6f1f`
// (28/08) a réparé la CAUSE (auto-hébergement + preload, `public/fonts/geist/`).
//
// Six jours entre les deux, et **aucune garde n'a été posée par-dessus** : rouvrir
// l'import externe est encore possible aujourd'hui, en une ligne, et le symptôme
// serait encore une console pleine de violations — cette fois en production, sur
// le poste d'une école.
//
// ─── Deux règles, parce qu'il y a deux façons de rouvrir le trou ────────────
//   1. **La source** : le HTML et le CSS expédiés ne demandent aucune origine
//      externe (ni `@import` de feuille, ni `<link>`, ni `url(...)` absolu). Ce
//      n'est pas « interdit par principe » : c'est la conséquence directe de la
//      politique du projet, où `style-src`/`font-src`/`img-src` valent `'self'`.
//      Un `url(https://…)` dans nos CSS est une requête que la CSP refusera —
//      donc une violation en console et une ressource qui n'arrive pas.
//   2. **La politique** : `style-src` et `font-src` ne NOMMENT aucune origine
//      externe. C'est l'autre façon de « réparer » un blocage, et elle est pire :
//      élargir la politique fait taire la violation en ouvrant la porte à tout
//      ce que l'origine servira. Le remède est l'auto-hébergement, jamais
//      l'élargissement — le dépôt a déjà payé ce raisonnement ailleurs.
//
// ─── Pourquoi une garde STATIQUE, quand un garde-fou Chrome existe déjà ─────
// `scripts/verify-csp-guard.mjs` ouvre le site déployé dans un vrai Chrome, se
// connecte et visite sept pages : il attrape les violations, `font-src` compris.
// Il est plus fort que ce contrôle sur SON terrain — l'origine servie — et il a
// deux angles morts que celui-ci couvre :
//   • il tourne dans `pdf-e2e`, après un build et un déploiement, avec un compte
//     éphémère en base : ici la réponse arrive en une seconde, sur un poste, sans
//     réseau ni identifiants — donc au moment où la ligne est écrite ;
//   • **il ne regarde pas l'application de bureau.** `electron/main.cjs` ne
//     déclare AUCUNE CSP (mesuré : `font-src` n'apparaît que dans `vercel.json`) :
//     dans le paquet Windows, un `@import` externe ne serait bloqué par personne
//     — il partirait sur le réseau, ou pendrait hors ligne, silencieusement. Pour
//     ce paquet-là, cette garde-ci est la SEULE.
//
// ─── Ce que ce module ne juge pas ───────────────────────────────────────────
// Les polices servies par un domaine que NOUS servons (`/fonts/…`) : c'est le
// remède, pas le défaut. Et les `data:`/`blob:`, autorisés par la politique.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les régies de polices connues, pour NOMMER l'origine dans le rapport.
 *
 * Elle ne sert pas à décider (toute origine absolue est refusée, quelle qu'elle
 * soit) mais à dire *pourquoi* celle-là est reconnaissable : une console qui
 * nomme « régie de polices » se répare plus vite qu'une console qui nomme une URL.
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

/** Les extensions scannées : HTML/CSS expédiés, plus le TS/TSX qui en produit. */
export const SCANNED_EXTS = ['.html', '.htm', '.css', '.ts', '.tsx', '.js', '.cjs', '.mjs'];

/**
 * Les fichiers HTML/CSS pris comme CORPUS par défaut.
 *
 * Explicite plutôt que déduit d'une marche d'arborescence : c'est ce qu'on
 * expédie au navigateur et au paquet Windows. `dist/`, `electron-ui-dist/` et
 * `.vercel/` sont des SORTIES — les scanner accuserait un artefact obsolète
 * (mesuré : `.vercel/output/…` porte encore l'ancien `@import` de Geist).
 */
export const SHIPPED_SOURCES = ['index.html', 'src', 'public', 'electron'];

/** Les fichiers qui DÉCLARENT la politique, avec le nom qu'on lui donne au rapport. */
export const POLICY_SOURCES = [{ name: 'web (vercel.json)', file: 'vercel.json' }];

/** Les jetons de source acceptés dans `style-src`/`font-src` — rien d'autre. */
const ALLOWED_SOURCES = new Set(["'self'", "'unsafe-inline'", "'none'", "'unsafe-hashes'", 'data:', 'blob:']);

/** Une URL absolue ou protocole-relative (`//host/…`). */
const ABSOLUTE_URL = /(?:https?:)?\/\/[^"'\s)>,;]+/gi;

/**
 * Les endroits d'un fichier d'où une ressource EXTERNE peut être demandée.
 *
 * Trois formes, et chacune a son message : elles ne se réparent pas pareil (une
 * feuille se remplace par un fichier local, une police aussi, mais le `<link>`
 * se supprime).
 */
const REQUEST_PATTERNS = [
  {
    kind: 'import-externe',
    label: 'feuille de style distante importée',
    // `@import` au début d'une ligne CSS, avec ou sans `url()`, quoté ou non.
    re: /@import\s+(?:url\()?\s*['"]?((?:https?:)?\/\/[^"'\s);]+)/gi,
  },
  {
    kind: 'lien-externe',
    label: 'feuille de style ou police distant liée par le document',
    re: /<link\b[^>]*\bhref\s*=\s*['"]((?:https?:)?\/\/[^"'\s>]+)['"][^>]*>/gi,
  },
  {
    kind: 'ressource-externe',
    label: 'ressource distante demandée par le contenu expédié',
    // Toute `url(...)` absolue : dans nos feuilles, `style-src`/`font-src`/`img-src`
    // valent `'self'` — donc elle est refusée par la politique à l'exécution.
    re: /url\(\s*['"]?((?:https?:)?\/\/[^"'\s)]+)/gi,
  },
];

/** Le numéro de ligne d'un index dans un texte (1-indexé, comme un éditeur). */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** L'origine d'une URL, ou la forme brute si elle ne se laisse pas lire. */
export function originOf(url) {
  const text = String(url ?? '');
  const host = /^(?:https?:)?\/\/([^/?#]+)/i.exec(text)?.[1] ?? '';
  return host.toLowerCase();
}

/** Vrai quand l'origine est une régie de polices connue (pour le message). */
export function isFontCdn(url) {
  const host = originOf(url);
  return FONT_CDNS.some((cdn) => host === cdn || host.endsWith(`.${cdn}`));
}

/**
 * Les demandes d'origine externe trouvées dans les fichiers EXPÉDIÉS.
 *
 * Le texte reçu est supposé déjà blanchi de sa prose (`maskComments`, côté
 * contrôle) : une garde qui accuse un commentaire qui CITE la règle est une
 * garde qu'on apprend à contourner — la leçon est écrite dans ce dépôt depuis
 * l'incident du scanner naïf.
 *
 * @param {{ files?: { path: string, text: string }[] }} [input]
 * @returns {{ path: string, line: number, kind: string, label: string, url: string, host: string, fontCdn: boolean, snippet: string }[]}
 */
export function findExternalRequests({ files = [] } = {}) {
  const findings = [];
  for (const file of files) {
    const text = String(file?.text ?? '');
    for (const { kind, label, re } of REQUEST_PATTERNS) {
      // `matchAll` sur une regex globale : on repart de zéro à chaque motif.
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const url = match[1];
        const at = match.index ?? 0;
        findings.push({
          path: file.path,
          line: lineAt(text, at),
          kind,
          label,
          url,
          host: originOf(url),
          fontCdn: isFontCdn(url),
          snippet: text.slice(Math.max(0, at - 40), at + url.length + 40).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  // Un rapport se lit deux fois de la même façon : tri stable sur le fichier,
  // puis la ligne. Deux exécutions du même arbre rendent le même ordre.
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * Ce qu'une politique DÉCLARE pour `style-src` et `font-src` — et si elle les a
 * élargies.
 *
 * `font-src` absente n'est pas un trou si `default-src` est là : la politique
 * retombe dessus, et c'est ce repli qui est jugé (la directive effectivement
 * appliquée est NOMMÉE dans le rapport, pour qu'on sache laquelle a tranché).
 *
 * @param {{ name?: string, csp?: string }} [input]
 * @returns {{ name: string, directives: Record<string, string[] | null>, effective: Record<string, string | null>, widened: { directive: string, token: string }[], judgeable: boolean }}
 */
export function auditStylePolicy({ name = '', csp = '' } = {}) {
  const directives = {};
  for (const raw of String(csp ?? '').split(';')) {
    const text = raw.trim();
    if (!text) continue;
    const [key, ...rest] = text.split(/\s+/);
    directives[key.toLowerCase()] = rest;
  }
  const widened = [];
  const effective = {};
  for (const directive of ['style-src', 'font-src']) {
    const tokens = directives[directive] ?? null;
    const fallback = tokens === null ? (directives['default-src'] ?? null) : null;
    effective[directive] = tokens !== null ? directive : (fallback !== null ? 'default-src' : null);
    for (const token of tokens ?? fallback ?? []) {
      // `'unsafe-inline'` et `'self'` sont la politique du dépôt ; tout le reste
      // (un hôte, un schéma élargi) est une porte ouverte pour une ressource
      // qu'on ne sert pas.
      if (!ALLOWED_SOURCES.has(token)) widened.push({ directive, token });
    }
  }
  return {
    name,
    directives,
    effective,
    widened,
    // Sans `style-src` ni `default-src`, il n'y a RIEN à juger : un contrôle qui
    // conclurait « aucune origine externe » sur une politique illisible rendrait
    // un vert sur du vide.
    judgeable: Boolean(directives['style-src'] ?? directives['default-src']),
  };
}

/**
 * Le verdict : ce qui est demandé dehors, et ce que la politique autorise.
 *
 * @param {{ files?: { path: string, text: string }[], policies?: { name?: string, csp?: string }[] }} [input]
 * @returns {{
 *   scanned: { files: number, policies: number },
 *   findings: ReturnType<typeof findExternalRequests>,
 *   policies: ReturnType<typeof auditStylePolicy>[],
 *   unjudgeable: string[],
 *   vacuous: boolean,
 *   ok: boolean,
 * }}
 */
export function judgeFontOrigins({ files = [], policies = [] } = {}) {
  const findings = findExternalRequests({ files });
  const audited = policies.map((policy) => auditStylePolicy(policy));
  const unjudgeable = audited.filter((policy) => !policy.judgeable).map((policy) => policy.name);
  const widened = audited.flatMap((policy) => policy.widened.map((w) => ({ ...w, policy: policy.name })));

  const policyProblems = unjudgeable.length + widened.length;
  const vacuous = files.length === 0 || policies.length === 0;

  return {
    scanned: { files: files.length, policies: policies.length },
    findings,
    policies: audited,
    unjudgeable,
    widened,
    // Aucun fichier, ou aucune politique : le regard n'a rien atteint.
    vacuous,
    ok: !vacuous && findings.length === 0 && policyProblems === 0,
  };
}
