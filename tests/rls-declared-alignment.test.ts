/**
 * Suite for `supabase/migrations/20261017000000_rls_declared_alignment.sql` —
 * l'alignement de `academic_years`, `user_profiles` et `todos` sur ce que le
 * dépôt DÉCLARE.
 *
 * ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
 * `npm run check:rls-policies` nommait NEUF écarts. Cinq étaient des politiques
 * qu'AUCUNE migration ne déclare ni ne retire — la génération d'avant les
 * migrations, sur `academic_years` (« Admin manage academic_years »,
 * « Authenticated read academic_years »), `user_profiles` (« Admin can update
 * profiles », « Users can read own profile or admin reads all ») et `todos`
 * (« Authenticated users can manage todos », un `ALL … true`). Deux étaient des
 * MANQUES sur `academic_years` : les noms que `20260820000000` déclare
 * (« Allow admin write access on academic_years », « Allow authenticated read
 * access on academic_years ») n'avaient jamais été posés. Les deux derniers
 * (`custom_grades`) n'étaient pas des droits : la table est RETIRÉE par
 * `20260828000004`, et le contrôle qui les réclamait a été corrigé
 * (`tests/rls-policies.test.ts`).
 *
 * ─── Ce que cette suite PROUVE, sur les seuls fichiers ─────────────────────
 *   1. le fichier ne porte que des gestes de POLITIQUE (retraits, poses) et le
 *      `NOTIFY` de fin — aucune table, aucun autre objet ;
 *   2. les CINQ retraits sont exactement ceux qui ont été mesurés en base, table
 *      par table (liste figée : y toucher sans mettre à jour la preuve rougit) ;
 *   3. les DEUX poses sont copiées de `20260820000000` : même commande, mêmes
 *      rôles, mêmes `USING` et `WITH CHECK` — un RENOMMAGE, pas une règle
 *      réécrite ; la question est doublée d'une mutation, sans quoi elle pourrait
 *      être verte parce qu'elle ne compare rien ;
 *   4. aucun retrait ne vise une politique DÉCLARÉE (hors celles que le fichier
 *      repose dans le même souffle) : retirer une règle du dépôt serait un
 *      resserrement, pas une déduplication ;
 *   5. chaque retrait laisse, sur la même table, un homologue DÉCLARÉ qui couvre
 *      sa COMMANDE — un `ALL … true` en exige quatre (SELECT, INSERT, UPDATE,
 *      DELETE), un `SELECT` un seul : sinon le retrait fermerait la lecture ou
 *      l'écriture à tout le monde ;
 *   6. `custom_grades` n'est PAS touchée par ce fichier, et les deux noms que le
 *      contrôle réclamait sont nommés comme retirés par la chute de leur table.
 *
 * ─── Ce que cette suite NE PROUVE PAS, et il faut le dire ──────────────────
 * Que l'effet des cinq retraits soit ÉGAL à celui des politiques déclarées qui
 * restent. Cette égalité a été MESURÉE sur la base réelle : la carte des droits
 * (par rôle, par table, par commande, lecture comprise) est IDENTIQUE avant et
 * après l'application — le relevé vit dans `DEVELOPMENT_HISTORY.md`. Un test hors
 * ligne compare du texte ; il peut dire qu'une règle subsiste et qu'elle est la
 * même que celle que le dépôt déclarait déjà, pas que l'union des politiques d'une
 * table n'a pas bougé. Croire le contraire serait le faux vert que ce dépôt
 * pourchasse.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectRoleSets,
  declaredPoliciesAndRetired,
  declaredPoliciesFromMigrations,
  expressionTokens,
  parseCreatePolicy,
  parseDropPolicy,
  policyKey,
  statementSpans,
} from '../scripts/lib/rls-policies.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const MIGRATION_FILE = '20261017000000_rls_declared_alignment.sql';

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

const alignment = migrations.find((migration) => migration.name === MIGRATION_FILE);
// Ce que le dépôt déclarait AVANT ce fichier : c'est à cette liste que les deux
// poses sont comparées, pour prouver qu'aucune règle n'est réécrite.
const before = migrations.filter((migration) => migration.name !== MIGRATION_FILE);
const declaredBefore = declaredPoliciesFromMigrations(before);
const declaredAfter = declaredPoliciesFromMigrations(migrations);
const roleSets = collectRoleSets(migrations);

const statements = alignment ? statementSpans(alignment.sql) : [];
const writtenDrops = statements
  .map((span) => parseDropPolicy(span))
  .filter((drop): drop is { name: string; table: string } => drop !== null);
const writtenCreates = statements
  .map((span) => parseCreatePolicy(span))
  .filter((created): created is NonNullable<ReturnType<typeof parseCreatePolicy>> => created !== null);

/**
 * Les cinq retraits, tels qu'ils ont été MESURÉS dans `pg_policies` le
 * 2026-10-13 — table, nom, et la commande que la base exécutait. La commande est
 * figée ici parce qu'elle n'existe nulle part ailleurs : ces politiques ne sont
 * dans aucune migration.
 */
const MEASURED_RETIREMENTS = [
  { table: 'academic_years', name: 'Authenticated read academic_years', cmd: 'SELECT' },
  { table: 'academic_years', name: 'Admin manage academic_years', cmd: 'ALL' },
  { table: 'user_profiles', name: 'Users can read own profile or admin reads all', cmd: 'SELECT' },
  { table: 'user_profiles', name: 'Admin can update profiles', cmd: 'UPDATE' },
  { table: 'todos', name: 'Authenticated users can manage todos', cmd: 'ALL' },
];

/** Les deux noms que le fichier POSE, copiés de `20260820000000`. */
const POSED = [
  { table: 'academic_years', name: 'Allow authenticated read access on academic_years' },
  { table: 'academic_years', name: 'Allow admin write access on academic_years' },
];

const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** Les retraits qui viseraient une politique déclarée, hors celles reposées ici. */
const collidingDrops = (
  declaredKeys: Set<string>,
  drops: readonly { table: string; name: string }[],
  posedKeys: Set<string>,
) =>
  drops
    .filter((drop) => !posedKeys.has(policyKey(drop.table, drop.name)))
    .filter((drop) => declaredKeys.has(policyKey(drop.table, drop.name)))
    .map((drop) => `${drop.table}::${drop.name}`);

/**
 * Les poses dont la règle DIFFÈRE de celle que le dépôt déclarait déjà.
 *
 * C'est la question du renommage : une pose dont la commande, les rôles ou une
 * condition changent n'est plus un renommage, c'est un changement de DROITS
 * déguisé en alignement.
 */
const changedPoses = (
  declared: Map<string, { cmd: string; roles: string[]; using: string | null; check: string | null }>,
  creates: readonly {
    name: string;
    table: string;
    cmd: string;
    roles: string[];
    using: string | null;
    check: string | null;
  }[],
) =>
  creates
    .filter((created) => {
      const known = declared.get(policyKey(created.table, created.name));
      if (!known) return true;
      if (known.cmd !== created.cmd || known.roles.join(',') !== created.roles.join(',')) return true;
      return (['using', 'check'] as const).some(
        (field) => expressionTokens(known[field]).join(' ') !== expressionTokens(created[field]).join(' '),
      );
    })
    .map((created) => `${created.table}::${created.name}`);

/** Les retraits sans homologue déclaré couvrant leur commande. */
const uncoveredRetirements = (
  declared: Map<string, { table: string; cmd: string }>,
  retirements: readonly { table: string; name: string; cmd: string }[],
) =>
  retirements
    .filter((retirement) => {
      const needed = retirement.cmd === 'ALL' ? COMMANDS : [retirement.cmd];
      return needed.some(
        (command) =>
          ![...declared.values()].some(
            (policy) => policy.table === retirement.table && (policy.cmd === command || policy.cmd === 'ALL'),
          ),
      );
    })
    .map((retirement) => `${retirement.table}::${retirement.name} (${retirement.cmd})`);

const posedKeys = new Set(writtenCreates.map((created) => policyKey(created.table, created.name)));

/**
 * Les retraits RÉELS : les `DROP` qui ne visent pas un nom reposé plus bas.
 *
 * Le fichier retire AUSSI les deux noms qu'il repose (rejouabilité : un rejeu ne
 * s'interrompt pas sur « policy already exists ») — ce ne sont pas des retraits,
 * et les compter comme tels ferait passer un renommage pour une fermeture.
 */
const retirements = writtenDrops.filter((drop) => !posedKeys.has(policyKey(drop.table, drop.name)));

describe('l’alignement déclaré — le fichier lui-même', () => {
  it('existe, et il y a bien un fichier à juger', () => {
    assert.ok(alignment, `${MIGRATION_FILE} est introuvable — un contrôle sans corpus ne prouve rien`);
    assert.ok(statements.length > 0, 'le fichier ne porte aucune instruction lisible');
  });

  it('ne porte que des gestes de politique — rien d’autre que retraits, poses et le NOTIFY', () => {
    const other = statements.filter(
      (span) =>
        !/^\s*DROP\s+POLICY\b/i.test(span.masked) &&
        !/^\s*CREATE\s+POLICY\b/i.test(span.masked) &&
        !/^\s*NOTIFY\b/i.test(span.masked),
    );
    assert.deepEqual(
      other.map((span) => span.masked.replace(/\s+/g, ' ').trim().slice(0, 60)),
      [],
      'une migration d’alignement qui touche autre chose qu’un droit ne se relit pas comme un alignement',
    );
  });

  it('porte `IF EXISTS` sur chaque retrait — le fichier se rejoue', () => {
    const withoutIfExists = statements
      .filter((span) => /^\s*DROP\s+POLICY\b/i.test(span.masked))
      .filter((span) => !/^\s*DROP\s+POLICY\s+IF\s+EXISTS\b/i.test(span.masked))
      .map((span) => span.masked.replace(/\s+/g, ' ').trim().slice(0, 80));
    assert.deepEqual(
      withoutIfExists,
      [],
      'un `DROP POLICY` sans `IF EXISTS` interrompt un rejeu au premier nom déjà parti',
    );
  });

  it('retire EXACTEMENT les cinq politiques héritées mesurées en base', () => {
    const written = retirements.map((drop) => policyKey(drop.table, drop.name)).sort();
    const measured = MEASURED_RETIREMENTS.map((drop) => policyKey(drop.table, drop.name)).sort();
    assert.deepEqual(written, measured, 'la liste des retraits a changé : la preuve doit suivre');
  });

  it('les deux autres `DROP` ne visent QUE les noms reposés plus bas — la rejouabilité, pas un retrait', () => {
    const replayDrops = writtenDrops
      .filter((drop) => posedKeys.has(policyKey(drop.table, drop.name)))
      .map((drop) => policyKey(drop.table, drop.name))
      .sort();
    assert.deepEqual(replayDrops, [...posedKeys].sort());
  });

  it('ne touche que les trois tables de la demande', () => {
    assert.deepEqual(
      [...new Set(writtenDrops.map((drop) => drop.table))].sort(),
      ['academic_years', 'todos', 'user_profiles'],
    );
  });

  it('ne touche PAS `custom_grades` : sa table est retirée par le dépôt, elle ne se répare pas ici', () => {
    const mentions = statements
      .filter((span) => /custom_grades/i.test(span.masked))
      .map((span) => span.masked.replace(/\s+/g, ' ').trim().slice(0, 60));
    assert.deepEqual(mentions, [], 'aucune instruction ne doit parler d’une table retirée');
  });
});

describe('les deux poses sont des RENOMMAGES — la règle ne change pas', () => {
  it('pose exactement les deux noms déclarés par `20260820000000`', () => {
    assert.deepEqual(
      writtenCreates.map((created) => policyKey(created.table, created.name)).sort(),
      POSED.map((posed) => policyKey(posed.table, posed.name)).sort(),
    );
  });

  it('chaque pose est identique, champ par champ, à ce que le dépôt déclarait déjà', () => {
    assert.deepEqual(changedPoses(declaredBefore, writtenCreates), [], 'une pose qui réécrit une règle est un changement de droits');
    // Et la question n’est pas vide : le corpus DÉCLARE bien ces deux noms avant
    // ce fichier, donc la comparaison porte sur quelque chose.
    for (const posed of POSED) {
      assert.ok(
        declaredBefore.has(policyKey(posed.table, posed.name)),
        `${posed.name} doit être déclarée par 20260820000000 — sinon la comparaison ne compare rien`,
      );
    }
  });

  it('la MÊME question rougit sur une pose qui changerait une condition', () => {
    // Preuve par mutation : `USING (true)` à la place d'`is_admin()` sur le nom
    // déclaré — un élargissement déguisé en renommage.
    const mutation = [
      {
        name: 'Allow admin write access on academic_years',
        table: 'academic_years',
        cmd: 'ALL',
        roles: ['authenticated'],
        using: 'true',
        check: 'true',
      },
    ];
    assert.deepEqual(changedPoses(declaredBefore, mutation), ['academic_years::Allow admin write access on academic_years']);
  });

  it('et les rôles ou la commande comptent aussi', () => {
    const mutation = [
      {
        name: 'Allow authenticated read access on academic_years',
        table: 'academic_years',
        cmd: 'SELECT',
        roles: ['public'],
        using: 'true',
        check: null,
      },
    ];
    assert.deepEqual(changedPoses(declaredBefore, mutation), ['academic_years::Allow authenticated read access on academic_years']);
  });
});

describe('aucun droit n’est fermé — l’invariant du retrait', () => {
  const declaredKeys = new Set(declaredBefore.keys());

  it('le corpus est lu — un scan vide n’est pas un scan vert', () => {
    assert.ok(declaredKeys.size > 0, `${before.length} migrations lues et aucune politique déclarée`);
    for (const table of ['academic_years', 'user_profiles', 'todos']) {
      assert.ok(
        [...declaredKeys].some((key) => key.startsWith(`${table}::`)),
        `les tables visées doivent être VUES par la lecture qui juge les retraits (${table})`,
      );
    }
  });

  it('aucun retrait ne vise une politique déclarée, hors celles reposées ici', () => {
    assert.deepEqual(
      collidingDrops(declaredKeys, MEASURED_RETIREMENTS, posedKeys),
      [],
      'retirer une politique DÉCLARÉE retire une règle du dépôt — c’est un resserrement, pas une déduplication',
    );
  });

  it('et ce qui est déclaré ET retiré est REPOSÉ dans le même fichier', () => {
    const droppedButNotReposed = writtenDrops
      .filter((drop) => declaredKeys.has(policyKey(drop.table, drop.name)))
      .filter((drop) => !posedKeys.has(policyKey(drop.table, drop.name)))
      .map((drop) => `${drop.table}::${drop.name}`);
    assert.deepEqual(droppedButNotReposed, [], 'un nom déclaré ne doit pas disparaître du rejeu');
  });

  it('la MÊME question rougit sur un retrait qui viserait une politique déclarée', () => {
    const mutation = [{ table: 'students', name: 'Authenticated update students' }];
    assert.deepEqual(collidingDrops(declaredKeys, mutation, posedKeys), ['students::Authenticated update students']);
  });

  it('chaque retrait laisse, même table, un homologue déclaré qui couvre sa COMMANDE', () => {
    assert.deepEqual(
      uncoveredRetirements(declaredAfter, MEASURED_RETIREMENTS),
      [],
      'retirer la dernière règle d’une commande fermerait la lecture ou l’écriture à tout le monde',
    );
  });

  it('la commande `ALL` exige bien les quatre — la question n’est pas vide', () => {
    // Une table absente du corpus n’a aucun homologue : c’est la mutation qui
    // prouve que le calcul regarde vraiment quelque chose.
    const mutation = [{ table: 'ghost_table', name: 'Fantôme', cmd: 'ALL' }];
    assert.deepEqual(uncoveredRetirements(declaredAfter, mutation), ['ghost_table::Fantôme (ALL)']);
  });
});

describe('les deux « manques » de `custom_grades` sont nommés, pas tus', () => {
  it('le rejeu du corpus les retire par la chute de leur table, avec les deux fichiers', () => {
    const { declared, retired } = declaredPoliciesAndRetired(migrations);
    assert.deepEqual([...declared.keys()].filter((key) => key.startsWith('custom_grades::')), []);
    assert.deepEqual(retired.map((entry) => entry.name).sort(), [
      'Authenticated insert custom grades',
      'Authenticated read custom grades',
    ]);
    for (const entry of retired) {
      assert.equal(entry.droppedBy, '20260828000004_custom_classes.sql');
    }
  });
});
