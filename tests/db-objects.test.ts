/**
 * Suite for `scripts/lib/db-objects.mjs` — la comparaison entre les INDEX, les
 * CONTRAINTES et les DÉCLENCHEURS que les migrations DÉCLARENT et ceux que le
 * catalogue de la base porte.
 *
 * Les cas ci-dessous ne sont pas décoratifs : trois d'entre eux ont été MESURÉS
 * faux une première fois, et chacun tient une garantie que le contrôle vend.
 *
 *   • les contraintes NOMMÉES du dépôt sont toutes posées par
 *     `ALTER TABLE … ADD CONSTRAINT` (`payments_months_shape_check`), et leur
 *     texte porte DÉJÀ son mot-clé : la lecture le préfixait une seconde fois
 *     (`CHECK CHECK (…)`), donc chaque contrainte nommée était signalée CHANGÉE
 *     sur une dérive qui n'existait que dans le module ;
 *   • Postgres NOMME ce que le SQL n'a pas nommé (`parents_pkey`,
 *     `students_student_id_key`, `students_parent_id_fkey`,
 *     `user_profiles_role_check`) : ces noms sont DÉRIVÉS, et une table (re)créée
 *     repart d'un ensemble de noms VIDE — sinon le second passage dérive
 *     `payments_pkey1` pour ce que Postgres appelle `payments_pkey` ;
 *   • un `DROP TABLE` vit souvent dans un bloc `DO $$ … $$` (c'est le cas du
 *     corpus) : s'il n'est pas lu, le contrôle réclame des objets impossibles, et
 *     un contrôle qui réclame l'impossible se fait désactiver.
 *
 * Le bloc « corpus réel » relit les migrations dans les deux sens : ce qu'elles
 * déclarent, reconstitué en catalogue, doit juger VERT, et retirer un objet du
 * catalogue doit le faire ROUGE — un contrôle qui ne sait pas dire « oui » sur un
 * catalogue conforme est un contrôle que personne ne peut croire.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  columnConstraints,
  declaredObjectsAndRetired,
  hostedObjectsFromRows,
  implicitConstraintName,
  judgeObjectDrift,
  normalizeDefinition,
  objectKey,
  parseCreateIndex,
  parseCreateTrigger,
  parseDropIndexes,
  parseDropTrigger,
  parseTableStatement,
  watchedTables,
} from '../scripts/lib/db-objects.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const readMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

const file = (name: string, sql: string) => ({ name, sql });

/** Une ligne de `pg_index`, comme le pilote `pg` la rend. */
const indexRow = (tablename: string, indexname: string, definition: string, constraintOwned = false) => ({
  schema: 'public',
  tablename,
  indexname,
  definition,
  constraint_owned: constraintOwned,
});

/** Une ligne de `pg_constraint`. */
const constraintRow = (tablename: string, conname: string, contype: string, definition: string) => ({
  schema: 'public',
  tablename,
  conname,
  contype,
  definition,
});

/**
 * La forme d'un objet de catalogue, des deux côtés (déclaré, lu) : le module est
 * en `.mjs`, donc ses champs se déclarent ici au lieu d'être devinés — et le
 * dépôt interdit `any` (une suite qui relâche le typage perd la moitié de ce
 * qu'une suite prouve).
 */
type CatalogueObject = {
  schema: string;
  table: string;
  name: string;
  type?: string;
  display?: string;
  unique?: boolean;
  method?: string;
  itemsText?: string[];
  predicateText?: string | null;
  timing?: string;
  events?: string[];
  orientation?: string;
  functionName?: string;
  when?: string | null;
  enabled?: boolean;
};

type Catalogue = {
  indexes: Map<string, CatalogueObject>;
  constraints: Map<string, CatalogueObject>;
  triggers: Map<string, CatalogueObject>;
};

/** Une contrainte telle que le module la rend : sa forme ÉCRITE et sa forme comparée. */
type ConstraintRecord = CatalogueObject & { type: string; display: string; definition: string };

/** Un objet RETIRÉ par le corpus, avec sa cause et le fichier qui le retire. */
type RetiredObject = {
  kind: string;
  table: string;
  name: string;
  cause: string;
  declaredBy: string;
  droppedBy: string;
};

/** Ce que le rejeu rend : les trois familles, les tables connues, les retraits. */
type DeclaredResult = {
  declared: Catalogue;
  tables: Map<string, { schema: string; table: string; created: boolean }>;
  retired: RetiredObject[];
};

/** Le catalogue LU, plus ce qu'il n'a pas su modéliser ou lire. */
type HostedCatalogue = Catalogue & {
  unmodeled: { kind: string; table: string; name: string; type: string }[];
  unreadable: { kind: string; name: string; table?: string }[];
};

/** Une instruction de table, découpée : création, ajouts et retraits. */
type TableStatement = {
  action: string;
  table?: string;
  schema?: string;
  constraints: CatalogueObject[];
  drops: { type: string; name: string }[];
  columns: string[];
};

/** Le verdict, tel que la sortie du contrôle le lit. */
type DriftReport = {
  declaredCount: number;
  hostedCount: number;
  matched: number;
  drift: number;
  ok: boolean;
  vacuous: boolean;
  missing: { kind: string; table: string; name: string; file?: string; type?: string }[];
  extra: { kind: string; table: string; name: string; detail: string }[];
  changed: {
    kind: string;
    table: string;
    name: string;
    file?: string;
    differences: { field: string; declared: string; base: string }[];
  }[];
  exempted: { kind: string; table: string; name: string; reason: string }[];
  problems: string[];
};

// Les `.mjs` ne portent pas de types : ils sont donc annotés ICI, à la frontière,
// une fois — plutôt que devinés à chaque appel (et jamais en `any`, interdit ici).
const replay = (migrations: { name: string; sql: string }[]) =>
  (declaredObjectsAndRetired)(migrations) as unknown as DeclaredResult;
const hostedFrom = (rows: Parameters<typeof hostedObjectsFromRows>[0]) =>
  (hostedObjectsFromRows)(rows) as unknown as HostedCatalogue;
const parseIndex = (span: string) => (parseCreateIndex)(span) as unknown as CatalogueObject | null;
const parseTrigger = (span: string) => (parseCreateTrigger)(span) as unknown as CatalogueObject | null;
const parseTable = (span: string) => (parseTableStatement)(span) as unknown as TableStatement;
const judge = (input: Parameters<typeof judgeObjectDrift>[0]) =>
  (judgeObjectDrift)(input) as unknown as DriftReport;

/** Un index, rendu comme `pg_get_indexdef` l'écrit. */
const indexDefinition = (record: CatalogueObject) =>
  `CREATE ${record.unique ? 'UNIQUE ' : ''}INDEX ${record.name} ON ${record.schema}.${record.table} ` +
  `USING ${record.method} (${record.itemsText?.join(', ')})${record.predicateText ? ` WHERE ${record.predicateText}` : ''}`;

/** Un déclencheur, rendu comme `pg_get_triggerdef` l'écrit. */
const triggerRow = (record: CatalogueObject) => ({
  schema: record.schema,
  tablename: record.table,
  tgname: record.name,
  tgenabled: record.enabled ? 'O' : 'D',
  definition:
    `CREATE TRIGGER ${record.name} ${record.timing} ${record.events?.join(' OR ')} ON ${record.schema}.${record.table} ` +
    `FOR EACH ${record.orientation} EXECUTE FUNCTION ${record.schema}.${record.functionName}()` +
    (record.when ? ` WHEN (${record.when})` : ''),
});

/** Un catalogue LU, remis en lignes `pg_*` (tel quel) : les deux moitiés se comparent. */
const rowsFromHosted = (hosted: Catalogue) => ({
  indexes: [...hosted.indexes.values()].map((record) => indexRow(record.table, record.name, indexDefinition(record))),
  constraints: [...hosted.constraints.values()].map((record) =>
    constraintRow(record.table, record.name, record.type ?? '', record.display ?? ''),
  ),
  triggers: [...hosted.triggers.values()].map((record) => triggerRow(record)),
});

/**
 * Le catalogue « miroir » d'un corpus déclaré : chaque objet déclaré est rendu
 * comme `pg_get_indexdef` / `pg_get_constraintdef` / `pg_get_triggerdef` le
 * feraient. C'est ce qui permet de tenir les deux moitiés du verdict sur le
 * corpus réel : VERT sur son propre miroir, ROUGE dès qu'un objet est retiré.
 */
const catalogueFrom = (declared: Catalogue) => (skipConstraintKey: string | null = null) =>
  hostedFrom({
    ...rowsFromHosted(declared),
    constraints: [...declared.constraints.entries()]
      .filter(([key]) => key !== skipConstraintKey)
      .map(([, record]) => constraintRow(record.table, record.name, record.type ?? '', record.display ?? '')),
  });

// ─── Les noms que Postgres DONNE ─────────────────────────────────────────────

describe('implicitConstraintName — les noms que Postgres dérive lui-même', () => {
  it('rend les quatre formes du corpus, et numérote quand le nom est déjà pris', () => {
    assert.equal(implicitConstraintName('parents', 'pkey', []), 'parents_pkey');
    assert.equal(implicitConstraintName('students', 'key', ['student_id']), 'students_student_id_key');
    assert.equal(implicitConstraintName('students', 'fkey', ['parent_id']), 'students_parent_id_fkey');
    assert.equal(implicitConstraintName('user_profiles', 'check', ['role'], new Set()), 'user_profiles_role_check');
    // Deux CHECK sur la même colonne : le second prend un suffixe, comme Postgres.
    assert.equal(
      implicitConstraintName('payments', 'check', ['months'], new Set(['payments_months_check'])),
      'payments_months_check1',
    );
  });

  it('une définition de colonne déclare ses contraintes, et PAS « NOT NULL » / « DEFAULT »', () => {
    const constraints = columnConstraints(
      'role',
      "TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff', 'dev'))",
      'user_profiles',
    );
    assert.deepEqual(
      constraints.map((record) => [record.name, record.type]),
      [['user_profiles_role_check', 'c']],
      'PostgreSQL 17 n’inscrit ni NOT NULL ni DEFAULT dans pg_constraint',
    );
    assert.equal(constraints[0]!.display, "CHECK (role IN ('admin', 'staff', 'dev'))", 'la forme ÉCRITE est gardée pour le rapport');
    assert.match(constraints[0]!.definition, /^check role in /);
    for (const literal of ["'admin'", "'staff'", "'dev'"]) {
      assert.ok(constraints[0]!.definition.includes(literal), `le littéral ${literal} survit à la normalisation`);
    }
  });

  it('la forme `= ANY (ARRAY[…])` et la forme `IN (…)` sont la MÊME règle — sinon chaque CHECK du corpus serait une dérive', () => {
    assert.equal(
      normalizeDefinition("CHECK (months = ANY (ARRAY['a'::text, 'b'::text]))"),
      normalizeDefinition("CHECK (months IN ('a', 'b'))"),
    );
  });

  it('la forme `<> ALL (ARRAY[…])` et la forme `NOT IN (…)` sont la MÊME règle — le miroir qui manquait', () => {
    // Mesuré le 2026-10-15 sur `app_settings_display_keys_check` : la migration
    // écrit `key NOT IN (…)`, le catalogue rend `key <> ALL (ARRAY[…])`. Sans ce
    // miroir, une contrainte appliquée MOT POUR MOT était dite CHANGÉE — la
    // négation n'était reconnue dans aucun sens.
    assert.equal(
      normalizeDefinition(
        "CHECK (((key <> ALL (ARRAY['display.theme'::text, 'display.density'::text])) OR (jsonb_typeof(value) = 'string'::text)))",
      ),
      normalizeDefinition("CHECK (key NOT IN ('display.theme', 'display.density') OR jsonb_typeof(value) = 'string')"),
    );
  });

  it('mais la négation n’est pas blanchie en égalité, et deux listes restent deux règles', () => {
    // Une réduction qui ramènerait les deux formes à la même chaîne inverserait
    // une règle (« aucune de ces valeurs » vs « une de ces valeurs ») ; et une
    // valeur changée doit continuer de sauter aux yeux.
    assert.notEqual(
      normalizeDefinition("CHECK (key <> ALL (ARRAY['a'::text, 'b'::text]))"),
      normalizeDefinition("CHECK (key = ANY (ARRAY['a'::text, 'b'::text]))"),
    );
    assert.notEqual(
      normalizeDefinition("CHECK (key NOT IN ('a', 'b'))"),
      normalizeDefinition("CHECK (key IN ('a', 'c'))"),
    );
  });

  it('la forme `BETWEEN a AND b` et la forme `>= a AND <= b` sont la MÊME règle', () => {
    // Mesuré le 2026-10-18 sur `station_versions_station_id_bounds` : le dépôt
    // écrit une BORNE, le catalogue la rend éclatée avec son opérande répété.
    // Sans cette réduction, chaque borne en `BETWEEN` passerait pour une dérive.
    assert.equal(
      normalizeDefinition('CHECK (char_length(station_id) BETWEEN 8 AND 64)'),
      normalizeDefinition('CHECK (((char_length(station_id) >= 8) AND (char_length(station_id) <= 64)))'),
    );
    assert.equal(
      normalizeDefinition('CHECK (os_version BETWEEN 1 AND 32)'),
      normalizeDefinition('CHECK ((os_version >= 1) AND (os_version <= 32))'),
    );
  });

  it('une borne COMPOSÉE n’est pas blanchie : la différence reste SIGNALÉE', () => {
    // La réduction ne couvre que les bornes simples. Une borne qui contient un
    // `AND` ou un appel de fonction n'est PAS réduite — le contrôle doit préférer
    // un faux rouge à un faux vert, et c'est ce que ce cas verrouille.
    assert.notEqual(
      normalizeDefinition('CHECK (x BETWEEN coalesce(a, 1) AND 32)'),
      normalizeDefinition('CHECK (x >= 1 AND x <= 32)'),
    );
  });
});

// ─── La lecture d'une déclaration ────────────────────────────────────────────

// Les lecteurs ci-dessous reçoivent une INSTRUCTION, telle que `statementSpans`
// la découpe — donc sans le point-virgule final (c'est le corpus réel qui le
// prouve plus bas, via `declaredObjectsAndRetired`).
describe('parseCreateIndex — la forme écrite, gardée pour être jugée', () => {
  it('lit l’unicité, la méthode, les expressions ET le prédicat partiel', () => {
    const parsed = parseIndex(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS public.students_name_idx ON public.students USING btree (lower(btrim(name))) WHERE flagged',
    )!;
    assert.equal(parsed.name, 'students_name_idx');
    assert.equal(parsed.schema, 'public');
    assert.equal(parsed.table, 'students');
    assert.equal(parsed.unique, true);
    assert.equal(parsed.method, 'btree');
    assert.deepEqual(parsed.itemsText, ['lower(btrim(name))'], 'les expressions se lisent dans le texte d’ORIGINE');
    assert.equal(parsed.predicateText, 'flagged');
  });

  it('un index sans parenthèses n’est pas un index', () => {
    assert.equal(parseIndex('CREATE INDEX idx'), null);
  });
});

describe('parseDropIndexes / parseDropTrigger', () => {
  it('un `DROP INDEX` peut en nommer plusieurs', () => {
    assert.deepEqual(parseDropIndexes('DROP INDEX IF EXISTS public.a, public.b'), [
      { schema: 'public', name: 'a' },
      { schema: 'public', name: 'b' },
    ]);
  });

  it('un `DROP TRIGGER` nomme sa table, et rien d’autre', () => {
    assert.deepEqual(parseDropTrigger('DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users'), {
      name: 'on_auth_user_created',
      schema: 'auth',
      table: 'users',
    });
  });
});

describe('parseTableStatement — création, ajouts et retraits', () => {
  it('un `ADD CONSTRAINT` nommé porte son mot-clé UNE seule fois', () => {
    // Mesuré : la lecture recollait le mot-clé sur un texte qui le portait déjà.
    const parsed = parseTable(
      "ALTER TABLE public.payments ADD CONSTRAINT payments_months_shape_check CHECK (months::text ~ '^\\{.*\\}$')",
    )!;
    assert.equal(parsed.action, 'alter');
    assert.equal(parsed.constraints.length, 1);
    assert.equal(parsed.constraints[0]!.type, 'c');
    assert.equal(parsed.constraints[0]!.display, "CHECK (months::text ~ '^\\{.*\\}$')");
  });

  it('un `DROP CONSTRAINT` est un retrait, un `DROP COLUMN` nomme la colonne', () => {
    const parsed = parseTable(
      'ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_months_shape_check, DROP COLUMN IF EXISTS months',
    )!;
    assert.deepEqual(parsed.drops, [{ type: 'constraint', name: 'payments_months_shape_check' }]);
    assert.deepEqual(parsed.columns, ['months']);
  });

  it('`CREATE TABLE … AS SELECT` déclare une table SANS contrainte, et ne se perd pas dans ce qui suit', () => {
    const parsed = parseTable('CREATE TABLE public.copy AS SELECT id FROM public.students;')!;
    assert.deepEqual(parsed, { action: 'create', table: 'copy', schema: 'public', constraints: [] });
  });
});

describe('parseCreateTrigger — la structure sur la vue masquée, la condition sur le texte', () => {
  it('lit le moment, les événements, la portée, la fonction et le WHEN', () => {
    const parsed = parseTrigger(
      "CREATE TRIGGER trg BEFORE INSERT OR UPDATE ON public.t FOR EACH ROW WHEN (new.status = 'payé') EXECUTE FUNCTION public.f();",
    )!;
    assert.equal(parsed.name, 'trg');
    assert.equal(parsed.timing, 'BEFORE');
    assert.deepEqual(parsed.events, ['INSERT', 'UPDATE']);
    assert.equal(parsed.orientation, 'ROW');
    assert.equal(parsed.functionName, 'f');
    assert.equal(parsed.when, "new.status = 'payé'", 'le littéral fait partie de la règle : il survit au blanchiment');
  });

  it('sans `FOR EACH ROW`, c’est STATEMENT — ce que Postgres applique', () => {
    const parsed = parseTrigger('CREATE TRIGGER trg AFTER INSERT ON public.t EXECUTE FUNCTION public.f()')!;
    assert.equal(parsed.orientation, 'STATEMENT');
    assert.equal(parsed.when, null);
  });

  it('un `CREATE TRIGGER` raconté dans un commentaire ne déclare rien', () => {
    const { declared } = replay([
      file('1.sql', '-- CREATE TRIGGER trg AFTER INSERT ON public.t EXECUTE FUNCTION public.f();\nSELECT 1;'),
    ]);
    assert.equal(declared.triggers.size, 0);
  });
});

// ─── Le catalogue ────────────────────────────────────────────────────────────

describe('hostedObjectsFromRows — ce que la base dit, et ce qu’elle ne dit pas', () => {
  it('l’index d’une clé (`constraint_owned`) n’est pas un index déclaré', () => {
    const hosted = hostedFrom({
      indexes: [
        indexRow('students', 'students_pkey', 'CREATE UNIQUE INDEX students_pkey ON public.students USING btree (id)', true),
        indexRow('students', 'students_name_idx', 'CREATE INDEX students_name_idx ON public.students USING btree (lower(btrim(name)))'),
      ],
    });
    assert.deepEqual(
      [...hosted.indexes.keys()],
      ['index::public.students_name_idx'],
      'la clé se compare du côté CONTRAINTE, une fois',
    );
  });

  it('un type hors modèle est NOMMÉ (`unmodeled`), jamais comparé en silence', () => {
    // PostgreSQL 18 inscrira les NOT NULL dans pg_constraint : ce jour-là elles
    // doivent apparaître « hors modèle », pas en dérive.
    const hosted = hostedFrom({ constraints: [constraintRow('t', 't_a_not_null', 'n', 'NOT NULL a')] });
    assert.deepEqual(hosted.unmodeled, [{ kind: 'constraint', table: 't', name: 't_a_not_null', type: 'n' }]);
    assert.equal(hosted.constraints.size, 0);
  });

  it('un déclencheur désactivé se VOIT', () => {
    const hosted = hostedFrom({
      triggers: [
        {
          schema: 'public',
          tablename: 't',
          tgname: 'trg',
          tgenabled: 'D',
          definition: 'CREATE TRIGGER trg BEFORE INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION public.f()',
        },
      ],
    });
    assert.equal(hosted.triggers.get('trigger::public.t::trg')!.enabled, false);
  });

  it('une ligne illisible rend le verdict FAUX — un objet non lu n’est pas un objet aligné', () => {
    const hosted = hostedFrom({
      indexes: [{ indexname: 'zzz', definition: 'pas un index' }],
      constraints: [constraintRow('students', 'students_pkey', 'p', 'PRIMARY KEY (id)')],
    });
    assert.equal(hosted.unreadable.length, 1);

    const declared = {
      constraints: new Map([
        [
          objectKey('constraint', { table: 'students', name: 'students_pkey' }),
          {
            kind: 'constraint',
            schema: 'public',
            table: 'students',
            name: 'students_pkey',
            type: 'p',
            definition: 'primary key id',
            display: 'PRIMARY KEY (id)',
            columns: ['id'],
            file: '1.sql',
          },
        ],
      ]),
    };
    const report = judge({ declared, hosted });
    assert.equal(report.drift, 0, 'aucune dérive nommée…');
    assert.equal(report.ok, false, '…et pourtant pas un vert : ce qui n’a pas été lu n’est pas lu');
    assert.match(report.problems.join('\n'), /n’a pas su la lire/);
  });
});

// ─── Le rejeu des migrations ─────────────────────────────────────────────────

describe('declaredObjectsAndRetired — ce que les migrations LAISSENT', () => {
  const constraint = (name: string) =>
    `ALTER TABLE public.payments ADD CONSTRAINT ${name} CHECK (months::text ~ '^\\{a\\}$');`;

  it('`DROP CONSTRAINT` puis `ADD` laisse, `ADD` puis `DROP` retire', () => {
    const kept = replay([
      file('1.sql', `ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_months_shape_check;\n${constraint('payments_months_shape_check')}`),
    ]);
    assert.equal(kept.declared.constraints.has('constraint::public.payments::payments_months_shape_check'), true);
    assert.deepEqual(kept.retired, [], 'le net est un maintien, donc rien n’est retiré');

    const gone = replay([
      file('1.sql', `${constraint('payments_months_shape_check')}\nALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_months_shape_check;`),
    ]);
    assert.equal(gone.declared.constraints.has('constraint::public.payments::payments_months_shape_check'), false);
    assert.deepEqual(gone.retired.map((entry) => entry.cause), ['drop-object']);
  });

  it('une table (re)créée repart de zéro : `payments_pkey`, jamais `payments_pkey1`', () => {
    const { declared } = replay([
      file('1.sql', 'CREATE TABLE public.payments (id UUID PRIMARY KEY);'),
      file('2.sql', 'DROP TABLE public.payments;\nCREATE TABLE public.payments (id UUID PRIMARY KEY);'),
    ]);
    assert.equal(declared.constraints.has('constraint::public.payments::payments_pkey'), true);
    assert.equal(
      [...declared.constraints.keys()].some((key) => key.endsWith('payments_pkey1')),
      false,
      'les noms implicites suivent la table qui les porte, pas l’historique du fichier',
    );
  });

  it('un `DROP TABLE` dans un bloc `DO $$ … $$` emporte ce que la table portait, et le NOMME', () => {
    const { declared, retired } = replay([
      file(
        '1.sql',
        'CREATE TABLE public.custom_grades (id UUID PRIMARY KEY);\nCREATE INDEX custom_grades_name_idx ON public.custom_grades (id);',
      ),
      file(
        '2.sql',
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custom_grades') THEN DROP TABLE public.custom_grades; END IF; END $$;",
      ),
    ]);
    assert.equal(declared.constraints.has('constraint::public.custom_grades::custom_grades_pkey'), false);
    assert.equal(declared.indexes.has('index::public.custom_grades_name_idx'), false);
    assert.equal(retired.length, 2, 'les deux objets de la table sont comptés, pas un seul');
    for (const entry of retired) {
      assert.equal(entry.cause, 'drop-table', 'la CAUSE du retrait est dite, jamais « disparu »');
      assert.equal(entry.droppedBy, '2.sql');
      assert.equal(entry.declaredBy, '1.sql');
    }
  });

  it('sans le `DROP TABLE`, rien n’est retiré — sinon le cas précédent serait vert parce qu’il ne lit rien', () => {
    const { declared, retired } = replay([
      file('1.sql', 'CREATE TABLE public.custom_grades (id UUID PRIMARY KEY);'),
    ]);
    assert.equal(declared.constraints.has('constraint::public.custom_grades::custom_grades_pkey'), true);
    assert.deepEqual(retired, []);
  });

  it('une colonne retirée emporte ses contraintes ET les index qui la nomment', () => {
    const { declared, retired } = replay([
      file(
        '1.sql',
        `${constraint('payments_months_shape_check')}\nCREATE INDEX payments_months_idx ON public.payments (months);\nCREATE INDEX payments_date_idx ON public.payments (date);`,
      ),
      file('2.sql', 'ALTER TABLE public.payments DROP COLUMN IF EXISTS months;'),
    ]);
    assert.equal(declared.constraints.has('constraint::public.payments::payments_months_shape_check'), false);
    assert.equal(declared.indexes.has('index::public.payments_months_idx'), false);
    assert.equal(
      declared.indexes.has('index::public.payments_date_idx'),
      true,
      'l’index d’une autre colonne survit : un retrait ne peut pas être plus large que sa cause',
    );
    for (const entry of retired) assert.equal(entry.cause, 'drop-column');
  });
});

// ─── Le verdict ──────────────────────────────────────────────────────────────

describe('judgeObjectDrift — les trois formes de dérive', () => {
  const declared = () =>
    replay([
      file(
        '20261011000000_payments_months.sql',
        `ALTER TABLE public.payments ADD CONSTRAINT payments_months_shape_check CHECK (months::text ~ '^\\{a\\}$');\n` +
          'CREATE INDEX payments_months_idx ON public.payments (months);\n' +
          'CREATE TRIGGER payments_touch AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch();',
      ),
    ]).declared;

  const hostedWith = (constraintDefs: string[], indexDef: string) =>
    hostedFrom({
      indexes: [indexRow('payments', 'payments_months_idx', indexDef)],
      constraints: constraintDefs.map((definition) => constraintRow('payments', 'payments_months_shape_check', 'c', definition)),
      triggers: [
        {
          schema: 'public',
          tablename: 'payments',
          tgname: 'payments_touch',
          tgenabled: 'O',
          definition:
            'CREATE TRIGGER payments_touch AFTER UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch()',
        },
      ],
    });

  it('une contrainte absente est NOMMÉE avec le fichier qui la déclare', () => {
    const report = judge({
      declared: declared(),
      hosted: hostedWith([], 'CREATE INDEX payments_months_idx ON public.payments USING btree (months)'),
    });
    assert.deepEqual(report.missing.map((item) => item.name), ['payments_months_shape_check']);
    assert.equal(report.missing[0]!.file, '20261011000000_payments_months.sql');
    assert.equal(report.ok, false);
    assert.equal(report.drift, 1);
  });

  it('un index CHANGÉ est nommé champ par champ, dans la forme ÉCRITE', () => {
    const report = judge({
      declared: declared(),
      hosted: hostedWith([], 'CREATE INDEX payments_months_idx ON public.payments USING btree (months, date)'),
    });
    const changed = report.changed.find((item) => item.name === 'payments_months_idx')!;
    assert.equal(changed.differences[0]!.field, 'colonnes');
    assert.equal(changed.differences[0]!.declared, 'months');
    assert.equal(changed.differences[0]!.base, 'months, date');
  });

  it('un objet EN TROP est décrit par ce qu’il est, et lui seul fait la dérive', () => {
    const want = declared().constraints.get(
      objectKey('constraint', { table: 'payments', name: 'payments_months_shape_check' }),
    ) as unknown as ConstraintRecord;
    // Le catalogue est ici CONFORME, plus un index qu’aucune migration ne déclare.
    const hosted = hostedWith([want.display], 'CREATE INDEX payments_months_idx ON public.payments USING btree (months)');
    const withLegacy = hostedFrom({
      ...rowsFromHosted(hosted),
      indexes: [
        indexRow('payments', 'payments_months_idx', 'CREATE INDEX payments_months_idx ON public.payments USING btree (months)'),
        indexRow('payments', 'payments_legacy_idx', 'CREATE UNIQUE INDEX payments_legacy_idx ON public.payments USING btree (receipt_number)'),
      ],
    });
    const report = judge({ declared: declared(), hosted: withLegacy });
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.changed, []);
    assert.deepEqual(report.extra.map((item) => item.name), ['payments_legacy_idx']);
    assert.match(report.extra[0]!.detail, /UNIQUE btree \(receipt_number\)/);
    assert.equal(report.ok, false);
  });

  it('un regard qui n’a rien atteint n’est pas un vert', () => {
    assert.equal(judge({ declared: new Map(), hosted: new Map() }).vacuous, true);
    assert.equal(judge({ declared: new Map(), hosted: new Map() }).ok, false);
    assert.equal(judge({ declared: declared(), hosted: new Map() }).vacuous, true, 'rien en base ⇒ rien jugé');
  });
});

describe('les exemptions sont bornées DANS LES DEUX SENS', () => {
  const declared = () =>
    replay([
      file('1.sql', "ALTER TABLE public.payments ADD CONSTRAINT attendue CHECK (months::text ~ '^\\{a\\}$');"),
    ]).declared;
  const hosted = () =>
    hostedFrom({
      constraints: [
        constraintRow('payments', 'heritee', 'c', "CHECK (months::text ~ '^\\{b\\}$')"),
        constraintRow('payments', 'attendue', 'c', "CHECK (months::text ~ '^\\{a\\}$')"),
      ],
    });

  it('motivée, elle est retenue et rapportée', () => {
    const report = judge({
      declared: declared(),
      hosted: hosted(),
      exemptions: [
        { kind: 'constraint', table: 'payments', name: 'heritee', reason: 'génération d’avant les migrations, retrait à décider' },
      ],
    });
    assert.deepEqual(report.exempted.map((entry) => entry.name), ['heritee']);
    assert.equal(report.extra.length, 0);
    assert.equal(report.ok, true);
  });

  it('muette, elle est un problème — pas un silence', () => {
    const report = judge({
      declared: declared(),
      hosted: hosted(),
      exemptions: [{ kind: 'constraint', table: 'payments', name: 'heritee', reason: '   ' }],
    });
    assert.match(report.problems.join('\n'), /exemption muette/);
  });

  it('périmée, elle est un problème : elle autoriserait un retour en arrière', () => {
    const report = judge({
      declared: declared(),
      hosted: hosted(),
      exemptions: [{ kind: 'constraint', table: 'payments', name: 'disparue', reason: 'raison' }],
    });
    assert.match(report.problems.join('\n'), /exemption périmée/);
  });

  it('et elle ne peut pas couvrir un objet que les migrations DÉCLARENT', () => {
    const report = judge({
      declared: declared(),
      hosted: hosted(),
      exemptions: [{ kind: 'constraint', table: 'payments', name: 'attendue', reason: 'raison' }],
    });
    assert.match(report.problems.join('\n'), /une migration le DÉCLARE/);
    assert.equal(report.ok, false);
  });
});

// ─── Le cas mesuré : la contrainte NOMMÉE du corpus ──────────────────────────

describe('la contrainte nommée du corpus — la dérive qui n’existait que dans le module', () => {
  const migration = readMigrations().find((entry) => entry.name === '20261011000000_payments_months.sql')!;
  const { declared } = replay([migration]);
  const key = objectKey('constraint', { table: 'payments', name: 'payments_months_shape_check' });
  const wanted = declared.constraints.get(key) as unknown as ConstraintRecord;
  const literal = /'([\s\S]*)'/.exec(wanted.display)![1];

  it('la déclaration du corpus porte son mot-clé UNE fois', () => {
    assert.ok(wanted, 'la migration du 2026-10-11 doit déclarer payments_months_shape_check');
    assert.match(wanted.display, /^CHECK \(months::text ~ '/);
    assert.doesNotMatch(wanted.display, /\bCHECK\s+CHECK\b/);
    assert.doesNotMatch(wanted.definition, /check check/);
  });

  it('le rendu de Postgres (double parenthèse, `::text` explicite) n’est PAS une dérive', () => {
    // `pg_get_constraintdef` rend `CHECK (((months)::text ~ '…'::text))` : la même
    // règle, écrite autrement. Un contrôle qui crie là-dessus ne se lit plus.
    const report = judge({
      declared,
      hosted: hostedFrom({
        constraints: [constraintRow('payments', 'payments_months_shape_check', 'c', `CHECK ((months::text ~ '${literal}'::text))`)],
      }),
    });
    assert.deepEqual(report.changed, []);
    assert.equal(report.matched, report.declaredCount);
    assert.equal(report.ok, true, JSON.stringify(report.problems));
  });

  it('mais une définition DOUBLÉE (`CHECK CHECK (…)`) serait bien une dérive', () => {
    // C'est l'état que produisait la lecture avant correction : la garantie est
    // donc tenue dans les deux sens, sinon « vert » pourrait vouloir dire « rien lu ».
    const doubled = `CHECK CHECK (months::text ~ '${literal}')`;
    const report = judge({
      declared: {
        constraints: new Map([
          [key, { ...wanted, definition: normalizeDefinition(doubled), display: doubled }],
        ]),
      },
      hosted: hostedFrom({
        constraints: [constraintRow('payments', 'payments_months_shape_check', 'c', wanted.display)],
      }),
    });
    assert.equal(report.changed.length, 1);
    assert.equal(report.changed[0]!.differences[0]!.field, 'définition');
    assert.match(report.changed[0]!.differences[0]!.declared, /CHECK CHECK/);
  });
});

// ─── Le corpus réel, relu des deux côtés ─────────────────────────────────────

describe('le corpus des migrations est lu pour de vrai', () => {
  const migrations = readMigrations();
  const { declared, tables, retired } = replay(migrations);
  const catalogue = catalogueFrom(declared);

  it('les trois familles sont déclarées, et les noms implicites sont DÉRIVÉS', () => {
    assert.ok(declared.indexes.size >= 5, `${declared.indexes.size} index déclarés`);
    assert.ok(declared.constraints.size >= 10, `${declared.constraints.size} contraintes déclarées`);
    assert.ok(declared.triggers.size >= 1, `${declared.triggers.size} déclencheurs déclarés`);

    const names = new Set([...declared.constraints.keys()].map((entry) => entry.split('::')[2]));
    for (const name of ['parents_pkey', 'students_student_id_key', 'students_parent_id_fkey', 'user_profiles_role_check']) {
      assert.ok(names.has(name), `${name} doit être dérivé des migrations`);
    }
    assert.ok(declared.triggers.has('trigger::auth.users::on_auth_user_created'), 'le déclencheur des profils est déclaré');
  });

  it('aucune définition déclarée ne porte un mot-clé DOUBLÉ', () => {
    for (const record of [...declared.constraints.values()] as unknown as ConstraintRecord[]) {
      assert.doesNotMatch(
        record.display,
        /^(CHECK|UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|EXCLUDE)\s+\1\b/i,
        `définition doublée : ${record.display}`,
      );
    }
  });

  it('les tables lues sont bornées : celles que le corpus CRÉE, et toute table qu’un déclencheur CIBLE', () => {
    const watched = watchedTables(tables);
    assert.ok(watched.owned.tables.includes('students'));
    assert.ok(watched.owned.tables.includes('payments'));
    assert.equal(watched.owned.tables.includes('users'), false, 'auth.users n’appartient pas au corpus');
    assert.ok(watched.targeted.tables.includes('users'), 'mais son déclencheur, lui, doit être lu');
    assert.deepEqual(watched.owned.schemas, ['public']);
    assert.ok(watched.targeted.schemas.includes('auth'));
  });

  it('le catalogue reconstitué depuis les déclarations juge VERT', () => {
    const report = judge({ declared: { ...declared, retired }, hosted: catalogue() });
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.changed, [], JSON.stringify(report.changed));
    assert.deepEqual(report.extra, []);
    assert.equal(report.matched, report.declaredCount);
    assert.equal(report.ok, true);
  });

  it('et il devient ROUGE dès qu’un objet déclaré manque au catalogue', () => {
    const [firstKey, first] = [...declared.constraints.entries()][0]!;
    const report = judge({ declared: { ...declared, retired }, hosted: catalogue(firstKey) });
    assert.deepEqual(report.missing.map((item) => item.name), [first.name]);
    assert.equal(report.changed.length, 0, 'le reste du catalogue est intact : le rouge vient de CE retrait');
    assert.equal(report.ok, false);
  });
});

// ─── Le contrôle est-il câblé ? ──────────────────────────────────────────────

describe('le contrôle est câblé — script npm, veille et inventaire des immunités', () => {
  it('package.json nomme le script, la veille l’appelle par son nom, l’inventaire le déclare', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:db-objects'], /check-db-objects\.mjs/);

    const watch = readFileSync(join(ROOT, '.github/workflows/public-rls-watch.yml'), 'utf8');
    assert.match(watch, /npm run check:db-objects/, 'la veille appelle le script par son nom, jamais une copie de la commande');
    assert.match(watch, /scripts\/lib\/db-objects\.mjs/, 'et elle se déclenche quand le contrôle ou son module change');

    const inventory = readFileSync(join(ROOT, 'scripts/lib/guard-immunity.mjs'), 'utf8');
    assert.match(inventory, /check: 'check-db-objects\.mjs'/);
  });
});
