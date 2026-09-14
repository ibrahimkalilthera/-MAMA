// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/schema-expected.mjs — ce que les migrations DÉCLARENT, et ce
// qu'une réponse de PostgREST en dit.
//
// ─── Pourquoi ce module existe ───────────────────────────────────────────────
// Le 2026-09-14, la colonne `staff.category` a été écrite dans le code AVANT
// d'exister dans la base hébergée. Un `select` la voyait manquante (400), et un
// AJOUT d'employé aurait été refusé — un déploiement vert, une fonctionnalité
// cassée, et rien pour le dire : la chaîne qualité ne regarde que le dépôt, les
// migrations ne sont appliquées à la main, et aucune automatisation ne comparait
// les deux. C'est exactement la forme d'échec que ce dépôt pourchasse : un
// contrôle absent, donc un silence pris pour une garantie.
//
// ─── Ce que ce module lit, et ce qu'il refuse de lire ───────────────────────
// La source de vérité est `supabase/migrations/` — les mêmes fichiers que
// `regenerate-full-setup.mjs` concatène, et dont `db:snapshot:check` prouve la
// cohérence dans la chaîne lint. Les tables et colonnes attendues en sont
// DÉDUITES, jamais recopiées : une deuxième liste dériverait de la première, et
// c'est cette dérive-là qu'on veut attraper.
//
// Ce qu'il ne couvre pas, et qui est dit plutôt que supposé : le DDL DYNAMIQUE
// (`EXECUTE 'ALTER TABLE …'` construit dans une chaîne) n'est pas vu, parce que
// les littéraux sont blanchis — un bloc `DO $$ … $$` reste lu, en revanche, donc
// le `DROP TABLE` conditionnel de `custom_classes` est bien pris en compte.
//
// ─── Pourquoi blanchir les commentaires ─────────────────────────────────────
// Un contrôle textuel qui lit de la prose comme du code s'est déjà trompé trois
// fois dans ce dépôt (voir scripts/lib/source-text.mjs). Ici la prose contient
// littéralement les colonnes : `-- Migrer les lignes … puis dropper la colonne
// `category``. `blankComments` remplace donc le CONTENU des commentaires et des
// littéraux par des espaces — les sauts de ligne restent, donc un décalage
// trouvé désigne la même ligne dans le fichier d'origine.
//
// ─── Ce que le verdict d'une sonde a le droit de dire ───────────────────────
// PostgREST valide les colonnes demandées AVANT d'appliquer la RLS : une sonde
// avec la clé anon suffit donc à détecter une colonne absente, sans aucun secret
// ni lecture de données. Et un statut inconnu (401, 500, réseau coupé) n'est
// JAMAIS un vert : il vaut « je n'ai pas pu regarder », que l'appelant doit
// rendre bruyant.
// ─────────────────────────────────────────────────────────────────────────────

/** Les préfixes qui commencent une CONTRAINTE de table, pas une colonne. */
const CONSTRAINT_STARTERS = /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE|INHERITS)\b/i;

/** Un `ADD x` qui n'ajoute pas une colonne : la suite est une contrainte. */
const NON_COLUMN_ADD = /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i;

/**
 * Blanchit le contenu des commentaires et des littéraux SQL, sans bouger la
 * longueur (sauf les sauts de ligne, qui restent).
 *
 * Ce qui est blanchi :
 *   • `-- commentaire` jusqu'à la fin de la ligne ;
 *   • un commentaire de bloc, multiligne compris ;
 *   • un littéral chaîne `'…'`, apostrophes doublées (`''`) comprises — c'est
 *     aussi ce qui retire les virgules d'un `DEFAULT 'a,b'` du découpage.
 *
 * Ce qui NE l'est pas, volontairement : le corps `$$ … $$`. Le `DROP TABLE
 * public.custom_grades` du dépôt vit dans un bloc `DO $$ … $$` conditionnel, et
 * l'ignorer ferait réclamer une table qui n'existe plus.
 *
 * @param {string} sql
 * @returns {string} texte de même longueur (sauts de ligne préservés)
 */
export function blankComments(sql) {
  const text = String(sql ?? '');
  const out = [];
  let state = 'code';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const pair = text.slice(i, i + 2);
    if (state === 'code') {
      if (pair === '--') {
        state = 'line';
        out.push('  ');
        i += 2;
        continue;
      }
      if (pair === '/*') {
        state = 'block';
        out.push('  ');
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = 'string';
        out.push(' ');
        i += 1;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out.push('\n');
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (pair === '*/') {
        state = 'code';
        out.push('  ');
        i += 2;
        continue;
      }
      out.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }
    // state === 'string'
    if (pair === "''") {
      out.push('  ');
      i += 2;
      continue;
    }
    if (ch === "'") {
      state = 'code';
      out.push(' ');
      i += 1;
      continue;
    }
    out.push(ch === '\n' ? '\n' : ' ');
    i += 1;
  }
  return out.join('');
}

/** Retire `public.` (et tout autre schéma) d'un nom de table. */
function unqualify(name) {
  const parts = String(name).split('.');
  return parts[parts.length - 1].replace(/"/g, '').toLowerCase();
}

/**
 * Découpe une liste SQL au niveau 0 : les virgules entre parenthèses (un
 * `CHECK (a IN ('x','y'))`) ne séparent pas deux éléments.
 * @param {string} text
 * @returns {string[]}
 */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Une instruction qui touche la FORME d'une table, capturée d'un seul geste.
 *
 * Les trois formes sont scannées ENSEMBLE, dans l'ordre du fichier, parce que
 * l'ordre est le sens : `CREATE` puis `DROP` dans la même migration (le cas du
 * dépôt, pour `custom_grades`) et `DROP` puis `CREATE` (recréer une table) ne
 * peuvent pas donner le même résultat. Les traiter en trois passes séparées
 * faisait gagner le `CREATE` dans les deux cas — un `DROP` conditionnel était
 * donc silencieusement annulé par le `CREATE` situé au-dessus de lui.
 */
const SHAPE_STATEMENT =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][\w."]*)\s*\(|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z_"][\w."]*)|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_"][\w."]*)/gi;

/** Le contenu de la parenthèse ouvrante à `start`, sautée à son équilibre. */
function readParenBlock(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return text.slice(start + 1);
}

/** Le texte d'une instruction, de `start` à son `;` de niveau 0. */
function readStatementTail(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ';' && depth <= 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/**
 * Les colonnes que chaque table doit porter, déduites des migrations ordonnées.
 *
 * @param {{ name: string, sql: string }[]} migrations dans l'ordre d'application
 * @returns {Map<string, Set<string>>} table → colonnes attendues
 */
export function expectedSchemaFromMigrations(migrations = []) {
  const tables = new Map();
  const ensure = (table) => {
    if (!tables.has(table)) tables.set(table, new Set());
    return tables.get(table);
  };

  for (const migration of migrations) {
    const text = blankComments(migration?.sql ?? '');

    // Une seule passe, dans l'ordre du fichier : la dernière instruction qui
    // parle d'une table décide de sa forme. Les `DROP TABLE` vivent dans des
    // blocs `DO $$ … $$` (le corps d'un bloc n'est PAS blanchi : seul un
    // `EXECUTE 'DROP TABLE …'` l'est, et c'est voulu — une chaîne n'est pas une
    // instruction).
    for (const match of text.matchAll(SHAPE_STATEMENT)) {
      const [full, created, altered, dropped] = match;

      if (dropped) {
        tables.delete(unqualify(dropped));
        continue;
      }

      // CREATE TABLE ( … ) — les contraintes de table ne sont pas des colonnes.
      if (created) {
        const block = readParenBlock(text, match.index + full.length - 1);
        const columns = ensure(unqualify(created));
        for (const item of splitTopLevel(block)) {
          const trimmed = item.trim();
          if (!trimmed || CONSTRAINT_STARTERS.test(trimmed)) continue;
          const column = /^"?([A-Za-z_]\w*)"?/.exec(trimmed);
          if (column) columns.add(column[1].toLowerCase());
        }
        continue;
      }

      // ALTER TABLE … ADD/DROP COLUMN
      const columns = ensure(unqualify(altered));
      const actions = readStatementTail(text, match.index + full.length);
      for (const item of splitTopLevel(actions)) {
        const trimmed = item.trim();
        const add = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)/i.exec(trimmed);
        if (add) {
          if (!NON_COLUMN_ADD.test(add[1])) columns.add(add[1].toLowerCase());
          continue;
        }
        const drop = /^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([A-Za-z_]\w*)/i.exec(trimmed);
        if (drop) columns.delete(drop[1].toLowerCase());
      }
    }
  }
  return tables;
}

/**
 * Ce qu'une table a répondu — le verdict, et ce sur quoi il repose.
 * @typedef {object} SchemaTableResult
 * @property {string} table nom de table (sans schéma)
 * @property {string[]} declared colonnes que les migrations déclarent
 * @property {string[]} gone colonnes que la base a REFUSÉES (elles décident)
 * @property {'ok'|'missing-columns'|'missing-table'|'unknown'} verdict
 * @property {string} reason le message de la base, quand il y en a un
 */

/**
 * Juge un schéma hébergé table par table, sonde injectée.
 *
 * C'est ICI que vit le verdict, pas dans le script : la boucle qui retire une
 * colonne absente de la demande pour nommer les suivantes a produit un FAUX VERT
 * à sa première écriture — l'essai d'après réussit forcément, donc juger sur
 * « le dernier essai a réussi » annonçait « toutes présentes » pour une table à
 * laquelle il manquait une colonne. Ce qui décide est ce qui a été RETIRÉ.
 * Extraire la boucle rend ce piège testable avec une sonde fabriquée, sans
 * toucher à une base réelle.
 *
 * @param {{ expected: Map<string, Set<string>>, probe: (table: string, columns: string[]) => Promise<{ status?: number, body?: unknown }> }} input
 * @returns {Promise<{ results: SchemaTableResult[], missing: SchemaTableResult[], missingTables: SchemaTableResult[], unverifiable: SchemaTableResult[], ok: boolean }>}
 */
export async function judgeHostedSchema({ expected, probe }) {
  /** @type {SchemaTableResult[]} */
  const results = [];
  for (const [table, columns] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    let wanted = [...columns].sort();
    const gone = [];
    let verdict = 'ok';
    let reason = '';

    // PostgREST ne nomme qu'UNE colonne absente à la fois : on la retire de la
    // demande et on repose la question, pour les nommer toutes d'un coup plutôt
    // que d'en annoncer une et d'en cacher quatre. La boucle s'arrête quand il
    // n'y a plus rien à demander : sans ça, la sonde suivante partait avec une
    // liste VIDE et son message (« column staff.undefined does not exist »)
    // ajoutait une colonne qui n'a jamais existé — le compte annoncé était faux.
    for (let attempt = 0; attempt <= columns.size && wanted.length > 0; attempt += 1) {
      let response;
      try {
        response = await probe(table, wanted);
      } catch (error) {
        verdict = 'unknown';
        reason = error instanceof Error ? error.message : String(error);
        break;
      }
      const reading = interpretProbe({ table, ...response });
      if (reading.verdict === 'ok') break;
      if (reading.verdict === 'missing-column') {
        // Une colonne qui n'était pas demandée ne fait pas avancer la question :
        // la retirer ne changerait rien et la boucle répéterait le même nom
        // jusqu'à sa borne. On s'arrête et on dit qu'on n'a pas pu juger.
        if (!reading.column || !wanted.includes(reading.column)) {
          verdict = 'unknown';
          reason = reading.reason || 'la sonde nomme une colonne qui n’était pas demandée';
          break;
        }
        gone.push(reading.column);
        wanted = wanted.filter((column) => column !== reading.column);
        reason = reading.reason;
        continue;
      }
      verdict = reading.verdict === 'missing-table' ? 'missing-table' : 'unknown';
      reason = reading.reason || `statut ${response?.status ?? 'sans réponse'}`;
      break;
    }

    results.push({
      table,
      declared: [...columns].sort(),
      gone,
      // Ce qui a été retiré décide, jamais le succès de l'essai suivant.
      verdict: verdict === 'ok' && gone.length > 0 ? 'missing-columns' : verdict,
      reason,
    });
  }
  const pick = (name) => results.filter((result) => result.verdict === name);
  return {
    results,
    missing: pick('missing-columns'),
    missingTables: pick('missing-table'),
    unverifiable: pick('unknown'),
    ok: results.every((result) => result.verdict === 'ok'),
  };
}

/**
 * Ce qu'une réponse de PostgREST dit de la sonde envoyée.
 *
 * `ok`          → toutes les colonnes demandées existent ;
 * `missing-column` → le message nomme la colonne introuvable ;
 * `missing-table`  → le message nomme la table introuvable ;
 * `unknown`     → tout le reste, et « tout le reste » n'est jamais un vert.
 *
 * @param {{ table?: string, status?: number, code?: string, body?: unknown }} response
 * @returns {{ verdict: 'ok'|'missing-column'|'missing-table'|'unknown', column: string|null, table: string|null, reason: string }}
 */
export function interpretProbe(response = {}) {
  const status = Number(response.status ?? 0);
  const body = response.body;
  const message =
    typeof body === 'string'
      ? body
      : (body && typeof body === 'object' && typeof body.message === 'string' && body.message) || '';

  if (status >= 200 && status < 300) {
    return { verdict: 'ok', column: null, table: null, reason: '' };
  }
  // DEUX formes pour la même absence, et les deux ont été MESURÉES sur la base
  // réelle le 2026-09-14 : PostgREST répond `PGRST204` quand la colonne manque à
  // son cache de schéma (« Could not find the 'x' column of 'y' »), et laisse
  // passer l'erreur de PostgreSQL — `42703`, « column y.x does not exist » —
  // quand c'est la base qui refuse. Ne reconnaître que la première aurait classé
  // un vrai retard de schéma en « invérifiable » : exit 2 au lieu du 1 qui le nomme.
  const missingColumn =
    /Could not find the '([^']+)' column of '([^']+)'/i.exec(message) ??
    /^column (?:[A-Za-z_][\w$]*\.)?"?([A-Za-z_][\w$]*)"? does not exist/i.exec(message);
  if (missingColumn) {
    const namedTable = /^column ([A-Za-z_][\w$]*)\./i.exec(message)?.[1] ?? null;
    return {
      verdict: 'missing-column',
      column: missingColumn[1],
      table: namedTable ?? response.table ?? null,
      reason: message,
    };
  }
  const missingTable =
    /Could not find the table '([^']+)'/i.exec(message) ??
    /relation "?([A-Za-z_][\w$]*)"? does not exist/i.exec(message);
  if (missingTable) {
    return {
      verdict: 'missing-table',
      column: null,
      table: missingTable[1].replace(/^[a-z_]+\./i, ''),
      reason: message,
    };
  }
  return {
    verdict: 'unknown',
    column: null,
    table: null,
    reason: message || `statut ${status || 'sans réponse'}`,
  };
}
