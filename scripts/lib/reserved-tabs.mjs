/**
 * ─── Le contrat des onglets réservés : UNE source, et rien d'autre ──────────
 *
 * Le dépôt a payé ce défaut une fois, mesuré le 2026-10-15 : le droit d'ouvrir
 * un onglet réservé était écrit à DEUX endroits — la ligne du rail décidait pour
 * elle seule (`isAdminDev`, `canSeePaymentHistory`), le filet du shell décidait
 * pour lui seul (`!auth.isAdmin` ⇒ settings, audit, paymentHistory). La base a
 * ouvert la lecture de l'historique des paiements à l'économe, le rail a suivi,
 * le filet non : l'économe voyait la ligne, cliquait, et l'onglet revenait au
 * tableau de bord dans la même seconde. La fonctionnalité était morte À L'ÉCRAN
 * tout en paraissant ouverte, et aucune suite verte ne le disait.
 *
 * La réparation a été de faire DEMANDER les trois surfaces à une seule table
 * (`src/app/tabRights.ts`). Ce module-ci est ce qui empêche la seconde liste de
 * revenir : il lit la table, puis refuse tout autre endroit qui déciderait d'un
 * onglet réservé par lui-même.
 *
 * ─── Ce qu'il refuse, et pourquoi seulement ça ──────────────────────────────
 *
 *   • `tab-role-literal` — un onglet réservé gardé par un rôle écrit à la main
 *     (`activeTab === 'settings' && !auth.isAdmin`, `'audit'` à côté d'un
 *     `role === 'dev'`). C'est la forme exacte du défaut.
 *   • `tab-gate-call` — un onglet réservé gardé par un appel à un droit
 *     (`canViewPaymentHistory(...)`, `isAdminRole(...)`) appelé depuis l'écran.
 *     Le droit n'est pas faux : il est lu au mauvais endroit, donc il ne dit rien
 *     de l'onglet quand la base change.
 *   • `gate-alias` — l'alias local qui porte cette décision (`const isAdminDev =
 *     …`), utilisé pour garder un bloc où un onglet réservé est posé. La forme
 *     qui a coûté le défaut, et la seule qui échappe à un scan ligne à ligne.
 *   • `tab-list` — une liste d'onglets réservés écrite à la main (deux onglets
 *     réservés ou plus, aucun autre onglet du vocabulaire sur la ligne). Une
 *     déclaration de TYPE qui énumère tout le vocabulaire (l'union `AppTab`, les
 *     props de vues) porte d'autres onglets : elle n'est pas une liste réservée,
 *     et le scan le vérifie au lieu de l'espérer.
 *   • `tab-ungated` — un onglet réservé que la table déclare et que les
 *     navigations ne gardent pas, ou qu'une seule des deux garde : les deux
 *     navigations montrent le même ensemble (« la barre reflète le rail » est la
 *     règle écrite dans son en-tête), donc un onglet gardé d'un seul côté est un
 *     onglet à moitié ouvert.
 *   • `roles-inline` / `roles-unimported` — dans la table elle-même : une liste
 *     de rôles écrite en clair, ou un identifiant qui ne vient pas d'un
 *     `src/lib/*Rights.ts` (le module où les tests comparent la liste à la
 *     MIGRATION, dans les deux sens).
 *
 * ─── Ce qu'il refuse de laisser passer pour un vert ─────────────────────────
 * Aucun onglet réservé lu dans la table, aucun vocabulaire d'onglets lu dans
 * l'union `AppTab`, aucun appelant de la table : trois refus ÉCRITS (sortie 2,
 * côté `check-reserved-tabs.mjs`). Un scan qui ne lit plus rien n'est pas un scan
 * propre — c'est le motif qui a disparu, et ce dépôt a déjà payé cette leçon.
 *
 * ─── Les SECTIONS ET MODALES, depuis le 2026-10-16 ──────────────────────────
 * Le même défaut vivait hors des onglets, mesuré le 2026-10-16 : la règle des
 * rôles financiers était écrite à la main en QUATRE endroits — `role === 'admin'
 * || role === 'dev' || role === 'general_manager'` dans l'en-tête, et
 * `isPromoter || isGeneralManager` dans le hook des élèves, la modale d'élève et
 * le hook des dépenses. Une liste recopiée par surface, dont une seule était
 * mesurée, et la dernière plus LARGE que la politique qu'elle croyait refléter.
 *
 * La table qui remplace ces copies est `src/app/sectionRights.ts`
 * (`RESERVED_SECTIONS`), lue ici comme celle des onglets, avec les mêmes refus :
 *
 *   • `role-composition` — une LISTE de rôles écrite à la main : deux tests de
 *     rôle ou plus (`role === 'x'`, `isPromoter`, `isGeneralManager`,
 *     `auth.isAdmin`) combinés par `&&` ou `||` sur la même ligne, hors des
 *     modules `src/lib/*Rights.ts` où les listes VIVENT. C'est la forme exacte du
 *     défaut : une composition n'est jamais un droit, c'est une copie de liste.
 *   • `section-ungated` — une surface que la table déclare et qu'AUCUN écran ne
 *     DEMANDE. Une surface déclarée sans appelant est une surface que personne ne
 *     garde.
 *
 * Ce qu'il ne juge PAS, et c'est délibéré : une comparaison de rôle UNIQUE (une
 * étiquette, une classe de couleur — « `role === 'dev' ? violet : …` ») n'est pas
 * une liste, et le refuser accuserait l'affichage ; une liste de rôles dans un
 * tableau (le vocabulaire des rôles acceptés par la session, `src/lib/useAuth.ts`)
 * n'ouvre ni ne ferme aucune surface. Les COMPOSITIONS d'affichage pures (un
 * compteur, une étiquette de personnel dans `SettingsUsersCard`) restent
 * déclarables par l'allowlist, avec leur raison — c'est fait une fois, ici, et
 * l'entrée devient PÉRIMÉE si le code disparaît.
 */

/** Le fichier qui PORTE la table — l'unique source des droits d'onglet. */
export const RESERVED_TABS_SOURCE = 'src/app/tabRights.ts';

/** Le fichier dont l'union `AppTab` donne le VOCABULAIRE complet des onglets. */
export const TAB_VOCABULARY_SOURCE = 'src/components/Sidebar.tsx';

/** L'appel de la source unique : le SEUL geste autorisé sur une ligne d'onglet. */
export const SINGLE_SOURCE_CALL = 'canOpenTab';

/** Le fichier qui porte la table des SURFACES d'écran (sections, modales). */
export const RESERVED_SECTIONS_SOURCE = 'src/app/sectionRights.ts';

/** L'appel de la source unique pour une surface : `canUseSection('<section>', role)`. */
export const SINGLE_SOURCE_SECTION_CALL = 'canUseSection';

/**
 * Les booléens d'ÉCRAN qui sont des tests de rôle déguisés.
 *
 * `isPromoter` = `auth.isAdmin` et `isGeneralManager` = « le rôle est
 * `general_manager` » (`src/app/useAuthWelcome.ts`) : les combiner est une LISTE
 * écrite à la main, exactement comme `role === 'a' || role === 'b'` — les deux
 * formes étaient présentes dans le défaut du 2026-10-16.
 */
export const ROLE_BOOLEAN_ALIASES = ['isPromoter', 'isGeneralManager'];

/**
 * Les modules où les LISTES de rôles vivent — et où une composition de rôles
 * n'est donc pas une copie : c'est la définition même du droit.
 */
export const ROLE_LIST_MODULE = /^src\/lib\/[A-Za-z]*(Rights|rights)\.ts$/;

/** Les rôles de l'application, tels qu'une comparaison écrite à la main les écrit. */
export const ROLE_LITERALS = ['admin', 'dev', 'general_manager', 'econome', 'staff'];

/** Le libellé, la raison et le remède de chaque règle — cités par le contrôle ET la suite. */
export const RULES = {
  'tab-role-literal': {
    label: 'un onglet réservé gardé par un rôle écrit à la main',
    remedy:
      'le droit d’ouvrir un onglet se DEMANDE : `canOpenTab` (src/app/tabRights.ts) ; la liste de rôles vit dans src/lib/*Rights.ts',
  },
  'tab-gate-call': {
    label: 'un onglet réservé gardé par un appel de droit, hors de la table',
    remedy:
      'la table porte le droit de l’onglet : ajoutez-y l’onglet plutôt que d’appeler le droit depuis l’écran',
  },
  'gate-alias': {
    label: 'un alias de rôle local garde un bloc où un onglet réservé est posé',
    remedy:
      'supprimez l’alias et appelez `canOpenTab` là où le bloc se décide — c’est la forme exacte du défaut du 2026-10-15',
  },
  'tab-list': {
    label: 'une liste d’onglets réservés écrite à la main',
    remedy: 'la liste des onglets réservés est `RESERVED_TABS` (src/app/tabRights.ts) : itérez dessus',
  },
  'tab-ungated': {
    label: 'un onglet réservé que les deux navigations ne gardent pas',
    remedy:
      'le rail (Sidebar) et la barre mobile (MobileNav) montrent le même ensemble : gardez l’onglet dans les deux, via `canOpenTab`',
  },
  'roles-inline': {
    label: 'une liste de rôles écrite en clair dans la table des onglets',
    remedy:
      'importez la liste du module qui la tient (`src/lib/*Rights.ts`), où les tests la comparent à la migration',
  },
  'roles-unimported': {
    label: 'un identifiant de rôles qui ne vient pas d’un src/lib/*Rights.ts',
    remedy: 'importez la liste depuis `../lib/…Rights` — une liste locale n’est le miroir d’aucune policy',
  },
  'role-composition': {
    label: 'une liste de rôles écrite à la main (deux tests de rôle combinés)',
    remedy:
      'le droit se DEMANDE : la table des surfaces (`RESERVED_SECTIONS`, src/app/sectionRights.ts) ou celle des onglets (`RESERVED_TABS`) ; les listes vivent dans src/lib/*Rights.ts',
  },
  'section-ungated': {
    label: 'une surface réservée que personne ne demande',
    remedy:
      'la surface s’ouvre en appelant `canUseSection(\'<section>\', role)` là où elle est montrée (ou gardée) — une surface déclarée sans appelant ne garde rien',
  },
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Le numéro de ligne (1-indexé) de l'index donné dans un texte. */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * Les entrées `tab: 'x', roles: IDENT` de la table, et ce que le lecteur REFUSE.
 *
 * Une entrée sans `roles:` est invisible : elle laisserait un onglet déclaré
 * sans droit lisible, donc elle est signalée comme une liste en clair — le
 * message est faux, le refus ne l'est pas (mieux vaut un lecteur qui refuse
 * qu'un lecteur qui saute une ligne en silence).
 *
 * @returns {{ entries: { tab: string, roles: string, line: number }[], problems: { rule: string, line: number, token: string }[] }}
 */
export function readReservedTabEntries({ text, file = RESERVED_TABS_SOURCE }) {
  const entries = [];
  const problems = [];
  const entryPattern = /\btab:\s*'([a-z][A-Za-z0-9]*)'\s*,\s*roles:\s*([^\n}]+)/g;
  for (const match of text.matchAll(entryPattern)) {
    const tab = match[1];
    const raw = match[2].replace(/[,\s]+$/, '').trim();
    const line = lineAt(text, match.index);
    if (!/^[A-Za-z_$][\w$]*$/.test(raw)) {
      problems.push({ rule: 'roles-inline', line, token: `${tab}: ${raw}` });
      continue;
    }
    entries.push({ tab, roles: raw, line });
  }
  // Un onglet nommé dans la table sans `roles:` lisible ne serait protégé par rien :
  // mieux vaut un lecteur qui refuse qu'un lecteur qui saute une ligne en silence.
  for (const match of text.matchAll(/\btab:\s*'([a-z][A-Za-z0-9]*)'/g)) {
    const tab = match[1];
    if (entries.some((entry) => entry.tab === tab)) continue;
    if (problems.some((problem) => problem.token.startsWith(`${tab}:`))) continue;
    problems.push({
      rule: 'roles-inline',
      line: lineAt(text, match.index),
      token: `${tab}: (aucun \`roles:\` lisible)`,
    });
  }
  return { entries, problems };
}

/**
 * Les identifiants importés d'un module de droits (`../lib/…`).
 * C'est d'ici que la table doit tirer ses listes — jamais d'une constante locale.
 */
export function readRightsImports(text) {
  const imported = new Set();
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (!/^\.\.?\/lib\//.test(match[2].trim())) continue;
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) imported.add(name);
    }
  }
  return imported;
}

/**
 * Le VOCABULAIRE des onglets, lu dans l'union `AppTab` — pas recopié ici.
 *
 * Il sert à une seule chose, et c'est ce qui le rend nécessaire : distinguer une
 * liste d'onglets RÉSERVÉS (deux réservés, rien d'autre — la liste interdite)
 * d'une déclaration de TYPE qui énumère tout le vocabulaire (l'union `AppTab`,
 * les props de vues : elles portent les autres onglets, donc elles ne sont pas
 * une liste réservée).
 *
 * @returns {string[]} les identifiants d'onglet, dans l'ordre du source
 */
export function readTabVocabulary(text) {
  const match = /(?:export\s+)?type\s+AppTab\s*=([^;]+);/.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
}

/** Un test de RÔLE, tel qu'un alias local le porte : la moitié gauche du défaut. */
const ROLE_TEST =
  /\.role\s*(?:===|!==|==|!=)|\bauth\.isAdmin\b|\b(?:isAdminRole|canViewPaymentHistory|isAdmin)\b/;

/** Un gate de rôle écrit à la main sur une ligne d'onglet. */
const ROLE_GATE_IDENTIFIER =
  /\b(?:isAdmin|isAdminDev|isPromoter|isGeneralManager|isAdminRole)\b|\bauth\.isAdmin\b|\brole\s*(?:===|!==|==|!=)|profile\?\.role\s*(?:===|!==)/;

/** Un appel de DROIT (et non la source unique, qui est blanchie avant le test). */
const RIGHT_CALL = /\b(?:can|may|is|has)[A-Z][A-Za-z0-9]*\s*\(/;

/**
 * Les manquements d'UNE ligne scannée (la prose est déjà blanchie par l'appelant).
 *
 * @param {string} line
 * @param {{ reservedTabs: string[], vocabulary?: string[] }} input
 * @returns {{ rule: string, token: string }[]}
 */
export function reservedTabHits(line, { reservedTabs, vocabulary = [] }) {
  const hits = [];
  const mentioned = reservedTabs.filter((tab) => line.includes(`'${tab}'`));
  if (mentioned.length === 0) return hits;

  // La source unique, DEMANDÉE sur cette ligne : c'est le geste voulu. On blanchit
  // son identifiant — et lui seul — pour que la ligne reste jugée sur ce qu'elle
  // ajoute à côté (`canOpenTab('audit', role) && role === 'admin'` ne passe pas).
  const rest = line.split(SINGLE_SOURCE_CALL).join('');

  if (mentioned.length >= 2 && !vocabulary.some((tab) => !reservedTabs.includes(tab) && rest.includes(`'${tab}'`))) {
    hits.push({ rule: 'tab-list', token: mentioned.join(', ') });
  }

  const roleLiteral = new RegExp(`'(${ROLE_LITERALS.join('|')})'`).exec(rest);
  const gate = roleLiteral ? null : ROLE_GATE_IDENTIFIER.exec(rest);
  if (roleLiteral || gate) {
    hits.push({ rule: 'tab-role-literal', token: mentioned.join(', ') + ' + ' + ((roleLiteral ?? gate)[0]) });
  }
  const call = RIGHT_CALL.exec(rest);
  if (call) hits.push({ rule: 'tab-gate-call', token: mentioned.join(', ') + ' + ' + call[0].trim() });
  return hits;
}

/**
 * L'alias de rôle local qui garde un bloc d'onglet réservé — la forme qui a coûté
 * le défaut, et la seule qu'un scan ligne à ligne ne voit pas :
 *
 *   const isAdminDev = currentUser?.role === 'admin' || currentUser?.role === 'dev';
 *   …
 *   {isAdminDev && (
 *     <button onClick={() => setActiveTab('audit')} …
 *
 * L'alias est cherché par SA déclaration, puis par ses USAGES : ceux qui gardent
 * un bloc (`{alias &&`, `{alias ?`) et dont la fenêtre qui suit pose un onglet
 * réservé à une place d'onglet (`setActiveTab('x')`, `navBtn('x')`, `tab: 'x'`).
 * Une fenêtre courte est suffisante — et voulue : un alias affiché dans un autre
 * contexte (un booléen rendu par un hook, par exemple) n'est pas jugé.
 *
 * @returns {{ line: number, useLine: number, token: string }[]}
 */
export function gateAliasHits({ text, reservedTabs, window = 4 }) {
  const lines = text.split(/\r?\n/);
  const declarations = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const match = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/.exec(lines[i]);
    if (!match) continue;
    if (ROLE_TEST.test(match[2])) declarations.set(match[1], i);
  }
  const findings = [];
  for (const [name, declaration] of declarations) {
    const usage = new RegExp(`(?:\\{|\\()\\s*!?${escape(name)}\\s*(?:&&|\\?|\\|\\|)`);
    const tabPositions = reservedTabs.map(
      (tab) => new RegExp(`(?:setActiveTab\\(|navBtn\\(|tab:\\s*)'${escape(tab)}'`),
    );
    for (let i = declaration + 1; i < lines.length; i += 1) {
      if (!usage.test(lines[i])) continue;
      const end = Math.min(lines.length, i + window + 1);
      const tabLine = lines.slice(i, end).findIndex((line) => tabPositions.some((p) => p.test(line)));
      if (tabLine < 0) continue;
      findings.push({
        line: declaration + 1,
        useLine: i + 1,
        token: `${name} (déclaré ligne ${declaration + 1}) garde le bloc ligne ${i + 1}`,
      });
      break;
    }
  }
  return findings;
}
