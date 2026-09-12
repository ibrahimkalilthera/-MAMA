// Suite for scripts/lib/transient-http.mjs — décider QUAND un échec HTTP mérite
// une nouvelle tentative.
//
// WHY THIS EXISTS
// ---------------
// Mesuré le 2026-09-12 : le pixel-check PDF est passé au rouge deux fois sur un
// 504 du gateway Supabase, application intacte. Et le résidu, lui, était réel :
// la suppression du compte éphémère a pris le même 504, donc le compte est resté
// en base jusqu'au run suivant. Le défaut n'était pas « il y a des pannes » —
// c'est la vie — mais « rien ne distinguait une panne passagère d'un verdict ».
//
// Ce que ces cas protègent, dans les deux sens : une coupure est retentée (le
// run retrouve sa vraie valeur), un verdict ne l'est JAMAIS (un 403 retenté
// quatre fois reste un refus, et le masquer ferait passer une vraie panne pour
// un hoquet), et un épuisement ne se déguise ni en succès ni en silence.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  DEFAULT_ATTEMPTS,
  MAX_ATTEMPTS,
  isTransientError,
  isTransientStatus,
  replayableWrite,
  withTransientRetry,
} from '../scripts/lib/transient-http.mjs';

/** Un `sleep` et un `log` espions : la cadence se teste comme une décision. */
function recorder() {
  const waits: number[] = [];
  const logs: string[] = [];
  return {
    waits,
    logs,
    sleep: async (ms: number) => { waits.push(ms); },
    log: (message: string) => { logs.push(message); },
  };
}

const httpError = (code: string) => Object.assign(new Error('fetch failed'), { code });

describe('une coupure passagère se retente, un verdict non', () => {
  it('les statuts de coupure sont reconnus, les verdicts aussi (dans l’autre sens)', () => {
    for (const s of [429, 502, 503, 504, '504']) assert.equal(isTransientStatus(s), true, `HTTP ${s}`);
    for (const s of [200, 201, 204, 400, 401, 403, 404, 409, 422, 500]) {
      assert.equal(isTransientStatus(s), false, `HTTP ${s} n’est pas une coupure passagère`);
    }
  });

  it('les pannes de transport sont reconnues, le reste ne l’est pas', () => {
    assert.equal(isTransientError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
    assert.equal(isTransientError(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
    assert.equal(isTransientError(httpError('ECONNRESET')), true);
    assert.equal(isTransientError({ message: 'fetch failed', cause: { code: 'UND_ERR_SOCKET' } }), true);
    assert.equal(isTransientError(new Error('HTTP 400')), false, 'un refus n’est pas un hoquet');
    assert.equal(isTransientError(null), false);
    assert.equal(isTransientError('boom'), false);
  });

  it('une coupure suivie d’un succès rend le succès, et le dit', async () => {
    const r = recorder();
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      return calls === 1 ? { status: 503, body: null } : { status: 200, body: { ok: true } };
    }, { sleep: r.sleep, log: r.log, label: 'PATCH x — ' });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true }, 'c’est la réponse de la DEUXIÈME tentative qui est rendue');
    assert.equal(calls, 2);
    assert.deepEqual(r.waits, [700], 'une seule attente, de la valeur par défaut');
    assert.equal(r.logs.length, 1, 'chaque reprise se voit');
    assert.match(r.logs[0], /HTTP 503 — coupure passagère, tentative 2\/4/);
  });

  it('un verdict n’est jamais retenté : il ressort tout de suite, sans attente', async () => {
    const r = recorder();
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      return { status: 403, body: null };
    }, { sleep: r.sleep, log: r.log });

    assert.equal(result.status, 403);
    assert.equal(calls, 1, 'un refus ne s’use pas à force d’insister');
    assert.deepEqual(r.waits, []);
    assert.deepEqual(r.logs, []);
  });

  it('une erreur de transport est retentée, une erreur ordinaire remonte aussitôt', async () => {
    const r = recorder();
    let transient = 0;
    const ok = await withTransientRetry(async () => {
      transient += 1;
      if (transient === 1) throw httpError('ECONNRESET');
      return { status: 200 };
    }, { sleep: r.sleep, log: r.log });
    assert.equal(ok.status, 200);
    assert.equal(transient, 2);

    let ordinary = 0;
    await assert.rejects(
      () => withTransientRetry(async () => {
        ordinary += 1;
        throw new Error('JSON invalide');
      }, { sleep: r.sleep, log: r.log }),
      /JSON invalide/,
    );
    assert.equal(ordinary, 1, 'une erreur qui n’est pas de transport ne se retente pas');
  });

  it('à l’épuisement, on rend ce qu’on a VU — le dernier statut, jamais un succès inventé', async () => {
    const r = recorder();
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      return { status: 504, body: null };
    }, { attempts: 3, sleep: r.sleep, log: r.log });

    assert.equal(result.status, 504, 'le 504 reste un 504 : l’appelant décide');
    assert.equal(calls, 3);
    assert.deepEqual(r.waits, [700, 1400], 'l’attente double entre deux tentatives');
    assert.match(r.logs[1], /tentative 3\/3/);
  });

  it('à l’épuisement sur des erreurs, l’erreur est RELANCÉE, pas avalée', async () => {
    const r = recorder();
    let calls = 0;
    await assert.rejects(
      () => withTransientRetry(async () => {
        calls += 1;
        throw httpError('ETIMEDOUT');
      }, { attempts: 2, sleep: r.sleep, log: r.log }),
      /fetch failed/,
    );
    assert.equal(calls, 2);
  });

  it('le nombre de tentatives est borné, même demandé très grand', async () => {
    const r = recorder();
    let calls = 0;
    await withTransientRetry(async () => {
      calls += 1;
      return { status: 502 };
    }, { attempts: 99, sleep: r.sleep, log: r.log });

    assert.equal(calls, MAX_ATTEMPTS, 'une reprise bornée reste une reprise');
    assert.ok(DEFAULT_ATTEMPTS <= MAX_ATTEMPTS);
  });

  it('l’attente croît puis plafonne — un retry ne doit pas s’étaler sans fin', async () => {
    const r = recorder();
    await withTransientRetry(async () => ({ status: 503 }), {
      attempts: 5, waitMs: 100, factor: 2, maxWaitMs: 250, sleep: r.sleep, log: r.log,
    });
    assert.deepEqual(r.waits, [100, 200, 250, 250]);
  });

  it('sans coupure, il n’y a ni attente ni bruit', async () => {
    const r = recorder();
    let calls = 0;
    const result = await withTransientRetry(async () => {
      calls += 1;
      return { status: 200, body: [] };
    }, { sleep: r.sleep, log: r.log });
    assert.deepEqual(result.body, []);
    assert.equal(calls, 1);
    assert.deepEqual(r.waits, []);
    assert.deepEqual(r.logs, []);
  });
});

// Une écriture non idempotente (POST) rejouée après un 504 doit être sondée
// AVANT d'être rejouée : le 504 peut être arrivé après l'application — et
// public.staff n'a aucune contrainte d'unicité pour l'interdire.
describe('une écriture rejouée ne se double pas', () => {
  it('le premier essai ne sonde pas, et une sonde vide fait rejouer', async () => {
    const r = recorder();
    let writes = 0;
    let probes = 0;
    const seen: number[] = [];
    const result = await replayableWrite(
      async () => {
        writes += 1;
        return writes === 1 ? { status: 504, body: null } : { status: 201, body: [{ id: 'ligne-1' }] };
      },
      async () => {
        probes += 1;
        seen.push(writes);
        return null;
      },
      { sleep: r.sleep, log: r.log },
    );

    assert.equal(result.status, 201);
    assert.equal(writes, 2, 'l’écriture est rejouée — la sonde n’a rien trouvé');
    assert.equal(probes, 1, 'la sonde tourne UNE fois, juste avant la reprise');
    assert.deepEqual(seen, [1], 'elle tourne après l’échec, pas avant le premier essai');
  });

  it('si la sonde trouve la ligne, l’écriture n’est PAS rejouée, et on le dit', async () => {
    const r = recorder();
    let writes = 0;
    const result = await replayableWrite(
      async (): Promise<{ status: number, body: Array<{ id: string }> | null }> => {
        writes += 1;
        return { status: 504, body: null };
      },
      async () => ({ status: 201, body: [{ id: 'déjà-là' }] }),
      { sleep: r.sleep, log: r.log, label: 'POST /rest/v1/staff — ' },
    );

    assert.equal(writes, 1, 'aucun doublon : la ligne de la première tentative est réutilisée');
    assert.deepEqual(result.body, [{ id: 'déjà-là' }], 'c’est l’état déjà écrit qui est rendu');
    assert.ok(
      r.logs.some((m) => /déjà appliquée — réutilisée/.test(m)),
      'la réutilisation se voit dans le journal : « vert » ne doit pas cacher une reprise',
    );
  });

  it('une sonde qui échoue ne décide rien : on rejoue', async () => {
    const r = recorder();
    let writes = 0;
    const result = await replayableWrite(
      async () => {
        writes += 1;
        return writes === 1 ? { status: 503, body: null } : { status: 201, body: [{ id: 'ok' }] };
      },
      async () => { throw httpError('ECONNRESET'); },
      { sleep: r.sleep, log: r.log },
    );

    assert.equal(result.status, 201);
    assert.equal(writes, 2);
  });

  it('un verdict (403) ne sonde jamais : il n’y a pas de reprise à préparer', async () => {
    const r = recorder();
    let probes = 0;
    const result = await replayableWrite(
      async () => ({ status: 403, body: null }),
      async () => { probes += 1; return null; },
      { sleep: r.sleep, log: r.log },
    );

    assert.equal(result.status, 403);
    assert.equal(probes, 0);
    assert.deepEqual(r.waits, []);
  });
});
