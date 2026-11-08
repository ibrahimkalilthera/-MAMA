// Le montant payé d'une dépense fournisseur, tenu par un VRAI PostgreSQL — pas
// seulement relu dans le texte de la migration.
//
// WHY THIS EXISTS
// ---------------
// Quatre calculs d'argent (`useDashboard`, `ExpensesView`, `useYearOps`,
// `pdfExpensesReport`) lisent le couple `payment_status` / `amount_paid` comme une
// seule grandeur : `paid → amount`, `partial → amount_paid`, sinon 0. Une seule
// écriture mal formée annonce donc une dépense fausse à l'écran et dans le PDF,
// sans qu'aucun contrôle ne la compare à autre chose. Le fichier
// `20261108000000_vendor_expense_paid_consistency.sql` ferme cette classe ; ce
// test prouve que PostgreSQL l'exécute réellement : le corps PL/pgSQL, la valeur
// de retour du BEFORE, le code d'erreur `23514` et le rattrapage n'existent
// nulle part dans une lecture de texte.
//
// PGlite est PostgreSQL compilé en WASM : le même moteur, sans serveur, sans
// Docker et sans mot de passe. La migration est appliquée TELLE QU'ELLE EST
// écrite, sur un schéma minimal qui ne garde que les colonnes dont elle dépend.
//
// Ce qui est verrouillé ici, et qui se paierait en silence :
//   • un `paid` inséré sans montant stocke le montant dû (le chemin nominal de
//     l'interface, où le champ est masqué et vaut 0) ;
//   • un `unpaid` qui porte un montant est remis à zéro — la valeur envoyée ne
//     survit pas ;
//   • un `partial` hors bornes (0, négatif, ≥ dû) est REFUSÉ, pas corrigé ;
//   • un montant négatif et un statut inconnu sont refusés, en nommant la ligne ;
//   • l'ordre des étages : une écriture refusée par la POLITIQUE RLS lève 42501 et
//     pas un refus de forme — un RAISE en BEFORE passait avant l'autorisation et
//     rendait 400 (insert `{}` d'anon) au lieu de 401 ;
//   • le rattrapage range les lignes existantes sans toucher à celles qui sont
//     déjà justes, et sans changer un statut déclaré `paid` / `unpaid` ;
//   • le fichier est rejouable sans empiler deux fois le déclencheur.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les deux fichiers, DANS L'ORDRE : le premier pose la règle et rattrape
 * l'histoire, le second déplace les refus d'un BEFORE vers un AFTER — voir
 * l'en-tête de `20261108000002_…` : un RAISE en BEFORE passe avant le contrôle
 * RLS, et le refus anon devenait un 400.
 */
const MIGRATIONS = [
  'supabase/migrations/20261108000000_vendor_expense_paid_consistency.sql',
  'supabase/migrations/20261108000002_vendor_expense_paid_validation_after_rls.sql',
];

/**
 * Le strict nécessaire pour que la migration s'applique. Aucune colonne de
 * confort (`description`, `aid_type`…) : un schéma qui ressemblerait à la
 * production masquerait une dépendance du fichier à une colonne qu'une base
 * neuve n'a pas.
 */
const SCHEMA = `
  create table public.vendor_expenses (
    id uuid primary key,
    vendor_name text not null,
    amount numeric not null,
    due_date date not null,
    payment_status text not null,
    amount_paid numeric default 0
  );
`;

const ID_A = '00000000-0000-4000-8000-0000000000a1';
const ID_B = '00000000-0000-4000-8000-0000000000b2';
const ID_C = '00000000-0000-4000-8000-0000000000c3';
const ID_D = '00000000-0000-4000-8000-0000000000d4';

function migrationText(): string {
  return MIGRATIONS.map((relative) => readFileSync(join(ROOT, relative), 'utf8')).join('\n');
}

async function schemaOnly(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}

async function freshDb(): Promise<PGlite> {
  const db = await schemaOnly();
  await db.exec(migrationText());
  return db;
}

async function addVendorRow(
  db: PGlite,
  id: string,
  amount: number | string,
  status: string,
  paid: number,
): Promise<void> {
  await db.query(
    `insert into public.vendor_expenses (id, vendor_name, amount, due_date, payment_status, amount_paid)
     values ($1, 'Fournisseur', $2, '2026-10-15', $3, $4)`,
    [id, amount, status, paid],
  );
}

async function paidOf(db: PGlite, id: string): Promise<{ status: string; paid: number }> {
  const result = await db.query<{ payment_status: string; amount_paid: string }>(
    `select payment_status, amount_paid::text as amount_paid
       from public.vendor_expenses where id = $1`,
    [id],
  );
  const row = result.rows[0];
  assert.ok(row, `la dépense ${id} existe`);
  return { status: row.payment_status, paid: Number(row.amount_paid) };
}

describe("le montant payé d'une dépense fournisseur, tenu par PostgreSQL (déclencheur réel)", () => {
  it('un « payé » inséré sans montant stocke le montant dû — le chemin nominal de l’interface', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 150000, 'paid', 0);
      assert.deepEqual(await paidOf(db, ID_A), { status: 'paid', paid: 150000 });
    } finally {
      await db.close();
    }
  });

  it('un « impayé » qui porte un montant est remis à zéro', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 150000, 'unpaid', 75000);
      assert.deepEqual(await paidOf(db, ID_A), { status: 'unpaid', paid: 0 });
    } finally {
      await db.close();
    }
  });

  it('un partiel dans les bornes est CONSERVÉ — c’est une vraie saisie', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 150000, 'partial', 50000);
      assert.deepEqual(await paidOf(db, ID_A), { status: 'partial', paid: 50000 });
    } finally {
      await db.close();
    }
  });

  it('un partiel au-delà du dû est REFUSÉ, avec la ligne nommée', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 100000, 'paid', 100000);
      await assert.rejects(
        db.query(`update public.vendor_expenses set payment_status = 'partial', amount_paid = 500000 where id = $1`, [ID_A]),
        (error: { code?: string; message?: string }) => {
          assert.equal(error.code, '23514');
          assert.match(String(error.message), /partiel/);
          assert.match(String(error.message), new RegExp(ID_A), 'le message nomme la ligne à corriger');
          return true;
        },
      );
      // Le refus laisse la ligne intacte : aucun demi-geste.
      assert.deepEqual(await paidOf(db, ID_A), { status: 'paid', paid: 100000 });
    } finally {
      await db.close();
    }
  });

  it('un partiel à zéro ou égal au dû est REFUSÉ — ce n’est pas un partiel', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 100000, 'partial', 40000);
      for (const impossible of [0, 100000]) {
        await assert.rejects(
          db.query(`update public.vendor_expenses set amount_paid = $1 where id = $2`, [impossible, ID_A]),
          (error: { code?: string }) => error.code === '23514',
        );
      }
      assert.deepEqual(await paidOf(db, ID_A), { status: 'partial', paid: 40000 });
    } finally {
      await db.close();
    }
  });

  it('un UPDATE du client sur un « payé » est REMPLACÉ par le montant dû', async () => {
    const db = await freshDb();
    try {
      await addVendorRow(db, ID_A, 100000, 'paid', 100000);
      await db.query(`update public.vendor_expenses set amount_paid = 1 where id = $1`, [ID_A]);
      assert.deepEqual(await paidOf(db, ID_A), { status: 'paid', paid: 100000 });
    } finally {
      await db.close();
    }
  });

  it('un montant négatif et un statut inconnu sont refusés', async () => {
    const db = await freshDb();
    try {
      await assert.rejects(
        addVendorRow(db, ID_A, -1, 'unpaid', 0),
        (error: { code?: string }) => error.code === '23514',
      );
      await assert.rejects(
        addVendorRow(db, ID_B, 1000, 'settled', 1000),
        (error: { code?: string }) => error.code === '23514',
      );
    } finally {
      await db.close();
    }
  });

  it('le rattrapage range les lignes existantes, et ne touche pas celles qui sont justes', async () => {
    const db = await schemaOnly();
    try {
      // Insérées AVANT la migration : c'est l'état que la base pouvait porter.
      await addVendorRow(db, ID_A, 100000, 'paid', 0);      // payé déclaré, colonne morte
      await addVendorRow(db, ID_B, 100000, 'unpaid', 75000); // impayé qui porte un montant
      await addVendorRow(db, ID_C, 100000, 'partial', 100000); // partiel égal au dû
      await addVendorRow(db, ID_D, 100000, 'partial', 30000);  // déjà juste

      await db.exec(migrationText());

      assert.deepEqual(await paidOf(db, ID_A), { status: 'paid', paid: 100000 }, 'le statut déclaré est respecté, le montant s’y range');
      assert.deepEqual(await paidOf(db, ID_B), { status: 'unpaid', paid: 0 });
      assert.deepEqual(await paidOf(db, ID_C), { status: 'paid', paid: 100000 }, 'un partiel égal au dû est un payé');
      assert.deepEqual(await paidOf(db, ID_D), { status: 'partial', paid: 30000 }, 'une ligne juste reste juste');
    } finally {
      await db.close();
    }
  });

  it("une écriture refusée par la POLITIQUE ne parle pas du déclencheur", async () => {
    // Le défaut mesuré en CI : un RAISE en BEFORE précède le `WITH CHECK` de la
    // RLS, donc l'insert `{}` d'anon revenait en 400 (message du déclencheur) au
    // lieu du 401. Ici la preuve est locale : la même RLS, le même payload, et
    // l'erreur attendue est celle de la politique (42501), jamais `23514`.
    const db = await freshDb();
    try {
      await db.exec(`
        create role anon nologin;
        alter table public.vendor_expenses enable row level security;
        grant insert on public.vendor_expenses to anon;
      `);
      await db.exec('set role anon');
      try {
        await assert.rejects(
          db.query('insert into public.vendor_expenses (id) values ($1)', [ID_A]),
          (error: { code?: string }) => {
            assert.notEqual(error.code, '23514', 'aucun refus de forme ne précède la politique');
            assert.equal(error.code, '42501', 'le refus vient de la RLS (401 côté PostgREST)');
            return true;
          },
        );
      } finally {
        await db.exec('reset role');
      }
      // Et la ligne n'existe pas : un refus RLS n'écrit rien.
      const rows = await db.query<{ count: string }>(
        `select count(*)::text as count from public.vendor_expenses where id = $1`,
        [ID_A],
      );
      assert.equal(rows.rows[0]?.count, '0');
    } finally {
      await db.close();
    }
  });

  it('les déclencheurs sont rejouables sans s’empiler', async () => {
    const db = await freshDb();
    try {
      await db.exec(migrationText());
      const triggers = await db.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where not tgisinternal
            and tgrelid = 'public.vendor_expenses'::regclass
          order by tgname`,
      );
      assert.deepEqual(
        triggers.rows.map((row) => row.tgname),
        ['vendor_expense_paid_consistency', 'vendor_expense_paid_validation'],
        'deux déclencheurs, une fois : un BEFORE qui range, un AFTER qui refuse',
      );
      // Et il agit encore après le second passage.
      await addVendorRow(db, ID_A, 90000, 'unpaid', 42000);
      assert.deepEqual(await paidOf(db, ID_A), { status: 'unpaid', paid: 0 });
    } finally {
      await db.close();
    }
  });
});
