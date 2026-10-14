// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/rls-policies.mjs — la base hébergée porte-t-elle EXACTEMENT les
// politiques que les migrations déclarent ?
//
// ─── Le défaut mesuré, deux fois dans la même semaine ───────────────────────
// Le 2026-10-13, la base de l'école portait « Promoter insert vendor_expenses »
// (`CHECK is_admin()`) alors que `20260906000002_vendor_expense_gm_policies.sql`
// déclarait depuis le 2026-09-06 « Finance admins insert vendor_expenses »
// (`is_finance_admin()`) : la migration n'avait JAMAIS été appliquée, donc le
// Gestionnaire Principal voyait le bouton « Ajouter une dépense fournisseur » et
// la base refusait chacune de ses écritures (42501) — cinq semaines durant. Le
// même jour, l'écran cachait l'insertion de l'économe parce que sa porte citait
// `is_admin()` là où la base acceptait déjà : deux formes du MÊME angle mort —
// personne ne comparait les politiques de la base à celles des migrations.
//
// `check:hosted-schema` compare les COLONNES (canal PostgREST, clé anon : les
// politiques ne s'y lisent pas) et `check:public-rls` regarde si chaque table
// PORTE RLS, jamais ce que la politique dit. Une policy absente, en trop, ou
// restée à un rôle plus étroit passait entre les deux, en silence, indéfiniment.
//
// ─── Ce qui est pur ici, et ce qui ne l'est pas ─────────────────────────────
// PUR, donc testé sans base (`tests/rls-policies.test.ts`) : le découpage des
// instructions, la lecture d'un `CREATE POLICY` (table, nom, commande, rôles,
// `USING`, `WITH CHECK`), le NET du rejeu (`DROP` puis `CREATE` du même nom laisse
// la politique ; l'inverse l'emporte), la canonicalisation des conditions, et le
// verdict. Le script ne fait que lire `pg_policies` et nommer.
//
// ─── Trois pièges mesurés, et comment ils sont traités ─────────────────────
//   1. Les LITTÉRAUX comptent. Le découpage partagé (`topLevelStatements`)
//      blanchit les chaînes — ce qui est juste pour décider d'un GESTE (un `DROP`
//      écrit dans une chaîne n'est pas un geste) mais faux ici :
//      `role IN ('admin','dev')` EST la règle. Structure et conditions sont donc
//      lues séparément, sur deux vues du MÊME texte, alignées caractère par
//      caractère : la STRUCTURE sur `blankComments(sql)` (commentaires et chaînes
//      blanchis — la couche partagée, donc la cécité à la prose est prouvée), les
//      CONDITIONS recopiées du texte d'origine aux mêmes index. Mesuré avant
//      correction : la condition déclarée s'affichait `role IN ( , )`, illisible
//      pour qui doit juger la dérive.
//   2. Deux écritures peuvent dire la MÊME règle. `role IN ('admin','dev')` et
//      `is_admin()` sont équivalents — les signaler serait un faux positif
//      permanent, et un contrôle qui crie toujours ne se lit plus. Les ensembles
//      de rôles sont donc CANONISÉS des deux côtés, à partir des FONCTIONS
//      DÉCLARÉES PAR LES MIGRATIONS (`collectRoleSets`) : aucune troisième copie
//      des listes de rôles, et `is_admin()` face à `is_finance_writer()` reste,
//      lui, une dérive nommée.
//   3. Une table RETIRÉE ne réclame plus ses politiques. Mesuré le 2026-10-13 :
//      `custom_grades` était annoncée « ABSENTE en base » pour deux politiques que
//      `20260828000002/3` déclaraient — alors que `20260828000004_custom_classes.sql`
//      RETIRE la table (bloc `DO $$ … $$` conditionnel) : le dépôt ne peut donc pas
//      vouloir ces politiques, et le contrôle exigeait un `CREATE POLICY`
//      impossible. Le `DROP TABLE` lui était invisible (`statementSpans` saute les
//      corps `$$ … $$`). Une table retirée par le corpus efface les politiques
//      qu'il déclarait AVANT elle, et le retrait est NOMMÉ (`declaredPoliciesAndRetired`),
//      jamais silencieux.
//
// ─── Ce qu'il refuse de laisser passer pour un vert ────────────────────────
// Aucune politique déclarée, aucune politique lue, une exemption muette, périmée,
// ou qui cache une politique DÉCLARÉE : le script sort en 2 ou nomme un problème
// — jamais un vert silencieux.
// ─────────────────────────────────────────────────────────────────────────────
import { blankComments } from './schema-expected.mjs';

/** La commande d'une politique, telle que `pg_policies.cmd` la rend. */
export const POLICY_COMMANDS = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** Le rôle implicite quand la migration n'écrit pas de clause `TO`. */
export const DEFAULT_ROLES = ['public'];

/**
 * La clé d'une politique dans une comparaison : `table::nom`.
 *
 * Deux politiques de même nom sur deux tables différentes sont deux objets
 * distincts (`pg_policies` les distingue par `tablename`), donc la table fait
 * partie de l'identité — sinon une policy posée sur une autre table passerait
 * pour la même.
 */
export const policyKey = (table, name) => `${String(table).toLowerCase()}::${String(name)}`;

/** Les rôles d'une politique, réduits à une forme comparable et triée. */
function normalizeRoles(roles) {
  const list = Array.isArray(roles) ? roles : String(roles ?? '').replace(/[{}]/g, '').split(',');
  // Les deux écritures d'un rôle : `'admin'` dans une liste SQL, `authenticated`
  // tel que `pg_policies.roles` le rend — et `"authenticated"` si un jour il est
  // quoté comme identifiant.
  const cleaned = list
    .map((role) => String(role ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
  return (cleaned.length > 0 ? cleaned : DEFAULT_ROLES).sort();
}

/**
 * Les instructions de niveau 0, en DEUX vues alignées : `masked` (structure) et
 * `text` (conditions, littéraux compris).
 *
 * Les corps `$$ … $$` sont sautés — aucune politique ne s'y écrit ; le repérage
 * des `;` se fait sur `masked`, donc un point-virgule dans un commentaire ou dans
 * une chaîne ne coupe pas une instruction. Les deux vues ayant la même longueur
 * (`blankComments` le garantit), un index calculé sur l'une vaut sur l'autre.
 *
 * @param {string} sql
 * @returns {{ start: number, masked: string, text: string }[]} `start` : la position
 *   de l'instruction dans le texte blanchi, pour ordonner les gestes d'un même
 *   fichier (un `DROP TABLE` et le `CREATE POLICY` qui le suit ne se lisent pas
 *   dans le désordre).
 */
export function statementSpans(sql) {
  const original = String(sql ?? '');
  const masked = blankComments(original);
  const spans = [];
  let start = 0;
  let i = 0;
  while (i < masked.length) {
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(masked.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = masked.indexOf(tag, i + tag.length);
      i = end === -1 ? masked.length : end + tag.length;
      continue;
    }
    if (masked[i] === ';') {
      spans.push({ start, masked: masked.slice(start, i), text: original.slice(start, i) });
      start = i + 1;
    }
    i += 1;
  }
  spans.push({ start, masked: masked.slice(start), text: original.slice(start) });
  return spans.filter((span) => span.masked.trim().length > 0);
}

/**
 * Les FONCTIONS de rôle déclarées par les migrations : `is_admin()` → ses rôles.
 *
 * Lues dans les migrations elles-mêmes (`… WHERE id = auth.uid() AND role IN
 * ('admin', 'dev')`) et non recopiées : la liste n'existe donc qu'à un endroit, et
 * un rôle ajouté à la fonction change la comparaison sans toucher ce fichier.
 * Amorce et corps sont lus séparément : l'INSTRUCTION est repérée sur la vue
 * masquée (une fonction racontée dans un commentaire n'existe pas), et la LISTE de
 * rôles est recopiée du texte d'origine — le corps `$$ … $$` garde ses littéraux,
 * c'est-à-dire exactement là où ces listes vivent.
 *
 * @param {{ name?: string, sql?: string }[]} migrations
 * @returns {Map<string, string[]>} nom de fonction (minuscules) → rôles triés
 */
export function collectRoleSets(migrations = []) {
  /** @type {Map<string, string[]>} */
  const roleSets = new Map();
  for (const migration of migrations) {
    for (const span of statementSpans(String(migration?.sql ?? ''))) {
      if (!/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(span.masked)) continue;
      const match = /FUNCTION\s+(?:public\.)?("?[A-Za-z_]\w*"?)\s*\(\s*\)[\s\S]*?role\s+IN\s*\(([^)]*)\)/i.exec(
        span.text,
      );
      if (!match) continue;
      const name = match[1].replace(/"/g, '').toLowerCase();
      const roles = normalizeRoles(match[2]).filter((role) => role !== 'public');
      if (roles.length > 0) roleSets.set(name, roles);
    }
  }
  return roleSets;
}

/** Le marqueur d'un ensemble de rôles, sous une forme qui survit au découpage en jetons. */
const roleMarker = (roles) => `roleset.${[...roles].sort().join('.')}`;

/**
 * Le texte d'une condition, réduit à ce que Postgres en garde.
 *
 * Mesuré : les migrations écrivent `WITH CHECK (public.is_finance_writer())` et la
 * base rend `is_finance_writer()` ; `(auth.role() = 'authenticated')` devient
 * `(auth.role() = 'authenticated'::text)`. Sans cette réduction, chaque politique
 * déclarerait une différence qui n'existe pas.
 */
export function normalizeExpression(text) {
  return String(text ?? '')
    .replace(/::\s*(?:text|character\s+varying|varchar|name|bpchar|boolean|bool)\b/gi, '')
    .replace(/\bpublic\./gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * La forme canonique d'une condition : chaque ensemble de rôles devient un
 * marqueur, qu'il soit écrit `is_admin()` ou `role IN ('admin', 'dev')`.
 */
export function canonicalExpression(text, roleSets = new Map()) {
  let out = normalizeExpression(text);
  // La MÊME règle écrite en clair : `exists (select 1 from user_profiles where
  // id = auth.uid() and role in ('admin','dev'))` est ce que `is_admin()` calcule.
  // Sans cette reconnaissance, la comparaison signalerait une dérive là où la
  // base applique exactement la règle déclarée — un faux positif permanent, et un
  // contrôle qui crie toujours ne se lit plus.
  out = out.replace(
    /exists\s*\(\s*select\s+1\s+from\s+(?:public\.)?user_profiles[\s\S]*?role\s+in\s*\(([^)]*)\)\s*\)/g,
    (_all, list) => roleMarker(normalizeRoles(list)),
  );
  out = out.replace(/role\s+in\s*\(([^)]*)\)/g, (_all, list) => roleMarker(normalizeRoles(list)));
  for (const [name, roles] of roleSets) {
    out = out.replace(new RegExp(`(^|[^a-z0-9_.])${name}(?!\\w)`, 'g'), (_all, prefix) => `${prefix}${roleMarker(roles)}`);
  }
  return out;
}

/**
 * Les JETONS d'une condition, triés et dédoublonnés.
 *
 * Comparer des jetons plutôt que du texte : la même condition écrite
 * `(auth.role() = 'authenticated')` et `auth.role() = 'authenticated'` doit peser
 * pareil, alors qu'un passage de `is_admin()` à `is_finance_writer()` — le défaut
 * mesuré — doit sauter aux yeux. Un changement de colonne, d'opérateur ou de
 * valeur change les jetons.
 */
export function expressionTokens(text, roleSets = new Map()) {
  const tokens = canonicalExpression(text, roleSets)
    .split(/[^a-z0-9_'.]+/)
    .filter(Boolean);
  return [...new Set(tokens.map((token) => token.replace(/^'|'$/g, '')))].sort();
}

/** Le rang de la parenthèse qui ferme celle ouverte à `openIndex`, ou `-1`. */
function closingParenIndex(text, openIndex) {
  if (text[openIndex] !== '(') return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Le contenu de la condition qui suit un mot-clé (`USING`, `WITH CHECK`).
 *
 * Le repérage et l'équilibrage des parenthèses se font sur la vue MASQUÉE (une
 * parenthèse dans une chaîne ou un commentaire ne compte pas) ; le contenu est
 * recopié du texte d'origine, littéraux compris, aux mêmes index.
 */
function expressionAfter(masked, text, keyword) {
  const match = new RegExp(`${keyword}\\s*\\(`, 'i').exec(masked);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = closingParenIndex(masked, open);
  if (close === -1) return null;
  return text.slice(open + 1, close);
}

/** Une instruction acceptée sous forme de chaîne ou de couple `{ masked, text }`. */
function views(span) {
  if (typeof span === 'string') {
    return { masked: span, text: span };
  }
  return { masked: String(span?.masked ?? ''), text: String(span?.text ?? '') };
}

/**
 * Une instruction `CREATE POLICY` découpée.
 *
 * @param {string|{ masked: string, text: string }} span
 * @returns {{ name: string, table: string, cmd: string, roles: string[],
 *   using: string|null, check: string|null }|null}
 */
export function parseCreatePolicy(span) {
  const { masked, text } = views(span);
  const flat = masked.replace(/\s+/g, ' ').trim();
  const head = /^CREATE\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?"?([A-Za-z_]\w*)"?/i.exec(flat);
  if (!head) return null;
  const name = (head[1] ?? head[2] ?? '').trim();
  const table = String(head[3] ?? '').trim();
  if (!name || !table) return null;
  const body = flat.slice(head[0].length);

  const cmdMatch = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(body);
  const cmd = cmdMatch ? cmdMatch[1].toUpperCase() : 'ALL';

  const rolesMatch = /\bTO\s+([^]*?)(?=\s+(?:USING|WITH\s+CHECK)\b|$)/i.exec(body);
  const roles = rolesMatch ? normalizeRoles(rolesMatch[1].replace(/\s+/g, '')) : [...DEFAULT_ROLES];

  // Les conditions se lisent sur le couple `masked` / `text` NON aplati : repérage
  // et équilibrage des parenthèses sur la vue masquée, contenu recopié du texte
  // d'origine aux mêmes index (les deux vues ont la même longueur).
  return {
    name,
    table,
    cmd: POLICY_COMMANDS.includes(cmd) ? cmd : 'ALL',
    roles,
    using: expressionAfter(masked, text, 'USING'),
    check: expressionAfter(masked, text, 'WITH\\s+CHECK'),
  };
}

/**
 * Une instruction `DROP POLICY IF EXISTS` (ou `DROP POLICY`).
 *
 * @param {string|{ masked: string, text: string }} span
 * @returns {{ name: string, table: string }|null}
 */
export function parseDropPolicy(span) {
  const { masked } = views(span);
  const text = masked.replace(/\s+/g, ' ').trim();
  const match = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))\s+ON\s+(?:public\.)?"?([A-Za-z_]\w*)"?/i.exec(text);
  if (!match) return null;
  const name = (match[1] ?? match[2] ?? '').trim();
  const table = String(match[3] ?? '').trim();
  if (!name || !table) return null;
  return { name, table };
}

/** Le nom d'une table tel qu'on le compare : sans schéma, sans guillemets. */
function tableName(name) {
  return String(name ?? '')
    .split('.')
    .pop()
    .replace(/"/g, '')
    .toLowerCase();
}

/**
 * Un `DROP TABLE` quelque part dans une migration, avec sa position.
 *
 * Repéré sur la vue BLANCHIE — donc un `DROP TABLE` raconté dans un commentaire
 * ou écrit dans une chaîne (`EXECUTE 'DROP TABLE …'`) n'est pas un geste — mais
 * SANS découper en instructions : les `DROP TABLE` du dépôt vivent dans des blocs
 * `DO $$ … $$`, que `statementSpans` saute par construction. C'est exactement
 * l'angle mort qui a fait réclamer deux politiques de `custom_grades` cinq
 * semaines après le retrait de la table.
 *
 * Exporté pour que le contrôle des INDEX, CONTRAINTES et DÉCLENCHEURS
 * (`db-objects.mjs`) emploie la MÊME règle : un `DROP TABLE` emporte ce qu'une
 * migration déclarait sur cette table, et deux copies de ce repérage finiraient
 * par diverger — l'une des deux continuerait de réclamer des objets disparus.
 *
 * @param {string} sql
 * @returns {{ index: number, table: string }[]}
 */
export function dropTableEvents(sql) {
  const masked = blankComments(String(sql ?? ''));
  return [...masked.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_"][\w."]*)/gi)].map(
    (match) => ({ index: match.index, table: tableName(match[1]) }),
  );
}

/**
 * Ce que les migrations LAISSENT en base, politique par politique.
 *
 * Les fichiers sont lus DANS L'ORDRE DONNÉ (leur préfixe est un horodatage :
 * `db:snapshot:check` et `db:apply` s'appuient déjà sur cet ordre) et le rejeu
 * suit le rang des instructions : `DROP` retire, `CREATE` (re)pose. Un `DROP`
 * raconté dans un commentaire n'est pas un geste — c'est `blankComments` qui le
 * garantit, et `tests/rls-policies.test.ts` qui l'exerce.
 *
 * @param {{ name?: string, sql?: string }[]} migrations
 * @returns {Map<string, { name: string, table: string, cmd: string, roles: string[],
 *   using: string|null, check: string|null, file: string }>}
 */
export function declaredPoliciesFromMigrations(migrations = []) {
  return declaredPoliciesAndRetired(migrations).declared;
}

/**
 * Le MÊME rejeu, plus ce qu'une table RETIRÉE emporte — pour que le retrait soit
 * NOMMÉ plutôt que silencieux.
 *
 * `custom_grades` est le cas mesuré : deux politiques déclarées par
 * `20260828000002/3`, la table retirée par `20260828000004`. Les compter comme
 * « ABSENTES en base » demandait un `CREATE POLICY` que le dépôt ne veut plus ;
 * les taire sans le dire aurait été l'autre faute — un contrôle qui renonce en
 * silence. Elles sortent donc du rejeu ET sont rapportées, table, nom, commande,
 * fichier qui les déclarait et fichier qui retire la table.
 *
 * @param {{ name?: string, sql?: string }[]} migrations
 * @returns {{ declared: Map<string, any>, retired: { table: string, name: string,
 *   cmd: string, declaredBy: string, droppedBy: string }[] }}
 */
export function declaredPoliciesAndRetired(migrations = []) {
  /** @type {Map<string, any>} */
  const policies = new Map();
  /** @type {{ table: string, name: string, cmd: string, declaredBy: string, droppedBy: string }[]} */
  const retired = [];
  for (const migration of migrations) {
    const file = String(migration?.name ?? '');
    const sql = String(migration?.sql ?? '');

    // Les gestes d'un MÊME fichier, dans l'ordre où ils sont écrits : un
    // `DROP TABLE` et les `CREATE POLICY` voisins ne se lisent pas dans le
    // désordre. Les deux familles viennent de la même vue blanchie, donc les
    // index sont comparables.
    const events = [];
    for (const span of statementSpans(sql)) {
      const drop = parseDropPolicy(span);
      if (drop) {
        events.push({ index: span.start, drop });
        continue;
      }
      const create = parseCreatePolicy(span);
      if (create) events.push({ index: span.start, create });
    }
    for (const event of dropTableEvents(sql)) events.push(event);
    events.sort((a, b) => a.index - b.index);

    for (const event of events) {
      if (event.table) {
        const prefix = `${event.table}::`;
        for (const key of [...policies.keys()]) {
          if (!key.startsWith(prefix)) continue;
          const policy = policies.get(key);
          policies.delete(key);
          retired.push({
            table: policy.table,
            name: policy.name,
            cmd: policy.cmd,
            declaredBy: policy.file,
            droppedBy: file,
          });
        }
        continue;
      }
      if (event.drop) {
        policies.delete(policyKey(event.drop.table, event.drop.name));
        continue;
      }
      policies.set(policyKey(event.create.table, event.create.name), { ...event.create, file });
    }
  }
  return { declared: policies, retired };
}

/**
 * Les politiques RÉELLES de la base, réduites à la même forme que les déclarées.
 *
 * `pg_policies` porte `roles` en `name[]` — le pilote `pg` rend un tableau, un
 * export JSON peut rendre `{authenticated}` : les deux formes sont lues.
 *
 * @param {{ tablename?: string, policyname?: string, cmd?: string, roles?: unknown,
 *   qual?: string|null, with_check?: string|null }[]} rows
 */
export function hostedPoliciesFromRows(rows = []) {
  /** @type {Map<string, any>} */
  const policies = new Map();
  for (const row of rows) {
    const table = String(row?.tablename ?? '').trim();
    const name = String(row?.policyname ?? '').trim();
    if (!table || !name) continue;
    const cmd = String(row?.cmd ?? 'ALL').trim().toUpperCase();
    policies.set(policyKey(table, name), {
      name,
      table,
      cmd: POLICY_COMMANDS.includes(cmd) ? cmd : 'ALL',
      roles: normalizeRoles(row?.roles),
      using: row?.qual ?? null,
      check: row?.with_check ?? null,
    });
  }
  return policies;
}

/** La requête du catalogue : les politiques de `public`, triées pour être comparables. */
export const POLICY_DRIFT_SQL = `
  select tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
   where schemaname = 'public'
   order by tablename, policyname
`;

/**
 * Le verdict : ce qui manque, ce qui est en trop, ce qui a changé.
 *
 * Les exemptions sont bornées DANS LES DEUX SENS, comme les autres de ce dépôt :
 * une exemption sans raison est un trou ; une exemption qui ne correspond à aucune
 * politique de la base est périmée (elle autoriserait un retour en arrière
 * silencieux) ; et une exemption qui couvrirait une politique DÉCLARÉE par une
 * migration est refusée — elle ne pourrait que cacher le défaut que ce contrôle
 * existe pour nommer.
 *
 * @param {{ declared?: Map<string, any>, hosted?: Map<string, any>,
 *   exemptions?: { table?: string, name?: string, reason?: string }[],
 *   roleSets?: Map<string, string[]> }} [input]
 */
export function judgePolicyDrift({ declared = new Map(), hosted = new Map(), exemptions = [], roleSets = new Map() } = {}) {
  const problems = [];
  const exempted = [];

  for (const exemption of exemptions) {
    const table = String(exemption?.table ?? '').trim().toLowerCase();
    const name = String(exemption?.name ?? '').trim();
    const reason = String(exemption?.reason ?? '').trim();
    if (!table || !name) {
      problems.push('une exemption sans table ni nom ne peut pas être vérifiée');
      continue;
    }
    if (!reason) {
      problems.push(`« ${table}.${name} » est exemptée sans raison — une exemption muette est un trou.`);
      continue;
    }
    const key = policyKey(table, name);
    if (declared.has(key)) {
      problems.push(
        `« ${table}.${name} » est exemptée alors qu’une migration la DÉCLARE — une exemption ne peut pas cacher une politique attendue : appliquez la migration (db:apply) plutôt que d’exempter.`,
      );
      continue;
    }
    if (!hosted.has(key)) {
      problems.push(
        `« ${table}.${name} » est exemptée mais n’existe pas dans public — une exemption périmée autorise un retour en arrière silencieux.`,
      );
      continue;
    }
    exempted.push({ table, name, reason });
  }
  const exemptKeys = new Set(exempted.map((entry) => policyKey(entry.table, entry.name)));

  const missing = [];
  const changed = [];
  let matched = 0;
  for (const [key, want] of declared) {
    const have = hosted.get(key);
    if (!have) {
      missing.push({ table: want.table, name: want.name, cmd: want.cmd, file: want.file });
      continue;
    }
    const differences = [];
    if (have.cmd !== want.cmd) differences.push({ field: 'commande', declared: want.cmd, base: have.cmd });
    if (have.roles.join(',') !== want.roles.join(',')) {
      differences.push({ field: 'rôles', declared: want.roles.join(', '), base: have.roles.join(', ') });
    }
    for (const field of ['using', 'check']) {
      if (expressionTokens(want[field], roleSets).join(' ') !== expressionTokens(have[field], roleSets).join(' ')) {
        differences.push({
          field: field === 'using' ? 'USING' : 'WITH CHECK',
          declared: String(want[field] ?? '—').replace(/\s+/g, ' ').trim() || '—',
          base: String(have[field] ?? '—').replace(/\s+/g, ' ').trim() || '—',
        });
      }
    }
    if (differences.length > 0) changed.push({ table: want.table, name: want.name, file: want.file, differences });
    else matched += 1;
  }

  const extra = [];
  for (const [key, have] of hosted) {
    if (declared.has(key)) continue;
    if (exemptKeys.has(key)) continue;
    extra.push({
      table: have.table,
      name: have.name,
      cmd: have.cmd,
      roles: have.roles.join(', '),
      expression: String(have.check ?? have.using ?? 'true').replace(/\s+/g, ' ').trim(),
    });
  }

  const byTableThenName = (a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name);
  missing.sort(byTableThenName);
  extra.sort(byTableThenName);
  changed.sort(byTableThenName);

  const drift = missing.length + extra.length + changed.length;
  return {
    declaredCount: declared.size,
    hostedCount: hosted.size,
    matched,
    missing,
    extra,
    changed,
    exempted,
    problems,
    drift,
    // Un regard qui n'a rien atteint n'est pas un état sain : sans politique
    // déclarée ou sans politique lue, il n'y a rien à comparer, et le script sort
    // en 2 — « je n'ai pas pu regarder » n'est pas un vert.
    vacuous: declared.size === 0 || hosted.size === 0,
    ok: declared.size > 0 && hosted.size > 0 && drift === 0 && problems.length === 0,
  };
}
