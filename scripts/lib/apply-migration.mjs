// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/apply-migration.mjs — ce que `db:apply` doit REFUSER, et ce
// qu'elle doit PROUVER.
//
// ─── Pourquoi cette commande existe ─────────────────────────────────────────
// Les migrations de ce dépôt étaient appliquées À LA MAIN (CLI ou Dashboard
// Supabase), et deux incidents ont été payés pour cette raison : le 2026-09-14,
// la colonne `staff.category` écrite dans le code AVANT d'exister en base — tout
// ajout d'employé était refusé, et le déploiement partait vert ; le 2026-10-11,
// `payments.months` déclarée par une migration non appliquée — le gate
// `check:hosted-schema` a bloqué la publication, et il a fallu une session de
// terminal pour voir que la base était en retard. La migration est un GESTE, et
// ce geste n'avait ni commande, ni preuve.
//
// ─── Ce que le module pur porte, et pourquoi il est séparé du script ────────
// Tout ce qui peut se tromper se trompe ICI, et se teste sans base : le chemin
// (une migration vit dans `supabase/migrations/`, jamais ailleurs), l'ordre
// (le préfixe est un horodatage — appliquer deux fichiers dans le désordre
// changerait le schéma obtenu), la TRANSACTION (un fichier qui porte la sienne
// ne se re-enveloppe pas, et une instruction que PostgreSQL refuse dans une
// transaction doit être refusée AVANT d'écrire, pas au milieu), et les OBJETS
// déclarés — ce que la commande exigera absent avant, présent après.
//
// ─── Un retrait est un geste, et il se prouve ───────────────────────────────
// Une migration ne fait pas que déclarer : elle retire. `DROP TABLE` et
// `ALTER TABLE … DROP COLUMN` se lisent donc aussi, et se prouvent par l'INVERSE
// de l'ajout — présent AVANT, absent APRÈS. Sans cette lecture, le retrait de la
// table qui fuyait (2026-10-11 : aucune RLS activée par un `CREATE TABLE AS`,
// lecture ouverte au rôle `anon`) ne déclarait rien d'observable : la commande le
// refusait — donc la suppression se serait faite à la main, hors de la preuve.
// Un `DROP` écrit dans une chaîne, un commentaire ou un corps `$$ … $$` n'est pas
// vu : une chaîne n'est pas un geste.
//
// ─── Ce qu'il refuse de laisser passer pour une preuve ──────────────────────
// Un fichier qui ne déclare AUCUN objet observable (table, colonne, contrainte,
// fonction, politique, déclencheur) ne peut pas être prouvé appliqué : la
// commande le refuse, au lieu de rendre un succès qu'aucune mesure n'appuie.
// C'est la même règle que `check:hosted-schema` — « je n'ai pas pu regarder »
// n'est pas « tout va bien ».
// ─────────────────────────────────────────────────────────────────────────────
import { blankComments, expectedSchemaFromMigrations } from './schema-expected.mjs';

/** Le dossier des migrations, la source de vérité du schéma (cf. db:snapshot). */
export const MIGRATIONS_DIR = 'supabase/migrations';

/** Une migration du dépôt : `AAAAMMJJHHMMSS_nom_en_minuscules.sql`. */
const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * Le problème d'un chemin, ou `null`.
 *
 * Un fichier est accepté s'il est DANS `supabase/migrations/` et qu'il porte la
 * forme d'une migration. Les deux règles ne sont pas de la coquetterie : le
 * dossier est ce que `db:snapshot:check`, `check:hosted-schema` et la
 * régénération du script complet lisent, donc appliquer un `.sql` posé ailleurs
 * produirait une base que le dépôt ne décrit pas — et le préfixe horodaté est ce
 * qui donne son sens à l'ordre.
 *
 * @param {{ file: string, root: string, exists?: (path: string) => boolean }} input
 * @returns {string|null}
 */
export function migrationPathProblem({ file, root, exists }) {
  const path = String(file ?? '').trim();
  if (!path) return 'aucun fichier à appliquer';
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
    ? path
    : `${root.replace(/[\\/]+$/, '')}/${path}`;
  const normalized = absolute.split(/[\\/]+/).join('/');
  const dir = `${root.replace(/[\\/]+$/, '').split(/[\\/]+/).join('/')}/${MIGRATIONS_DIR}`;
  if (!normalized.startsWith(`${dir}/`)) {
    return `« ${path} » n’est pas dans ${MIGRATIONS_DIR}/ — une migration hors de ce dossier produirait une base que le dépôt ne décrit pas`;
  }
  const name = normalized.slice(dir.length + 1);
  if (!name.endsWith('.sql')) return `« ${path} » n’est pas un fichier .sql`;
  if (!MIGRATION_NAME.test(name)) {
    return `« ${name} » ne suit pas la forme AAAAMMJJHHMMSS_nom.sql — sans horodatage, l’ordre d’application ne se déduit plus`;
  }
  if (exists && !exists(normalized)) return `« ${path} » est introuvable`;
  return null;
}

/**
 * L'ordre des fichiers donnés suit-il l'ordre chronologique de leur nom ?
 *
 * Appliquer `…20261011000001` avant `…20261010000000` produirait un schéma que
 * PERSONNE n'a prévu (la seconde migration a été écrite en supposant la
 * première) : c'est un refus, pas un avertissement.
 *
 * @param {string[]} names noms de fichiers, dans l'ordre où ils seront appliqués
 * @returns {string|null}
 */
export function orderProblem(names = []) {
  const list = names.map((name) => String(name));
  for (let i = 1; i < list.length; i += 1) {
    const previous = list[i - 1].slice(0, 14);
    const current = list[i].slice(0, 14);
    if (current < previous) {
      return `l’ordre demandé n’est pas chronologique : « ${list[i]} » (${current}) vient après « ${list[i - 1]} » (${previous}) — appliquez-les dans l’ordre de leurs noms`;
    }
    if (current === previous) {
      return `deux fichiers portent le même horodatage (${current}) : « ${list[i - 1]} » et « ${list[i]} » — l’ordre n’est pas décidable`;
    }
  }
  return null;
}

/**
 * Les instructions de NIVEAU 0, comments et corps `$$ … $$` écartés.
 *
 * Le découpage n'est pas une formalité : les migrations de ce dépôt portent des
 * fonctions PL/pgSQL, dont le corps commence par `BEGIN` — compter ces `BEGIN`
 * comme des transactions annoncerait un fichier « autogéré » qui ne l'est pas, et
 * envelopper un fichier autogéré dans une seconde transaction ferait qu'un
 * `COMMIT` du fichier validerait la nôtre : la vérification « après » partirait
 * hors transaction, et le `ROLLBACK` d'un échec ne pourrait plus rien annuler.
 *
 * @param {string} sql
 * @returns {string[]} instructions de niveau 0, dans l'ordre du fichier
 */
export function topLevelStatements(sql) {
  const text = String(sql ?? '');
  const statements = [];
  let current = '';
  let i = 0;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    current = '';
  };
  while (i < text.length) {
    const pair = text.slice(i, i + 2);
    if (pair === '--') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      current += ' ';
      continue;
    }
    if (pair === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      current += ' ';
      continue;
    }
    if (text[i] === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      current += ' ';
      continue;
    }
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = text.indexOf(tag, i + tag.length);
      i = end === -1 ? text.length : end + tag.length;
      current += ' <corps> ';
      continue;
    }
    if (text[i] === ';') {
      flush();
      i += 1;
      continue;
    }
    current += text[i];
    i += 1;
  }
  flush();
  return statements;
}

/** Les commandes qui OUVRENT, FERMENT ou jalonnent une transaction. */
const TRANSACTION_COMMAND = /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i;

/**
 * Le fichier apporte-t-il sa PROPRE transaction ?
 *
 * Les migrations du dépôt n'en apportent aucune aujourd'hui (mesuré sur les 33),
 * et c'est la commande qui les enveloppe. La règle existe pour demain : un
 * fichier qui ouvre lui-même une transaction ne se ré-enveloppe pas.
 *
 * @param {string[]} statements
 * @returns {string[]} les commandes trouvées, dans l'ordre
 */
export function transactionControl(statements = []) {
  return statements
    .filter((statement) => TRANSACTION_COMMAND.test(String(statement).trim()))
    .map((statement) => String(statement).trim().split(/\s+/)[0].toUpperCase());
}

/**
 * Les instructions que PostgreSQL REFUSE dans un bloc de transaction.
 *
 * Elles doivent être refusées AVANT d'écrire : découvertes au milieu du fichier,
 * elles laisseraient une base à moitié changée — la seule chose que cette commande
 * promet de ne jamais faire.
 */
const TRANSACTION_BLOCKERS = [
  { command: 'CREATE INDEX CONCURRENTLY', re: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i },
  { command: 'DROP INDEX CONCURRENTLY', re: /^DROP\s+INDEX\s+CONCURRENTLY\b/i },
  { command: 'REINDEX … CONCURRENTLY', re: /^REINDEX\b[\s\S]*\bCONCURRENTLY\b/i },
  { command: 'VACUUM', re: /^VACUUM\b/i },
  { command: 'CREATE DATABASE', re: /^CREATE\s+DATABASE\b/i },
  { command: 'DROP DATABASE', re: /^DROP\s+DATABASE\b/i },
  { command: 'ALTER SYSTEM', re: /^ALTER\s+SYSTEM\b/i },
  { command: 'TABLESPACE', re: /^(?:CREATE|ALTER|DROP)\s+TABLESPACE\b/i },
  { command: 'SUBSCRIPTION', re: /^(?:CREATE|ALTER|DROP)\s+SUBSCRIPTION\b/i },
];

/**
 * @param {string[]} statements instructions de niveau 0
 * @returns {{ command: string, statement: string }[]}
 */
export function transactionBlockers(statements = []) {
  const found = [];
  for (const statement of statements) {
    const text = String(statement).trim();
    const blocker = TRANSACTION_BLOCKERS.find((entry) => entry.re.test(text));
    if (blocker) found.push({ command: blocker.command, statement: text.replace(/\s+/g, ' ').slice(0, 90) });
  }
  return found;
}

/**
 * Les noms capturés, avec leur RANG dans le fichier.
 *
 * Le rang est le fond du geste : `DROP CONSTRAINT IF EXISTS x` puis
 * `ADD CONSTRAINT x` (le cas de `payments_months`) et `ADD` puis `DROP` ne
 * laissent PAS le même objet derrière. Trier par rang, c'est lire le fichier
 * dans l'ordre où PostgreSQL l'exécutera.
 */
const OBJECT_STATEMENTS = [
  { kind: 'constraint', op: 'add', re: /ADD\s+CONSTRAINT\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'constraint', op: 'drop', re: /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'constraint', op: 'add', re: /(?:^|[,(])\s*CONSTRAINT\s+"([^"]+)"\s+(?:PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/gim },
  { kind: 'trigger', op: 'add', re: /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'trigger', op: 'drop', re: /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'policy', op: 'add', re: /CREATE\s+POLICY\s+(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'policy', op: 'drop', re: /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'function', op: 'add', re: /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[A-Za-z_]\w*\.)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
  { kind: 'function', op: 'drop', re: /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:[A-Za-z_]\w*\.)?(?:"([^"]+)"|([A-Za-z_]\w*))/gi },
];

/**
 * Les instructions de RETRAIT, et le nom qu'elles emportent.
 *
 * Ancrées au début et à la fin de l'instruction (`topLevelStatements` les a déjà
 * détachées) : un `DROP TABLE` ne se confond donc pas avec le même mot au milieu
 * d'autre chose. Une liste de tables séparées par des virgules n'est PAS lue —
 * elle déclarerait alors un retrait partiel, ce qui est pire que pas de retrait.
 */
const REMOVAL_STATEMENTS = [
  {
    kind: 'table',
    re: /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?(?:\s+(?:CASCADE|RESTRICT))?$/i,
  },
  {
    kind: 'column',
    re: /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([A-Za-z_]\w*)"?\s+DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?"?([A-Za-z_]\w*)"?(?:\s+(?:CASCADE|RESTRICT))?$/i,
  },
];

/**
 * Ce qu'un fichier RETIRE.
 *
 * Les noms reviennent triés, pour que deux fichiers disent la même chose du même
 * jeu — comme `objectKeys` le fait des ajouts.
 *
 * @param {string} sql
 * @returns {{ tables: string[], columns: { table: string, column: string }[] }}
 */
export function removedObjects(sql) {
  const tables = new Set();
  const columns = new Map();
  for (const statement of topLevelStatements(sql)) {
    const flat = String(statement).replace(/\s+/g, ' ').trim();
    for (const { kind, re } of REMOVAL_STATEMENTS) {
      const match = re.exec(flat);
      if (!match) continue;
      if (kind === 'table') {
        tables.add(match[1]);
        continue;
      }
      const table = match[1];
      const column = match[2].toLowerCase();
      columns.set(`${table}.${column}`, { table, column });
    }
  }
  return {
    tables: [...tables].sort(),
    columns: [...columns.values()].sort(
      (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
    ),
  };
}

/**
 * Ce qu'un fichier de migration déclare — table par table, objet par objet.
 *
 * @param {string} sql
 * @returns {{ tables: { name: string, columns: string[] }[], constraints: string[],
 *   functions: string[], policies: string[], triggers: string[],
 *   removed: { tables: string[], columns: { table: string, column: string }[] } }}
 */
export function declaredObjects(sql) {
  const text = blankComments(String(sql ?? ''));
  const schema = expectedSchemaFromMigrations([{ name: 'fichier', sql: String(sql ?? '') }]);
  const tables = [...schema].map(([name, columns]) => ({ name, columns: [...columns].sort() }));

  const seen = { constraint: new Map(), trigger: new Map(), policy: new Map(), function: new Map() };
  const matches = [];
  for (const { kind, op, re } of OBJECT_STATEMENTS) {
    for (const match of text.matchAll(re)) {
      const name = (match[1] ?? match[2] ?? '').trim();
      if (name) matches.push({ rank: match.index ?? 0, kind, op, name });
    }
  }
  matches.sort((a, b) => a.rank - b.rank);
  for (const { kind, op, name } of matches) {
    if (op === 'add') seen[kind].set(name, true);
    else seen[kind].delete(name);
  }

  // Le retrait se lit NET : ce qu'un fichier retire ET redéclare dans le même
  // souffle (`DROP TABLE x; CREATE TABLE x (…)`) n'est pas un retrait mais une
  // remise à zéro — et c'est le net qui décide, exactement comme
  // `expectedSchemaFromMigrations` le fait du schéma attendu.
  const removed = removedObjects(sql);
  const declaredTables = new Set(tables.map((table) => table.name));
  const declaredColumns = new Set(
    tables.flatMap((table) => table.columns.map((column) => `${table.name}.${column}`)),
  );

  return {
    tables,
    constraints: [...seen.constraint.keys()].sort(),
    functions: [...seen.function.keys()].sort(),
    policies: [...seen.policy.keys()].sort(),
    triggers: [...seen.trigger.keys()].sort(),
    removed: {
      tables: removed.tables.filter((name) => !declaredTables.has(name)),
      columns: removed.columns.filter(({ table, column }) => !declaredColumns.has(`${table}.${column}`)),
    },
  };
}

/**
 * Les clés des objets déclarés — ce que la sonde doit trouver, et rien d'autre.
 *
 * Une colonne se nomme `<table>.<colonne>`, et chaque autre objet par son genre :
 * la réconciliation compare des ENSEMBLES de chaînes, donc deux familles qui
 * porteraient le même nom (une politique et une contrainte, disons) ne se
 * confondent pas.
 *
 * @param {ReturnType<typeof declaredObjects>} objects
 * @returns {string[]}
 */
export function objectKeys(objects) {
  const keys = [];
  for (const table of objects?.tables ?? []) {
    for (const column of table.columns) keys.push(`column:${table.name}.${column}`);
  }
  for (const name of objects?.constraints ?? []) keys.push(`constraint:${name}`);
  for (const name of objects?.functions ?? []) keys.push(`function:${name}`);
  for (const name of objects?.policies ?? []) keys.push(`policy:${name}`);
  for (const name of objects?.triggers ?? []) keys.push(`trigger:${name}`);
  return keys.sort();
}

/**
 * Les clés des objets RETIRÉS — ce que la sonde doit trouver AVANT, et plus après.
 *
 * Même vocabulaire que `objectKeys` (`table:…`, `column:…`), et c'est voulu : une
 * seule sonde répond donc aux deux questions, et un retrait ne se compare pas à
 * un ajout dans deux langues différentes.
 *
 * @param {ReturnType<typeof declaredObjects>} objects
 * @returns {string[]}
 */
export function removalKeys(objects) {
  const keys = [];
  for (const name of objects?.removed?.tables ?? []) keys.push(`table:${name}`);
  for (const { table, column } of objects?.removed?.columns ?? []) keys.push(`column:${table}.${column}`);
  return keys.sort();
}

/**
 * Le verdict : ce qui manque, ce qui était DÉJÀ là, et ce qui ne serait pas
 * observable du tout.
 *
 * `before` et `after` sont des ensembles de clés PRÉSENTES (voir `objectKeys`),
 * lus dans les catalogues de PostgreSQL — pas dans PostgREST : une même
 * transaction doit pouvoir vérifier ce qu'elle vient d'écrire, et le cache de
 * schéma de PostgREST ne voit qu'un commit.
 *
 * Un RETRAIT se prouve par l'inverse : l'objet doit être PRÉSENT avant, et ABSENT
 * après. Les deux moitiés vivent donc dans le même verdict, et `preflight` porte
 * la question d'AVANT l'écriture — « ce que le fichier exige était-il déjà
 * satisfait ? » — où un objet à retirer qui n'est pas là est le refus, pas
 * l'échec d'une suppression.
 *
 * @param {{ objects: ReturnType<typeof declaredObjects>, before: Set<string>,
 *   after: Set<string>, again?: boolean, preflight?: boolean }} input
 * @returns {{ ok: boolean, keys: string[], removals: string[], already: string[],
 *   goneAlready: string[], missing: string[], stillThere: string[],
 *   problems: string[], warnings: string[] }}
 */
export function applyVerdict({ objects, before, after, again = false, preflight = false }) {
  const keys = objectKeys(objects);
  const removals = removalKeys(objects);
  const problems = [];
  const warnings = [];

  if (keys.length === 0 && removals.length === 0) {
    problems.push(
      'ce fichier ne déclare AUCUN objet observable (table, colonne, contrainte, fonction, politique, déclencheur) : ' +
        'la commande ne pourrait pas prouver son application — appliquez-le autrement, ou déclarez ce qu’il fait',
    );
    return {
      ok: false,
      keys,
      removals,
      already: [],
      goneAlready: [],
      missing: [],
      stillThere: [],
      problems,
      warnings,
    };
  }

  const already = again ? [] : keys.filter((key) => before.has(key));
  if (already.length > 0) {
    problems.push(
      `déjà en base AVANT : ${already.join(', ')} — ` +
        'le fichier est (au moins en partie) déjà appliqué, donc le rejouer ne prouverait rien ' +
        '(relancez avec --again si le fichier est écrit pour être rejoué : c’est alors la seule chose qui sera dite)',
    );
  }
  // L'autre moitié de la même question, et elle est symétrique : un fichier qui
  // demande de retirer ce qui n'est PAS là ne prouve rien non plus. C'est le seul
  // refus qui empêche un retrait « réussi » de n'être qu'un no-op.
  const goneAlready = again ? [] : removals.filter((key) => !before.has(key));
  if (goneAlready.length > 0) {
    problems.push(
      `déjà ABSENT avant : ${goneAlready.join(', ')} — ` +
        'le fichier ne prouverait rien de ce retrait : ce qu’il demande de retirer n’était pas en base ' +
        '(relancez avec --again si le fichier est écrit pour être rejoué : c’est alors la seule chose qui sera dite)',
    );
  }
  const stillThere = removals.filter((key) => after.has(key));
  if (!preflight && stillThere.length > 0) {
    problems.push(
      `retrait NON vérifié APRÈS : ${stillThere.join(', ')} — ` +
        'l’objet est encore en base : la transaction sera ANNULÉE si elle est encore ouverte',
    );
  }
  if (again) {
    warnings.push(
      '--again : les objets présents AVANT ne sont plus un refus — la vérification « après » reste exigée, mais ' +
        'l’application ne prouve plus qu’elle a produit ces objets',
    );
    const wrong = preflight ? [] : keys.filter((key) => !after.has(key));
    if (wrong.length > 0) {
      problems.push(`appliqué mais NON vérifié APRÈS : ${wrong.join(', ')} — la base ne porte pas ce que le fichier déclare`);
    }
    return {
      ok: problems.length === 0,
      keys,
      removals,
      already: [],
      goneAlready: [],
      missing: wrong,
      stillThere,
      problems,
      warnings,
    };
  }

  const missing = keys.filter((key) => !after.has(key));
  if (missing.length > 0) {
    problems.push(
      `appliqué mais NON vérifié APRÈS : ${missing.join(', ')} — ` +
        'la transaction sera ANNULÉE si elle est encore ouverte : rien n’a été écrit',
    );
  }
  return {
    ok: problems.length === 0,
    keys,
    removals,
    already,
    goneAlready,
    missing,
    stillThere,
    problems,
    warnings,
  };
}
