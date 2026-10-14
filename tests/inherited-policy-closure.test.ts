/**
 * Suite for `supabase/migrations/20261015000000_inherited_policy_closure.sql` —
 * la fermeture des politiques HÉRITÉES de `students`, `parents`, `staff`,
 * `salary_payments` et `expenses`.
 *
 * ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
 * La base partagée portait quinze politiques que le dépôt ne déclare NI ne
 * retire : celles de sa mise en place MANUELLE, antérieures aux politiques du
 * dépôt — `20260809000000_auth_and_rls.sql` avait retiré les « Allow anonymous … »
 * et laissé celles-ci, un autre jeu de noms. `npm run check:rls-policies` les
 * nommait « en base, déclarée par AUCUNE migration », et elles y restaient depuis
 * que le défaut de `payments` avait été traité seul. Le fichier de fermeture les
 * retire — et cette suite tient les quatre choses qui font qu'un retrait est
 * SÛR, parce qu'un `DROP` mal visé retire un droit en silence.
 *
 * ─── Ce que cette suite PROUVE, et ce qu'elle ne prouve pas ─────────────────
 * Prouvé, sur le seul contenu des fichiers :
 *   1. le fichier ne contient QUE des retraits — rien n'ouvre, rien ne crée ;
 *   2. les quinze retraits sont EXACTEMENT ceux qui ont été mesurés en base,
 *      table par table (une liste figée : y toucher sans mettre à jour la preuve
 *      fait rougir la suite) ;
 *   3. aucun nom retiré n'est DÉCLARÉ par une migration du dépôt — c'est
 *      l'invariant qui compte : retirer une politique déclarée retirerait une
 *      RÈGLE, et c'est exactement ce qu'une fermeture ne doit jamais faire ;
 *   4. chaque retrait laisse, sur la même table et pour la même commande, au
 *      moins un homologue déclaré — donc une règle subsiste ;
 *   5. chaque retrait est `IF EXISTS` : le fichier se REJOUE (une migration
 *      appliquée deux fois ne doit pas s'interrompre au premier `DROP`).
 *
 * PAS prouvé ici, et il faut le dire : que l'effet des quinze retraits soit
 * ÉGAL à celui des politiques déclarées qui restent. Cette égalité a été MESURÉE
 * sur la base réelle — la carte des écritures (par rôle, par table, par commande,
 * colonne de l'argent comprise) est IDENTIQUE avant et après l'application ; elle
 * vit dans `DEVELOPMENT_HISTORY.md`. Un test hors ligne compare du texte : il
 * peut dire qu'une règle subsiste, pas qu'elle est aussi large — et un contrôle
 * qui laisserait croire le contraire serait le faux vert que ce dépôt pourchasse.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  declaredPoliciesFromMigrations,
  parseDropPolicy,
  policyKey,
  statementSpans,
} from '../scripts/lib/rls-policies.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const CLOSURE_FILE = '20261015000000_inherited_policy_closure.sql';

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

const closure = migrations.find((migration) => migration.name === CLOSURE_FILE);
const others = migrations.filter((migration) => migration.name !== CLOSURE_FILE);

/** Les politiques que le dépôt DÉCLARE (les `DROP` retirés du rejeu). */
const declared = declaredPoliciesFromMigrations(migrations);

/**
 * Les quinze retraits, tels qu'ils ont été MESURÉS dans `pg_policies` le
 * 2026-10-13 — table, nom, et la commande que la base exécutait.
 *
 * La commande est figée ici parce qu'elle n'existe NULLE PART ailleurs : ces
 * politiques ne sont dans aucune migration. C'est le fait mesuré, et c'est lui
 * qui rend vérifiable la case 4 (un homologue de la même commande subsiste).
 */
const MEASURED_DROPS = [
  { table: 'students', name: 'Authenticated users can read students', cmd: 'SELECT' },
  { table: 'students', name: 'Authenticated users can insert students', cmd: 'INSERT' },
  { table: 'students', name: 'Authenticated users can update students', cmd: 'UPDATE' },
  { table: 'students', name: 'Admin can delete students', cmd: 'DELETE' },
  { table: 'parents', name: 'Authenticated users can read parents', cmd: 'SELECT' },
  { table: 'parents', name: 'Authenticated users can insert parents', cmd: 'INSERT' },
  { table: 'parents', name: 'Authenticated users can update parents', cmd: 'UPDATE' },
  { table: 'parents', name: 'Admin can delete parents', cmd: 'DELETE' },
  { table: 'expenses', name: 'Authenticated users can read expenses', cmd: 'SELECT' },
  { table: 'expenses', name: 'Authenticated users can insert expenses', cmd: 'INSERT' },
  { table: 'expenses', name: 'Authenticated users can update expenses', cmd: 'UPDATE' },
  { table: 'expenses', name: 'Admin can delete expenses', cmd: 'DELETE' },
  { table: 'staff', name: 'Authenticated users can read staff', cmd: 'SELECT' },
  { table: 'staff', name: 'Admin can delete staff', cmd: 'DELETE' },
  { table: 'salary_payments', name: 'Authenticated users can read salary_payments', cmd: 'SELECT' },
];

/** Le fichier de fermeture, découpé en instructions — corps `$$ … $$` exclus. */
const closureStatements = closure ? statementSpans(closure.sql) : [];

/** Les retraits réellement écrits dans le fichier. */
const writtenDrops = closureStatements
  .map((span) => ({ span, drop: parseDropPolicy(span) }))
  .filter((entry) => entry.drop !== null)
  .map((entry) => entry.drop as { name: string; table: string });

/**
 * Les retraits qui viseraient une politique DÉCLARÉE par le dépôt.
 *
 * C'est LA question de l'invariant, et elle est écrite une fois pour être posée
 * deux fois : sur le fichier réel (qui doit rendre la liste vide), puis sur un
 * retrait FABRIQUÉ qui vise une politique déclarée (qui doit en rendre une) —
 * sans quoi l'invariant pourrait être vert parce qu'il ne regarde rien.
 */
const collidingDrops = (declaredKeys: Set<string>, drops: readonly { table: string; name: string }[]) =>
  drops
    .filter((drop) => declaredKeys.has(policyKey(drop.table, drop.name)))
    .map((drop) => `${drop.table}::${drop.name}`);

describe('la fermeture des politiques héritées — le fichier lui-même', () => {
  it('existe, et il y a bien un fichier à juger', () => {
    assert.ok(closure, `${CLOSURE_FILE} est introuvable — un contrôle sans corpus ne prouve rien`);
    assert.ok(closureStatements.length > 0, 'le fichier ne porte aucune instruction lisible');
  });

  it('ne contient QUE des retraits : rien n’ouvre, rien ne crée', () => {
    const opening = closureStatements.filter(
      (span) => !/^\s*DROP\s+POLICY\b/i.test(span.masked) && !/^\s*NOTIFY\b/i.test(span.masked),
    );
    assert.deepEqual(
      opening.map((span) => span.masked.replace(/\s+/g, ' ').trim().slice(0, 60)),
      [],
      'une fermeture qui crée ou modifie autre chose que des retraits ne se relit pas comme une fermeture',
    );
  });

  it('porte `IF EXISTS` sur chaque retrait — le fichier se rejoue', () => {
    const withoutIfExists = closureStatements
      .filter((span) => /^\s*DROP\s+POLICY\b/i.test(span.masked))
      .filter((span) => !/^\s*DROP\s+POLICY\s+IF\s+EXISTS\b/i.test(span.masked))
      .map((span) => span.masked.replace(/\s+/g, ' ').trim().slice(0, 80));
    assert.deepEqual(
      withoutIfExists,
      [],
      'un `DROP POLICY` sans `IF EXISTS` interrompt un rejeu au premier nom déjà parti',
    );
  });

  it('retire EXACTEMENT les quinze politiques héritées mesurées en base', () => {
    const written = writtenDrops.map((drop) => policyKey(drop.table, drop.name)).sort();
    const measured = MEASURED_DROPS.map((drop) => policyKey(drop.table, drop.name)).sort();
    assert.deepEqual(written, measured, 'la liste des retraits a changé : la preuve doit suivre');
  });

  it('ne touche QUE les cinq tables de la demande', () => {
    const tables = [...new Set(writtenDrops.map((drop) => drop.table))].sort();
    assert.deepEqual(tables, ['expenses', 'parents', 'salary_payments', 'staff', 'students']);
  });
});

/** Les politiques que le dépôt déclare HORS de la fermeture. */
const declaredWithoutClosure = declaredPoliciesFromMigrations(others);
const declaredKeys = new Set(declaredWithoutClosure.keys());

describe('la fermeture ne retire aucun DROIT — l’invariant', () => {
  it('le corpus est lu — un scan vide n’est pas un scan vert', () => {
    assert.ok(declaredKeys.size > 0, `${others.length} migrations lues et aucune politique déclarée : il n’y a rien à comparer`);
    assert.ok(
      [...declaredKeys].some((key) => key.startsWith('students::')) &&
        [...declaredKeys].some((key) => key.startsWith('staff::')),
      'les tables visées doivent être VUES par la lecture qui juge les retraits',
    );
  });

  it('aucun nom retiré n’est déclaré par une migration du dépôt', () => {
    assert.deepEqual(
      collidingDrops(declaredKeys, MEASURED_DROPS),
      [],
      'retirer une politique DÉCLARÉE retire une règle du dépôt — c’est un resserrement, pas une déduplication',
    );
  });

  it('la MÊME question rougit sur un retrait qui viserait une politique déclarée', () => {
    // Preuve par mutation : on fabrique le retrait que l'invariant interdit et on
    // exige que la question le voie. Sans ce cas, le précédent pourrait être vert
    // parce qu'il ne regarde rien.
    const mutation = [{ table: 'students', name: 'Authenticated update students' }];
    assert.deepEqual(collidingDrops(declaredKeys, mutation), ['students::Authenticated update students']);
  });

  it('chaque retrait laisse, même table et même commande, un homologue DÉCLARÉ', () => {
    const orphans = MEASURED_DROPS.filter(
      (drop) =>
        ![...declared.values()].some(
          (policy) => policy.table === drop.table && (policy.cmd === drop.cmd || policy.cmd === 'ALL'),
        ),
    );
    assert.deepEqual(
      orphans.map((drop) => `${drop.table}::${drop.name} (${drop.cmd})`),
      [],
      'retirer la dernière règle d’une commande fermerait l’écriture ou la lecture à tout le monde',
    );
  });
});
