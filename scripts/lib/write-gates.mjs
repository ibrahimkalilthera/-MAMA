// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/write-gates.mjs — quel rôle voit un BOUTON que la base refuse ?
//
// ─── Le défaut mesuré, et pourquoi aucune garde existante ne le voyait ──────
// Le 2026-10-05, un compte `econome` enregistrait la paie hors ligne ; chaque
// rejeu revenait en `42501` et les saisies restaient dans la file. Le
// 2026-10-13, le MÊME angle mort avait deux formes de plus, dans les deux sens :
// `staff` et `vendor_expenses` refusaient le Gestionnaire Principal et l'économe
// pendant que l'écran leur cachait l'action, et `expenses` ACCEPTAIT l'économe
// pendant que l'icône « Ajouter une dépense » ne s'affichait pas chez lui.
//
// Chaque moitié était pourtant vérifiée : `tests/finance-rights.test.ts` compare
// les listes de `src/lib/*Rights.ts` aux fonctions des migrations, et
// `check:rls-policies` compare les politiques de la BASE à celles des migrations.
// Ce qui manquait était la TRAVERSE : personne ne croisait *qui la base
// autorise* avec *qui l'écran laisse voir*. Les deux contrôles pouvaient être
// verts pendant qu'un écran montrait un bouton que la base refuse (42501) ou
// cachait une action qu'elle accepte (une capacité que le rôle a et qu'il ne
// peut pas exercer).
//
// ─── Ce que ce module croise, et dans les deux sens ─────────────────────────
//   • les ÉCRITURES de l'app — lues dans `src/lib/dataOps/*.ts`, la seule couche
//     qui écrit en base (`.from('t').insert(…)`, `.update(…)`, `.delete(…)`,
//     `.rpc('f')`) ; aucune liste à tenir à la main ;
//   • les POLITIQUES D'ÉCRITURE de la base — rejouées depuis les migrations par
//     `rls-policies.mjs` (déjà éprouvé par `check:rls-policies`), chaque
//     condition résolue en un ENSEMBLE DE RÔLES lu dans les fonctions de rôle
//     des migrations (`is_admin()`, `is_finance_writer()`…), jamais recopié ;
//   • les PORTES D'AFFICHAGE de l'app — l'inventaire ci-dessous NOMME l'écran et
//     la porte qu'il lit ; les rôles d'une porte sont lus dans le `.ts` qui les
//     DÉCLARE (parseur TypeScript), donc une seule copie existe.
//
// Deux verdicts, et ils se nomment rôle par rôle :
//   ❌ L'ÉCRAN MONTRE CE QUE LA BASE REFUSE → la file hors ligne, puis le 42501 ;
//   ❌ LA BASE ACCEPTE CE QUE L'ÉCRAN CACHE → une capacité muette (la forme
//      mesurée le 2026-10-13 sur `expenses`).
// Le second se DÉCLARE quand il est voulu (`narrower`), avec sa raison : l'écran
// plus ÉTROIT que la base ne promet jamais une écriture refusée, et c'est la
// seule direction que ce dépôt accepte — mais un écart non déclaré reste un
// écart, et il s'écrit ici pour être lu, pas pour être avalé.
//
// ─── Ce qu'il refuse de laisser passer pour un vert ────────────────────────
// Un inventaire vide, aucune écriture lue, aucune politique déclarée, aucune
// liste de rôles lisible : sortie 2. Une porte déclarée que l'ÉCRAN ne lit pas
// (le lecteur ne correspond à rien dans la source blanchie) : c'est une porte
// qui ne garde rien. Une action que l'app exécute et que l'inventaire ne nomme
// pas, ou l'inverse : l'un comme l'autre est un écart, et il se NOMME.
// ─────────────────────────────────────────────────────────────────────────────
import ts from 'typescript';

import { maskComments } from './source-text.mjs';
import { collectRoleSets, declaredPoliciesAndRetired, statementSpans } from './rls-policies.mjs';

/** La couche d'écriture : tout ce qui écrit en base passe par là. */
export const DATA_OPS_PREFIX = 'src/lib/dataOps/';

/** Les commandes qui ÉCRIVENT. `SELECT` n'est pas de ce ressort. */
export const WRITE_COMMANDS = ['INSERT', 'UPDATE', 'DELETE'];

/** « tout rôle, le rôle anonyme compris » — une politique ouverte à `public`. */
export const ANY_ROLE = 'tous';
/** « tout compte connecté » — `auth.role() = 'authenticated'` ou un `TO authenticated`. */
export const ANY_AUTHENTICATED = 'authenticated';
/** Une condition que ce module n'a pas su lire : il REFUSE de conclure. */
export const ILLEGIBLE = 'inconnu';

const isAll = (set) => set === ANY_ROLE;
const isAuth = (set) => set === ANY_AUTHENTICATED;
const isList = (set) => Array.isArray(set);

const asList = (set) => (isList(set) ? set : null);

/** Un ensemble de rôles lisible dans un rapport : jamais un identifiant nu. */
export function describeRoles(set) {
  if (set === ANY_ROLE) return 'tout rôle, le rôle anonyme compris';
  if (set === ANY_AUTHENTICATED) return 'tout compte connecté';
  if (set === ILLEGIBLE) return 'condition illisible';
  if (isList(set) && set.length === 0) return 'aucun rôle';
  return isList(set) ? set.join(', ') : String(set ?? '—');
}

/** `inner ⊆ outer` sur le treillis (tout rôle ⊃ connecté ⊃ liste). */
export function includes(outer, inner) {
  if (outer === ILLEGIBLE || inner === ILLEGIBLE) return false;
  if (isAll(outer)) return true;
  if (isAuth(outer)) return inner !== ANY_ROLE && inner !== ILLEGIBLE;
  if (isAuth(inner) || isAll(inner)) return false;
  const outerList = asList(outer) ?? [];
  const innerList = asList(inner) ?? [];
  return innerList.every((role) => outerList.includes(role));
}

/** Ce que la base accepte et que l'écran cache — nommé, rôle par rôle. */
export function missingRoles(outer, inner) {
  if (isAll(outer) || isAll(inner) || outer === ILLEGIBLE || inner === ILLEGIBLE) return [];
  if (isAuth(outer)) {
    // L'écran cache « tout compte connecté » : l'écart n'a pas de nom de rôle.
    return isAuth(inner) ? [] : ['tout compte connecté'];
  }
  const have = new Set(asList(inner) ?? []);
  return (asList(outer) ?? []).filter((role) => !have.has(role));
}

/** L'union (deux politiques permissives s'additionnent). */
export function unionSets(a, b) {
  if (a === ILLEGIBLE || b === ILLEGIBLE) return ILLEGIBLE;
  if (isAll(a) || isAll(b)) return ANY_ROLE;
  if (isAuth(a) || isAuth(b)) return ANY_AUTHENTICATED;
  return [...new Set([...(asList(a) ?? []), ...(asList(b) ?? [])])].sort();
}

/** L'intersection (une clause `TO` et une condition limitent chacune). */
export function intersectSets(a, b) {
  if (a === ILLEGIBLE || b === ILLEGIBLE) return ILLEGIBLE;
  if (isAll(a)) return b;
  if (isAll(b)) return a;
  if (isAuth(a)) return isAuth(b) ? ANY_AUTHENTICATED : b;
  if (isAuth(b)) return a;
  const other = new Set(asList(b) ?? []);
  return (asList(a) ?? []).filter((role) => other.has(role)).sort();
}

/** Les rôles écrits `role IN ('admin','dev')`, réduits à une forme comparable. */
function rolesInList(text) {
  return String(text ?? '')
    .split(',')
    .map((role) => role.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter((role) => role && role !== 'public')
    .sort();
}

/** Le texte d'une condition, aplati pour être lu par les motifs ci-dessous. */
function flat(text) {
  return String(text ?? '')
    .replace(/::\s*(?:text|character\s+varying|varchar|name|bpchar|boolean|bool)\b/gi, '')
    .replace(/\bpublic\./gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Découpe une condition sur un opérateur, aux niveaux 0 de parenthèses. */
function splitTopLevel(text, operator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && text.startsWith(operator, i)) {
      parts.push(text.slice(start, i));
      i += operator.length;
      start = i;
      continue;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * La condition d'une politique, réduite à l'ENSEMBLE DE RÔLES qu'elle accepte.
 *
 * Les trois formes du dépôt sont reconnues, et elles disent la même chose quand
 * elles le disent : `is_finance_writer()` est lu dans la FONCTION de la migration,
 * `role IN ('admin','dev')` est lu dans le littéral, `auth.role() =
 * 'authenticated'` vaut « tout compte connecté ». Une condition `true` n'impose
 * rien (`ANY_ROLE`, que la clause `TO` limite ensuite). Une condition que ce
 * module ne sait pas lire rend `ILLEGIBLE` : il refusera de conclure plutôt que
 * de deviner (un défaut avalé en silence serait pire que le défaut).
 */
export function resolveCondition(text, roleSets = new Map()) {
  const raw = flat(text);
  if (!raw || raw === 'true') return ANY_ROLE;
  if (raw === 'false') return [];

  const orParts = splitTopLevel(raw, ' or ');
  if (orParts.length > 1) return orParts.map((part) => resolveCondition(part, roleSets)).reduce(unionSets);
  const andParts = splitTopLevel(raw, ' and ');
  if (andParts.length > 1) return andParts.map((part) => resolveCondition(part, roleSets)).reduce(intersectSets);

  // La FONCTION de rôle des migrations d'abord : c'est la forme que le dépôt
  // emploie, et sa liste n'existe qu'à un endroit.
  for (const [name, roles] of roleSets) {
    if (new RegExp(`(^|[^a-z0-9_.])${name}\\s*\\(`).test(raw)) return [...roles].sort();
  }
  const inList = /role\s+in\s*\(([^)]*)\)/.exec(raw);
  if (inList) return rolesInList(inList[1]);
  if (/auth\.role\(\)\s*=\s*'authenticated'/.test(raw)) return ANY_AUTHENTICATED;
  // Un filtre de LIGNE (`created_by = auth.uid()`) nomme l'auteur, pas le rôle :
  // il borne les lignes d'un compte connecté, donc l'ensemble est « connecté ».
  if (/auth\.uid\(\)/.test(raw)) return ANY_AUTHENTICATED;
  // Un filtre de LIGNE sur la CLÉ d'un réglage (`key IN (…)`, `key = '…'`) : il
  // borne les lignes qu'une politique ouvre, jamais les RÔLES — c'est la clause
  // `TO` qui dit qui peut écrire. Le lire comme une condition illisible faisait
  // échouer tout le contrôle sur une politique pourtant lisible : mesuré le
  // 2026-10-19 sur les préférences d'affichage (`app_settings`, quatre clés
  // bornées, écriture ouverte à tout compte connecté — voir
  // supabase/migrations/20261019000000_display_preferences.sql). Une clé n'est
  // pas un rôle : elle n'élargit donc rien, et l'intersection avec la clause `TO`
  // reste ce qu'elle dit.
  if (/^(?:[a-z_]\w*\.)?key\s*(?:<>|!=|=|not\s+in\b|in\b)/.test(raw)) return ANY_ROLE;
  return ILLEGIBLE;
}

/** La clause `TO` d'une politique, sur le même treillis. */
export function resolveToRoles(roles = []) {
  const list = (Array.isArray(roles) ? roles : [roles]).map((role) => String(role).trim().toLowerCase());
  if (list.includes('public')) return ANY_ROLE;
  if (list.includes('authenticated')) return ANY_AUTHENTICATED;
  return list.filter((role) => role && role !== 'public').sort();
}

/**
 * Ce que les migrations ACCORDENT, par `table::COMMANDE`.
 *
 * Une politique `FOR ALL` vaut pour les trois écritures. Deux politiques de même
 * (table, commande) sont permissives : leurs ensembles s'ADDITIONNENT, comme
 * Postgres les additionne.
 *
 * @param {{ name?: string, sql?: string }[]} migrations
 * @returns {Map<string, { set: string[]|string, policies: { name: string, file: string,
 *   cmd: string, roles: string, expression: string }[] }>}
 */
export function baseWriters(migrations = []) {
  const { declared } = declaredPoliciesAndRetired(migrations);
  const roleSets = collectRoleSets(migrations);
  /** @type {Map<string, any>} */
  const writers = new Map();
  for (const policy of declared.values()) {
    if (policy.cmd === 'SELECT') continue;
    const scope = policy.cmd === 'ALL' ? WRITE_COMMANDS : [policy.cmd];
    const toSet = resolveToRoles(policy.roles);
    for (const cmd of scope) {
      // L'INSERT n'a pas de `USING` (rien n'existe encore) ; le DELETE et
      // l'UPDATE bornent des lignes avec `USING`. Les deux clauses bornent quand
      // elles existent : on les intersecte.
      const clauses = cmd === 'INSERT' ? [policy.check] : [policy.using, policy.check];
      const condition = clauses
        .filter((clause) => clause !== null && clause !== undefined)
        .map((clause) => resolveCondition(clause, roleSets))
        .reduce((a, b) => intersectSets(a, b), ANY_ROLE);
      const set = intersectSets(toSet, condition);
      const key = `${policy.table.toLowerCase()}::${cmd}`;
      const previous = writers.get(key);
      const entry = previous ?? { set: [], policies: [] };
      entry.set = unionSets(entry.set, set);
      entry.policies.push({
        name: policy.name,
        file: policy.file,
        cmd: policy.cmd,
        roles: describeRoles(toSet),
        expression: flat(policy.check ?? policy.using ?? 'true') || 'true',
      });
      writers.set(key, entry);
    }
  }
  return writers;
}

/**
 * La garde de rôle d'une FONCTION de la base (`set_payment_months`,
 * `reassign_payment_student`) : ses rôles d'exécution, lus dans le corps.
 *
 * Le dépôt emploie une seule forme — `IF NOT public.is_x() THEN RAISE` — donc un
 * rôle autorisé est un rôle dont la garde est VRAIE ; la fonction qui la porte
 * est nommée dans le rapport, pour qu'un humain puisse la relire. Une fonction
 * sans référence à un rôle est exécutable par `authenticated` (c'est le `GRANT`
 * que les migrations posent) : elle est donc lue ainsi, jamais devinée.
 */
export function functionWriters(migrations = []) {
  const roleSets = collectRoleSets(migrations);
  /** @type {Map<string, { set: string[]|string, file: string, guard: string }>} */
  const functions = new Map();
  for (const migration of migrations) {
    const file = String(migration?.name ?? '');
    for (const span of statementSpans(String(migration?.sql ?? ''))) {
      const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([A-Za-z_]\w*)"?\s*\(/i.exec(
        span.masked,
      );
      if (!head) continue;
      const name = head[1].toLowerCase();
      const body = flat(span.text);
      const guards = [...roleSets].filter(([fn]) => new RegExp(`(^|[^a-z0-9_.])${fn}\\s*\\(`).test(body));
      const inList = /role\s+in\s*\(([^)]*)\)/.exec(body);
      let set = ILLEGIBLE;
      let guard = '';
      if (inList) {
        set = rolesInList(inList[1]);
        guard = `role IN (${inList[1].trim()})`;
      } else if (guards.length > 0) {
        set = guards.map(([, roles]) => [...roles].sort()).reduce(unionSets);
        guard = guards.map(([fn]) => `${fn}()`).join(' + ');
      } else if (/auth\.role\(\)\s*=\s*'authenticated'/.test(body)) {
        set = ANY_AUTHENTICATED;
        guard = "auth.role() = 'authenticated'";
      }
      // Une fonction SECURITY DEFINER sans garde lisible garde son verdict
      // illisible : le rapport le dira au lieu de supposer « tout connecté ».
      if (set === ILLEGIBLE && /auth\.uid\(\)/.test(body)) {
        set = ANY_AUTHENTICATED;
        guard = 'auth.uid() (aucune garde de rôle nommée)';
      }
      functions.set(name, { set, file, guard: guard || 'aucune garde de rôle lisible' });
    }
  }
  return functions;
}

/** Les écritures que la couche d'écriture EXÉCUTE, avec leur ligne. */
export function appWriteActions(files = []) {
  const actions = [];
  for (const { file, text } of files) {
    if (!String(file).startsWith(DATA_OPS_PREFIX)) continue;
    const masked = maskComments(String(text ?? ''));
    const lines = (index) => masked.slice(0, index).split(/\r?\n/).length;
    const from = /\.from\(\s*['"]([A-Za-z_]\w*)['"]\s*\)/g;
    for (let match = from.exec(masked); match !== null; match = from.exec(masked)) {
      const window = masked.slice(match.index + match[0].length, match.index + match[0].length + 400);
      // Le verbe doit appartenir à la MÊME instruction : une seconde source
      // (`;`) ou une seconde table coupe la fenêtre.
      const stop = window.search(/;|\.from\s*\(/);
      const statement = stop === -1 ? window : window.slice(0, stop);
      const verb = /\.(insert|update|delete|upsert)\s*\(/.exec(statement);
      if (!verb) continue;
      actions.push({
        file,
        line: lines(match.index),
        table: match[1].toLowerCase(),
        cmd: verb[1].toUpperCase() === 'UPSERT' ? 'INSERT' : verb[1].toUpperCase(),
      });
    }
  }
  return actions;
}

/** Les appels de FONCTION que l'app exécute (`.rpc('…')`), avec leur ligne. */
export function appRpcCalls(files = []) {
  const calls = [];
  for (const { file, text } of files) {
    const masked = maskComments(String(text ?? ''));
    const lines = (index) => masked.slice(0, index).split(/\r?\n/).length;
    for (const match of masked.matchAll(/\.rpc\(\s*['"]([A-Za-z_]\w*)['"]/g)) {
      calls.push({ file, line: lines(match.index), fn: match[1].toLowerCase() });
    }
  }
  return calls;
}

/**
 * Les LISTES DE RÔLES d'un fichier TypeScript, lues par le parseur — pas par un
 * motif : `export const FINANCE_WRITER_ROLES = ['admin', …] as const;`.
 *
 * Le parseur évite les deux pièges de ce dépôt : une liste décrite dans un
 * commentaire n'est pas une liste, et une liste reformatée sur plusieurs lignes
 * reste lisible. Un alias (`VENDOR_EXPENSE_DELETER_ROLES = FINANCE_ADMIN_ROLES`)
 * est résolu dans le même fichier : c'est la MÊME liste, et la lire deux fois
 * ferait deux vérités.
 *
 * @param {{ file: string, text: string }[]} files
 * @returns {Map<string, string[]>} `fichier::SYMBOLE` → rôles triés
 */
export function readRoleLists(files = []) {
  /** @type {Map<string, string[]>} */
  const lists = new Map();
  for (const { file, text } of files) {
    const source = ts.createSourceFile(String(file), String(text ?? ''), ts.ScriptTarget.Latest, true);
    /** @type {Map<string, string[]|string>} */
    const local = new Map();
    for (const statement of source.statements) {
      const declaration = statement.declarationList?.declarations?.[0];
      if (!declaration || !ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      let init = declaration.initializer;
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression?.(init)) {
        init = init.expression;
      }
      if (ts.isArrayLiteralExpression(init)) {
        const roles = init.elements
          .filter((element) => ts.isStringLiteralLike(element))
          .map((element) => element.text.trim().toLowerCase())
          .filter(Boolean);
        local.set(declaration.name.text, [...new Set(roles)].sort());
      } else if (ts.isIdentifier(init)) {
        local.set(declaration.name.text, init.text);
      }
    }
    for (const [symbol, value] of local) {
      const resolved = typeof value === 'string' ? local.get(value) : value;
      if (Array.isArray(resolved) && resolved.length > 0) lists.set(`${file}::${symbol}`, resolved);
    }
  }
  return lists;
}

/**
 * Les portes d'AFFICHAGE : quelle action, sur quelle table, montrée par quel
 * écran, à quels rôles — et l'écart déclaré quand l'écran est plus étroit que la
 * base.
 *
 * Chaque entrée est une AFFIRMATION que le contrôle éprouve :
 *   • `screen` existe et lit bien sa porte (`reader` doit y apparaître, hors
 *     prose) — sinon c'est une porte qui ne garde rien ;
 *   • les rôles viennent du `.ts` qui les DÉCLARE (`gate.file` + `gate.symbol`),
 *     jamais d'une copie écrite ici ;
 *   • l'action existe vraiment dans la couche d'écriture, et aucune écriture de
 *     l'app ne manque à l'inventaire.
 */
/**
 * Les entrées sont volontairement de forme LARGE : une entrée de TABLE nomme
 * `table`/`cmd`, une entrée de FONCTION nomme `rpc` — et les suites du dépôt en
 * fabriquent d'autres pour éprouver le jugement.
 *
 * @type {any[]}
 */
export const WRITE_GATE_INVENTORY = [
  // ── Élèves et parents : l'inscription et la correction sont ouvertes à tout
  //    compte connecté (la policy le dit), la DESTRUCTION reste à `is_admin()`.
  {
    action: 'Enregistrer un élève',
    table: 'students',
    cmd: 'INSERT',
    // L'action est offerte par l'en-tête et la barre latérale (`onAddStudent`),
    // toutes deux sans garde : la base l'ouvre aussi à tout compte connecté.
    screen: 'src/components/AppHeader.tsx',
    shown: /onAddStudent/,
    gate: null,
  },
  {
    action: 'Corriger une fiche d’élève',
    table: 'students',
    cmd: 'UPDATE',
    screen: 'src/components/StudentsView.tsx',
    shown: /openEditModal/,
    gate: null,
  },
  {
    action: 'Enregistrer un reçu (recalcule le payé de l’élève)',
    table: 'students',
    cmd: 'UPDATE',
    screen: 'src/components/PaymentEntryModal.tsx',
    shown: /amount/,
    gate: null,
  },
  {
    action: 'Supprimer une fiche d’élève',
    table: 'students',
    cmd: 'DELETE',
    screen: 'src/components/StudentsView.tsx',
    shown: /canDelete/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /canDelete/ },
  },
  // ── Les réglages d'affichage (thème, densité, verre des icônes, langue) : ils
  //    vivent en base pour VOYAGER avec la sauvegarde, donc n'importe quel poste
  //    connecté doit pouvoir les enregistrer. La base le dit par deux politiques
  //    bornées à ces quatre clés-là (`20261019000000_display_preferences.sql`),
  //    jamais par une ouverture de `app_settings` — c'est le magasin des réglages
  //    d'équipe, et il reste administré. L'écran, lui, n'a aucune garde de rôle :
  //    la densité d'une tablette de classe et la langue d'un poste de guichet
  //    regardent la personne devant l'écran, pas son rôle.
  {
    action: 'Changer un réglage d’affichage (thème, densité, verre, langue)',
    table: 'app_settings',
    cmd: 'INSERT',
    screen: 'src/components/SettingsPreferencesCard.tsx',
    shown: /setTheme|setDensity|setIconGlass|toggleLanguage/,
    gate: null,
  },
  {
    action: 'Enregistrer un parent',
    table: 'parents',
    cmd: 'INSERT',
    screen: 'src/components/ParentsView.tsx',
    shown: /onOpenParentForm|setShowParentModal/,
    gate: null,
  },
  {
    action: 'Corriger une fiche de parent',
    table: 'parents',
    cmd: 'UPDATE',
    screen: 'src/components/ParentsView.tsx',
    shown: /onOpenParentForm|openEditParentModal/,
    gate: null,
  },
  {
    action: 'Supprimer une fiche de parent',
    table: 'parents',
    cmd: 'DELETE',
    screen: 'src/components/ParentsView.tsx',
    shown: /canDelete/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /canDelete/ },
  },

  // ── Personnel et paie : l'écriture est à l'économe ET au Gestionnaire
  //    Principal (`is_finance_writer()` / `is_payroll_writer()`), la destruction
  //    d'un membre du personnel reste à `is_finance_admin()`.
  {
    action: 'Ajouter un membre du personnel',
    table: 'staff',
    cmd: 'INSERT',
    screen: 'src/components/PayrollView.tsx',
    shown: /canManageStaff/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canManageStaff/ },
  },
  {
    action: 'Corriger un membre du personnel',
    table: 'staff',
    cmd: 'UPDATE',
    screen: 'src/components/PayrollView.tsx',
    shown: /openEditStaffModal/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canManageStaff/ },
  },
  {
    action: 'Supprimer un membre du personnel',
    table: 'staff',
    cmd: 'DELETE',
    screen: 'src/components/PayrollView.tsx',
    shown: /setConfirmDeleteStaff/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /canDelete/ },
    // ÉCART DÉCLARÉ, et il est réel : la base accorde la suppression d'un membre
    // du personnel à `public.is_finance_admin()` — admin, dev **et Gestionnaire
    // Principal** (`20260902000000_general_manager_role.sql`) — alors que
    // l'écran ne montre la corbeille qu'à `canDelete` (admin, dev). L'écran est
    // donc PLUS ÉTROIT que la base : aucune écriture refusée n'est proposée (la
    // direction dangereuse est fermée), mais le Gestionnaire Principal ne peut
    // pas exercer une capacité que la base lui donne. `src/lib/deleteRights.ts`
    // range pourtant `staff` dans `ADMIN_ONLY_DELETE_TABLES` — la decision de
    // droits est à confirmer avec le propriétaire, et cet écart est NOMMÉ à
    // chaque exécution plutôt que tu.
    narrower:
      'l’écran ne montre la corbeille du personnel qu’aux rôles `admin`/`dev` alors que la base accepte aussi `general_manager` (décision de droits à confirmer)',
  },
  {
    action: 'Enregistrer un paiement de salaire',
    table: 'salary_payments',
    cmd: 'INSERT',
    screen: 'src/components/PayrollView.tsx',
    shown: /canWritePayroll/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'PAYROLL_WRITER_ROLES', reader: /canWritePayroll/ },
  },

  // ── Dépenses : la saisie quotidienne est ouverte à tout compte connecté en
  //    base ; l'écran la borne aux rôles financiers (écart déclaré), et la
  //    destruction des dépenses fournisseur reste à `is_finance_admin()`.
  {
    action: 'Ajouter une dépense',
    table: 'expenses',
    cmd: 'INSERT',
    screen: 'src/components/ExpensesView.tsx',
    shown: /canWriteExpenses/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canWriteExpenses/ },
    narrower:
      'la base ouvre la saisie d’une dépense à tout compte connecté (`auth.role() = \'authenticated\'`) ; l’écran la réserve aux rôles financiers (décision du 2026-10-13)',
  },
  {
    action: 'Corriger une dépense',
    table: 'expenses',
    cmd: 'UPDATE',
    screen: 'src/components/ExpensesView.tsx',
    shown: /canWriteExpenses/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canWriteExpenses/ },
    narrower:
      'la base ouvre la correction à tout compte connecté ; l’écran la réserve aux rôles financiers',
  },
  {
    action: 'Supprimer une dépense',
    table: 'expenses',
    cmd: 'DELETE',
    screen: 'src/components/ExpensesView.tsx',
    shown: /canDelete/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /canDelete/ },
  },
  {
    action: 'Ajouter une dépense fournisseur',
    table: 'vendor_expenses',
    cmd: 'INSERT',
    screen: 'src/components/VendorExpenseModal.tsx',
    shown: /canWriteExpenses/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canWriteExpenses/ },
  },
  {
    action: 'Corriger une dépense fournisseur',
    table: 'vendor_expenses',
    cmd: 'UPDATE',
    screen: 'src/components/VendorExpenseModal.tsx',
    shown: /canWriteExpenses/,
    gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canWriteExpenses/ },
    narrower:
      'la base laisse la correction d’une dépense fournisseur à tout compte connecté (`TO authenticated … USING (true)`, 20260828000000) ; l’écran la réserve aux rôles financiers — le montant d’une dépense reste donc corrigeable en base par un rôle qui ne voit pas le bouton',
  },
  {
    action: 'Supprimer une dépense fournisseur',
    table: 'vendor_expenses',
    cmd: 'DELETE',
    screen: 'src/components/ExpensesView.tsx',
    shown: /canDeleteVendorExpense/,
    gate: {
      file: 'src/lib/payrollRights.ts',
      symbol: 'VENDOR_EXPENSE_DELETER_ROLES',
      reader: /canDeleteVendorExpense/,
    },
  },

  // ── Paiements : l'insertion est ouverte à tout compte connecté, la
  //    DESTRUCTION à `is_payment_deleter()`, la ré-attribution à `is_admin()`
  //    (fonction), les mois à `is_payment_month_editor()` (fonction).
  {
    action: 'Enregistrer un reçu',
    table: 'payments',
    cmd: 'INSERT',
    screen: 'src/components/PaymentEntryModal.tsx',
    shown: /amount/,
    gate: null,
  },
  {
    action: 'Supprimer un reçu',
    table: 'payments',
    cmd: 'DELETE',
    screen: 'src/components/PaymentHistoryView.tsx',
    shown: /canDeletePayment/,
    gate: { file: 'src/lib/paymentRights.ts', symbol: 'PAYMENT_DELETER_ROLES', reader: /canDeletePayment/ },
  },

  // ── Classes, tâches, année scolaire : trois tables dont l'écriture est
  //    ouverte à tout compte connecté, sauf `academic_years` (`is_admin()`, et
  //    l'app entretient la ligne de l'année seulement pour ce rôle).
  {
    action: 'Ajouter une classe',
    table: 'custom_classes',
    cmd: 'INSERT',
    screen: 'src/components/SettingsClassesCard.tsx',
    shown: /setShowAddClassModal|onOpenAddClass/,
    gate: null,
  },
  {
    action: 'Corriger une classe',
    table: 'custom_classes',
    cmd: 'UPDATE',
    screen: 'src/components/EditClassModal.tsx',
    shown: /onSubmit|handleSubmit/,
    gate: null,
  },
  {
    action: 'Supprimer une classe',
    table: 'custom_classes',
    cmd: 'DELETE',
    screen: 'src/components/SettingsClassesCard.tsx',
    shown: /handleDeleteClass/,
    gate: null,
  },
  {
    action: 'Ajouter une tâche',
    table: 'todos',
    cmd: 'INSERT',
    screen: 'src/components/ProductivityPanel.tsx',
    shown: /handleAddTodo/,
    gate: null,
  },
  {
    action: 'Cocher ou redater une tâche',
    table: 'todos',
    cmd: 'UPDATE',
    screen: 'src/components/ProductivityPanel.tsx',
    shown: /toggleTodo|handleUpdateTodoDate/,
    gate: null,
  },
  {
    action: 'Supprimer une tâche',
    table: 'todos',
    cmd: 'DELETE',
    screen: 'src/components/ProductivityPanel.tsx',
    shown: /deleteTodo/,
    gate: null,
  },
  {
    action: 'Déclarer l’année scolaire de travail',
    table: 'academic_years',
    cmd: 'INSERT',
    screen: 'src/app/useAcademicYears.ts',
    shown: /keepAcademicYearCurrent/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /isAdmin/ },
  },
  {
    action: 'Tenir l’année courante',
    table: 'academic_years',
    cmd: 'UPDATE',
    screen: 'src/app/useAcademicYears.ts',
    shown: /keepAcademicYearCurrent/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /isAdmin/ },
  },

  // ── Les FONCTIONS : un geste borné plutôt qu'une policy (voir
  //    `20261013000001_payments_write_lock.sql`). La garde est lue dans le corps
  //    de la fonction, jamais recopiée.
  {
    action: 'Corriger les mois payés d’un reçu',
    rpc: 'set_payment_months',
    // La garde est lue par le grand livre, pas par l'éditeur de mois : celui-ci
    // « ne connaît ni Supabase, ni les droits » (PaymentMonthsEditor.tsx).
    screen: 'src/components/PaymentLedger.tsx',
    shown: /canEditPaymentMonths/,
    gate: {
      file: 'src/lib/paymentRights.ts',
      symbol: 'PAYMENT_MONTH_EDITOR_ROLES',
      reader: /canEditPaymentMonths/,
    },
  },
  {
    action: 'Rattraper les mois de plusieurs reçus (une classe, une passe)',
    rpc: 'set_payment_months',
    // Le MÊME geste, offert depuis un SECOND écran : la passe groupée écrit un
    // reçu à la fois, mais elle part du même droit de la base. La porte est lue
    // là où la passe est OFFERTE — `SilentReceiptsView` ne monte le panneau que
    // sous `canEditPaymentMonths` — jamais dans le panneau lui-même, qui est
    // purement présentatif (comme `PaymentMonthsEditor`).
    screen: 'src/components/SilentReceiptsView.tsx',
    shown: /canEditPaymentMonths/,
    gate: {
      file: 'src/lib/paymentRights.ts',
      symbol: 'PAYMENT_MONTH_EDITOR_ROLES',
      reader: /canEditPaymentMonths/,
    },
  },
  {
    action: 'Renseigner les mois élève par élève (du plus gros montant au plus petit)',
    rpc: 'set_payment_months',
    // Le MÊME geste, offert par une SECONDE porte du même écran : le parcours
    // élève par élève (`SilentReceiptsWalk`) écrit un reçu à la fois, dans l'ordre
    // de la liste, sous le même droit de la base. La porte est lue là où le
    // parcours est OFFERT — `SilentReceiptsView` ne le monte que sous
    // `canEditPaymentMonths` — jamais dans le panneau, qui est purement
    // présentatif (comme `PaymentMonthsEditor`).
    screen: 'src/components/SilentReceiptsView.tsx',
    shown: /canEditPaymentMonths/,
    gate: {
      file: 'src/lib/paymentRights.ts',
      symbol: 'PAYMENT_MONTH_EDITOR_ROLES',
      reader: /canEditPaymentMonths/,
    },
  },
  {
    action: 'Ré-attribuer un reçu à une autre fiche (fusion)',
    rpc: 'reassign_payment_student',
    screen: 'src/components/DuplicateReviewModal.tsx',
    shown: /canDelete/,
    gate: { file: 'src/lib/deleteRights.ts', symbol: 'ADMIN_ROLES', reader: /canDelete/ },
  },
];

/** Le nom d'un écart déclaré, pour que le rapport le lise sans décodeur. */
export const NARROWED_LABEL = 'ÉCART DÉCLARÉ (l’écran plus étroit que la base)';

/**
 * Le jugement, dans les deux sens.
 *
 * Les types sont volontairement LARGES (`any[]`) : une suite éprouve ce jugement
 * avec des corpus fabriqués, et un inventaire de test n'a pas la forme exacte de
 * celui du dépôt.
 *
 * @param {{
 *   inventory?: any[],
 *   sources?: { file: string, text: string }[],
 *   migrations?: { name?: string, sql?: string }[],
 * }} [input]
 */
export function judgeWriteGates({ inventory = WRITE_GATE_INVENTORY, sources = [], migrations = [] } = {}) {
  const problems = [];
  const illegible = [];
  const narrowed = [];
  const shownOverPromises = [];
  const hiddenGrants = [];
  const noWritePolicy = [];
  const unproven = [];
  const byScreen = new Map(sources.map((entry) => [String(entry?.file ?? ''), String(entry?.text ?? '')]));
  const maskedScreen = (file) => {
    const text = byScreen.get(String(file));
    return text === undefined ? null : maskComments(text);
  };

  const actions = appWriteActions(sources);
  const rpcs = appRpcCalls(sources);
  const writers = baseWriters(migrations);
  const functions = functionWriters(migrations);
  const roleLists = readRoleLists(sources);

  // ── L'inventaire doit nommer CHAQUE écriture de l'app, et rien de plus : un
  //    geste non nommé est un geste que personne ne croise, une entrée périmée
  //    garde une action qui n'existe plus.
  const covered = new Set();
  for (const entry of inventory) {
    if (entry.rpc) {
      if (!rpcs.some((call) => call.fn === String(entry.rpc).toLowerCase())) {
        problems.push(`« ${entry.rpc} » est gardée par « ${entry.screen} » mais l’app ne l’appelle nulle part — entrée périmée.`);
      }
      covered.add(`rpc::${String(entry.rpc).toLowerCase()}`);
      continue;
    }
    const found = actions.some((action) => action.table === entry.table && action.cmd === entry.cmd);
    if (!found) {
      problems.push(
        `« ${entry.action} » (${entry.table}.${entry.cmd}) est gardée par « ${entry.screen} » mais la couche d’écriture ` +
          'ne l’exécute nulle part — entrée périmée.',
      );
    }
    covered.add(`${entry.table}::${entry.cmd}`);
  }
  for (const action of actions) {
    const key = `${action.table}::${action.cmd}`;
    if (covered.has(key)) continue;
    problems.push(
      `${action.file}:${action.line} écrit ${action.table}.${action.cmd} et AUCUNE porte d’affichage ne le croise — ` +
        'nommez l’écran qui l’offre et la garde qu’il lit.',
    );
  }
  for (const call of rpcs) {
    if (covered.has(`rpc::${call.fn}`)) continue;
    problems.push(
      `${call.file}:${call.line} appelle ${call.fn}() et AUCUNE porte d’affichage ne le croise — ` +
        'nommez l’écran qui l’offre et la garde qu’il lit.',
    );
  }

  for (const entry of inventory) {
    const key = entry.rpc ? `rpc::${String(entry.rpc).toLowerCase()}` : `${entry.table}::${entry.cmd}`;
    const screenText = maskedScreen(entry.screen);
    if (screenText === null) {
      problems.push(`« ${entry.action} » : la source de « ${entry.screen} » n’a pas été lue — la porte ne peut pas être éprouvée.`);
      continue;
    }
    if (!entry.shown.test(screenText)) {
      unproven.push({
        ...entry,
        key,
        why: `« ${entry.screen} » ne contient aucune trace de « ${entry.action} » (motif ${entry.shown}) — l’action a-t-elle disparu de l’écran ?`,
      });
      continue;
    }

    // ── Les rôles de la PORTE, lus dans le `.ts` qui les déclare.
    let appRoles = ANY_AUTHENTICATED;
    if (entry.gate) {
      const roles = roleLists.get(`${entry.gate.file}::${entry.gate.symbol}`);
      if (!roles) {
        problems.push(
          `« ${entry.action} » : la liste « ${entry.gate.symbol} » est introuvable dans ${entry.gate.file} — ` +
            'une porte dont les rôles ne se lisent pas ne garde rien.',
        );
        continue;
      }
      if (!entry.gate.reader.test(screenText)) {
        unproven.push({
          ...entry,
          key,
          why: `« ${entry.screen} » ne LIT pas la porte « ${entry.gate.symbol} » (motif ${entry.gate.reader}) — la garde est déclarée, pas appliquée.`,
        });
        continue;
      }
      appRoles = roles;
    }
    // Sans porte (`gate: null`), l'écran montre l'action à tout compte connecté :
    // c'est une affirmation, et elle se vérifie contre la base — une écriture
    // réservée en face devient donc « l'écran montre ce que la base refuse »,
    // nommée « tout compte connecté ».

    // ── Les rôles de la BASE : la policy pour une table, la garde du corps pour
    //    une fonction.
    let baseSet;
    let source;
    if (entry.rpc) {
      const found = functions.get(String(entry.rpc).toLowerCase());
      if (!found) {
        noWritePolicy.push({ ...entry, key, base: 'aucune fonction déclarée' });
        continue;
      }
      baseSet = found.set;
      source = `${found.file} — garde « ${found.guard} »`;
    } else {
      const found = writers.get(key);
      if (!found) {
        noWritePolicy.push({ ...entry, key, base: 'aucune politique d’écriture déclarée' });
        continue;
      }
      baseSet = found.set;
      const first = found.policies[0];
      source = `${first.file} — politique « ${first.name} » (${first.expression})`;
      if (found.policies.length > 1) {
        source += ` et ${found.policies.length - 1} autre(s)`;
      }
    }

    if (baseSet === ILLEGIBLE) {
      illegible.push({ ...entry, key, source });
      continue;
    }

    if (!includes(baseSet, appRoles)) {
      shownOverPromises.push({
        ...entry,
        key,
        roles: missingRoles(appRoles, baseSet),
        base: describeRoles(baseSet),
        app: describeRoles(appRoles),
        source,
      });
      continue;
    }
    const hidden = missingRoles(baseSet, appRoles);
    if (hidden.length > 0) {
      if (entry.narrower) {
        narrowed.push({ ...entry, key, roles: hidden, base: describeRoles(baseSet), app: describeRoles(appRoles), source });
      } else {
        hiddenGrants.push({
          ...entry,
          key,
          roles: hidden,
          base: describeRoles(baseSet),
          app: describeRoles(appRoles),
          source,
        });
      }
    }
  }

  const drift = shownOverPromises.length + hiddenGrants.length + noWritePolicy.length + unproven.length;
  const roleListsRead = [...inventory].filter((entry) => entry.gate && roleLists.has(`${entry.gate.file}::${entry.gate.symbol}`)).length;
  // Ce qui rend le verdict impossible : rien à croiser (aucune porte, aucune
  // écriture), aucune politique déclarée en face, ou aucune liste de rôles lue.
  // Un dépôt sans FONCTION n'est pas vide pour autant — les appels `.rpc()` sont
  // couverts par la règle d'inventaire complet, pas par cette vacuité.
  const vacuous =
    inventory.length === 0 || actions.length === 0 || writers.size === 0 || roleListsRead === 0;

  return {
    entries: inventory.length,
    actions: actions.length,
    rpcs: rpcs.length,
    policies: writers.size,
    roleListsRead,
    shownOverPromises,
    hiddenGrants,
    noWritePolicy,
    unproven,
    narrowed,
    illegible,
    problems,
    drift,
    // Rien lu = aucun verdict : « je n’ai pas pu regarder » n’est pas un vert.
    // Une condition illisible non plus : un couple (table, commande) dont la
    // règle n’a pas été lue n’est pas un couple vérifié.
    vacuous,
    ok: !vacuous && drift === 0 && problems.length === 0 && illegible.length === 0,
  };
}
