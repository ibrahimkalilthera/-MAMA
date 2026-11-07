// Le solde d'un élève, calculé par un VRAI PostgreSQL — pas seulement lu dans le
// texte de la migration.
//
// WHY THIS EXISTS
// ---------------
// `tests/students-balance-trigger.test.ts` lit la migration comme un catalogue :
// il prouve qu'elle DÉCLARE un BEFORE ROW sur `students` et un AFTER ROW sur
// `payments`, pas que Postgres les exécute. Entre les deux il y a le corps
// PL/pgSQL, l'ordre des déclencheurs, la valeur de retour d'un AFTER, et le
// `SELECT … INTO NEW.*` : autant de choses qu'aucune lecture de texte ne vérifie.
// Ce dépôt a déjà payé cette classe d'erreur (une suite verte sur du code mort).
//
// PGlite est PostgreSQL compilé en WASM : le même moteur, sans serveur, sans
// Docker et sans mot de passe. La migration est appliquée TELLE QU'ELLE EST
// écrite (`supabase/migrations/20261107000000_…sql`), sur un schéma minimal qui
// ne garde que les colonnes dont elle dépend — si elle cessait de fonctionner sur
// une base neuve, ce fichier rougirait avant le déploiement.
//
// Ce qui est verrouillé ici, et qui se paie en silence :
//   • un solde DÉCLARÉ par le client ne survit pas à l'INSERT ;
//   • deux reçus font la somme, et la date est celle du plus récent ;
//   • un `UPDATE` du client sur les deux colonnes est REMPLACÉ, pas fusionné ;
//   • corriger, ré-attribuer ou supprimer un reçu recalcule la ou les fiches ;
//   • sans reçu, la date redevient NULL (jamais « 0 FCFA le 1er janvier ») ;
//   • le fichier est rejouable sans empiler deux fois le même déclencheur.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'supabase/migrations/20261107000000_students_balance_from_receipts.sql';

/**
 * Le strict nécessaire pour que la migration s'applique : les deux tables, leurs
 * clés, et les deux colonnes dérivées. Aucune colonne de confort — un schéma qui
 * ressemblerait à la production masquerait une dépendance de la migration à une
 * colonne qu'une base neuve n'a pas.
 */
const SCHEMA = `
  create table public.students (
    id uuid primary key,
    name text,
    amount_paid numeric not null default 0,
    last_payment_date date
  );
  create table public.payments (
    id uuid primary key,
    student_id uuid not null references public.students(id) on delete cascade,
    amount numeric not null,
    date date not null
  );
`;

const STUDENT_A = '00000000-0000-4000-8000-0000000000a1';
const STUDENT_B = '00000000-0000-4000-8000-0000000000b2';
const PAYMENT_1 = '00000000-0000-4000-8000-0000000000c1';
const PAYMENT_2 = '00000000-0000-4000-8000-0000000000c2';

function migrationText(): string {
  return readFileSync(join(ROOT, MIGRATION), 'utf8');
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migrationText());
  return db;
}

/** Le solde tel que la BASE le rend, en jour ISO (jamais un objet `Date` local). */
async function balanceOf(db: PGlite, studentId: string): Promise<{ amount: number; day: string | null }> {
  const result = await db.query<{ amount_paid: string; day: string | null }>(
    `select amount_paid::text as amount_paid,
            to_char(last_payment_date, 'YYYY-MM-DD') as day
       from public.students where id = $1`,
    [studentId],
  );
  const row = result.rows[0];
  assert.ok(row, `la fiche ${studentId} existe`);
  return { amount: Number(row.amount_paid), day: row.day };
}

async function addStudent(db: PGlite, id: string, declared = 0): Promise<void> {
  await db.query(
    'insert into public.students (id, name, amount_paid) values ($1, $2, $3)',
    [id, `Élève ${id.slice(-2)}`, declared],
  );
}

async function addReceipt(db: PGlite, id: string, studentId: string, amount: number, date: string): Promise<void> {
  await db.query(
    'insert into public.payments (id, student_id, amount, date) values ($1, $2, $3, $4)',
    [id, studentId, amount, date],
  );
}

describe('le solde et la date, calculés par PostgreSQL (déclencheurs réels)', () => {
  it('une fiche créée avec un solde déclaré naît à ZÉRO, sans date', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A, 9999);
      // Ce que la migration appelle « balance-without-receipt » : un montant que
      // rien n'a encaissé. Il n'existe plus, dès l'INSERT.
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 0, day: null });
    } finally {
      await db.close();
    }
  });

  it('deux reçus font la SOMME, et la date est celle du plus récent', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 4000, '2026-09-01');
      await addReceipt(db, PAYMENT_2, STUDENT_A, 4000, '2026-10-04');
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 8000, day: '2026-10-04' });
    } finally {
      await db.close();
    }
  });

  it('un UPDATE du client sur les deux colonnes est REMPLACÉ — c’est le défaut mesuré', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 4000, '2026-09-01');
      // Le geste du 2026-10-11 : le client réécrit une valeur absolue depuis un
      // instantané en mémoire. Ici, volontairement fausse dans les deux sens.
      await db.query(
        `update public.students set amount_paid = 1, last_payment_date = '2020-01-01' where id = $1`,
        [STUDENT_A],
      );
      assert.deepEqual(
        await balanceOf(db, STUDENT_A),
        { amount: 4000, day: '2026-09-01' },
        'une écriture du client ne peut pas faire dériver le registre',
      );
    } finally {
      await db.close();
    }
  });

  it('corriger un reçu recalcule le solde et la date', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 4000, '2026-09-01');
      await addReceipt(db, PAYMENT_2, STUDENT_A, 4000, '2026-10-04');
      await db.query(`update public.payments set amount = 6000 where id = $1`, [PAYMENT_1]);
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 10000, day: '2026-10-04' });
      // La date suit aussi le reçu corrigé, y compris quand il devient le plus
      // récent — un AFTER qui ne regarderait que le montant laisserait l'ancienne.
      await db.query(`update public.payments set date = '2026-11-02' where id = $1`, [PAYMENT_1]);
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 10000, day: '2026-11-02' });
    } finally {
      await db.close();
    }
  });

  it('une ré-attribution recalcule les DEUX fiches', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A);
      await addStudent(db, STUDENT_B);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 4000, '2026-09-01');
      await addReceipt(db, PAYMENT_2, STUDENT_A, 4000, '2026-10-04');
      // Le geste de la fusion : `payments.student_id` change de fiche.
      await db.query(`update public.payments set student_id = $1 where id = $2`, [STUDENT_B, PAYMENT_2]);
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 4000, day: '2026-09-01' });
      assert.deepEqual(
        await balanceOf(db, STUDENT_B),
        { amount: 4000, day: '2026-10-04' },
        'la fiche d’arrivée gagne le reçu, la fiche d’origine le perd',
      );
    } finally {
      await db.close();
    }
  });

  it('sans reçu restant, la date redevient NULL — pas « 0 FCFA le 1er janvier »', async () => {
    const db = await freshDb();
    try {
      await addStudent(db, STUDENT_A);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 4000, '2026-09-01');
      await db.query(`delete from public.payments where id = $1`, [PAYMENT_1]);
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 0, day: null });
    } finally {
      await db.close();
    }
  });

  it('la migration est rejouable sans empiler les déclencheurs', async () => {
    const db = await freshDb();
    try {
      await db.exec(migrationText());
      const triggers = await db.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where not tgisinternal
            and tgrelid in ('public.students'::regclass, 'public.payments'::regclass)
          order by tgname`,
      );
      assert.deepEqual(
        triggers.rows.map((row) => row.tgname),
        ['payments_sync_student_balance', 'students_balance_derived'],
        'deux déclencheurs, une fois chacun',
      );
      await addStudent(db, STUDENT_A);
      await addReceipt(db, PAYMENT_1, STUDENT_A, 2500, '2026-10-10');
      assert.deepEqual(await balanceOf(db, STUDENT_A), { amount: 2500, day: '2026-10-10' });
    } finally {
      await db.close();
    }
  });
});
