// Suite for `npm run db:apply` (scripts/lib/apply-migration.mjs +
// scripts/apply-migration.mjs).
//
// WHY THIS EXISTS
// ---------------
// Les migrations de ce dépôt s'appliquaient À LA MAIN, et le prix a été payé
// deux fois : le 2026-09-14 (`staff.category` écrite dans le code avant
// d'exister en base — tout ajout d'employé refusé, déploiement vert) et le
// 2026-10-11 (`payments.months` — c'est le gate `check:hosted-schema` qui a
// arrêté la publication, pas le geste qui aurait dû la préparer).
//
// Ces cas protègent ce qui se trompe SANS base, donc sans qu'on s'en aperçoive :
// un fichier appliqué depuis un dossier que le dépôt ne lit pas, deux migrations
// jouées dans le désordre, une instruction que PostgreSQL refuse dans une
// transaction (découverte au milieu du fichier, elle laisse une base à moitié
// changée), un `BEGIN` de PL/pgSQL pris pour une transaction, et un fichier qui
// ne déclare rien — qu'aucune mesure ne peut prouver appliqué.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  MIGRATIONS_DIR,
  applyVerdict,
  declaredObjects,
  migrationPathProblem,
  objectKeys,
  orderProblem,
  removalKeys,
  removedObjects,
  topLevelStatements,
  transactionBlockers,
  transactionControl,
} from '../scripts/lib/apply-migration.mjs';
// Ce qui s'exécute, et pas ce qui se raconte : les commentaires de la migration de
// retrait nomment `CREATE TABLE … AS` (c'est le motif du retrait), donc lire le
// fichier brut confondrait un motif écrit avec un geste.
import { blankComments } from '../scripts/lib/schema-expected.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
// La migration réelle qui a servi de mesure le 2026-10-11 : elle ajoute une
// colonne ET une contrainte, et elle DROP la contrainte avant de l'ajouter (donc
// l'ordre du fichier décide de ce qui reste).
const MONTHS = `${MIGRATIONS_DIR}/20261011000000_payments_months.sql`;
const monthsSql = read(MONTHS);
// La migration qui RETIRE la table fuitée (2026-10-11). Elle a servi de mesure à
// la lecture des retraits : sans elle, une migration de retrait ne déclarait rien
// d'observable, donc la fermeture de la fuite n'était pas prouvable.
const DROP_BACKUP = `${MIGRATIONS_DIR}/20261011000001_drop_students_dupe_backup.sql`;
const dropBackupSql = read(DROP_BACKUP);

describe('db:apply — ce qu’elle refuse AVANT d’écrire', () => {
  it('une migration vit dans supabase/migrations, et nulle part ailleurs', () => {
    assert.equal(
      migrationPathProblem({ file: MONTHS, root, exists: () => true }),
      null,
      'le chemin normal est accepté',
    );
    assert.match(
      String(migrationPathProblem({ file: 'scripts/seed-probe.sql', root, exists: () => true })),
      /n’est pas dans supabase\/migrations\//,
      'un .sql posé ailleurs produirait une base que le dépôt ne décrit pas',
    );
    assert.match(
      String(migrationPathProblem({ file: `${MIGRATIONS_DIR}/payments.sql`, root, exists: () => true })),
      /AAAAMMJJHHMMSS_nom\.sql/,
      'sans horodatage, l’ordre d’application ne se déduit plus',
    );
    assert.match(
      String(migrationPathProblem({ file: `${MIGRATIONS_DIR}/20261011000000_x.sql`, root, exists: () => false })),
      /introuvable/,
    );
    assert.match(String(migrationPathProblem({ file: '', root })), /aucun fichier/);
  });

  it('deux migrations ne s’appliquent pas dans le désordre', () => {
    const a = '20261006000000_students_matricule_all.sql';
    const b = '20261011000000_payments_months.sql';
    assert.equal(orderProblem([a, b]), null, 'l’ordre chronologique passe');
    assert.match(String(orderProblem([b, a])), /n’est pas chronologique/, 'l’inverse est refusé');
    assert.match(String(orderProblem([a, a])), /même horodatage/, 'et deux fichiers du même instant ne sont pas ordonnables');
  });

  it('un `BEGIN` de PL/pgSQL n’est pas une transaction', () => {
    // Le cas mesuré : `20260828000001_auth_role_hardening.sql` porte `BEGIN` en
    // ligne 10, à l'intérieur de `AS $$ … $$`. Compté comme une transaction, le
    // fichier serait déclaré « autogéré », la commande ne l'envelopperait pas, et
    // la vérification « après » partirait hors transaction — sans pouvoir annuler.
    const hardening = read(`${MIGRATIONS_DIR}/20260828000001_auth_role_hardening.sql`);
    assert.equal(transactionControl(topLevelStatements(hardening)).length, 0);
    assert.ok(topLevelStatements(hardening).some((s) => /CREATE OR REPLACE FUNCTION/i.test(s)), 'la fonction est bien vue');

    const selfManaged = 'BEGIN;\nALTER TABLE public.payments ADD COLUMN x int;\nCOMMIT;\n';
    assert.deepEqual(transactionControl(topLevelStatements(selfManaged)), ['BEGIN', 'COMMIT']);

    const inComment = '-- BEGIN;\nselect 1;\n/* COMMIT; */\n';
    assert.deepEqual(transactionControl(topLevelStatements(inComment)), [], 'un commentaire n’est pas une instruction');

    const inString = "insert into public.notes values ('BEGIN; COMMIT;');\n";
    assert.deepEqual(transactionControl(topLevelStatements(inString)), []);
  });

  it('le découpage ne se casse pas sur un `;` dans une chaîne', () => {
    const statements = topLevelStatements("create table t (a text default 'x;y');\nselect 1;\n");
    assert.equal(statements.length, 2);
    assert.match(statements[0] ?? '', /create table t/);
  });

  it('une instruction interdite en transaction est refusée, et NOMMÉE', () => {
    const blockers = transactionBlockers(topLevelStatements('CREATE INDEX CONCURRENTLY payments_idx ON public.payments (date);\n'));
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0]?.command, 'CREATE INDEX CONCURRENTLY');
    assert.match(blockers[0]?.statement ?? '', /^CREATE INDEX CONCURRENTLY payments_idx/);
    assert.equal(transactionBlockers(topLevelStatements('VACUUM;\n'))[0]?.command, 'VACUUM');
    // Le corpus réel doit passer : une migration du dépôt qui porterait un de ces
    // gestes serait refusée par la commande, et c'est le fait à connaître.
    assert.deepEqual(transactionBlockers(topLevelStatements(monthsSql)), []);
  });

  it('un fichier qui ne déclare rien n’est pas applicable — il n’est pas prouvable', () => {
    const verdict = applyVerdict({ objects: declaredObjects('-- rien\n'), before: new Set(), after: new Set() });
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems.join(' '), /AUCUN objet observable/);
    assert.deepEqual(verdict.keys, []);
  });
});

describe('db:apply — ce que la migration déclare, et ce qui le prouve', () => {
  it('lit la colonne ET la contrainte de la migration réelle', () => {
    const objects = declaredObjects(monthsSql);
    assert.deepEqual(objects.tables, [{ name: 'payments', columns: ['months'] }]);
    assert.deepEqual(objects.constraints, ['payments_months_shape_check']);
    assert.deepEqual(objectKeys(objects), ['column:payments.months', 'constraint:payments_months_shape_check']);
  });

  it('l’ordre du fichier décide : DROP puis ADD laisse l’objet, ADD puis DROP ne le laisse pas', () => {
    const kept = declaredObjects(
      'ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS c;\nALTER TABLE public.payments ADD CONSTRAINT c CHECK (true);\n',
    );
    assert.deepEqual(kept.constraints, ['c']);
    const gone = declaredObjects(
      'ALTER TABLE public.payments ADD CONSTRAINT c CHECK (true);\nALTER TABLE public.payments DROP CONSTRAINT IF EXISTS c;\n',
    );
    assert.deepEqual(gone.constraints, []);
  });

  it('les politiques, fonctions et déclencheurs se lisent aussi — noms à espaces compris', () => {
    const objects = declaredObjects(`
      CREATE POLICY "Authenticated read payments" ON public.payments FOR SELECT USING (true);
      CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ select true; $$;
      CREATE OR REPLACE FUNCTION public.assign_student_matricule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
      CREATE TRIGGER students_assign_matricule BEFORE INSERT ON public.students FOR EACH ROW EXECUTE FUNCTION public.assign_student_matricule();
      DROP TRIGGER IF EXISTS obsolete_trigger ON public.students;
    `);
    assert.deepEqual(objects.policies, ['Authenticated read payments']);
    assert.deepEqual(objects.functions, ['assign_student_matricule', 'is_admin'], 'triés, pour que deux fichiers disent la même chose du même jeu');
    assert.deepEqual(objects.triggers, ['students_assign_matricule']);
    assert.ok(objectKeys(objects).includes('policy:Authenticated read payments'));
  });

  it('le verdict exige ABSENT avant, PRÉSENT après — et annonce l’annulation', () => {
    const objects = declaredObjects(monthsSql);
    const keys = objectKeys(objects);

    const clean = applyVerdict({ objects, before: new Set(), after: new Set(keys) });
    assert.equal(clean.ok, true, 'absent avant, présent après : le seul cas vert');
    assert.deepEqual(clean.keys, keys);

    const before = applyVerdict({ objects, before: new Set(keys), after: new Set(keys) });
    assert.equal(before.ok, false);
    assert.deepEqual(before.already, keys, 'déjà en base : rejouer ne prouverait rien');
    assert.match(before.problems.join(' '), /déjà en base AVANT/);

    const after = applyVerdict({ objects, before: new Set(), after: new Set([keys[0]!]) });
    assert.equal(after.ok, false);
    assert.deepEqual(after.missing, [keys[1]]);
    assert.match(after.problems.join(' '), /NON vérifié APRÈS/);
    assert.match(after.problems.join(' '), /transaction sera ANNULÉE/, 'et ce qui va s’ensuivre est dit');
  });

  it('--again lève le refus « déjà là » MAIS dit ce que ça coûte : la preuve de production', () => {
    const objects = declaredObjects(monthsSql);
    const keys = objectKeys(objects);
    const again = applyVerdict({ objects, before: new Set(keys), after: new Set(keys), again: true });
    assert.equal(again.ok, true);
    assert.deepEqual(again.already, [], 'le refus est levé');
    assert.match(again.warnings.join(' '), /ne prouve plus qu’elle a produit ces objets/, 'et l’aveu est imprimé');
  });
});

describe('db:apply — un RETRAIT se prouve aussi (présent avant, absent après)', () => {
  it('la migration de retrait déclare ce qu’elle retire, et rien d’autre', () => {
    const objects = declaredObjects(dropBackupSql);
    assert.deepEqual(objectKeys(objects), [], 'elle n’ajoute rien');
    assert.deepEqual(removalKeys(objects), ['table:students_dupe_backup_20261005'], 'et elle nomme ce qu’elle retire');
    assert.deepEqual(objects.removed.columns, []);
  });

  it('un fichier qui ne fait que retirer n’est plus « un fichier qui ne déclare rien »', () => {
    const objects = declaredObjects(dropBackupSql);
    const key = 'table:students_dupe_backup_20261005';

    const clean = applyVerdict({ objects, before: new Set([key]), after: new Set() });
    assert.equal(clean.ok, true, 'présente avant, absente après : le seul cas vert');
    assert.deepEqual(clean.removals, [key]);
    assert.deepEqual(clean.stillThere, []);

    const alreadyGone = applyVerdict({ objects, before: new Set(), after: new Set() });
    assert.equal(alreadyGone.ok, false, 'retirer ce qui n’est pas là ne prouve rien');
    assert.deepEqual(alreadyGone.goneAlready, [key]);
    assert.match(alreadyGone.problems.join(' '), /déjà ABSENT avant/);

    const stillThere = applyVerdict({ objects, before: new Set([key]), after: new Set([key]) });
    assert.equal(stillThere.ok, false);
    assert.deepEqual(stillThere.stillThere, [key]);
    assert.match(stillThere.problems.join(' '), /retrait NON vérifié APRÈS/);
    assert.match(stillThere.problems.join(' '), /ANNULÉE/, 'et ce qui va s’ensuivre est dit');

    // Le pré-vol ne se prononce pas sur l’après : rien n’a encore été écrit.
    const preflight = applyVerdict({ objects, before: new Set([key]), after: new Set([key]), preflight: true });
    assert.equal(preflight.ok, true, 'la table est bien là avant : le pré-vol ne refuse pas');
  });

  it('--again lève le refus « déjà absente », et l’aveu est le même que pour un ajout', () => {
    const objects = declaredObjects(dropBackupSql);
    const again = applyVerdict({ objects, before: new Set(), after: new Set(), again: true });
    assert.equal(again.ok, true);
    assert.deepEqual(again.goneAlready, []);
    assert.match(again.warnings.join(' '), /ne prouve plus qu’elle a produit ces objets/);
  });

  it('un `DROP` qui n’est pas un geste n’est pas lu', () => {
    const inString = declaredObjects("insert into public.notes(body) values ('DROP TABLE public.students;');\n");
    assert.deepEqual(removalKeys(inString), [], 'une chaîne n’est pas un geste');
    const inComment = declaredObjects('-- DROP TABLE public.students;\nselect 1;\n');
    assert.deepEqual(removalKeys(inComment), [], 'un commentaire non plus');
    const inBody = declaredObjects(
      'CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE \'DROP TABLE public.students\'; END; $$;\n',
    );
    assert.deepEqual(removalKeys(inBody), [], 'un corps $$ … $$ non plus');
  });

  it('retirer PUIS recréer n’est pas un retrait, c’est une remise à zéro', () => {
    const reset = declaredObjects('DROP TABLE IF EXISTS public.x;\nCREATE TABLE public.x (a int);\n');
    assert.deepEqual(removalKeys(reset), [], 'le net décide : la table est là après coup');
    assert.deepEqual(reset.tables, [{ name: 'x', columns: ['a'] }]);
  });

  it('une colonne retirée se nomme, avec sa table', () => {
    const objects = declaredObjects('ALTER TABLE public.students DROP COLUMN IF EXISTS obsolete;\n');
    assert.deepEqual(removalKeys(objects), ['column:students.obsolete']);
  });

  it('la migration de retrait ne recrée RIEN — c’est le fond du geste', () => {
    const executed = blankComments(dropBackupSql);
    assert.doesNotMatch(executed, /CREATE\s+TABLE/i, 'recréer la table rouvrirait le trou');
    assert.doesNotMatch(executed, /CREATE\s+POLICY|ENABLE\s+ROW\s+LEVEL/i, 'on ne « sécurise » pas un artefact : on le retire');
    assert.match(executed, /DROP TABLE IF EXISTS public\.students_dupe_backup_20261005;/);
  });
});

describe('db:apply — le geste lui-même, tel qu’il est écrit', () => {
  const source = read('scripts/apply-migration.mjs');

  it('la commande existe sous son nom, et elle est joignable', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['db:apply'], 'node scripts/apply-migration.mjs');
    assert.match(source, /npm run db:apply -- supabase\/migrations\/<fichier>\.sql/, 'le gate du schéma renvoie vers cette commande');
    assert.match(read('scripts/check-hosted-schema.mjs'), /db:apply/, 'et c’est le message du gate qui la nomme');
  });

  it('elle n’écrit QUE sur la base partagée : il n’y a pas d’option pour viser ailleurs', () => {
    assert.match(source, /projectRefOf\(appUrl\) !== SHARED_PROJECT_REF/, 'le canal de l’application doit pointer la base partagée');
    assert.match(source, /`postgres\.\$\{SHARED_PROJECT_REF\}`/, 'la connexion est construite sur le ref partagé');
    assert.doesNotMatch(source, /--url/, 'aucune option d’URL : une commande qui écrit ne se redirige pas par argument');
  });

  it('le fichier est joué TEL QUEL, et la vérification « après » vit DANS la transaction', () => {
    assert.match(source, /await client\.query\(plan\.sql\)/, 'le contenu du fichier part tel quel, jamais réassemblé');
    assert.match(source, /if \(managed\) await client\.query\('BEGIN'\)/);
    assert.match(source, /const after = await probeObjects\(client, plan\.objects\);/);
    // L'ordre des deux est le fond du geste : un ROLLBACK qui viendrait après le
    // COMMIT ne pourrait plus rien annuler.
    const rollback = source.indexOf("await client.query('ROLLBACK');");
    const commit = source.indexOf("await client.query('COMMIT');");
    assert.ok(rollback > 0 && commit > 0 && rollback < commit, 'l’annulation est écrite AVANT la validation');
    assert.match(source, /information_schema\.columns/, 'les colonnes se lisent dans les catalogues, pas dans un cache REST');
    assert.match(source, /pg_constraint/);
    assert.match(source, /statement_timeout/, 'une instruction qui traîne côté base est bornée');
  });

  it('et elle relit le canal de l’APPLICATION après coup — c’est lui que le bureau utilise', () => {
    assert.match(source, /appChannelConfirmation/);
    assert.match(source, /rest\/v1\//, 'la relecture passe par PostgREST, comme le poste');
    assert.match(source, /cache de schéma/, 'un cache en retard se DIT au lieu de faire échouer une migration appliquée');
  });

  it('un retrait se sonde dans les catalogues, et se relit sur le canal du bureau', () => {
    assert.match(source, /information_schema\.tables/, 'la présence d’une table se lit dans les catalogues');
    assert.match(source, /present\.add\(`table:\$\{row\.table_name\}`\)/, 'et sous la clé que le verdict attend');
    assert.match(source, /appChannelRemovalConfirmation/, 'le canal de l’application est relu APRÈS le retrait');
    assert.match(source, /PGRST205/, 'un 404 ou « introuvable dans le cache de schéma » est la seule fermeture acceptable');
    assert.match(
      source,
      /pre\.already\.length > 0 \|\| pre\.goneAlready\.length > 0/,
      '« déjà là » et « déjà absente » sont les deux refus du pré-vol',
    );
  });
});
