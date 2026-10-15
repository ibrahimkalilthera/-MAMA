// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/db-objects.mjs — la base hébergée porte-t-elle EXACTEMENT les
// INDEX, les CONTRAINTES et les DÉCLENCHEURS que les migrations déclarent ?
//
// ─── Pourquoi ce contrôle existe, après celui des politiques ────────────────
// `check:hosted-schema` compare les COLONNES (canal PostgREST, clé anon),
// `check:public-rls` regarde si chaque table PORTE RLS, et `check:rls-policies`
// compare les POLITIQUES. Restaient trois familles d'objets qu'une base peut
// porter en retard — ou en avance — sans que rien ne le dise :
//
//   • un INDEX absent ne casse pas une écriture, il la rend LENTE (et une
//     jointure sans index sur `audit_logs` se paie à chaque écran) ; un index
//     UNIQUE absent, lui, accepte des doublons que le dépôt croit interdits ;
//   • une CONTRAINTE absente est pire : `payments_motif_shape_check` est ce qui
//     empêche une clé de motif que le module ne saura pas relire d'entrer en
//     base, et une clé étrangère absente laisse des lignes orphelines que
//     l'écran ne saura plus rattacher ;
//   • un DÉCLENCHEUR absent est SILENCIEUX : `students_assign_matricule` remplit
//     un matricule que l'application a cessé d'écrire, donc un élève créé sans
//     lui reste sans matricule — et rien ne le dit, ni à l'écran, ni en base.
//
// ─── Le modèle est celui des politiques, et il est assumé ───────────────────
// Les trois familles sont lues dans `supabase/migrations/` et REJOUÉES dans
// l'ordre des horodatages : `DROP` retire, `CREATE` (re)pose, et un objet déclaré
// sur une table que le corpus RETIRE plus loin n'est pas un manque — c'est un
// retrait, et il est NOMMÉ (voir `declaredObjectsAndRetired`). Le catalogue vient
// de `pg_index`, `pg_constraint` et `pg_trigger` par connexion DIRECTE. Chaque
// écart est nommé : ABSENT, EN TROP, ou CHANGÉ champ par champ.
//
// ─── Trois pièges du corpus réel, et comment ils sont traités ───────────────
//   1. **Postgres NOMME ce que le SQL n'a pas nommé.** Le dépôt écrit
//      `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `student_id TEXT UNIQUE`,
//      `parent_id UUID REFERENCES public.parents(id)` : la base, elle, porte
//      `students_pkey`, `students_student_id_key`, `students_parent_id_fkey`.
//      Ces noms sont DÉRIVÉS ici, par les règles de Postgres (`<table>_pkey`,
//      `<table>_<colonne>_key`, `<table>_<colonne>_fkey`, `<table>_<colonne>_check`,
//      `<table>_check`, suffixe numérique en cas de collision), et non recopiés
//      du catalogue : une liste recopiée ne vaudrait que pour la base
//      d'aujourd'hui, et c'est la dérive d'après-demain qu'on veut attraper.
//   2. **Deux écritures, une seule règle.** `motif IN ('scolarite','inscription')`
//      et `motif = ANY (ARRAY['scolarite'::text, 'inscription'::text])` sont la
//      MÊME contrainte : la base rend la seconde, le dépôt écrit la première. La
//      comparaison normalise les deux formes (voir `normalizeDefinition`) — sans
//      quoi le contrôle signalerait une dérive sur chaque contrainte du dépôt, et
//      un contrôle qui crie toujours ne se lit plus. Le même écart existe pour les
//      BORNES : `char_length(x) BETWEEN 8 AND 64` (le dépôt) et
//      `((char_length(x) >= 8) AND (char_length(x) <= 64))` (le catalogue), dont
//      `station_versions_station_id_bounds` a payé le cas le 2026-10-18.
//   3. **L'index d'une contrainte n'est pas un index déclaré.** Une clé primaire
//      ou une contrainte UNIQUE crée un index (`students_pkey`) : le compter comme
//      un index à part ferait de chaque table une dérive permanente. Le catalogue
//      les marque (`conindid`), et ils sont comptés du côté CONTRAINTE, une fois.
//
// ─── Ce qu'il refuse de laisser passer pour un vert ─────────────────────────
// Aucun objet déclaré, aucun objet lu, une exemption muette, périmée, ou qui
// cache un objet DÉCLARÉ : le script sort en 2 ou nomme un problème. Un type de
// contrainte que ce modèle ne couvre pas (`n`, les contraintes NOT NULL de
// PostgreSQL 18) n'est jamais tu : il est NOMMÉ à part (`unmodeled`), sans être
// compté comme une dérive — mais une ligne que le module n'arrive PAS à lire
// rend le verdict faux, parce qu'un objet non lu n'est pas un objet aligné.
//
// PUR, donc testé sans base (`tests/db-objects.test.ts`) : le découpage, la
// lecture des déclarations, la dérivation des noms implicites, la normalisation,
// et le verdict. Le script ne fait que lire et nommer.
// ─────────────────────────────────────────────────────────────────────────────
import { blankComments } from './schema-expected.mjs';
import { dropTableEvents, statementSpans } from './rls-policies.mjs';

/** Les trois familles comparées — nommées une fois, citées sans faute de frappe. */
export const OBJECT_KINDS = ['index', 'constraint', 'trigger'];

/** Les types de contrainte de `pg_constraint` que ce module modélise. */
export const CONSTRAINT_TYPES = {
  p: 'PRIMARY KEY',
  u: 'UNIQUE',
  f: 'FOREIGN KEY',
  c: 'CHECK',
  x: 'EXCLUDE',
};

/** Les types modélisés, dans un ordre stable (`pg_constraint` n'en donne aucun). */
const MODELED_TYPES = Object.keys(CONSTRAINT_TYPES).join('');

/**
 * Le nom de la famille d'objets, au pluriel RÉEL.
 *
 * `index` ne fait pas « indexs » : les familles déclarées sont `indexes`,
 * `constraints` et `triggers`, et c'est cette table — une seule, nommée une fois —
 * qui évite qu'une famille se perdre dans une chaîne construite à la main.
 */
export const OBJECT_FAMILIES = { index: 'indexes', constraint: 'constraints', trigger: 'triggers' };

/**
 * La clé d'un objet dans une comparaison.
 *
 * Les index sont uniques par SCHÉMA (Postgres impose l'unicité du nom) ; une
 * contrainte et un déclencheur sont uniques par TABLE (`pg_constraint` et
 * `pg_trigger` les distinguent par `conrelid`/`tgrelid`) — sans la table, une
 * contrainte posée ailleurs passerait pour la même.
 */
export function objectKey(kind, { schema = 'public', table = '', name = '' } = {}) {
  const clean = (value) => String(value ?? '').replace(/"/g, '').toLowerCase();
  if (kind === 'index') return `index::${clean(schema)}.${clean(name)}`;
  return `${kind}::${clean(schema)}.${clean(table)}::${clean(name)}`;
}

/** Un nom qualifié (`public.students`) → `{ schema, name }`, sans guillemets. */
export function splitQualified(name) {
  const parts = String(name ?? '')
    .split('.')
    .map((part) => part.replace(/"/g, '').trim())
    .filter(Boolean);
  if (parts.length === 0) return { schema: 'public', name: '' };
  if (parts.length === 1) return { schema: 'public', name: parts[0].toLowerCase() };
  return { schema: parts[parts.length - 2].toLowerCase(), name: parts[parts.length - 1].toLowerCase() };
}

/** Le rang de la parenthèse qui ferme celle ouverte à `openIndex`, ou `-1`. */
export function closeParen(text, openIndex) {
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
 * La fin d'un en-tête dans le texte d'ORIGINE.
 *
 * L'en-tête (`CREATE INDEX … ON public.t`) est repéré sur la vue APLATIE — les
 * espaces multiples et les commentaires n'y ont pas d'importance — mais les
 * expressions se lisent dans le texte d'origine, où les littéraux vivent. Les deux
 * vues ayant la même longueur (`blankComments`), on retrouve donc la fin de
 * l'en-tête en marchant sur la vue MASQUÉE jusqu'à avoir consommé le même contenu
 * hors espaces, et l'index obtenu vaut dans les deux vues.
 */
function headOffset(masked, flatHead) {
  const squeeze = (value) => value.replace(/\s+/g, '');
  const wanted = squeeze(flatHead);
  let consumed = '';
  let i = 0;
  while (i < masked.length && consumed.length < wanted.length) {
    consumed += squeeze(masked[i]);
    i += 1;
  }
  return i;
}

/**
 * Découpe une liste au niveau 0 en couples `{ masked, text }` alignés.
 *
 * La séparation se décide sur la vue MASQUÉE (commentaires et littéraux blanchis) :
 * une virgule dans `DEFAULT 'a,b'` ou dans un commentaire ne coupe pas un élément.
 * Le contenu de chaque élément est recopié du texte d'ORIGINE aux mêmes index —
 * c'est là que vivent les expressions qu'on veut pouvoir juger.
 */
export function splitTopLevelSpans(masked, text = masked) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push({ masked: masked.slice(start, i), text: String(text).slice(start, i) });
      start = i + 1;
    }
  }
  out.push({ masked: masked.slice(start), text: String(text).slice(start) });
  return out
    .map((span) => ({ masked: span.masked.trim(), text: span.text.trim() }))
    .filter((span) => span.masked.length > 0);
}

/** Un couple `masked`/`text` accepté sous forme de chaîne (utile aux tests). */
function views(span) {
  if (typeof span === 'string') return { masked: span, text: span };
  return { masked: String(span?.masked ?? ''), text: String(span?.text ?? '') };
}

/**
 * Le texte d'une définition, réduit à ce que Postgres en garde.
 *
 * Quatre réductions, chacune payée par une forme MESURÉE dans le dépôt ou dans le
 * catalogue :
 *   • `= ANY (ARRAY['a','b'])` → `IN ('a','b')` — la même règle, écrite par la base
 *     (`payments_motif_shape_check`, `user_profiles_role_check`) ;
 *   • `<> ALL (ARRAY['a','b'])` → `NOT IN ('a','b')` — la NÉGATION de la même
 *     règle, et le miroir qui manquait : le catalogue ne rend pas toujours un
 *     `NOT IN` écrit à la main sous la forme `NOT (… = ANY …)`, mais sous celle
 *     de l'opérateur négatif (mesuré le 2026-10-15 sur
 *     `app_settings_display_keys_check`, écrit `key NOT IN (…)` dans la migration
 *     et rendu `key <> ALL (ARRAY[…])`). Sans ce miroir, une contrainte que la
 *     migration venait d'écrire mot pour mot était signalée comme une dérive ;
 *   • les CASTS (`'x'::text`, `(months)::text`) : Postgres les rend, le dépôt ne
 *     les écrit pas — les comparer ferait de chaque contrainte une dérive ;
 *   • le schéma `public.` : absent du rendu du catalogue ;
 *   • les PARENTHÈSES et les espaces : `((months)::text ~ …)` et `months::text ~ …`
 *     disent la même chose. Elles sont remplacées par une ESPACE (jamais retirées) :
 *     `coalesce(a)` et `coalescea)` ne sont pas la même chose, et une réduction qui
 *     colle deux identifiants inventerait l'égalité qu'elle prétend vérifier.
 *
 * Les réductions de ponctuation s'arrêtent aux PORTES des LITTÉRAUX. C'est une
 * leçon déjà payée dans ce dépôt : le contrôle des politiques affichait
 * `role IN ( , )` pour une condition qu'il venait de blanchir, et plus personne ne
 * pouvait juger la dérive. Ici, `months::text ~ '^\{(\d{4}-(0[1-9]|1[0-2]))?…\}$'`
 * doit rester LISIBLE : les parenthèses et la casse d'une chaîne appartiennent à la
 * règle, pas à sa mise en forme.
 */
export function normalizeDefinition(value) {
  const rewritten = String(value ?? '')
    .replace(/\b([a-z_]\w*)\s*=\s*any\s*\(\s*array\s*\[([^\]]*)\]\s*\)/gi, '$1 in ($2)')
    .replace(/\b([a-z_]\w*)\s*=\s*any\s*\(\s*([^()]*)\)/gi, '$1 in ($2)')
    // La NÉGATION, sans quoi le miroir de la réduction ci-dessus n'existe que dans
    // un sens : `NOT IN` écrit par la migration sort du catalogue en `<> ALL`.
    .replace(/\b([a-z_]\w*)\s*(?:<>|!=)\s*all\s*\(\s*array\s*\[([^\]]*)\]\s*\)/gi, '$1 not in ($2)')
    .replace(/\b([a-z_]\w*)\s*(?:<>|!=)\s*all\s*\(\s*([^()]*)\)/gi, '$1 not in ($2)')
    // `x BETWEEN a AND b` → `x >= a AND x <= b` : Postgres rend l'idiome ÉCLATÉ
    // (mesuré sur `station_versions` le 2026-10-18 —
    // `((char_length(app_version) >= 1) AND (char_length(app_version) <= 32))`
    // pour un `BETWEEN 1 AND 32`), et l'opérande de gauche y est RÉPÉTÉ. Seules
    // les bornes SIMPLES sont réduites (littéral, nombre) : une borne composée
    // reste intacte, donc une vraie différence est SIGNALÉE plutôt que blanchie —
    // le refus est du bon côté.
    .replace(
      /\b([a-z_]\w*(?:\s*\(\s*[a-z_]\w*(?:\s*,\s*[a-z_]\w*)*\s*\))?)\s+between\s+('[^']*'|[-+]?\d+(?:\.\d+)?)\s+and\s+('[^']*'|[-+]?\d+(?:\.\d+)?)/gi,
      '$1 >= $2 and $1 <= $3',
    )
    .replace(/::\s*"?[a-z_][a-z0-9_]*"?(\s*\[\])?(\s*\(\s*\d+(\s*,\s*\d+)?\s*\))?/gi, '')
    .replace(/\bpublic\./gi, '')
    .replace(/"/g, ' ');
  return literalSegments(rewritten)
    .map((segment) =>
      segment.literal
        ? segment.value
        : segment.value.toLowerCase().replace(/[()]/g, ' ').replace(/\s*,\s*/g, ','),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Découpe un texte SQL en segments de CODE et de LITTÉRAL.
 *
 * Les apostrophes doublées (`''`) restent dans le littéral : c'est la seule façon
 * de ne pas confondre la fin d'une chaîne avec l'échappement d'une apostrophe
 * (`'l''économe'`), défaut que ce dépôt a déjà payé deux fois.
 */
export function literalSegments(text) {
  const segments = [];
  let code = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      if (code) segments.push({ literal: false, value: code });
      code = '';
      let literal = "'";
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          literal += "''";
          i += 2;
          continue;
        }
        literal += text[i];
        i += 1;
        if (literal.endsWith("'")) break;
      }
      segments.push({ literal: true, value: literal });
      continue;
    }
    code += text[i];
    i += 1;
  }
  if (code) segments.push({ literal: false, value: code });
  return segments;
}

/**
 * La forme LISIBLE d'une définition — celle qu'un humain doit pouvoir juger.
 *
 * La comparaison se fait sur la forme normalisée, mais le rapport montre CE QUI
 * EST ÉCRIT : une dérive de contrainte se juge sur l'expression, et une expression
 * dépouillée de ses parenthèses et de ses littéraux ne dit plus rien.
 */
export function readableDefinition(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Les éléments d'une liste SQL (colonnes d'un index, d'une clé), DANS L'ORDRE.
 *
 * L'ordre compte : `UNIQUE (a, b)` et `UNIQUE (b, a)` sont deux contraintes —
 * contrairement à `a AND b` et `b AND a`, qui sont la même condition. Chaque
 * élément est normalisé séparément, donc les virgules INTERNES (`coalesce(x, '')`)
 * ne séparent rien.
 */
export function definitionItems(value) {
  return splitTopLevelSpans(String(value ?? '')).map((item) => normalizeDefinition(item.masked));
}

/** Les mêmes éléments, dans leur forme LISIBLE (pour le rapport). */
export function readableItems(value) {
  return splitTopLevelSpans(String(value ?? '')).map((item) => readableDefinition(item.masked));
}

// ─── La lecture des déclarations ─────────────────────────────────────────────

/** Une instruction `CREATE [UNIQUE] INDEX … [WHERE …]`, découpée. */
export function parseCreateIndex(span) {
  const { masked, text } = views(span);
  const flat = masked.replace(/\s+/g, ' ').trim();
  const head =
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)\s+ON\s+([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)([\s\S]*)$/i.exec(
      flat,
    );
  if (!head) return null;
  const indexName = splitQualified(head[2].replace(/\s+/g, ''));
  const target = splitQualified(head[3].replace(/\s+/g, ''));
  // Expressions et prédicat se recopient du texte d'ORIGINE : c'est là que vivent
  // les littéraux (`lower(btrim(name))`, `WHERE recorded_offline`). L'en-tête est
  // celui qui PRÉCÈDE le groupe final — `head[0]` va jusqu'à la fin de
  // l'instruction (le dernier groupe est gourmand), et le prendre entier rendait
  // une queue vide : le contrôle comparait alors deux index sans expressions.
  const rest = text.slice(headOffset(masked, head[0].slice(0, head[0].length - head[4].length)));
  const open = rest.indexOf('(');
  if (open === -1) return null;
  const close = closeParen(rest, open);
  if (close === -1) return null;
  const predicate = /^WHERE\s+([\s\S]+)$/i.exec(rest.slice(close + 1).trim())?.[1] ?? null;
  const expressions = rest.slice(open + 1, close);
  return {
    kind: 'index',
    name: indexName.name,
    schema: target.schema,
    table: target.name,
    unique: Boolean(head[1]),
    method: /\bUSING\s+([A-Za-z_]\w*)/i.exec(head[4])?.[1]?.toLowerCase() ?? 'btree',
    items: definitionItems(expressions),
    itemsText: readableItems(expressions),
    predicate: predicate === null ? null : normalizeDefinition(predicate),
    predicateText: predicate === null ? null : readableDefinition(predicate),
  };
}

/** Les `DROP INDEX` d'une instruction — Postgres en accepte plusieurs d'un coup. */
export function parseDropIndexes(span) {
  const { masked } = views(span);
  const flat = masked.replace(/\s+/g, ' ').trim();
  const match = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\s\S]+)$/i.exec(flat);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((name) => splitQualified(name.trim()))
    .filter((entry) => entry.name);
}

/** Le type d'une contrainte à partir de son premier mot-clé, ou `null`. */
function constraintType(keyword) {
  const flat = String(keyword ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (flat.startsWith('PRIMARY')) return 'p';
  if (flat.startsWith('UNIQUE')) return 'u';
  if (flat.startsWith('FOREIGN')) return 'f';
  if (flat.startsWith('CHECK')) return 'c';
  if (flat.startsWith('EXCLUDE')) return 'x';
  return null;
}

/** La liste de colonnes d'une contrainte, dans l'ordre, ou `null` pour un CHECK. */
function constraintColumns(type, tail) {
  if (type === 'c') return null;
  const open = String(tail).indexOf('(');
  if (open === -1) return null;
  const close = closeParen(String(tail), open);
  if (close === -1) return null;
  return definitionItems(String(tail).slice(open + 1, close));
}

/**
 * Le nom que Postgres DONNE à une contrainte que le SQL n'a pas nommée.
 *
 * Les règles sont celles du serveur, et elles sont employées au lieu d'une liste
 * recopiée du catalogue : `<table>_pkey`, `<table>_<colonnes>_key`,
 * `<table>_<colonnes>_fkey`, `<table>_<colonne>_check`, `<table>_check`, et un
 * suffixe numérique quand le nom est déjà pris — le corpus s'en remet à lui
 * partout (`id UUID PRIMARY KEY`, `student_id TEXT UNIQUE`, `parent_id UUID
 * REFERENCES …`).
 *
 * @param {string} table
 * @param {string} base `pkey`, `key`, `fkey`, `check`, `exclude`
 * @param {string[]} columns les colonnes de la contrainte (vides pour un CHECK de table)
 * @param {Set<string>} used les noms déjà attribués DANS cette table
 */
export function implicitConstraintName(table, base, columns, used = new Set()) {
  const suffix = columns.length > 0 ? `${columns.join('_')}_${base}` : base;
  const root = `${table}_${suffix}`.toLowerCase();
  if (!used.has(root)) return root;
  let index = 1;
  while (used.has(`${root}${index}`)) index += 1;
  return `${root}${index}`;
}

/**
 * Une contrainte déclarée, réduite à ce qui sera comparé ET à ce qui sera montré.
 *
 * `definition` sert à COMPARER (normalisée) ; `display` sert à MONTRER (telle
 * qu'écrite). Les deux sont conservées parce que le rapport est lu par un humain
 * qui doit juger une dérive : une expression dépouillée de ses parenthèses et de
 * ses littéraux ne dit plus rien (leçon déjà payée sur les politiques).
 */
function constraintRecord(type, name, body) {
  // Le mot-clé n'est ajouté QUE s'il manque : un `ADD CONSTRAINT x CHECK (…)`
  // porte déjà le sien, et le préfixer deux fois rendait `CHECK CHECK (…)` — la
  // comparaison des quatre contraintes CHECK du dépôt échouait alors sur une
  // dérive qui n'existait que dans ce module.
  const text = readableDefinition(body);
  const keyword = CONSTRAINT_TYPES[type];
  const declared = new RegExp(`^${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text) ? text : `${keyword} ${text}`;
  return {
    name,
    type,
    definition: normalizeDefinition(declared),
    display: declared,
    columns: constraintColumns(type, declared),
  };
}

/**
 * Les contraintes d'une définition de COLONNE (`id UUID PRIMARY KEY REFERENCES …`).
 *
 * `NOT NULL` et `DEFAULT` ne produisent RIEN : PostgreSQL 17 ne les inscrit pas
 * dans `pg_constraint` (mesuré sur la base de l'école : `user_profiles.role` est
 * `NOT NULL DEFAULT 'staff'` et n'y figure pas). Le jour où le dépôt viserait
 * PostgreSQL 18 — qui, lui, y met les contraintes NOT NULL — ces lignes
 * apparaîtraient en « hors modèle » plutôt que d'être prises pour une dérive.
 */
export function columnConstraints(column, tail, table, used = new Set()) {
  const out = [];
  const push = (type, name, body) => {
    used.add(name);
    out.push(constraintRecord(type, name, body));
  };

  if (/\bPRIMARY\s+KEY\b/i.test(tail)) push('p', implicitConstraintName(table, 'pkey', [], used), `PRIMARY KEY (${column})`);
  if (/\bUNIQUE\b/i.test(tail)) push('u', implicitConstraintName(table, 'key', [column], used), `UNIQUE (${column})`);
  const references = /\bREFERENCES\s+([\s\S]+)$/i.exec(tail)?.[1] ?? null;
  if (references) push('f', implicitConstraintName(table, 'fkey', [column], used), `FOREIGN KEY (${column}) REFERENCES ${references}`);

  // Plusieurs CHECK sur une même colonne reçoivent un suffixe numérique, comme
  // Postgres les nomme : on les parcourt dans l'ordre du texte.
  for (const check of tail.matchAll(/\bCHECK\s*\(/gi)) {
    const open = tail.indexOf('(', check.index);
    const close = closeParen(tail, open);
    if (open === -1 || close === -1) continue;
    push('c', implicitConstraintName(table, 'check', [column], used), `CHECK (${tail.slice(open + 1, close)})`);
  }
  return out;
}

/** Les contraintes d'une liste d'éléments de `CREATE TABLE` / `ADD …`. */
function constraintsFromItems(items, table, used = new Set()) {
  const out = [];
  for (const item of items) {
    const named = /^CONSTRAINT\s+("[^"]+"|[A-Za-z_]\w*)\s+([\s\S]+)$/i.exec(item.masked);
    if (named) {
      const type = constraintType(named[2]);
      if (!type) continue;
      const name = named[1].replace(/"/g, '');
      used.add(name.toLowerCase());
      // Le texte APRÈS le nom porte DÉJÀ son mot-clé (« CHECK (…) ») : le
      // préfixer ici le doublait, et `constraintRecord` — qui n'ajoute le
      // mot-clé que s'il manque — recevait alors `CHECK CHECK (…)`. Les
      // contraintes NOMMÉES du dépôt sont précisément celles qu'`ALTER TABLE …
      // ADD CONSTRAINT` pose : toutes étaient signalées CHANGÉES, sur une dérive
      // qui n'existait que dans ce module.
      out.push(constraintRecord(type, name, item.text.slice(item.text.length - named[2].length)));
      continue;
    }
    const tableLevel = /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)\b([\s\S]*)$/i.exec(item.masked);
    if (tableLevel) {
      const type = constraintType(tableLevel[1]);
      if (!type) continue;
      const tail = item.text.slice(item.text.length - tableLevel[2].length);
      const columns = constraintColumns(type, tail) ?? [];
      const base = `${{ p: 'pkey', u: 'key', f: 'fkey', x: 'exclude' }[type] ?? 'check'}`;
      const name = implicitConstraintName(table, base, columns, used);
      used.add(name);
      out.push(constraintRecord(type, name, `${CONSTRAINT_TYPES[type]} ${tail}`));
      continue;
    }
    const column = /^("[^"]+"|[A-Za-z_]\w*)\s+([\s\S]+)$/.exec(item.masked);
    if (!column) continue;
    const tail = item.text.slice(item.text.length - column[2].length);
    for (const constraint of columnConstraints(column[1].replace(/"/g, '').toLowerCase(), tail, table, used)) out.push(constraint);
  }
  return out;
}

/**
 * Les instructions qui touchent une TABLE : création (et ses contraintes
 * implicites), ajouts et retraits.
 *
 * Les contraintes implicites sont nommées à l'instant de la DÉCLARATION, comme
 * Postgres le fait : `usedForTable` porte donc les noms déjà pris dans cette table
 * (les noms explicites le rejoignent), sinon deux CHECK sur la même colonne
 * recevraient le même nom et l'un des deux écraserait l'autre — un faux « absent »
 * doublé d'un faux « en trop ».
 *
 * @param {string|{ masked: string, text: string }} span
 * @param {(table: string) => Set<string>} usedForTable
 */
export function parseTableStatement(span, usedForTable = () => new Set()) {
  const { masked, text } = views(span);
  const flat = masked.replace(/\s+/g, ' ').trim();

  // La parenthèse est cherchée APRÈS l'en-tête (le `\s*\(` du motif la incluait,
  // et `indexOf` trouvait alors celle d'un défaut de colonne — `uuid_generate_v4(` —
  // si bien qu'aucune contrainte n'était lue).
  const created = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)\s*/i.exec(flat);
  if (created) {
    const target = splitQualified(created[1].replace(/\s+/g, ''));
    const used = usedForTable(target.name);
    const after = headOffset(masked, created[0]);
    const open = masked.indexOf('(', after);
    // `CREATE TABLE … AS SELECT` : la table existe sans qu'une seule colonne soit
    // écrite, donc sans contrainte à déclarer. La parenthèse TROUVÉE doit être
    // celle de la table — un `(` plus loin appartient à un défaut de colonne.
    if (open === -1 || masked.slice(after, open).trim().length > 0) {
      return { action: 'create', table: target.name, schema: target.schema, constraints: [] };
    }
    const close = closeParen(masked, open);
    if (close === -1) return null;
    const items = splitTopLevelSpans(masked.slice(open + 1, close), text.slice(open + 1, close));
    return { action: 'create', table: target.name, schema: target.schema, constraints: constraintsFromItems(items, target.name, used) };
  }

  const altered = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)([\s\S]*)$/i.exec(flat);
  if (altered) {
    const target = splitQualified(altered[1].replace(/\s+/g, ''));
    const used = usedForTable(target.name);
    // Le groupe final est gourmand : les ACTIONS se lisent donc après l'en-tête
    // seul (`alter\.table\.nom`), jamais après le match entier — mesuré : prendre
    // le match entier rendait une liste d'actions VIDE, et les contraintes du
    // dépôt (toutes posées par `ALTER TABLE … ADD CONSTRAINT`) étaient invisibles.
    const tailAt = headOffset(masked, altered[0].slice(0, altered[0].length - altered[2].length));
    const actions = splitTopLevelSpans(masked.slice(tailAt), text.slice(tailAt));
    const constraints = [];
    const drops = [];
    const droppedColumns = [];
    for (const action of actions) {
      const addConstraint = /^ADD\s+CONSTRAINT\s+("[^"]+"|[A-Za-z_]\w*)\s+([\s\S]+)$/i.exec(action.masked);
      if (addConstraint) {
        const type = constraintType(addConstraint[2]);
        if (!type) continue;
        const name = addConstraint[1].replace(/"/g, '');
        used.add(name.toLowerCase());
        // Même piège que dans `constraintsFromItems` : le mot-clé est DANS le
        // texte qui suit le nom, jamais ajouté par-dessus.
        constraints.push(constraintRecord(type, name, action.text.slice(action.text.length - addConstraint[2].length)));
        continue;
      }
      const addTableLevel = /^ADD\s+(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)\b([\s\S]*)$/i.exec(action.masked);
      if (addTableLevel) {
        const type = constraintType(addTableLevel[1]);
        if (!type) continue;
        const tail = action.text.slice(action.text.length - addTableLevel[2].length);
        const columns = constraintColumns(type, tail) ?? [];
        const base = `${{ p: 'pkey', u: 'key', f: 'fkey', x: 'exclude' }[type] ?? 'check'}`;
        const name = implicitConstraintName(target.name, base, columns, used);
        used.add(name);
        constraints.push(constraintRecord(type, name, `${CONSTRAINT_TYPES[type]} ${tail}`));
        continue;
      }
      const addColumn = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[A-Za-z_]\w*)\s+([\s\S]+)$/i.exec(action.masked);
      if (addColumn) {
        const tail = action.text.slice(action.text.length - addColumn[2].length);
        for (const constraint of columnConstraints(addColumn[1].replace(/"/g, '').toLowerCase(), tail, target.name, used)) constraints.push(constraint);
        continue;
      }
      const dropConstraint = /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_]\w*)$/i.exec(action.masked);
      if (dropConstraint) {
        const name = dropConstraint[1].replace(/"/g, '').toLowerCase();
        used.delete(name);
        drops.push({ type: 'constraint', name });
        continue;
      }
      const dropColumn = /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_]\w*)$/i.exec(action.masked);
      if (dropColumn) droppedColumns.push(dropColumn[1].replace(/"/g, '').toLowerCase());
    }
    return { action: 'alter', table: target.name, schema: target.schema, constraints, drops, columns: droppedColumns };
  }

  const dropped = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)/i.exec(flat);
  if (dropped) {
    const target = splitQualified(dropped[1].replace(/\s+/g, ''));
    return { action: 'drop', table: target.name, schema: target.schema };
  }
  return null;
}

/** Une instruction `CREATE TRIGGER` découpée. */
export function parseCreateTrigger(span) {
  const { masked, text } = views(span);
  const flat = masked.replace(/\s+/g, ' ').trim();
  const head =
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+("[^"]+"|[A-Za-z_]\w*)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]*?)\s+ON\s+([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)([\s\S]*)$/i.exec(
      flat,
    );
  if (!head) return null;
  const target = splitQualified(head[4].replace(/\s+/g, ''));
  const events = head[3]
    .split(/\s+OR\s+/i)
    .map((event) => event.replace(/\s+/g, ' ').trim().toUpperCase())
    .filter(Boolean);
  // Structure sur la vue MASQUÉE, contenu du WHEN sur le texte d'ORIGINE : un
  // littéral dans la condition (`WHEN (new.status = 'payé')`) fait partie de la
  // règle, et une vue qui le blanchit comparerait deux conditions vides.
  // Le groupe final est gourmand : l'en-tête s'arrête donc AVANT lui. Le prendre
  // entier (mesuré à la première écriture) rendait une queue VIDE, et les quatre
  // déclencheurs du dépôt se comparaient alors sur des champs vides — un vert qui
  // ne regardait rien, exactement ce que ce contrôle existe pour empêcher.
  const tailAt = headOffset(masked, head[0].slice(0, head[0].length - head[5].length));
  const maskedTail = masked.slice(tailAt);
  const originalTail = text.slice(tailAt);
  const whenAt = /\bWHEN\s*\(/i.exec(maskedTail);
  let when = null;
  if (whenAt) {
    const open = maskedTail.indexOf('(', whenAt.index);
    const close = closeParen(maskedTail, open);
    if (open !== -1 && close !== -1) when = normalizeDefinition(originalTail.slice(open + 1, close));
  }
  return {
    kind: 'trigger',
    name: head[1].replace(/"/g, ''),
    schema: target.schema,
    table: target.name,
    timing: head[2].replace(/\s+/g, ' ').toUpperCase(),
    events: [...new Set(events)].sort(),
    orientation: /FOR\s+EACH\s+(ROW|STATEMENT)/i.exec(maskedTail)?.[1]?.toUpperCase() ?? 'STATEMENT',
    functionName: normalizeDefinition(
      splitQualified(/EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)/i.exec(maskedTail)?.[1] ?? '').name,
    ),
    when,
    enabled: true,
  };
}

/** Un `DROP TRIGGER [IF EXISTS] name ON table`. */
export function parseDropTrigger(span) {
  const { masked } = views(span);
  const match = /^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_]\w*)\s+ON\s+([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)/i.exec(
    masked.replace(/\s+/g, ' ').trim(),
  );
  if (!match) return null;
  const target = splitQualified(match[2].replace(/\s+/g, ''));
  return { name: match[1].replace(/"/g, ''), schema: target.schema, table: target.name };
}

// ─── La lecture du catalogue ────────────────────────────────────────────────

/** Un `pg_get_indexdef` découpé — la même forme que `parseCreateIndex`. */
export function parseIndexDef(sql) {
  const text = String(sql ?? '').replace(/\s+/g, ' ').trim();
  const head = /^CREATE\s+(UNIQUE\s+)?INDEX\s+("[^"]+"|[A-Za-z_]\w*)\s+ON\s+([A-Za-z_"]\w*(?:\s*\.\s*[A-Za-z_"]\w*)?)([\s\S]*)$/i.exec(text);
  if (!head) return null;
  const target = splitQualified(head[3].replace(/\s+/g, ''));
  const rest = head[4];
  const open = rest.indexOf('(');
  if (open === -1) return null;
  const close = closeParen(rest, open);
  if (close === -1) return null;
  const predicate = /^WHERE\s+([\s\S]+)$/i.exec(rest.slice(close + 1).trim())?.[1] ?? null;
  const expressions = rest.slice(open + 1, close);
  return {
    kind: 'index',
    name: head[2].replace(/"/g, ''),
    schema: target.schema,
    table: target.name,
    unique: Boolean(head[1]),
    method: /\bUSING\s+([A-Za-z_]\w*)/i.exec(rest)?.[1]?.toLowerCase() ?? 'btree',
    items: definitionItems(expressions),
    itemsText: readableItems(expressions),
    predicate: predicate === null ? null : normalizeDefinition(predicate),
    predicateText: predicate === null ? null : readableDefinition(predicate),
  };
}

/** Un `pg_get_constraintdef` découpé. */
export function parseConstraintDef(sql) {
  const text = String(sql ?? '').replace(/\s+/g, ' ').trim();
  const type = constraintType(text);
  if (!type) return null;
  return { type, definition: normalizeDefinition(text), display: readableDefinition(text), columns: constraintColumns(type, text) };
}

/** Un `pg_get_triggerdef` découpé, plus son état (`tgenabled`). */
export function parseTriggerDef(sql, { enabled = true } = {}) {
  const parsed = parseCreateTrigger({ masked: String(sql ?? ''), text: String(sql ?? '') });
  if (!parsed) return null;
  return { ...parsed, enabled: Boolean(enabled) };
}

/**
 * Les objets RÉELS de la base, réduits à la forme des objets déclarés.
 *
 * Trois choses sont écartées ICI, et chacune pour une raison nommée :
 *   • l'index d'une contrainte (`constraint_owned`) : il EST la clé primaire ou la
 *     contrainte UNIQUE, comptée du côté contrainte — le compter deux fois ferait
 *     une dérive par table ;
 *   • un type de contrainte que le modèle ne connaît pas : il est rendu à part
 *     (`unmodeled`) pour être NOMMÉ, jamais comparé en silence ;
 *   • une ligne que le module n'arrive pas à lire : elle rend le verdict faux
 *     (`unreadable`), parce qu'un catalogue illisible n'est pas un catalogue aligné.
 *
 * @param {{ indexes?: object[], constraints?: object[], triggers?: object[] }} rows
 * @returns {{ indexes: Map<string, object>, constraints: Map<string, object>,
 *   triggers: Map<string, object>, unmodeled: object[], unreadable: object[] }}
 */
export function hostedObjectsFromRows({ indexes = [], constraints = [], triggers = [] } = {}) {
  const out = { indexes: new Map(), constraints: new Map(), triggers: new Map(), unmodeled: [], unreadable: [] };

  for (const row of indexes) {
    // `constraint_owned` est lu ici et non dans le SQL : c'est une décision de
    // COMPARAISON (« l'index d'une clé n'est pas un index déclaré »), donc elle
    // appartient au module pur, où un test la fixe.
    if (row?.constraint_owned) continue;
    const parsed = parseIndexDef(row?.definition);
    if (!parsed) {
      out.unreadable.push({ kind: 'index', name: String(row?.indexname ?? '') });
      continue;
    }
    out.indexes.set(objectKey('index', { schema: parsed.schema, name: String(row?.indexname ?? parsed.name) }), {
      ...parsed,
      name: String(row?.indexname ?? parsed.name),
    });
  }

  for (const row of constraints) {
    const type = String(row?.contype ?? '').trim();
    if (!MODELED_TYPES.includes(type)) {
      out.unmodeled.push({ kind: 'constraint', table: String(row?.tablename ?? ''), name: String(row?.conname ?? ''), type });
      continue;
    }
    const parsed = parseConstraintDef(row?.definition);
    if (!parsed) {
      out.unreadable.push({ kind: 'constraint', table: String(row?.tablename ?? ''), name: String(row?.conname ?? '') });
      continue;
    }
    const record = {
      kind: 'constraint',
      schema: String(row?.schema ?? 'public').toLowerCase(),
      table: String(row?.tablename ?? '').toLowerCase(),
      name: String(row?.conname ?? ''),
      ...parsed,
    };
    out.constraints.set(objectKey('constraint', record), record);
  }

  for (const row of triggers) {
    const parsed = parseTriggerDef(row?.definition, { enabled: String(row?.tgenabled ?? 'O') !== 'D' });
    if (!parsed) {
      out.unreadable.push({ kind: 'trigger', table: String(row?.tablename ?? ''), name: String(row?.tgname ?? '') });
      continue;
    }
    const record = {
      ...parsed,
      schema: String(row?.schema ?? parsed.schema).toLowerCase(),
      table: String(row?.tablename ?? parsed.table).toLowerCase(),
      name: String(row?.tgname ?? parsed.name),
    };
    out.triggers.set(objectKey('trigger', record), record);
  }
  return out;
}

// ─── Le rejeu des migrations ────────────────────────────────────────────────

/**
 * Ce que les migrations LAISSENT en base, famille par famille.
 *
 * Les fichiers sont rejoués DANS L'ORDRE DONNÉ (leur préfixe est un horodatage :
 * `db:snapshot:check` et `db:apply` s'appuient déjà sur cet ordre) : `CREATE`
 * (re)pose, `DROP` retire, et un `DROP TABLE` emporte TOUT ce qui était déclaré
 * sur cette table — y compris quand il est écrit dans un bloc `DO $$ … $$`, que le
 * découpage saute par construction. Le retrait est NOMMÉ (`retired`) plutôt que
 * silencieux : c'est la leçon de `custom_grades`, où réclamer une politique
 * impossible a coûté une relecture entière du contrôle des politiques.
 *
 * Il rend aussi les TABLES que le corpus connaît (`tables`) : `created` pour celles
 * qu'il CRÉE (leurs index et contraintes sont donc de son ressort), et les autres
 * pour celles qu'un objet déclaré CIBLE sans les créer — `auth.users`, où vit le
 * déclencheur de création de profil. C'est ce qui borne la lecture du catalogue :
 * comparer les contraintes des tables `auth.*` que Supabase gère n'aurait aucun
 * sens, et les compter comme « en trop » enterrerait les vraies dérives.
 *
 * @param {{ name?: string, sql?: string }[]} migrations
 * @returns {{ declared: { indexes: Map<string, object>, constraints: Map<string, object>,
 *   triggers: Map<string, object> }, tables: Map<string, object>, retired: object[] }}
 */
export function declaredObjectsAndRetired(migrations = []) {
  const declared = { indexes: new Map(), constraints: new Map(), triggers: new Map() };
  const tables = new Map();
  const retired = [];
  const usedNames = new Map();

  const tableKey = (schema, table) => `${schema}.${table}`;
  const noteTable = (schema, table, created) => {
    const key = tableKey(schema, table);
    const known = tables.get(key);
    tables.set(key, { schema, table, created: Boolean(known?.created) || created });
  };

  const usedFor = (table) => {
    if (!usedNames.has(table)) usedNames.set(table, new Set());
    return usedNames.get(table);
  };

  const add = (record, file) => {
    declared[OBJECT_FAMILIES[record.kind]].set(objectKey(record.kind, record), { ...record, file });
    if (record.kind === 'constraint') usedFor(record.table).add(record.name.toLowerCase());
    noteTable(record.schema, record.table, false);
  };

  /**
   * Retirer un objet déclaré, en NOMMANT la cause.
   *
   * La cause n'est pas un détail de forme : « plus réclamé parce qu'un `DROP`
   * explicite le retire » et « plus réclamé parce que sa TABLE est retirée » sont
   * deux faits différents, et la sortie les dit séparément — un contrôle qui
   * renonce en silence serait la faute que ce dépôt pourchasse.
   */
  const retire = (kind, matcher, droppedBy, cause = 'drop-object') => {
    const family = declared[OBJECT_FAMILIES[kind]];
    for (const key of [...family.keys()]) {
      const record = family.get(key);
      if (!matcher(record)) continue;
      family.delete(key);
      retired.push({ kind, schema: record.schema, table: record.table, name: record.name, declaredBy: record.file, droppedBy, cause });
    }
  };

  for (const migration of migrations) {
    const file = String(migration?.name ?? '');
    const sql = String(migration?.sql ?? '');

    for (const span of statementSpans(sql)) {
      const flat = span.masked.replace(/\s+/g, ' ').trim();

      const index = parseCreateIndex(span);
      if (index) {
        add(index, file);
        continue;
      }
      if (/^DROP\s+INDEX\b/i.test(flat)) {
        for (const dropped of parseDropIndexes(span)) {
          retire('index', (record) => record.name.toLowerCase() === dropped.name, file);
        }
        continue;
      }
      const trigger = parseCreateTrigger(span);
      if (trigger) {
        add(trigger, file);
        continue;
      }
      const droppedTrigger = parseDropTrigger(span);
      if (droppedTrigger) {
        retire(
          'trigger',
          (record) => record.name === droppedTrigger.name && record.table === droppedTrigger.table && record.schema === droppedTrigger.schema,
          file,
        );
        continue;
      }
      // Un `DROP TABLE` écrit dans un bloc `DO $$ … $$` est invisible au découpage
      // (il saute les corps) : il est donc cherché DANS chaque instruction, à sa
      // PLACE dans l'ordre du fichier. Le chercher après la boucle — première
      // écriture — retirait les objets d'un `CREATE` situé PLUS LOIN dans le même
      // fichier : `DROP TABLE t; CREATE TABLE t (id UUID PRIMARY KEY);` laissait
      // `t` sans sa clé, et le contrôle réclamait une contrainte que sa propre
      // lecture venait d'effacer. C'est la règle que le contrôle des politiques a
      // déjà payée : l'ordre DANS le même fichier décide.
      for (const dropped of dropTableEvents(span.text)) {
        retireTable({ table: dropped.table, schema: 'public' }, file, true);
        tables.delete(tableKey('public', dropped.table));
      }

      const table = parseTableStatement(span, usedFor);
      if (!table) continue;

      if (table.action === 'drop') {
        retireTable(table, file);
        tables.delete(tableKey(table.schema, table.table));
        continue;
      }
      if (table.action === 'create') {
        noteTable(table.schema, table.table, true);
        // Une table (re)créée repart de zéro : Postgres n'aurait gardé aucune
        // contrainte de sa vie antérieure, et un `CREATE TABLE IF NOT EXISTS`
        // rejoué ne les repose pas davantage. Les noms implicites se réattribuent
        // donc depuis un ensemble vide — sinon le second passage dériverait
        // `payments_pkey1` pour une table que Postgres nomme `payments_pkey`.
        usedNames.delete(table.table);
        for (const constraint of table.constraints ?? []) {
          add({ kind: 'constraint', schema: table.schema, table: table.table, ...constraint }, file);
        }
        continue;
      }
      for (const drop of table.drops ?? []) {
        retire('constraint', (record) => record.table === table.table && record.name.toLowerCase() === drop.name, file);
      }
      for (const column of table.columns ?? []) {
        // Une colonne retirée emporte ses contraintes ET ses index (Postgres les
        // supprime avec elle). Repérage best-effort, et NOMMÉ : les contraintes
        // qui la listent dans leurs colonnes, les CHECK et les index dont
        // l'expression porte son nom. Sans ça, un index déclaré sur une colonne
        // retirée resterait réclamé à jamais — une dérive permanente que personne
        // ne pourrait réparer, puisqu'il n'y a plus de colonne à indexer.
        const names = new RegExp(`(^|[^a-z0-9_])${column}([^a-z0-9_]|$)`);
        retire(
          'constraint',
          (record) =>
            record.table === table.table &&
            (((record.columns ?? []).includes(column)) || (record.type === 'c' && names.test(record.definition))),
          file,
          'drop-column',
        );
        retire(
          'index',
          (record) => record.table === table.table && (record.items ?? []).some((item) => names.test(item)),
          file,
          'drop-column',
        );
      }
      for (const constraint of table.constraints ?? []) {
        add({ kind: 'constraint', schema: table.schema, table: table.table, ...constraint }, file);
      }
    }

  }

  /** Le retrait des objets d'une table (déclaration) — jamais silencieux. */
  function retireTable(table, droppedBy, anySchema = false) {
    const matches = (record) => record.table === table.table && (anySchema || record.schema === table.schema);
    retire('index', matches, droppedBy, 'drop-table');
    retire('constraint', matches, droppedBy, 'drop-table');
    retire('trigger', matches, droppedBy, 'drop-table');
    usedNames.delete(table.table);
  }

  return { declared, tables, retired };
}

/**
 * Les TABLES à lire dans le catalogue, par famille.
 *
 *   • index et contraintes : les tables que le corpus CRÉE (`created`) — les
 *     objets d'une table qu'il ne possède pas ne sont pas les siens (les
 *     contraintes de `auth.users` sont celles de Supabase, et les compter comme
 *     « en trop » enterrerait les vraies dérives) ;
 *   • déclencheurs : toute table qu'un déclencheur déclaré CIBLE, `auth.users`
 *     compris — un déclencheur absent sur la table des comptes est une panne
 *     silencieuse (aucun profil créé), et c'est justement celle-là qu'on veut
 *     voir.
 */
export function watchedTables(tables = new Map()) {
  const owned = { tables: new Set(), schemas: new Set() };
  const targeted = { tables: new Set(), schemas: new Set() };
  for (const entry of tables.values()) {
    targeted.tables.add(entry.table);
    targeted.schemas.add(entry.schema);
    if (!entry.created) continue;
    owned.tables.add(entry.table);
    owned.schemas.add(entry.schema);
  }
  const dump = (bag) => ({ tables: [...bag.tables].sort(), schemas: [...bag.schemas].sort() });
  return { owned: dump(owned), targeted: dump(targeted) };
}

// ─── Le verdict ─────────────────────────────────────────────────────────────

/** Une valeur réduite à une forme lisible (jamais `undefined`). */
const readable = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  return String(value);
};

/**
 * Les différences entre un objet déclaré et l'objet porté par la base.
 *
 * La COMPARAISON porte sur la forme normalisée (`definition`, `items`, `predicate`),
 * le RAPPORT sur la forme écrite (`display`, `itemsText`, `predicateText`) : montrer
 * la définition dépouillée ferait juger une dérive sur un texte que personne n'a
 * écrit, alors que c'est l'expression réelle qui dit quelle règle s'applique.
 */
function differencesOf(kind, want, have) {
  const differences = [];
  const compare = (field, declared, base, shown = {}) => {
    if (readable(declared) === readable(base)) return;
    differences.push({
      field,
      declared: readable(shown.declared === undefined ? declared : shown.declared),
      base: readable(shown.base === undefined ? base : shown.base),
    });
  };
  if (kind === 'index') {
    compare('unicité', want.unique, have.unique);
    compare('méthode', want.method, have.method);
    compare('colonnes', want.items.join(', '), have.items.join(', '), {
      declared: (want.itemsText ?? want.items).join(', '),
      base: (have.itemsText ?? have.items).join(', '),
    });
    compare('prédicat', want.predicate, have.predicate, { declared: want.predicateText, base: have.predicateText });
  } else if (kind === 'constraint') {
    compare('type', CONSTRAINT_TYPES[want.type] ?? want.type, CONSTRAINT_TYPES[have.type] ?? have.type);
    compare('définition', want.definition, have.definition, { declared: want.display, base: have.display });
  } else {
    compare('moment', want.timing, have.timing);
    compare('événements', want.events.join(' OR '), have.events.join(' OR '));
    compare('portée', want.orientation, have.orientation);
    compare('fonction', want.functionName, have.functionName);
    compare('condition', want.when, have.when);
    compare('état', want.enabled, have.enabled);
  }
  return differences;
}

/** Une ligne courte pour décrire un objet en trop (ce qu'il est, à quoi il tient). */
export function describeObject(kind, have) {
  if (kind === 'index') {
    const items = (have.itemsText ?? have.items).join(', ');
    const predicate = have.predicateText ?? have.predicate;
    return `${have.unique ? 'UNIQUE ' : ''}${have.method} (${items})${predicate ? ` WHERE ${predicate}` : ''}`;
  }
  if (kind === 'constraint') return have.display ?? have.definition;
  return `${have.timing} ${have.events.join(' OR ')} → ${have.functionName}${have.enabled ? '' : ' (désactivé)'}`;
}

/**
 * Le verdict : ce qui manque, ce qui est en trop, ce qui a changé.
 *
 * Les exemptions sont bornées DANS LES DEUX SENS, comme partout dans ce dépôt :
 * une exemption sans raison est un trou, une exemption qui ne correspond à aucun
 * objet de la base est périmée (elle autoriserait un retour en arrière silencieux),
 * et une exemption qui couvrirait un objet DÉCLARÉ est refusée — elle ne pourrait
 * que cacher la dérive que ce contrôle existe pour nommer.
 *
 * @param {{ declared?: object, hosted?: object,
 *   exemptions?: { kind?: string, table?: string, name?: string, reason?: string }[] }} [input]
 */
export function judgeObjectDrift({ declared, hosted, exemptions = [] } = {}) {
  const familiesOf = (source) => {
    const out = {};
    for (const kind of OBJECT_KINDS) out[kind] = source?.[OBJECT_FAMILIES[kind]] ?? new Map();
    return out;
  };
  const declaredFamilies = familiesOf(declared);
  const hostedFamilies = familiesOf(hosted);

  const problems = [];
  for (const entry of hosted?.unreadable ?? []) {
    problems.push(
      `« ${entry.kind} ${entry.table ? `${entry.table}.` : ''}${entry.name} » est en base mais ce contrôle n’a pas su la lire — un objet non lu n’est pas un objet aligné.`,
    );
  }

  const exempted = [];
  const exemptKeys = new Set();
  for (const exemption of exemptions) {
    const kind = String(exemption?.kind ?? '').trim().toLowerCase();
    const name = String(exemption?.name ?? '').trim();
    const table = String(exemption?.table ?? '').trim().toLowerCase();
    const reason = String(exemption?.reason ?? '').trim();
    if (!OBJECT_KINDS.includes(kind) || !name) {
      problems.push('une exemption sans famille ni nom ne peut pas être vérifiée');
      continue;
    }
    if (!reason) {
      problems.push(`« ${kind} ${name} » est exempté sans raison — une exemption muette est un trou.`);
      continue;
    }
    const key = objectKey(kind, { name, table });
    if (declaredFamilies[kind].has(key)) {
      problems.push(
        `« ${kind} ${table ? `${table}.` : ''}${name} » est exempté alors qu’une migration le DÉCLARE — une exemption ne peut pas cacher un objet déclaré : appliquez la migration (db:apply) plutôt que d’exempter.`,
      );
      continue;
    }
    if (!hostedFamilies[kind].has(key)) {
      problems.push(
        `« ${kind} ${table ? `${table}.` : ''}${name} » est exempté mais n’existe pas dans le catalogue lu — une exemption périmée autorise un retour en arrière silencieux.`,
      );
      continue;
    }
    exempted.push({ kind, table, name, reason });
    exemptKeys.add(key);
  }

  const missing = [];
  const changed = [];
  let matched = 0;
  let declaredCount = 0;
  for (const kind of OBJECT_KINDS) {
    for (const [key, want] of declaredFamilies[kind]) {
      declaredCount += 1;
      const have = hostedFamilies[kind].get(key);
      if (!have) {
        missing.push({ kind, schema: want.schema, table: want.table, name: want.name, file: want.file, type: want.type });
        continue;
      }
      const differences = differencesOf(kind, want, have);
      if (differences.length > 0) changed.push({ kind, schema: want.schema, table: want.table, name: want.name, file: want.file, differences });
      else matched += 1;
    }
  }

  const extra = [];
  let hostedCount = 0;
  for (const kind of OBJECT_KINDS) {
    for (const [key, have] of hostedFamilies[kind]) {
      hostedCount += 1;
      if (declaredFamilies[kind].has(key)) continue;
      if (exemptKeys.has(key)) continue;
      extra.push({ kind, schema: have.schema, table: have.table, name: have.name, detail: describeObject(kind, have) });
    }
  }

  const byName = (a, b) =>
    a.kind.localeCompare(b.kind) || String(a.table ?? '').localeCompare(String(b.table ?? '')) || a.name.localeCompare(b.name);
  missing.sort(byName);
  extra.sort(byName);
  changed.sort(byName);

  const drift = missing.length + extra.length + changed.length;
  return {
    declaredCount,
    hostedCount,
    matched,
    missing,
    extra,
    changed,
    exempted,
    unmodeled: hosted?.unmodeled ?? [],
    retired: declared?.retired ?? [],
    problems,
    drift,
    // Un regard qui n'a rien atteint n'est pas un état sain : sans objet déclaré ou
    // sans objet lu, il n'y a RIEN à comparer, et le script sort en 2.
    vacuous: declaredCount === 0 || hostedCount === 0,
    ok: declaredCount > 0 && hostedCount > 0 && drift === 0 && problems.length === 0,
  };
}

// ─── Les requêtes du catalogue ──────────────────────────────────────────────

/**
 * Les INDEX, avec le marqueur `constraint_owned` (l'index d'une clé primaire ou
 * d'une contrainte UNIQUE n'est pas un index déclaré : il est comparé avec sa
 * contrainte).
 */
export const INDEX_DRIFT_SQL = `
  select n.nspname as schema,
         c.relname as tablename,
         i.relname as indexname,
         pg_get_indexdef(i.oid) as definition,
         exists (select 1 from pg_constraint k where k.conindid = i.oid and k.contype in ('p','u','x')) as constraint_owned     from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class c on c.oid = x.indrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1::text[])
     and c.relname = any($2::text[])
   order by n.nspname, c.relname, i.relname
`;

/** Les CONTRAINTES, tous types confondus — c'est le module qui juge le type. */
export const CONSTRAINT_DRIFT_SQL = `
  select n.nspname as schema,
         c.relname as tablename,
         k.conname,
         k.contype,
         pg_get_constraintdef(k.oid) as definition
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = any($1::text[])
     and c.relname = any($2::text[])
   order by n.nspname, c.relname, k.conname
`;

/** Les DÉCLENCHEURS non internes (ceux du dépôt, pas ceux des clés étrangères). */
export const TRIGGER_DRIFT_SQL = `
  select n.nspname as schema,
         c.relname as tablename,
         t.tgname,
         t.tgenabled,
         pg_get_triggerdef(t.oid) as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and n.nspname = any($1::text[])
     and c.relname = any($2::text[])
   order by n.nspname, c.relname, t.tgname
`;
