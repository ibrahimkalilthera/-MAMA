// ─────────────────────────────────────────────────────────────────────────────
// Le partage production/recette, tel qu'il est tranché le 2026-09-14.
//
// Les cycles E2E écrivent des élèves, parents, employés, paiements et dépenses de
// DÉMONSTRATION dans la base partagée — celle de l'école. C'est ce qui prouve le
// chemin réel, et c'est ce qui a rempli le journal d'audit de 432 lignes de bruit
// de recette avant la mise en service. La règle qui protège l'école sans casser
// la preuve : écrire tant que la base est LIBRE de saisies d'école, refuser dès
// la première ligne réelle, en la nommant.
//
// Ce qui se verrouille ici, ce sont les deux façons de se tromper : autoriser
// l'écriture sur une base habitée (les lignes de recette se mêleraient aux
// vraies), et autoriser l'écriture sur un comptage INCOMPLET (une passerelle en
// panne ferait passer une base pleine pour une base libre).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readSchoolCounts, recetteWriteVerdict, SCHOOL_TABLES } from '../scripts/lib/recette-base.mjs';

type Counts = Record<string, number | string>;

/** Une base libre : les sept tables métier comptées, toutes à zéro. */
const emptyBase = (): Counts => Object.fromEntries(SCHOOL_TABLES.map((t: string) => [t, 0]));

const verdict = (counts: Counts, allow = false) =>
  recetteWriteVerdict({ counts, allow }) as {
    ok: boolean;
    cause: string;
    detail: string;
    tables: Array<{ table: string; rows: number }>;
  };

describe('recetteWriteVerdict — où la recette a le droit d’écrire', () => {
  it('base libre → autorisé, et le dit avec le nombre de tables regardées', () => {
    const v = verdict(emptyBase());
    assert.equal(v.ok, true);
    assert.equal(v.cause, 'base libre de données d’école');
    assert.match(v.detail, new RegExp(`${SCHOOL_TABLES.length} table`));
    assert.deepEqual(v.tables, []);
  });

  it('une seule ligne réelle suffit à refuser — et la table est NOMMÉE', () => {
    const v = verdict({ ...emptyBase(), students: 1 });
    assert.equal(v.ok, false);
    assert.match(v.cause, /données d’école/);
    assert.match(v.detail, /students 1/, 'le compte lu est publié, pas résumé');
    assert.deepEqual(v.tables, [{ table: 'students', rows: 1 }]);
  });

  it('plusieurs tables habitées sont toutes nommées, dans l’ordre du contrat', () => {
    const v = verdict({ ...emptyBase(), students: 42, payments: 137, staff: '3' });
    assert.equal(v.ok, false);
    assert.deepEqual(
      v.tables.map((t) => `${t.table} ${t.rows}`),
      ['students 42', 'staff 3', 'payments 137'],
      'l’ordre suit SCHOOL_TABLES, pas l’ordre d’arrivée des chiffres',
    );
  });

  it('le détail dit les DEUX issues — c’est ce qui rend le refus actionnable', () => {
    const v = verdict({ ...emptyBase(), students: 5 });
    assert.match(v.detail, /vulbmmzhcmnzswcvswfk/, 'le projet de recette qui répond encore est nommé');
    assert.match(v.detail, /--allow/, 'et la dérogation assumée est nommée aussi');
  });

  it('une dérogation explicite autorise — mais l’écrit noir sur blanc', () => {
    const v = verdict({ ...emptyBase(), students: 5 }, true);
    assert.equal(v.ok, true);
    assert.equal(v.cause, 'dérogation explicite');
    assert.match(v.detail, /À CÔTÉ de données réelles/, 'une dérogation ne se déguise pas en base libre');
    assert.deepEqual(v.tables, [{ table: 'students', rows: 5 }]);
  });

  it('un comptage incomplet REFUSE : sans chiffre, une base pleine ressemblerait à une base libre', () => {
    const counts = emptyBase();
    delete counts.payments;
    const v = verdict(counts);
    assert.equal(v.ok, false);
    assert.equal(v.cause, 'comptage incomplet');
    assert.match(v.detail, /payments/);
  });

  it('une valeur illisible n’est pas un zéro', () => {
    const v = verdict({ ...emptyBase(), expenses: 'indisponible' });
    assert.equal(v.ok, false);
    assert.equal(v.cause, 'comptage incomplet');
    assert.match(v.detail, /expenses/);
  });

  it('les tables hors saisie d’école ne pèsent pas : le journal et les comptes ne bloquent rien', () => {
    const v = verdict({ ...emptyBase(), audit_logs: 429, user_profiles: 4, academic_years: 4 });
    assert.equal(v.ok, true, 'un journal d’audit plein et quatre comptes ne sont pas des saisies d’école');
  });
});

describe('readSchoolCounts — lire sans jamais lire les données', () => {
  const fakeFetch = (rows: Record<string, string | number | null>, opts: { status?: number } = {}) =>
    (async (url: string) => {
      const table = String(url).split('/rest/v1/')[1]!.split('?')[0]!;
      const value = rows[table];
      const status = opts.status ?? 200;
      return {
        ok: status < 400,
        status,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-range' ? (value === null ? null : `0-0/${value}`) : null,
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

  it('lit le total du content-range, table par table — aucune ligne ramenée', async () => {
    const asked: string[] = [];
    const counting = (async (url: string, init?: RequestInit) => {
      asked.push(String(url).replace('https://x.supabase.co', ''));
      assert.equal(
        (init?.headers as Record<string, string>)?.Range,
        '0-0',
        'la lecture est bornée à zéro ligne : aucune donnée d’école ne transite',
      );
      return (fakeFetch({ students: 7, parents: 0 }) as unknown as (u: string) => Promise<Response>)(url);
    }) as unknown as typeof fetch;

    const { counts, unread } = await readSchoolCounts({ base: 'https://x.supabase.co/', key: 'k', fetchImpl: counting });
    assert.equal(counts.students, 7);
    assert.equal(counts.parents, 0, 'un zéro RÉPONDU (0-0/0) reste un zéro mesuré, pas un non-lu');
    assert.equal(
      unread.length,
      SCHOOL_TABLES.length - 2,
      'les cinq tables que ce faux backend ne connaît pas sont « non lues »',
    );
    assert.equal(asked.length, SCHOOL_TABLES.length);
    assert.ok(
      asked.every((u) => u.startsWith('/rest/v1/') && u.includes('select=id')),
      'et chaque lecture ne demande que l’identifiant',
    );
  });

  it('une table qui répond mal est « non lue », pas « vide » — la distinction décide de l’écriture', async () => {
    const { counts, unread } = await readSchoolCounts({
      base: 'https://x.supabase.co',
      key: 'k',
      fetchImpl: fakeFetch({ students: 3 }, { status: 500 }),
    });
    assert.deepEqual(counts, {}, 'un 500 ne produit aucun zéro commode');
    assert.equal(unread.length, SCHOOL_TABLES.length);
    assert.ok(unread.every((u) => /HTTP 500/.test(u)), 'et la cause est écrite avec le statut');
  });

  it('une coupure de transport est comptée comme non lue, avec sa cause', async () => {
    const failing = (async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }) as unknown as typeof fetch;
    const { counts, unread } = await readSchoolCounts({ base: 'https://x.supabase.co', key: 'k', fetchImpl: failing });
    assert.deepEqual(counts, {});
    assert.ok(unread.every((u) => /ECONNRESET/.test(u)));
  });
});
