/**
 * Suite for `scripts/lib/write-gates.mjs` — le croisement des politiques
 * d'écriture de la base avec les portes d'affichage de l'app.
 *
 * Le défaut mesuré, et il a trois formes : le 2026-10-05 un compte `econome`
 * enregistrait la paie hors ligne et chaque rejeu revenait en `42501` ; le
 * 2026-10-13 le Gestionnaire Principal et l'économe étaient refusés sur `staff`
 * et `vendor_expenses` pendant que l'écran leur cachait l'action ; le même jour
 * `expenses` ACCEPTAIT l'économe alors que l'icône « Ajouter une dépense » ne
 * s'affichait pas chez lui. Les deux premiers cas sont ici : un contrôle qui ne
 * les attrape pas ne sert à rien.
 *
 * Trois choses sont verrouillées en plus, parce qu'elles ont été mesurées comme
 * fausses une première fois ailleurs dans ce dépôt :
 *   • une écriture RACONTÉE dans un commentaire n'est pas une écriture, et une
 *     liste de rôles commentée n'est pas une liste — c'est la cécité à la prose ;
 *   • une condition que le module ne sait pas lire ne devient JAMAIS un vert :
 *     il refuse de conclure (`ILLEGIBLE`), parce que deviner la règle serait pire
 *     que le défaut ;
 *   • un corpus vide n'est pas un état sain, c'est un regard qui n'a rien atteint.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANY_AUTHENTICATED,
  ANY_ROLE,
  DATA_OPS_PREFIX,
  ILLEGIBLE,
  WRITE_GATE_INVENTORY,
  appRpcCalls,
  appWriteActions,
  baseWriters,
  describeRoles,
  functionWriters,
  includes,
  judgeWriteGates,
  missingRoles,
  readRoleLists,
  resolveCondition,
  resolveToRoles,
} from '../scripts/lib/write-gates.mjs';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const readMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

/** Le corpus de l'app : la couche d'écriture + les fichiers que l'inventaire nomme. */
const readAppCorpus = (inventory = WRITE_GATE_INVENTORY) => {
  const dataOps = readdirSync(join(ROOT, 'src', 'lib', 'dataOps'))
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => `${DATA_OPS_PREFIX}${name}`);
  const named = new Set<string>(dataOps);
  for (const entry of inventory) {
    named.add(entry.screen);
    if (entry.gate?.file) named.add(entry.gate.file);
  }
  return [...named].map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
};

// ─── Des corpus fabriqués, et ce qu'ils disent ──────────────────────────────

const ROLE_FUNCTIONS = `
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin','dev'));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_finance_writer() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin','dev','econome','general_manager'));
$$ LANGUAGE sql STABLE;
`;

const migration = (name: string, sql: string) => ({ name, sql });

// ─── resolveCondition — la règle d'une politique, réduite à ses rôles ───────

describe('resolveCondition — lire une condition sans la recopier', () => {
  const roleSets = new Map([
    ['is_admin', ['admin', 'dev']],
    ['is_finance_writer', ['admin', 'dev', 'econome', 'general_manager']],
  ]);

  it('résout une FONCTION de rôle par la liste de la migration', () => {
    assert.deepEqual(resolveCondition('public.is_finance_writer()', roleSets), [
      'admin',
      'dev',
      'econome',
      'general_manager',
    ]);
  });

  it('résout `role IN (…)` — la même règle écrite en clair', () => {
    assert.deepEqual(resolveCondition("role IN ('admin','dev')", roleSets), ['admin', 'dev']);
  });

  it('`auth.role() = \'authenticated\'` vaut « tout compte connecté »', () => {
    assert.equal(resolveCondition("(auth.role() = 'authenticated')", roleSets), ANY_AUTHENTICATED);
    assert.equal(resolveCondition("auth.role() = 'authenticated' AND created_by = auth.uid()", roleSets), ANY_AUTHENTICATED);
  });

  it('`true` n’impose rien (la clause `TO` limitera), `false` ne laisse personne', () => {
    assert.equal(resolveCondition('true', roleSets), ANY_ROLE);
    assert.equal(resolveCondition(null, roleSets), ANY_ROLE);
    assert.deepEqual(resolveCondition('false', roleSets), []);
  });

  it('un `OR` additionne, un `AND` resserre', () => {
    assert.deepEqual(resolveCondition('public.is_admin() OR public.is_finance_writer()', roleSets), [
      'admin',
      'dev',
      'econome',
      'general_manager',
    ]);
    assert.deepEqual(resolveCondition('public.is_finance_writer() AND public.is_admin()', roleSets), ['admin', 'dev']);
  });

  it('une condition illisible rend ILLEGIBLE — jamais une supposition', () => {
    assert.equal(resolveCondition('public.has_clearance(4)', roleSets), ILLEGIBLE);
  });

  it('la clause `TO` se lit sur le même treillis', () => {
    assert.equal(resolveToRoles(['public']), ANY_ROLE);
    assert.equal(resolveToRoles(['authenticated']), ANY_AUTHENTICATED);
    assert.deepEqual(resolveToRoles(['anon']), ['anon']);
  });
});

describe('includes / missingRoles — les deux sens, nommés', () => {
  it('un écran plus large que la base voit ses rôles NOMMÉS', () => {
    assert.equal(includes(['admin', 'dev'], ['admin', 'dev', 'econome']), false);
    assert.deepEqual(missingRoles(['admin', 'dev', 'econome'], ['admin', 'dev']), ['econome']);
  });

  it('un écran plus étroit laisse la base accorder en plus', () => {
    assert.equal(includes(['admin', 'dev', 'general_manager'], ['admin', 'dev']), true);
    assert.deepEqual(missingRoles(['admin', 'dev', 'general_manager'], ['admin', 'dev']), ['general_manager']);
  });

  it('« tout compte connecté » est plus large que n’importe quelle liste', () => {
    assert.equal(includes(['admin', 'dev'], ANY_AUTHENTICATED), false);
    assert.equal(includes(ANY_ROLE, ANY_AUTHENTICATED), true);
    assert.deepEqual(missingRoles(ANY_AUTHENTICATED, ['admin', 'dev']), ['tout compte connecté']);
  });
});

// ─── baseWriters — ce que les migrations accordent ─────────────────────────

describe('baseWriters — la base, telle que les migrations la déclarent', () => {
  it('une politique `FOR ALL` couvre les trois écritures', () => {
    const writers = baseWriters([
      migration(
        '0001.sql',
        `${ROLE_FUNCTIONS}
        CREATE POLICY "Années — admins" ON public.academic_years
          FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());`,
      ),
    ]);
    assert.deepEqual(writers.get('academic_years::INSERT')?.set, ['admin', 'dev']);
    assert.deepEqual(writers.get('academic_years::UPDATE')?.set, ['admin', 'dev']);
    assert.deepEqual(writers.get('academic_years::DELETE')?.set, ['admin', 'dev']);
  });

  it('un `TO public` + `is_admin()` ne donne rien au rôle anonyme', () => {
    const writers = baseWriters([
      migration(
        '0001.sql',
        `${ROLE_FUNCTIONS}
        CREATE POLICY "Profils — insertion admin" ON public.user_profiles
          FOR INSERT TO public WITH CHECK (public.is_admin());`,
      ),
    ]);
    assert.deepEqual(writers.get('user_profiles::INSERT')?.set, ['admin', 'dev']);
  });

  it('deux politiques permissives s’ADDITIONNENT, comme Postgres les additionne', () => {
    const writers = baseWriters([
      migration(
        '0001.sql',
        `${ROLE_FUNCTIONS}
        CREATE POLICY "Paie — écrivains" ON public.salary_payments
          FOR INSERT TO authenticated WITH CHECK (public.is_finance_writer());
        CREATE POLICY "Paie — admins" ON public.salary_payments
          FOR INSERT TO authenticated WITH CHECK (public.is_admin());`,
      ),
    ]);
    assert.deepEqual(writers.get('salary_payments::INSERT')?.set, ['admin', 'dev', 'econome', 'general_manager']);
    assert.equal(writers.get('salary_payments::INSERT')?.policies.length, 2);
  });

  it('`TO authenticated … WITH CHECK (true)` ouvre à tout compte connecté', () => {
    const writers = baseWriters([
      migration(
        '0001.sql',
        `CREATE POLICY "Fournisseurs — correction ouverte" ON public.vendor_expenses
          FOR UPDATE TO authenticated USING (true) WITH CHECK (true);`,
      ),
    ]);
    assert.equal(writers.get('vendor_expenses::UPDATE')?.set, ANY_AUTHENTICATED);
  });

  it('une politique RACONTÉE dans un commentaire n’existe pas', () => {
    const writers = baseWriters([
      migration(
        '0001.sql',
        `-- CREATE POLICY "Fantôme" ON public.expenses FOR DELETE TO authenticated USING (true);
        ${ROLE_FUNCTIONS}`,
      ),
    ]);
    assert.equal(writers.get('expenses::DELETE'), undefined);
  });
});

describe('functionWriters — la garde lue dans le corps de la fonction', () => {
  it('`IF NOT is_admin()` veut dire : les rôles que la fonction exige', () => {
    const functions = functionWriters([
      migration(
        '0001.sql',
        `${ROLE_FUNCTIONS}
        CREATE OR REPLACE FUNCTION public.reassign_payment_student(p_id uuid) RETURNS integer
        LANGUAGE plpgsql SECURITY DEFINER AS $$
        BEGIN
          IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'refusé' USING ERRCODE = '42501';
          END IF;
          RETURN 1;
        END;
        $$;`,
      ),
    ]);
    assert.deepEqual(functions.get('reassign_payment_student')?.set, ['admin', 'dev']);
    assert.match(String(functions.get('reassign_payment_student')?.guard), /is_admin\(\)/);
    assert.equal(functions.get('reassign_payment_student')?.file, '0001.sql');
  });
});

// ─── appWriteActions — ce que l'app écrit vraiment ─────────────────────────

describe('appWriteActions — la couche d’écriture, lue et non listée', () => {
  const dataOps = (text: string) => [{ file: `${DATA_OPS_PREFIX}thing.ts`, text }];

  it('lit les trois gestes et la fonction', () => {
    const actions = appWriteActions(
      dataOps(`
        await supabase.from('expenses').insert({ amount: 1 });
        await supabase.from('expenses').update({ amount: 2 }).eq('id', id);
        await supabase.from('expenses').delete().eq('id', id);
        await supabase.rpc('set_payment_months', { p_id: id });
      `),
    );
    assert.deepEqual(
      actions.map((action) => `${action.table}.${action.cmd}`).sort(),
      ['expenses.DELETE', 'expenses.INSERT', 'expenses.UPDATE'],
    );
    assert.deepEqual(
      appRpcCalls(dataOps(`await supabase.rpc('set_payment_months', { p_id: id });`)).map((call) => call.fn),
      ['set_payment_months'],
    );
  });

  it('n’invente pas une écriture : `.select()` n’est pas un geste', () => {
    assert.deepEqual(appWriteActions(dataOps(`await supabase.from('students').select().eq('id', id);`)), []);
  });

  it('ne lit pas une écriture RACONTÉE dans un commentaire', () => {
    assert.deepEqual(appWriteActions(dataOps(`// await supabase.from('expenses').delete().eq('id', id);`)), []);
  });

  it('ne franchit pas la fin de l’instruction', () => {
    const actions = appWriteActions(
      dataOps(`
        const rows = await supabase.from('students').select().eq('id', id);
        await logSomething();
        await supabase.from('parents').insert({ name: 'x' });
      `),
    );
    assert.deepEqual(actions.map((action) => `${action.table}.${action.cmd}`), ['parents.INSERT']);
  });

  it('ignore ce qui n’est pas la couche d’écriture', () => {
    assert.deepEqual(appWriteActions([{ file: 'src/components/View.tsx', text: `x.from('expenses').delete();` }]), []);
  });
});

// ─── readRoleLists — les listes, lues par le parseur ───────────────────────

describe('readRoleLists — les rôles d’une porte, lus là où ils sont déclarés', () => {
  const file = (text: string) => [{ file: 'src/lib/thingRights.ts', text }];

  it('lit un tableau `as const`', () => {
    const lists = readRoleLists(file(`export const THING_WRITERS = ['admin', 'dev', 'econome'] as const;`));
    assert.deepEqual(lists.get('src/lib/thingRights.ts::THING_WRITERS'), ['admin', 'dev', 'econome']);
  });

  it('résout un alias dans le même fichier — la MÊME liste, pas une seconde copie', () => {
    const lists = readRoleLists(
      file(`
        export const ADMIN_ROLES = ['admin', 'dev'] as const;
        export const THING_DELETERS = ADMIN_ROLES;
      `),
    );
    assert.deepEqual(lists.get('src/lib/thingRights.ts::THING_DELETERS'), ['admin', 'dev']);
  });

  it('ne lit pas une liste commentée', () => {
    const lists = readRoleLists(file(`// export const GHOST = ['admin', 'dev'] as const;`));
    assert.equal(lists.size, 0);
  });
});

// ─── judgeWriteGates — ROUGE dans les deux sens ────────────────────────────

/** Ce qu'une suite peut changer dans le corpus minimal — annoté, jamais `any`. */
type CorpusOptions = {
  writers?: string;
  base?: string;
  screen?: string;
  gate?: string;
  inventory?: unknown[];
};

describe('judgeWriteGates — le croisement, dans les deux sens', () => {
  /** Le corpus minimal : une table, une écriture, un écran, une porte. */
  const corpus = ({
    writers = "['admin', 'dev']",
    base = `CREATE POLICY "P" ON public.thing FOR DELETE TO authenticated USING (public.is_admin());`,
    screen = `export const V = () => (canDelete ? <button>Supprimer</button> : null);`,
    gate = `export const THING_DELETERS = ${writers} as const;`,
    inventory,
  }: CorpusOptions = {}) => {
    const sources = [
      {
        file: `${DATA_OPS_PREFIX}thing.ts`,
        text: `await supabase.from('thing').delete().eq('id', id);`,
      },
      { file: 'src/components/ThingView.tsx', text: screen },
      { file: 'src/lib/thingRights.ts', text: gate },
    ];
    return judgeWriteGates({
      inventory:
        inventory ??
        [
          {
            action: 'Supprimer une chose',
            table: 'thing',
            cmd: 'DELETE',
            screen: 'src/components/ThingView.tsx',
            shown: /canDelete/,
            gate: { file: 'src/lib/thingRights.ts', symbol: 'THING_DELETERS', reader: /canDelete/ },
          },
        ],
      sources,
      migrations: [migration('0001.sql', `${ROLE_FUNCTIONS}\n${base}`)],
    });
  };

  it('VERT quand l’écran dit exactement ce que la base exécute', () => {
    const report = corpus();
    assert.equal(report.ok, true);
    assert.equal(report.drift, 0);
    assert.equal(report.vacuous, false);
  });

  it('ROUGE : l’écran montre le bouton à un rôle que la base refuse (le 42501 de la paie)', () => {
    const report = corpus({ writers: "['admin', 'dev', 'econome']" });
    assert.equal(report.ok, false);
    assert.equal(report.shownOverPromises.length, 1);
    assert.deepEqual(report.shownOverPromises[0].roles, ['econome']);
    assert.equal(report.shownOverPromises[0].key, 'thing::DELETE');
  });

  it('ROUGE : l’écran sans garde offre l’action à TOUT compte connecté', () => {
    const report = corpus({
      inventory: [
        {
          action: 'Supprimer une chose',
          table: 'thing',
          cmd: 'DELETE',
          screen: 'src/components/ThingView.tsx',
          shown: /Supprimer/,
          gate: null,
        },
      ],
    });
    assert.equal(report.ok, false);
    assert.deepEqual(report.shownOverPromises[0].roles, ['tout compte connecté']);
  });

  it('ROUGE : la base accepte un rôle que l’écran cache (la forme mesurée sur `expenses`)', () => {
    const report = corpus({
      base: `CREATE POLICY "P" ON public.thing FOR DELETE TO authenticated USING (public.is_finance_writer());`,
    });
    assert.equal(report.ok, false);
    assert.equal(report.hiddenGrants.length, 1);
    assert.deepEqual(report.hiddenGrants[0].roles, ['econome', 'general_manager']);
  });

  it('VERT quand l’écart est DÉCLARÉ — et il reste NOMMÉ dans le rapport', () => {
    const report = corpus({
      base: `CREATE POLICY "P" ON public.thing FOR DELETE TO authenticated USING (public.is_finance_writer());`,
      inventory: [
        {
          action: 'Supprimer une chose',
          table: 'thing',
          cmd: 'DELETE',
          screen: 'src/components/ThingView.tsx',
          shown: /canDelete/,
          gate: { file: 'src/lib/thingRights.ts', symbol: 'THING_DELETERS', reader: /canDelete/ },
          narrower: 'l’écran ne montre la corbeille qu’aux administrateurs (décision du propriétaire)',
        },
      ],
    });
    assert.equal(report.ok, true);
    assert.equal(report.hiddenGrants.length, 0);
    assert.equal(report.narrowed.length, 1);
    assert.deepEqual(report.narrowed[0].roles, ['econome', 'general_manager']);
  });

  it('ROUGE : aucune politique d’écriture — un écran qui promet un 42501', () => {
    const report = corpus({ base: `CREATE POLICY "P" ON public.thing FOR SELECT TO authenticated USING (true);` });
    assert.equal(report.ok, false);
    assert.equal(report.noWritePolicy.length, 1);
    assert.match(String(report.noWritePolicy[0].base), /aucune politique/);
  });

  it('ROUGE : la porte est déclarée mais l’écran ne la lit pas', () => {
    // L'écran MONTRE l'action (`Supprimer`) sans lire la garde : la garde est
    // une intention, pas une protection.
    const report = corpus({
      screen: `export const V = () => <button>Supprimer</button>;`,
      inventory: [
        {
          action: 'Supprimer une chose',
          table: 'thing',
          cmd: 'DELETE',
          screen: 'src/components/ThingView.tsx',
          shown: /Supprimer/,
          gate: { file: 'src/lib/thingRights.ts', symbol: 'THING_DELETERS', reader: /canDelete/ },
        },
      ],
    });
    assert.equal(report.ok, false);
    assert.equal(report.unproven.length, 1);
    assert.match(String(report.unproven[0].why), /ne LIT pas la porte/);
  });

  it('ROUGE : une écriture de l’app que personne ne croise', () => {
    const report = corpus({ inventory: [] });
    assert.equal(report.ok, false);
    assert.match(report.problems.join('\n'), /AUCUNE porte d’affichage ne le croise/);
  });

  it('ROUGE : une entrée périmée garde une action que l’app n’exécute plus', () => {
    const report = corpus({
      inventory: [
        {
          action: 'Supprimer une chose',
          table: 'thing',
          cmd: 'DELETE',
          screen: 'src/components/ThingView.tsx',
          shown: /canDelete/,
          gate: { file: 'src/lib/thingRights.ts', symbol: 'THING_DELETERS', reader: /canDelete/ },
        },
        {
          action: 'Supprimer un fantôme',
          table: 'ghost',
          cmd: 'DELETE',
          screen: 'src/components/ThingView.tsx',
          shown: /canDelete/,
          gate: { file: 'src/lib/thingRights.ts', symbol: 'THING_DELETERS', reader: /canDelete/ },
        },
      ],
    });
    assert.equal(report.ok, false);
    assert.match(report.problems.join('\n'), /entrée périmée/);
  });

  it('ROUGE : une condition illisible empêche de conclure (sortie 2, jamais un vert)', () => {
    const report = corpus({ base: `CREATE POLICY "P" ON public.thing FOR DELETE TO authenticated USING (public.has_clearance());` });
    assert.equal(report.ok, false);
    assert.equal(report.illegible.length, 1);
  });

  it('un corpus VIDE n’est pas un vert', () => {
    const report = judgeWriteGates({ inventory: [], sources: [], migrations: [] });
    assert.equal(report.vacuous, true);
    assert.equal(report.ok, false);
  });
});

// ─── Le corpus du dépôt ────────────────────────────────────────────────────

/** Les raisons des écarts déclarés de l'inventaire du dépôt. */
const NARROWED_REASONS: string[] = WRITE_GATE_INVENTORY.filter((entry) => entry.narrower).map((entry) =>
  String(entry.narrower),
);

describe('le corpus réel — l’inventaire du dépôt', () => {
  const migrations = readMigrations();

  it('croise chaque écriture de `dataOps` et reste VERT', () => {
    const report = judgeWriteGates({ sources: readAppCorpus(), migrations });
    assert.equal(report.vacuous, false);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.shownOverPromises, []);
    assert.deepEqual(report.hiddenGrants, []);
    assert.deepEqual(report.noWritePolicy, []);
    assert.deepEqual(report.unproven, []);
    assert.deepEqual(report.illegible, []);
    assert.equal(report.ok, true);
  });

  it('NOMME les écarts déclarés — dont la corbeille du personnel et la saisie des dépenses', () => {
    const report = judgeWriteGates({ sources: readAppCorpus(), migrations });
    const keys = report.narrowed.map((item) => item.key);
    assert.ok(keys.includes('staff::DELETE'), `écarts déclarés : ${keys.join(', ')}`);
    assert.ok(keys.includes('expenses::INSERT'));
    assert.ok(keys.includes('expenses::UPDATE'));
    for (const item of report.narrowed) assert.ok(String(item.narrower).trim().length > 0);
  });

  it('la base de l’école sur `staff` : la corbeille du Gestionnaire Principal est cachée', () => {
    const report = judgeWriteGates({ sources: readAppCorpus(), migrations });
    const staff = report.narrowed.find((item) => item.key === 'staff::DELETE');
    assert.deepEqual(staff?.roles, ['general_manager']);
    assert.deepEqual(baseWriters(migrations).get('staff::DELETE')?.set, ['admin', 'dev', 'general_manager']);
  });

  it('déplacer UN rôle dans une porte réelle fait rougir — la preuve de vie', () => {
    // L'écran du personnel laisserait écrire l'économe là où la base ne prend que
    // `is_finance_writer()` + `is_finance_admin()` : le contrôle doit le nommer.
    const tampered = WRITE_GATE_INVENTORY.map((entry) =>
      entry.table === 'staff' && entry.cmd === 'DELETE'
        ? {
            ...entry,
            gate: { file: 'src/lib/payrollRights.ts', symbol: 'FINANCE_WRITER_ROLES', reader: /canDelete/ },
            narrower: undefined,
          }
        : entry,
    );
    const report = judgeWriteGates({ sources: readAppCorpus(tampered), migrations, inventory: tampered });
    assert.equal(report.ok, false);
    const staff = report.shownOverPromises.find((item) => item.key === 'staff::DELETE');
    assert.deepEqual(staff?.roles, ['econome']);
  });

  it('un écran plus étroit que la base est DÉCLARÉ avec une raison, jamais muet', () => {
    assert.ok(NARROWED_REASONS.length > 0);
    for (const reason of NARROWED_REASONS) assert.ok(reason.trim().length > 20, reason);
  });
});

// ─── Le libellé des ensembles, pour que le rapport se lise sans décodeur ───

describe('describeRoles — un rapport qui se lit', () => {
  it('nomme les trois états du treillis', () => {
    assert.equal(describeRoles(ANY_ROLE), 'tout rôle, le rôle anonyme compris');
    assert.equal(describeRoles(ANY_AUTHENTICATED), 'tout compte connecté');
    assert.equal(describeRoles(['admin', 'dev']), 'admin, dev');
  });
});
