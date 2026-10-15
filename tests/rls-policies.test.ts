/**
 * Suite for `scripts/lib/rls-policies.mjs` — la comparaison entre les politiques
 * que les migrations DÉCLARENT et celles que la base hébergée PORTE.
 *
 * Le défaut, mesuré le 2026-10-13 : `vendor_expenses` portait encore
 * « Promoter insert vendor_expenses » (`is_admin()`) alors que
 * `20260906000002_vendor_expense_gm_policies.sql` déclarait depuis le 2026-09-06
 * « Finance admins insert vendor_expenses » (`is_finance_admin()`) — la migration
 * n'avait jamais été appliquée, donc le Gestionnaire Principal voyait le bouton
 * « Ajouter une dépense fournisseur » et la base refusait chacune de ses écritures
 * (42501). Ce cas est le premier testé ci-dessous : un contrôle qui ne l'attrape
 * pas ne sert à rien.
 *
 * Trois autres choses sont verrouillées, parce qu'elles ont été MESURÉES comme
 * fausses une première fois :
 *   • le découpage ne se laisse pas manger par une apostrophe française dans un
 *     commentaire (`l'économe`, `qu'elle`) ni par un `;` dans une chaîne ;
 *   • les LITTÉRAUX survivent (`role IN ('admin', 'dev')`), sinon la condition
 *     affichée devient `role IN ( , )` et plus personne ne peut juger ;
 *   • deux écritures de la MÊME règle ne sont pas une dérive (`is_admin()` face à
 *     `role IN ('admin','dev')` ou à son `EXISTS` en clair) — un contrôle qui crie
 *     toujours ne se lit plus. `is_admin()` face à `is_finance_writer()` reste,
 *     lui, une dérive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalExpression,
  collectRoleSets,
  declaredPoliciesAndRetired,
  declaredPoliciesFromMigrations,
  expressionTokens,
  hostedPoliciesFromRows,
  judgePolicyDrift,
  normalizeExpression,
  parseCreatePolicy,
  parseDropPolicy,
  statementSpans,
} from '../scripts/lib/rls-policies.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const readMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

/** Une ligne de `pg_policies`, comme le pilote `pg` la rend. */
const hostedRow = (tablename: string, policyname: string, cmd: string, roles: string[], expression: string) => ({
  tablename,
  policyname,
  cmd,
  roles,
  qual: cmd === 'INSERT' ? null : expression,
  with_check: cmd === 'INSERT' ? expression : null,
});

// ─── Le découpage ────────────────────────────────────────────────────────────

describe('statementSpans — découper sans se laisser manger', () => {
  it('sépare les instructions et saute les corps `$$ … $$`', () => {
    const spans = statementSpans(`
      CREATE FUNCTION public.f() RETURNS boolean AS $$
        SELECT 1; -- un point-virgule DANS un corps n’est pas une frontière
      $$ LANGUAGE sql;
      CREATE POLICY "P" ON public.t FOR SELECT USING (true);
    `);
    assert.equal(spans.length, 2, 'deux instructions de niveau 0');
    assert.ok(spans[1].masked.trim().startsWith('CREATE POLICY'), 'la politique est bien la seconde');
  });

  it('ne se laisse pas ouvrir par une apostrophe française dans un commentaire', () => {
    // Mesuré : « l'économe » dans un commentaire ouvrait une fausse chaîne, qui
    // avalait toutes les instructions suivantes — des `DROP POLICY` réels
    // disparaissaient de la lecture, donc le contrôle ne les voyait plus.
    const spans = statementSpans(`
      -- l'économe écrit, qu'elle le fasse ici n'y change rien
      DROP POLICY IF EXISTS "A" ON public.t;
      CREATE POLICY "P" ON public.t FOR SELECT USING (true);
    `);
    assert.equal(spans.length, 2, 'le commentaire n’avale pas les instructions');
    assert.ok(parseDropPolicy(spans[0])?.name === 'A');
    assert.ok(parseCreatePolicy(spans[1])?.name === 'P');
  });

  it('garde les LITTÉRAUX : c’est dans les chaînes que vit la règle', () => {
    const spans = statementSpans(`CREATE POLICY "P" ON public.t FOR ALL TO authenticated USING (role IN ('admin', 'dev'));`);
    const parsed = parseCreatePolicy(spans[0])!;
    assert.equal(parsed.using, "role IN ('admin', 'dev')", 'la condition se lit telle qu’elle est écrite');
  });

  it('un `;` dans une chaîne ne coupe pas l’instruction', () => {
    const spans = statementSpans(`CREATE POLICY "P" ON public.t FOR ALL USING (note = 'a;b');`);
    assert.equal(spans.length, 1);
    assert.equal(parseCreatePolicy(spans[0])?.name, 'P');
  });

  it('un commentaire ne fait pas exister une politique', () => {
    const spans = statementSpans(`
      -- CREATE POLICY "P" ON public.t FOR SELECT USING (true);
      SELECT 1;
    `);
    assert.equal(parseCreatePolicy(spans[0]), null, 'la prose n’est pas un geste');
  });
});

// ─── La lecture d’une politique ──────────────────────────────────────────────

describe('parseCreatePolicy / parseDropPolicy', () => {
  it('lit table, nom, commande, rôles et les deux conditions', () => {
    const parsed = parseCreatePolicy(
      'CREATE POLICY "Finance writers insert staff" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_finance_writer())',
    )!;
    assert.deepEqual(
      { name: parsed.name, table: parsed.table, cmd: parsed.cmd, roles: parsed.roles },
      { name: 'Finance writers insert staff', table: 'staff', cmd: 'INSERT', roles: ['authenticated'] },
    );
    assert.equal(parsed.check, 'public.is_finance_writer()');
    assert.equal(parsed.using, null, 'pas de USING sur un INSERT');
  });

  it('sans `FOR` ni `TO`, c’est ALL et public — ce que Postgres applique', () => {
    const parsed = parseCreatePolicy('CREATE POLICY P ON public.t USING (auth.uid() = id)')!;
    assert.equal(parsed.cmd, 'ALL');
    assert.deepEqual(parsed.roles, ['public']);
    assert.equal(parsed.using, 'auth.uid() = id');
  });

  it('lit un DROP avec ou sans `IF EXISTS`, et avec des noms non quotés', () => {
    assert.deepEqual(parseDropPolicy('DROP POLICY IF EXISTS "A" ON public.t'), { name: 'A', table: 't' });
    assert.deepEqual(parseDropPolicy('DROP POLICY B ON t'), { name: 'B', table: 't' });
  });
});

// ─── Le rejeu ────────────────────────────────────────────────────────────────

describe('declaredPoliciesFromMigrations — ce que les migrations LAISSENT', () => {
  const file = (name: string, sql: string) => ({ name, sql });

  it('DROP retire, DROP puis CREATE laisse, CREATE puis DROP emporte', () => {
    const kept = declaredPoliciesFromMigrations([
      file('1.sql', 'CREATE POLICY "P" ON public.t FOR SELECT USING (true);'),
      file('2.sql', 'DROP POLICY IF EXISTS "P" ON public.t; CREATE POLICY "P" ON public.t FOR SELECT USING (true);'),
    ]);
    assert.equal(kept.has('t::P'), true, 'le net est un maintien');

    const gone = declaredPoliciesFromMigrations([
      file('1.sql', 'CREATE POLICY "P" ON public.t FOR SELECT USING (true); DROP POLICY IF EXISTS "P" ON public.t;'),
    ]);
    assert.equal(gone.has('t::P'), false, 'le net est un retrait');
  });

  it('un DROP raconté dans un commentaire n’est pas un retrait', () => {
    const declared = declaredPoliciesFromMigrations([
      file('1.sql', 'CREATE POLICY "P" ON public.t FOR SELECT USING (true);'),
      file('2.sql', '-- DROP POLICY IF EXISTS "P" ON public.t;  (une fois le nettoyage confirmé)\nSELECT 1;'),
    ]);
    assert.equal(declared.has('t::P'), true, 'la prose ne retire rien');
  });
});

// ─── L’équivalence des écritures ─────────────────────────────────────────────

describe('canonicalisation — deux écritures, une seule règle', () => {
  const roleSets = collectRoleSets([
    {
      name: 'x.sql',
      sql: `CREATE FUNCTION public.is_admin() RETURNS boolean AS $$ SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'dev')); $$ LANGUAGE sql;
            CREATE FUNCTION public.is_finance_writer() RETURNS boolean AS $$ SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'dev', 'general_manager', 'econome')); $$ LANGUAGE sql;`,
    },
  ]);

  it('les six fonctions de rôle des migrations sont lues', () => {
    const real = collectRoleSets(readMigrations());
    for (const name of ['is_admin', 'is_finance_admin', 'is_payroll_writer', 'is_finance_writer']) {
      assert.ok(real.has(name), `${name}() doit être lue dans les migrations`);
    }
    assert.deepEqual(real.get('is_admin'), ['admin', 'dev'], 'et avec les bons rôles');
  });

  it("`public.is_admin()`, `is_admin()` et `role IN ('admin','dev')` pèsent pareil", () => {
    const a = expressionTokens('public.is_admin()', roleSets).join(' ');
    const b = expressionTokens('is_admin()', roleSets).join(' ');
    const c = expressionTokens("role IN ('admin', 'dev')", roleSets).join(' ');
    assert.equal(a, b);
    assert.equal(b, c, 'la même règle écrite en clair n’est pas une dérive');
  });

  it('l’EXISTS en clair est reconnu comme `is_admin()` — sans quoi le contrôle crierait toujours', () => {
    const inline =
      "EXISTS ( SELECT 1 FROM public.user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role IN ('admin', 'dev') )";
    assert.equal(
      expressionTokens(inline, roleSets).join(' '),
      expressionTokens('is_admin()', roleSets).join(' '),
    );
  });

  it('mais `is_admin()` face à `is_finance_writer()` reste une dérive', () => {
    assert.notEqual(
      expressionTokens('is_admin()', roleSets).join(' '),
      expressionTokens('is_finance_writer()', roleSets).join(' '),
      'un rôle ajouté change la règle',
    );
  });

  it('la casse du cast et les parenthèses ne changent rien', () => {
    assert.equal(normalizeExpression("(auth.role() = 'authenticated'::text)"), "(auth.role() = 'authenticated')");
    assert.equal(
      expressionTokens("auth.role() = 'authenticated'", roleSets).join(' '),
      expressionTokens("(auth.role() = 'authenticated'::TEXT)", roleSets).join(' '),
    );
  });

  it('une LISTE énumérée survit à son rendu : `key IN (…)` et `key = ANY (ARRAY[…])` pèsent pareil', () => {
    // Mesuré le 2026-10-15 : `app_settings_display_insert` est écrite
    // `key IN ('display.theme', …)` et la base la rend
    // `key = ANY (ARRAY['display.theme'::text, …])`. Sans cette réduction, TOUTE
    // politique qui énumère des valeurs serait une fausse dérive permanente — et
    // un contrôle qui crie toujours ne se lit plus.
    assert.equal(
      expressionTokens("key IN ('display.theme', 'display.density')", roleSets).join(' '),
      expressionTokens("(key = ANY (ARRAY['display.theme'::text, 'display.density'::text]))", roleSets).join(' '),
      'la même liste, écrite par le dépôt et rendue par le catalogue, est la même règle',
    );
    assert.equal(
      expressionTokens("key NOT IN ('display.theme')", roleSets).join(' '),
      expressionTokens("(key <> ALL (ARRAY['display.theme'::text]))", roleSets).join(' '),
      'et sa négation aussi : le catalogue rend `NOT IN` en `<> ALL (ARRAY[…])`',
    );
  });

  it('mais une liste DIFFÉRENTE reste une dérive, et la négation n’est pas blanchie', () => {
    // La réduction rapproche deux écritures de la MÊME liste, jamais deux listes :
    // une valeur changée reste une dérive, et « aucune de ces valeurs » n'est pas
    // « une de ces valeurs » — sinon le contrôle absoudrait exactement ce qu'il
    // existe pour voir.
    assert.notEqual(
      expressionTokens("key IN ('display.theme')", roleSets).join(' '),
      expressionTokens("key IN ('display.density')", roleSets).join(' '),
    );
    assert.notEqual(
      expressionTokens("key NOT IN ('display.theme')", roleSets).join(' '),
      expressionTokens("key IN ('display.theme')", roleSets).join(' '),
      'la négation et l’affirmation ne sont pas la même règle',
    );
  });

  it('un changement de colonne ou de valeur change bien les jetons', () => {
    assert.notEqual(expressionTokens('created_by = auth.uid()', roleSets).join(' '), expressionTokens('created_by = id', roleSets).join(' '));
    assert.equal(canonicalExpression('TRUE', roleSets), 'true');
  });
});

// ─── Le verdict ──────────────────────────────────────────────────────────────

describe('judgePolicyDrift — le défaut mesuré serait attrapé', () => {
  it('la migration du Gestionnaire Principal jamais appliquée : ABSENTE + EN TROP', () => {
    // Le 2026-09-06, `20260906000002_vendor_expense_gm_policies.sql` déclare
    // « Finance admins insert vendor_expenses » (`is_finance_admin()`). Le
    // 2026-10-13, la base portait encore la version `is_admin()` : ce contrôle
    // doit le NOMMER, et c'est ce qu'il fait.
    const declared = declaredPoliciesFromMigrations([
      {
        name: '20260906000002_vendor_expense_gm_policies.sql',
        sql: `DROP POLICY IF EXISTS "Promoter insert vendor_expenses" ON public.vendor_expenses;
              CREATE POLICY "Finance admins insert vendor_expenses" ON public.vendor_expenses
                  FOR INSERT TO authenticated WITH CHECK (public.is_finance_admin());`,
      },
    ]);
    const hosted = hostedPoliciesFromRows([
      hostedRow('vendor_expenses', 'Promoter insert vendor_expenses', 'INSERT', ['authenticated'], 'is_admin()'),
    ]);
    const report = judgePolicyDrift({ declared, hosted });

    assert.deepEqual(report.missing.map((m) => m.name), ['Finance admins insert vendor_expenses']);
    assert.deepEqual(report.extra.map((e) => e.name), ['Promoter insert vendor_expenses']);
    assert.equal(report.ok, false);
    assert.equal(report.drift, 2);
  });

  it('une politique CHANGÉE est nommée champ par champ', () => {
    const declared = declaredPoliciesFromMigrations([
      { name: 'a.sql', sql: 'CREATE POLICY "P" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_finance_writer());' },
    ]);
    const hosted = hostedPoliciesFromRows([
      hostedRow('staff', 'P', 'INSERT', ['authenticated'], 'is_admin()'),
    ]);
    const report = judgePolicyDrift({ declared, hosted, roleSets: collectRoleSets(readMigrations()) });

    assert.equal(report.changed.length, 1);
    assert.equal(report.changed[0]!.differences[0]!.field, 'WITH CHECK');
    assert.equal(report.changed[0]!.differences[0]!.declared, 'public.is_finance_writer()');
    assert.equal(report.changed[0]!.differences[0]!.base, 'is_admin()');
  });

  it('une commande ou des rôles différents sont une dérive', () => {
    const declared = declaredPoliciesFromMigrations([
      { name: 'a.sql', sql: 'CREATE POLICY "P" ON public.t FOR SELECT TO authenticated USING (true);' },
    ]);
    const report = judgePolicyDrift({
      declared,
      hosted: hostedPoliciesFromRows([hostedRow('t', 'P', 'ALL', ['public'], 'true')]),
    });
    assert.deepEqual(
      report.changed[0]!.differences.map((d) => d.field),
      ['commande', 'rôles'],
    );
  });

  it('quand tout correspond, le verdict est vert — et il compte ce qu’il a aligné', () => {
    const declared = declaredPoliciesFromMigrations([
      { name: 'a.sql', sql: 'CREATE POLICY "P" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_finance_writer());' },
    ]);
    const report = judgePolicyDrift({
      declared,
      hosted: hostedPoliciesFromRows([hostedRow('staff', 'P', 'INSERT', ['authenticated'], 'is_finance_writer()')]),
      roleSets: collectRoleSets(readMigrations()),
    });
    assert.equal(report.ok, true);
    assert.equal(report.matched, 1);
    assert.equal(report.drift, 0);
  });

  it('un regard qui n’a rien atteint n’est pas un vert', () => {
    const one = declaredPoliciesFromMigrations([{ name: 'a.sql', sql: 'CREATE POLICY "P" ON public.t USING (true);' }]);
    assert.equal(judgePolicyDrift({ declared: one, hosted: new Map() }).vacuous, true);
    assert.equal(judgePolicyDrift({ declared: new Map(), hosted: hostedPoliciesFromRows([hostedRow('t', 'P', 'ALL', ['public'], 'true')]) }).vacuous, true);
    assert.equal(judgePolicyDrift({ declared: one, hosted: new Map() }).ok, false, 'vide n’est jamais vert');
  });
});

// ─── Les exemptions, bornées dans les deux sens ──────────────────────────────

describe('les exemptions ne peuvent pas cacher ce qu’elles prétendent traiter', () => {
  const declared = declaredPoliciesFromMigrations([
    { name: 'a.sql', sql: 'CREATE POLICY "Attendue" ON public.t FOR SELECT USING (true);' },
  ]);
  const hosted = hostedPoliciesFromRows([
    hostedRow('t', 'Heritee', 'SELECT', ['authenticated'], 'true'),
  ]);

  it('une exemption motivée est retenue, et rapportée', () => {
    const report = judgePolicyDrift({
      declared,
      hosted,
      exemptions: [{ table: 't', name: 'Heritee', reason: 'génération d’avant les migrations, retrait à décider' }],
    });
    assert.deepEqual(report.exempted.map((e) => e.name), ['Heritee']);
    assert.equal(report.extra.length, 0, 'exemptée, donc pas comptée en dérive');
  });

  it('muette, elle est un problème — pas un silence', () => {
    const report = judgePolicyDrift({ declared, hosted, exemptions: [{ table: 't', name: 'Heritee', reason: '  ' }] });
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0]!, /exemption muette/);
  });

  it('périmée, elle est un problème : elle autoriserait un retour en arrière', () => {
    const report = judgePolicyDrift({ declared, hosted, exemptions: [{ table: 't', name: 'Disparue', reason: 'raison' }] });
    assert.match(report.problems[0]!, /n’existe pas dans public|n’existe pas/);
  });

  it('et elle ne peut pas couvrir une politique que les migrations DÉCLARENT', () => {
    // Sinon le contrôle laisserait exempter précisément ce qu’il doit montrer.
    const report = judgePolicyDrift({ declared, hosted, exemptions: [{ table: 't', name: 'Attendue', reason: 'raison' }] });
    assert.match(report.problems[0]!, /une migration la DÉCLARE/);
    assert.ok(report.ok === false);
  });
});

// ─── Le corpus réel ──────────────────────────────────────────────────────────

describe('le corpus des migrations est lu pour de vrai', () => {
  const migrations = readMigrations();
  const declared = declaredPoliciesFromMigrations(migrations);

  it('les 37 migrations déclarent des politiques, et le rejeu est net', () => {
    assert.ok(migrations.length >= 30, `${migrations.length} migrations lues`);
    assert.ok(declared.size >= 30, `${declared.size} politiques déclarées`);
    // Le net du rejeu, sur le corpus réel : la migration du 2026-10-13 ouvre
    // l'écriture à l'économe, donc elle laisse SES noms et emporte les hérités.
    assert.ok(declared.has('staff::Finance writers insert staff'), 'la politique du 2026-10-13 est déclarée');
    assert.equal(declared.has('staff::Finance admins insert staff'), false, 'et l’héritée qu’elle remplace est retirée');
    assert.equal(declared.has('staff::Admin insert staff'), false, 'les deux générations héritées partent');
  });

  it('les fonctions de rôle du dépôt portent toutes leurs rôles', () => {
    const roleSets = collectRoleSets(migrations);
    assert.deepEqual(roleSets.get('is_finance_writer'), ['admin', 'dev', 'econome', 'general_manager']);
    assert.equal(roleSets.get('is_admin')?.includes('econome'), false, 'is_admin() reste admin et dev');
  });
});

// ─── La table RETIRÉE, et ce qu'elle emporte ─────────────────────────────────
//
// Mesuré le 2026-10-13 : le contrôle réclamait deux politiques de `custom_grades`
// (« ABSENTE en base ») alors que `20260828000004_custom_classes.sql` RETIRE cette
// table — le dépôt ne peut donc pas vouloir ces politiques, et le contrôle
// exigeait un `CREATE POLICY` impossible. Le `DROP TABLE` vit dans un bloc
// `DO $$ … $$`, que `statementSpans` saute par construction : c'est cet angle mort
// que les cas ci-dessous ferment. Les deux moitiés sont tenues : la table retirée
// emporte ses politiques, et le retrait est NOMMÉ plutôt que silencieux.

describe('une table RETIRÉE ne réclame plus ses politiques', () => {
  const file = (name: string, sql: string) => ({ name, sql });
  const doBlock =
    `\n    DO $$\n    BEGIN\n      IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custom_grades') THEN\n` +
    `        DROP TABLE public.custom_grades;\n      END IF;\n    END $$;\n  `;

  it('emporte celles qu’elle déclarait avant — `DROP TABLE` dans un bloc `DO $$ … $$` compris', () => {
    const { declared, retired } = declaredPoliciesAndRetired([
      file('1.sql', 'CREATE POLICY "P" ON public.custom_grades FOR SELECT USING (true);'),
      file('2.sql', doBlock),
    ]);
    assert.equal(declared.has('custom_grades::P'), false, 'la politique ne se réclame plus');
    assert.deepEqual(
      retired,
      [{ table: 'custom_grades', name: 'P', cmd: 'SELECT', declaredBy: '1.sql', droppedBy: '2.sql' }],
      'et le retrait est NOMMÉ, jamais silencieux',
    );
  });

  it('ne retire rien de plus : sans le `DROP TABLE`, la politique est bien réclamée', () => {
    // Sinon le cas précédent pourrait être vert parce qu'il ne lit rien.
    const { declared, retired } = declaredPoliciesAndRetired([
      file('1.sql', 'CREATE POLICY "P" ON public.custom_grades FOR SELECT USING (true);'),
    ]);
    assert.equal(declared.has('custom_grades::P'), true);
    assert.deepEqual(retired, []);
  });

  it('mais un `DROP TABLE` en commentaire ou dans une chaîne n’est pas un geste', () => {
    const { declared, retired } = declaredPoliciesAndRetired([
      file('1.sql', 'CREATE POLICY "P" ON public.t FOR SELECT USING (true);'),
      file(
        '2.sql',
        "-- DROP TABLE public.t; (une fois les lignes migrées)\nSELECT 1;\nDO $$ BEGIN EXECUTE 'DROP TABLE public.t'; END $$;",
      ),
    ]);
    assert.equal(declared.has('t::P'), true, 'la prose et les chaînes ne sont pas des gestes');
    assert.deepEqual(retired, []);
  });

  it('l’ordre DANS le même fichier décide : `CREATE` puis `DROP` retire, `DROP` puis `CREATE` laisse', () => {
    const retired = declaredPoliciesAndRetired([
      file('1.sql', 'CREATE POLICY "P" ON public.t FOR SELECT USING (true);\nDROP TABLE public.t;'),
    ]);
    assert.equal(retired.declared.has('t::P'), false);
    assert.equal(retired.retired.length, 1);

    const recreated = declaredPoliciesAndRetired([
      file(
        '1.sql',
        'DROP TABLE public.t;\nCREATE TABLE public.t (id UUID);\nCREATE POLICY "P" ON public.t FOR SELECT USING (true);',
      ),
    ]);
    assert.equal(recreated.declared.has('t::P'), true, 'déclarée APRÈS le retrait de la table');
    assert.deepEqual(recreated.retired, []);
  });

  it('le corpus réel : `custom_grades` n’est plus réclamée, et les deux noms sont nommés', () => {
    const { declared, retired } = declaredPoliciesAndRetired(readMigrations());
    assert.deepEqual(
      [...declared.keys()].filter((key) => key.startsWith('custom_grades::')),
      [],
      'la table retirée ne réclame plus aucune politique',
    );
    assert.deepEqual(retired.map((entry) => entry.name).sort(), [
      'Authenticated insert custom grades',
      'Authenticated read custom grades',
    ]);
    for (const entry of retired) {
      assert.equal(entry.droppedBy, '20260828000004_custom_classes.sql', 'le fichier qui retire la table est nommé');
      assert.match(entry.declaredBy, /^2026082800000[23]_custom_grades/, 'et celui qui les déclarait aussi');
      assert.ok(['SELECT', 'INSERT'].includes(entry.cmd), `commande mesurée : ${entry.cmd}`);
    }
  });
});
