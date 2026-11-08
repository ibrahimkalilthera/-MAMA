/**
 * Le lecteur paginé — la moitié qui manquait à `range()`.
 *
 * Le cas mesuré est celui de `payments` : 1 412 lignes, une seule requête, et
 * les 412 reçus les plus récents absents de l'écran sans un mot. Les tests
 * ci-dessous ne parlent pas à Supabase : ils prouvent la BOUCLE (combien de
 * pages, dans quel ordre, quand elle s'arrête) et ce qu'elle rend quand la
 * table dépasse son plafond.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_READ_PAGES, readAllPages } from '../src/lib/pagedRead';
import type { PageResult } from '../src/lib/pagedRead';

/** Une fausse table de `total` lignes, servie par pages, avec compte exact. */
function fakeTable(total: number, opts: { count?: boolean } = {}) {
  const calls: { from: number; to: number }[] = [];
  const fetchPage = async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push({ from, to });
    const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i);
    return { data, count: opts.count === false ? null : total, error: null };
  };
  return { calls, fetchPage };
}

describe('readAllPages — lire la table, pas sa première page', () => {
  it('1 412 lignes tiennent en deux requêtes, et la seconde est bornée au total', async () => {
    const table = fakeTable(1412);
    const result = await readAllPages('payments', table.fetchPage);
    assert.equal(result.rows.length, 1412, 'aucune ligne n’est laissée de côté');
    assert.equal(result.rows[1411], 1411, 'l’ordre des pages est conservé');
    assert.deepEqual(table.calls, [
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    assert.equal(result.total, 1412);
    assert.equal(result.shortfall, null);
    assert.equal(result.pages, 2);
  });

  it('exactement 1 000 lignes : le total connu arrête la boucle — et AUCUN manque', async () => {
    const table = fakeTable(1000);
    const result = await readAllPages('payments', table.fetchPage);
    assert.equal(result.rows.length, 1000);
    assert.equal(result.shortfall, null, 'une page pleine n’est pas une preuve de troncature quand le total est connu');
    assert.equal(table.calls.length, 1, 'inutile de demander une page vide que le total exclut');
  });

  it('999 lignes : une seule requête, et rien à signaler', async () => {
    const table = fakeTable(999);
    const result = await readAllPages('payments', table.fetchPage);
    assert.equal(result.rows.length, 999);
    assert.equal(table.calls.length, 1);
    assert.equal(result.shortfall, null);
  });

  it('la base ne compte pas : une page pleine devient un manque SUSPECT, jamais un silence', async () => {
    const table = fakeTable(1412, { count: false });
    const result = await readAllPages('payments', table.fetchPage, { maxPages: 1 });
    assert.equal(result.rows.length, 1000);
    assert.equal(result.total, null);
    assert.deepEqual(result.shortfall, { table: 'payments', loaded: 1000, total: null });
  });

  it('le plafond de pages est un refus dit, pas une boucle infinie', async () => {
    const table = fakeTable(10_000_000);
    const result = await readAllPages('payments', table.fetchPage, { maxPages: 2 });
    assert.equal(result.pages, 2);
    assert.equal(result.rows.length, 2000);
    assert.equal(result.shortfall?.loaded, 2000);
    assert.equal(result.shortfall?.total, 10_000_000);
    assert.equal(MAX_READ_PAGES, 50);
  });

  it('une erreur de page est RELANCÉE avec sa table et son numéro de page', async () => {
    const fetchPage = async (): Promise<PageResult<number>> => ({ data: null, count: null, error: { message: 'boom' } });
    await assert.rejects(
      () => readAllPages('payments', fetchPage),
      /Lecture de « payments » \(page 1\) : boom/,
    );
  });

  it('une taille de page absurde est refusée avant toute requête', async () => {
    let called = false;
    await assert.rejects(
      () => readAllPages('payments', async () => { called = true; return { data: [], count: 0, error: null }; }, { pageSize: 0 }),
      /Taille de page invalide/,
    );
    assert.equal(called, false, 'aucune requête ne part sur une configuration invalide');
  });

  it('une page vide termine la lecture (table vidée entre deux pages)', async () => {
    const fetchPage = async (from: number, to: number): Promise<PageResult<number>> => ({
      data: from === 0 ? Array.from({ length: to + 1 }, (_, i) => i) : [],
      count: 1000,
      error: null,
    });
    const result = await readAllPages('payments', fetchPage);
    assert.equal(result.rows.length, 1000);
    assert.equal(result.shortfall, null);
  });
});
