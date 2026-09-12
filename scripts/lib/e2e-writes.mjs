// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/e2e-writes.mjs — une écriture de démo doit pouvoir être retrouvée.
//
// Mesuré le 2026-09-12 : un 504 du gateway Supabase est tombé APRÈS avoir
// appliqué un POST. Rejouer l'écriture a créé son risque propre — un doublon —
// parce que `public.staff` n'a aucune contrainte sur `email` et que
// `public.students` n'a d'unique que `student_id` (NULL sur les lignes de démo).
// Et le doublon serait resté INVISIBLE : le nettoyage supprime par l'id rendu
// par la tentative gagnante, donc la ligne de la tentative perdue n'aurait
// jamais eu de nom.
//
// La leçon tient en deux exigences, et ce module les VÉRIFIE au lieu de les
// recommander :
//   • une **identité unique** — la ligne porte le jeton de son exécution, sinon
//     deux runs (ou un rejeu) produisent des lignes qu'aucun humain ne peut
//     distinguer ;
//   • une **clé de réconciliation** — une REQUÊTE qui la retrouve (`email=eq.…`,
//     ou `?email=` côté GoTrue), et pas seulement l'id rendu : c'est la seule qui
//     vaille si la réponse s'est perdue, et la seule capable de retrouver un
//     doublon.
//
// ─── Trois indirections, résolues au lieu d'être tolérées ───────────────────
//
// Un contrôle qui lit un fichier tel qu'il est écrit se trompe sur du code
// correct, et c'est le pire des deux péchés : un faux rouge apprend à éteindre
// le contrôle. Le code de ce dépôt met le jeton et la clé à UN cran du POST :
//
//   • le JETON est cherché par SYMBOLE. Les constantes du fichier qui viennent de
//     `Date.now()`, `ephemeralEmail()`, `randomUUID()` — ou d'un gabarit bâti sur
//     elles (`const PROBE_NAME = \`RLS ${TS}\``) — sont des jetons ; une ligne qui
//     en CITE un porte le jeton de son run. La citation, pas la déclaration : la
//     ligne qui DÉFINIT `TS` n'est pas une ligne estampillée, sinon n'importe
//     quelle fenêtre de texte assez large ferait passer n'importe quoi.
//   • la CLÉ d'une AIDE se vérifie chez TOUS ses appelants, et l'appelant fautif
//     est nommé — pas la définition. Une aide qui porte déjà sa clé (elle reçoit
//     l'email et sonde avec) n'exige rien de ses appelants.
//   • l'ENROBAGE se lit sur les appels qui ENCADRENT le site, pas dans un
//     voisinage : une aide de rejeu écrite trente lignes plus haut ne couvre
//     rien, et une fenêtre assez large pour l'attraper attraperait aussi le
//     script entier.
//
// ─── La prose n'est pas du code ─────────────────────────────────────────────
// Ce dépôt a payé trois fois de lire de la prose comme du code. Ce module lit la
// version BLANCHIE des commentaires (`source-text.mjs`) : la phrase qui explique
// `email=eq.…` ne peut pas faire passer un POST qui ne l'écrit nulle part.
//
// Et la limite, qu'il faut dire : c'est un contrôle de TEXTE. Il attrape une
// écriture brute non déclarée, il ne prouve pas que la ligne est nettoyée. La
// preuve de nettoyage appartient au garde anti-résidus
// (`scripts/verify-ephemeral-cleanup.mjs`) et à l'exécution, pas au texte.
// ─────────────────────────────────────────────────────────────────────────────
import { maskComments } from './source-text.mjs';

/** Les URL qui désignent la base partagée (REST et auth). */
const SUPABASE_MARKERS = ['supabaseBase', '/rest/v1/', '/auth/v1/', 'authApi('];

/** Les aides de rejeu : passer par l'une d'elles, c'est sonder avant de rejouer. */
export const REPLAY_HELPERS = ['replayableWrite', 'insertOnce', 'createOnce', 'insertOnceRow', 'createDemoRow'];

/**
 * Les fabriques qui produisent elles-mêmes un jeton d'exécution.
 *
 * `Date.now()` nu n'est PAS retenu : il apparaît dans des lignes de journal
 * étrangères au sujet, et l'accepter rendait estampillé tout voisinage un peu
 * large — c'est ainsi qu'un `const TS = Date.now()` défini dans l'en-tête du
 * fichier blanchissait à lui seul toutes les écritures situées en dessous. Il
 * compte en revanche pour RECONNAÎTRE une constante-jeton (`stampSymbols`).
 */
const STAMP_FACTORY = /(?:ephemeralEmail|randomUUID)\s*\(/;

/** Une interpolation de gabarit, et ce qu'elle interpole. */
const INTERPOLATION = /\$\{\s*([A-Za-z_$][\w$]*|Date\.now\s*\(|new Date|randomUUID\s*\()/g;

/** Une déclaration de constante, dont on veut lire la valeur. */
const STAMP_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;

/** Une clé de RÉCONCILIATION : une REQUÊTE qui retrouve la ligne. */
export const RECONCILIATION_MARKERS = /=eq\.|\?email=/;

/** La définition d'une aide de rejeu, et le nom de cette aide. */
const WRAPPER_DEF = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:replayableWrite|insertOnce|createOnce|insertOnceRow|createDemoRow)\s*\(/g;

/** Le nombre de caractères pris de part et d'autre d'un site d'écriture. */
const WINDOW_BEFORE = 1400;
const WINDOW_AFTER = 900;

/**
 * Un POST qui ne CRÉE pas de ligne : appel de fonction, session, reset.
 *
 * Les compter comme des écritures de démo rendrait l'inventaire bruyant, et un
 * inventaire bruyant se lit de travers : `verify-anon-rls.mjs` passe la moitié
 * de sa vie à des appels RPC que la policy DOIT refuser.
 */
const NON_CREATING = /(\/rpc\/|rpc\/|grant_type=|authApi\('recover'|authApi\('token)/;

/**
 * L'offset exact d'une ligne, quel que soit le format de fin de ligne.
 *
 * Recalculer l'offset en recollant les lignes avec `\n` se trompe d'un caractère
 * par ligne sur un fichier CRLF — soit des fenêtres décalées de plusieurs
 * centaines de caractères, donc des verdicts qui parlent du mauvais endroit.
 */
function lineOffset(source, line) {
  let index = 0;
  for (let n = 1; n < line; n += 1) {
    const next = source.indexOf('\n', index);
    if (next < 0) return source.length;
    index = next + 1;
  }
  return index;
}

/** La ligne n° `line` (1-indexée), sans son saut de ligne. */
const lineText = (source, line) => String(source ?? '').split(/\r?\n/)[line - 1] ?? '';

/** Le numéro de ligne d'un offset. */
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length;

/**
 * `text` privé des lignes qui DÉCLARENT ce symbole.
 *
 * C'est la différence entre citer un jeton et le définir : sans ce retrait, la
 * ligne `const TS = Date.now()…` fait passer pour estampillé tout texte qui la
 * contient — y compris une fenêtre qui n'a rien à voir avec une écriture.
 */
function withoutDeclaration(text, name) {
  const declaration = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`);
  return text.split('\n').filter((line) => !declaration.test(line)).join('\n');
}

/**
 * Les symboles du fichier qui PORTENT un jeton d'exécution.
 *
 * Une seule passe ne suffit pas : `const PROBE_NAME = \`RLS ${TS}\`` n'est un
 * jeton que parce que `TS` en est un. La propagation est répétée jusqu'à point
 * fixe (bornée), ce qui couvre les chaînes de constantes réelles sans ouvrir la
 * porte à n'importe quel identifiant.
 *
 * @param {string} source texte blanchi des commentaires
 * @returns {Set<string>}
 */
export function stampSymbols(source) {
  const text = String(source ?? '');
  const decls = [...text.matchAll(STAMP_DECL)].map((m) => ({ name: m[1], index: m.index ?? 0 }));
  const stamps = new Set();
  // Une VALEUR qui fabrique un jeton (`Date.now()` nu compris, ici : c'est la
  // définition qui parle), ou qui en cite un déjà reconnu.
  const isSource = (value) =>
    /\bDate\.now\s*\(|\b(?:ephemeralEmail|randomUUID)\s*\(/.test(value) || citesStamp(value, stamps);
  for (let pass = 0; pass < 4; pass += 1) {
    const before = stamps.size;
    decls.forEach((decl, i) => {
      if (stamps.has(decl.name)) return;
      const end = i + 1 < decls.length ? decls[i + 1].index : text.length;
      if (isSource(text.slice(decl.index, Math.min(end, decl.index + 600)))) stamps.add(decl.name);
    });
    if (stamps.size === before) break;
  }
  return stamps;
}

/**
 * Ce texte porte-t-il un jeton d'exécution — écrit, ou CITÉ par symbole ?
 * @param {string} text
 * @param {Set<string>} stamps
 * @returns {boolean}
 */
export function isStamped(text, stamps = new Set()) {
  const value = String(text ?? '');
  if (STAMP_FACTORY.test(value)) return true;
  for (const name of stamps) {
    if (new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`).test(withoutDeclaration(value, name))) return true;
  }
  return citesStamp(value, stamps);
}

/**
 * Le texte interpole-t-il un jeton — `${TS}` où `TS` en est un ?
 *
 * C'est la différence entre un jeton et un gabarit quelconque : `${supabaseBase}`
 * construit une URL, pas une identité de run, et le compter comme un jeton
 * rendait estampillée toute écriture voisine d'un template.
 *
 * @param {string} text
 * @param {Set<string>} stamps
 * @returns {boolean}
 */
function citesStamp(text, stamps) {
  for (const match of String(text ?? '').matchAll(INTERPOLATION)) {
    const name = match[1];
    if (/^(?:Date\.now\s*\(|new Date|randomUUID\s*\()/.test(name)) return true;
    if (stamps.has(name)) return true;
  }
  return false;
}

/**
 * Le texte entre les parenthèses d'un appel, équilibré.
 * @param {string} text
 * @param {number} open index de la parenthèse ouvrante
 * @returns {string}
 */
function argumentText(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** Les appels d'une aide : son nom, suivi d'une parenthèse, hors définition. */
function callSites(text, name, definitionIndex) {
  const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g');
  const sites = [];
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    const open = index + match[0].length - 1;
    if (open === definitionIndex) continue;
    sites.push({ index, line: lineText(text, lineOf(text, index)), args: argumentText(text, open) });
  }
  return sites;
}

/**
 * Les appels qui ENCADRENT un offset, du plus proche au plus lointain.
 *
 * C'est la différence entre « cette écriture passe par le rejeu » et « il y a un
 * rejeu quelque part au-dessus » : compter les parenthèses vers l'arrière, en
 * s'arrêtant au début de l'instruction (`;`) ou du bloc (`{`) qui contient le
 * site. Sans cette borne, la définition d'une aide voisine passerait pour
 * l'enrobage du site, et le contrôle deviendrait vert sans rien vérifier.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {string[]} noms d'appels, du plus proche au plus lointain
 */
export function enclosingCalls(text, offset) {
  const names = [];
  let depth = 0;
  for (let i = offset - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === ')') depth += 1;
    else if (char === '(') {
      if (depth === 0) {
        // Le nom se lit avant la parenthèse ; une parenthèse de paramètres
        // (`() =>`, `function x(`) n'en a pas et n'est donc jamais prise pour
        // un appel.
        const before = text.slice(Math.max(0, i - 60), i);
        const name = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
        names.push(name ? name[1] : '');
      } else depth -= 1;
    } else if (char === ';' && depth === 0) {
      // Fin de l'instruction qui porte le site : au-delà, on lit des
      // instructions VOISINES, et une aide de rejeu voisine ne couvre rien.
      break;
    }
  }
  return names;
}

/**
 * La première ligne d'une instruction VOISINE de celle qui commence en
 * `defIndex`, ou `lines.length` s'il n'y en a pas.
 *
 * Le repère est l'INDENTATION, pas la colonne 0 : les écritures de ce dépôt
 * vivent dans des fonctions, donc indentées, et une règle « colonne 0 » ne
 * voyait jamais la fin d'une instruction — une aide définie soixante lignes plus
 * haut passait alors pour l'enrobage du site, et le contrôle devenait vert sans
 * avoir rien vérifié.
 *
 * @param {string[]} lines
 * @param {number} defIndex index 0-based de la ligne de définition
 * @returns {number}
 */
function siblingLine(lines, defIndex) {
  const indentOf = (line) => line.match(/^\s*/)[0].length;
  const base = indentOf(lines[defIndex] ?? '');
  for (let i = defIndex + 1; i < lines.length; i += 1) {
    const head = (lines[i] ?? '').trim();
    if (!head) continue;
    if (indentOf(lines[i]) > base) continue;
    // La fermeture de l'appel lui-même (`);`, `}`, `])`) est à la même
    // indentation que sa définition : ce n'est pas une instruction voisine.
    if (indentOf(lines[i]) === base && /^[)\]}]/.test(head)) continue;
    return i;
  }
  return lines.length;
}

/**
 * Le texte de l'instruction d'une aide : de sa définition à la première
 * instruction voisine. C'est là que se lisent ses propres marqueurs.
 */
function wrapperText(text, wrapper) {
  const lines = text.split('\n');
  const end = siblingLine(lines, wrapper.defLine - 1);
  return text.slice(wrapper.index, end >= lines.length ? text.length : lineOffset(text, end + 1));
}

/**
 * L'aide de rejeu qui ENCADRE ce site, si c'en est une.
 *
 * La contenance est vérifiée, pas devinée : toute instruction de premier niveau
 * rencontrée entre la définition et le site veut dire qu'on en est sorti.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{ name: string, index: number, defLine: number }|null}
 */
export function wrapperAround(text, offset) {
  let found = null;
  for (const match of text.matchAll(WRAPPER_DEF)) {
    const index = match.index ?? 0;
    if (index >= offset) break;
    found = { name: match[1], index, defLine: lineOf(text, index) };
  }
  if (!found) return null;
  // Le site doit être DANS l'instruction de l'aide : dès qu'une instruction
  // voisine commence avant lui, on en est sorti.
  return siblingLine(text.split('\n'), found.defLine - 1) >= lineOf(text, offset) ? found : null;
}

/**
 * La ligne d'une déclaration `const NAME = { … }`, si elle existe — c'est-à-dire
 * la charge utile qu'un appelant passe à une aide.
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
function payloadBlock(text, name) {
  const match = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(text);
  if (!match) return null;
  return text.slice(match.index, match.index + 1600);
}

/**
 * Une charge utile porte-t-elle le jeton du run, directement ou par référence ?
 *
 * `insertOnce('staff', demo, …)` ne dit rien du contenu de `demo` : le jeton est
 * dans le littéral qui le construit. C'est ce littéral qu'on lit, sinon on
 * exigerait du code correct qu'il répète son jeton à chaque appel.
 */
function payloadStamped(text, args, stamps) {
  for (const name of new Set(args.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
    const block = payloadBlock(text, name);
    if (block && isStamped(block, stamps)) return true;
  }
  return false;
}

/**
 * Une obligation, vérifiée chez TOUS les appelants d'une aide.
 *
 * Une aide dont le rejeu se sonde par un paramètre n'est conforme que si chaque
 * appel fournit ce qu'il faut : un seul appel incomplet rend l'aide incapable de
 * retrouver sa ligne, et c'est cet appel-là qu'il faut corriger.
 *
 * @param {string} text
 * @param {{ name: string, index: number }} wrapper
 * @param {(site: { line: string, args: string, index: number }) => boolean} holds
 * @returns {{ ok: boolean, offenders: { line: string }[], count: number }}
 */
function holdsAtCallers(text, wrapper, holds) {
  const sites = callSites(text, wrapper.name, wrapper.index);
  const offenders = sites.filter((site) => !holds(site));
  return { ok: sites.length > 0 && offenders.length === 0, offenders, count: sites.length };
}

/**
 * Les écritures d'une source — création (POST) ou mutation (PATCH/DELETE/PUT).
 *
 * @param {string} source
 * @returns {{ line: number, kind: 'create'|'mutate', text: string }[]}
 */
export function findWrites(source) {
  const code = maskComments(source);
  const writes = [];
  code.split(/\r?\n/).forEach((line, index) => {
    const match = /method:\s*['"](POST|PATCH|PUT|DELETE)['"]/.exec(line);
    if (!match) return;
    writes.push({ line: index + 1, kind: match[1] === 'POST' ? 'create' : 'mutate', text: line.trim() });
  });
  return writes;
}

/**
 * La source parle-t-elle à la base partagée ?
 *
 * Un script qui ne mentionne aucun marqueur Supabase ne peut pas y écrire : juger
 * ses POST (API GitHub, serveur local) serait du bruit, et le bruit fait ignorer
 * le contrôle.
 *
 * @param {string} source
 * @returns {boolean}
 */
export const touchesSupabase = (source) => SUPABASE_MARKERS.some((m) => String(source ?? '').includes(m));

/**
 * Les exemptions du dépôt — la POLITIQUE, à côté du contrat qu'elle assouplit.
 *
 * Elle vit ici, et non dans le seul point d'entrée, pour qu'elle soit VUE par
 * les tests : une exemption qu'on ne peut pas juger est une exemption qu'on
 * oublie. Chacune est nommée, bornée, et justifiée.
 */
export const EXEMPTIONS = [
  {
    file: 'scripts/verify-anon-rls.mjs',
    maxCreates: 3,
    reason:
      'sondes de REFUS anon : ces POST doivent être refusés par RLS (401/403) — une sonde qui passe est une brèche du garde-fou, ' +
      'et le run échoue. Il n’y a rien à réconcilier (le payload est `{}` ou un nom de sonde) et une sonde refusée ne laisse aucune ligne ; ' +
      'les quatre écritures RÉELLES du même fichier, elles, passent par l’enrobage rejouable.',
  },
];

/**
 * Juger les écritures d'un fichier.
 *
 * Le contrat, et il est volontairement étroit : une **création** non déclarée
 * rejouable est refusée, sauf exemption NOMMÉE et BORNÉE (le nombre de sites
 * tolérés est écrit dans l'exemption, et il est vérifié dans les deux sens). Une
 * mutation (PATCH, DELETE, PUT) n'est pas le sujet : rejouer une mutation ne
 * duplique pas de ligne. Elle est comptée, pour que l'inventaire reste lisible.
 *
 * @param {{ file: string, source: string, allowlist?: { file: string, maxCreates: number, reason: string }[] }} input
 * @returns {{ creates: number, mutations: number, problems: string[], exempted: string|null }}
 */
export function judgeWrites({ file, source, allowlist = [] } = {}) {
  if (!touchesSupabase(source)) return { creates: 0, mutations: 0, problems: [], exempted: null };
  const code = maskComments(source);
  const stamps = stampSymbols(code);
  const writes = findWrites(source);
  // Un POST de FONCTION (rpc, session, reset) n'écrit pas de ligne de démo, et
  // son URL vit souvent une ligne plus haut que son `method:` — d'où la fenêtre,
  // et non la seule ligne.
  const creates = writes
    .filter((w) => w.kind === 'create')
    .filter((w) => !NON_CREATING.test(code.slice(Math.max(0, lineOffset(code, w.line) - 400), lineOffset(code, w.line) + 200)));
  const entry = allowlist.find((a) => a.file === file) || null;
  const problems = [];
  if (entry && !String(entry.reason ?? '').trim()) {
    problems.push(`${file} : exemption sans raison — une exemption muette est un trou.`);
  }

  /** La ligne FAUTIVE, pas l'aide : c'est elle qu'on doit corriger. */
  const offenderLine = (site) => String(site.line ?? '').trim().slice(0, 80);

  /** Le verdict d'un site : rejouable, estampillé, réconciliable — et chez qui. */
  const judgeSite = (w) => {
    const offset = lineOffset(code, w.line);
    const window = code.slice(Math.max(0, offset - WINDOW_BEFORE), offset + WINDOW_AFTER);
    const wrapper = wrapperAround(code, offset);
    const reentrant = enclosingCalls(code, offset).some((name) => REPLAY_HELPERS.includes(name)) || Boolean(wrapper);
    // Un site encadré par une aide se juge sur l'instruction de CETTE aide ; les
    // autres sur leur propre voisinage, qui contient leur appel de rejeu et sa
    // sonde.
    const scope = wrapper ? wrapperText(code, wrapper) : window;
    const verdict = {
      line: w.line,
      reentrant,
      stamp: { ok: isStamped(scope, stamps), at: 'site' },
      reconciliation: { ok: RECONCILIATION_MARKERS.test(scope), at: 'site' },
    };
    if (!reentrant || !wrapper) return verdict;
    // L'aide est le cran d'indirection : ce que sa définition ne dit pas doit
    // être dit par ses appelants — et un seul appel incomplet suffit à rendre
    // l'aide fautive. Une définition qui porte déjà ses marqueurs (elle reçoit la
    // clé en paramètre et sonde avec) passe sans rien exiger de ses appelants.
    const stamped = holdsAtCallers(code, wrapper, (site) => isStamped(site.args, stamps) || payloadStamped(code, site.args, stamps));
    const keyed = holdsAtCallers(code, wrapper, (site) => RECONCILIATION_MARKERS.test(site.args));
    verdict.stamp = verdict.stamp.ok ? verdict.stamp : {
      ok: stamped.ok,
      at: `appelants de ${wrapper.name}`,
      offenders: stamped.offenders.map(offenderLine),
    };
    verdict.reconciliation = verdict.reconciliation.ok ? verdict.reconciliation : {
      ok: keyed.ok,
      at: `appelants de ${wrapper.name}`,
      offenders: keyed.offenders.map(offenderLine),
    };
    return verdict;
  };

  const verdicts = creates.map(judgeSite);
  const unrepeatable = verdicts.filter((v) => !v.reentrant);
  // Une exemption COUVRE des sites par leur rang : les premiers non rejouables,
  // dans l'ordre du fichier. Un site couvert sort du contrat — une sonde qui doit
  // être REFUSÉE n'a pas d'identité, et l'exiger serait exiger l'impossible.
  const covered = entry ? unrepeatable.slice(0, entry.maxCreates).map((v) => v.line) : [];
  if (unrepeatable.length && !entry) {
    problems.push(
      `${file} : ${unrepeatable.length} création(s) sans enrobage rejouable (ligne ${unrepeatable.map((v) => v.line).join(', ')}) — ` +
        'un rejeu après une réponse perdue peut laisser un doublon que le nettoyage ne connaîtra pas.',
    );
  }
  if (entry && unrepeatable.length > entry.maxCreates) {
    const extra = unrepeatable.slice(entry.maxCreates);
    problems.push(
      `${file} : ${unrepeatable.length} création(s) non rejouables alors que l'exemption en tolère ${entry.maxCreates} ` +
        `(ligne ${extra.map((v) => v.line).join(', ')}) — migrez l'écriture vers l'enrobage partagé, ou élargissez l'exemption en le justifiant.`,
    );
  }
  if (entry && unrepeatable.length < entry.maxCreates) {
    problems.push(
      `${file} : l'exemption en tolère ${entry.maxCreates} mais il n'en reste que ${unrepeatable.length} — ` +
        'une exemption qui ne correspond plus au réel doit être abaissée (sinon elle autorise un retour en arrière silencieux).',
    );
  }
  for (const v of verdicts) {
    // Un site non rejouable a déjà son défaut principal : lui reprocher en plus
    // l'absence de sonde serait du bruit, et le bruit noie le vrai motif.
    if (!v.reentrant || covered.includes(v.line)) continue;
    for (const [what, found] of [
      ['jeton d’exécution', v.stamp],
      ['clé de réconciliation', v.reconciliation],
    ]) {
      if (found.ok) continue;
      const where = found.at === 'site'
        ? `${file} (ligne ${v.line})`
        : `${file} — ${found.at}, ${found.offenders.join(' | ')}`;
      const why = what === 'jeton d’exécution'
        ? 'la ligne ne porte rien qui la rattache à ce run, donc deux exécutions produiraient des lignes indiscernables au nettoyage.'
        : 'le rejeu retrouverait une ligne au hasard : il faut une REQUÊTE qui la retrouve (`=eq.…` ou `?email=`), pas l’id rendu.';
      problems.push(`${where} : création sans ${what} — ${why}`);
    }
  }
  return {
    creates: creates.length,
    mutations: writes.length - creates.length,
    problems,
    exempted: entry ? entry.reason : null,
  };
}

/**
 * Un inventaire et son exemption tiennent-ils, vus du disque ?
 *
 * Une exemption qui nomme un script disparu est un trou : elle laisse croire
 * qu'une écriture est surveillée alors qu'il n'y a plus rien à surveiller.
 *
 * @param {{ allowlist?: { file: string }[], present?: string[] }} input
 * @returns {string[]} problèmes
 */
export function auditAllowlist({ allowlist = [], present = [] } = {}) {
  return allowlist
    .filter((entry) => !present.includes(entry.file))
    .map((entry) => `l'exemption déclare « ${entry.file} », introuvable dans scripts/ — retirez-la.`);
}
