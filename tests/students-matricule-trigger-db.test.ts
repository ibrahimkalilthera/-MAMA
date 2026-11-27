// Le matricule attribué par un VRAI PostgreSQL — et le passage 999 → 1000 qui a
// bloqué l'école pendant trois jours.
//
// WHY THIS EXISTS
// ---------------
// Le 2026-11-24, la base a attribué `MT-2026-999` au 999e élève de l'année. Toute
// insertion suivante a été refusée : `assign_student_matricule()` écrivait
// `lpad(v_seq::text, 3, '0')`, et `lpad` TRONQUE au-delà de la longueur demandée
// (`lpad('1000', 3, '0')` = `'100'`). Le 1000e élève recevait le matricule du
// 100e, l'index UNIQUE refusait, et l'écran annonçait « Doublon détecté » pour un
// élève qui n'existait pas.
//
// Aucun test ne couvrait ce passage : les suites existantes vérifiaient que la
// migration DÉCLARE un déclencheur, pas ce que le corps PL/pgSQL produit au
// 1000e numéro. Ce fichier applique les deux migrations TELLES QU'ELLES SONT
// écrites, dans un PostgreSQL réel (PGlite, WASM), et verrouille :
//   • le 1000e matricule s'écrit EN ENTIER (`MT-2026-1000`) ;
//   • un matricule déjà pris au-delà du compteur est SAUTÉ, pas heurté ;
//   • un matricule fourni (numéro d'examen) reste intact ;
//   • la forme à trois chiffres ne change pas (`MT-2026-008`) ;
//   • les compteurs ne reculent jamais et rattrapent ce qui est déjà porté.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIGRATIONS = [
  'supabase/migrations/20261006000000_students_matricule_all.sql',
  'supabase/migrations/20261127000000_students_matricule_no_truncation.sql',
];

/**
 * Le strict nécessaire : `students` telle que les migrations la lisent, et
 * l'index UNIQUE que la production porte déjà (c'est lui qui refuse, donc c'est
 * lui qu'il faut avoir pour mesurer le défaut).
 */
const SCHEMA = `
  create table public.students (
    id uuid primary key,
    name text,
    student_id text unique,
    enrollment_date date,
    created_at timestamptz not null default now()
  );
`;

const migrationText = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  for (const path of MIGRATIONS) await db.exec(migrationText(path));
  return db;
}

let nextId = 0;
const newId = (): string => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;

/** Insère un élève sans matricule et rend celui que la BASE a attribué. */
async function addStudent(db: PGlite, enrollmentDate = '2026-11-27'): Promise<string> {
  const { rows } = await db.query<{ student_id: string }>(
    `insert into public.students (id, name, enrollment_date)
     values ($1, $2, $3::date) returning student_id`,
    [newId(), `Élève ${nextId}`, enrollmentDate],
  );
  return rows[0].student_id;
}

async function setCounter(db: PGlite, yr: string, seq: number): Promise<void> {
  await db.query(
    `insert into public.student_matricule_counters (yr, last_seq) values ($1, $2)
     on conflict (yr) do update set last_seq = $2`,
    [yr, seq],
  );
}

async function counterOf(db: PGlite, yr: string): Promise<number> {
  const { rows } = await db.query<{ last_seq: number }>(
    'select last_seq from public.student_matricule_counters where yr = $1',
    [yr],
  );
  return rows[0].last_seq;
}

describe('matricules — le numéro ne se tronque jamais', () => {
  it('écrit le 1000e matricule en entier, au lieu de retomber sur MT-2026-100', async () => {
    const db = await freshDb();
    await setCounter(db, '2026', 999);

    assert.equal(await addStudent(db), 'MT-2026-1000');
    assert.equal(await addStudent(db), 'MT-2026-1001');
    assert.equal(await counterOf(db, '2026'), 1001);
    await db.close();
  });

  it('saute un matricule déjà pris au-delà du compteur au lieu de bloquer l’ajout', async () => {
    const db = await freshDb();
    await setCounter(db, '2026', 999);
    // Un matricule saisi à la main (import, numéro d'examen) sans passer par le compteur.
    await db.query(
      `insert into public.students (id, name, student_id, enrollment_date)
       values ($1, 'Numéro saisi', 'MT-2026-1000', '2026-11-27')`,
      [newId()],
    );

    assert.equal(await addStudent(db), 'MT-2026-1001');
    await db.close();
  });

  it('garde la forme à trois chiffres pour les premiers numéros', async () => {
    const db = await freshDb();
    await setCounter(db, '2026', 7);

    assert.equal(await addStudent(db), 'MT-2026-008');
    await db.close();
  });

  it('respecte un matricule fourni, et ne consomme pas de numéro', async () => {
    const db = await freshDb();
    await setCounter(db, '2026', 40);

    const { rows } = await db.query<{ student_id: string }>(
      `insert into public.students (id, name, student_id, enrollment_date)
       values ($1, 'Numéro d’examen', 'EXAM-042', '2026-11-27') returning student_id`,
      [newId()],
    );

    assert.equal(rows[0].student_id, 'EXAM-042');
    assert.equal(await counterOf(db, '2026'), 40);
    await db.close();
  });

  it('réaligne le compteur au-dessus d’un matricule qui l’a dépassé, sans reculer', async () => {
    const db = await freshDb();
    await setCounter(db, '2026', 999);
    await db.query(
      `insert into public.students (id, name, student_id, enrollment_date)
       values ($1, 'Numéro saisi haut', 'MT-2026-1200', '2026-11-27')`,
      [newId()],
    );

    // Rejouer la migration est idempotent et suffit à remettre le compteur d'aplomb.
    await db.exec(migrationText(MIGRATIONS[1]));

    assert.equal(await counterOf(db, '2026'), 1200);
    assert.equal(await addStudent(db), 'MT-2026-1201');
    await db.close();
  });
});
