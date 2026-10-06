// Suite for scripts/lib/audit-verdict.mjs — ce qui compte comme une MESURE
// d'audit, et ce qu'un cache a encore le droit de faire dans le verdict.
//
// Deux façons de rendre un vert SANS avoir mesuré, toutes deux payées le
// 2026-10-06 et verrouillées ici :
//
//   1. LE CACHE. Le job « Quality & performance guard » est VERT en relisant un
//      cache de 23,5 h (`Total audit count 7 within baseline 7 (cached, 23.5h
//      old)`) alors que le `npm ci` du MÊME job annonçait déjà
//      `16 vulnerabilities (8 moderate, 8 high)`. La clé du cache est l'empreinte
//      du lockfile, or un avis se publie SANS que le lockfile change.
//
//   2. LA RÉPONSE D'ERREUR. `npm audit --json` écrit AUSSI du JSON sur stdout
//      quand le registre est injoignable (`{"message": …, "error": {…}}`), et il
//      peut sortir 0. Lu comme un rapport, ce payload n'a pas de
//      `vulnerabilities` : le gate annonçait « Production … clean » et
//      « Total audit count 0 » sur un audit qui n'avait RIEN regardé.
//
// D'où deux propriétés, chacune avec ses cas :
//   • une MESURE est un rapport npm réel, et un payload d'erreur n'en est pas un ;
//   • un cache n'est exploitable que pour SON arbre et un âge borné, et un repli
//     porte son libellé — le câblage du gate le vérifie aussi.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_VERSION, cacheFallbackLabel, isAuditReport, usableCache } = await import(
  '../scripts/lib/audit-verdict.mjs'
);

const HOUR = 3600000;
const LOCK = 'deadbeefdeadbeef';
const NOW = Date.parse('2026-10-06T06:00:00.000Z');

/** Un rapport d'audit tel que npm le produit quand il a mesuré. */
const report = (total = 8) => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: total, high: 0, critical: 0, total } },
});

describe('isAuditReport — une mesure est un RAPPORT, pas du JSON', () => {
  it('un rapport avec `metadata.vulnerabilities` est une mesure', () => {
    assert.equal(isAuditReport(report()), true);
    assert.equal(isAuditReport(report(0)), true, 'zéro vulnérabilité reste une mesure');
  });

  it('le payload d’ERREUR de npm n’est PAS un rapport (mesuré : registre injoignable, stdout JSON)', () => {
    // Payload relevé le 2026-10-06 sur un registre injoignable, code de sortie 0.
    const payload = {
      message: 'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed',
      error: { summary: '', detail: '' },
    };
    assert.equal(isAuditReport(payload), false);
  });

  it('tout ce qui n’est pas un rapport est refusé', () => {
    for (const value of [
      null,
      undefined,
      'un rapport',
      42,
      [],
      {},
      { metadata: {} },
      { metadata: { vulnerabilities: 'aucune' } },
      { vulnerabilities: {} },
    ]) {
      assert.equal(isAuditReport(value), false, JSON.stringify(value ?? null));
    }
  });
});

/** Une entrée telle que le gate en écrit, horodatée relativement à NOW. */
const entry = (over: Record<string, unknown> = {}, ageHours = 1) =>
  JSON.stringify({
    version: CACHE_VERSION,
    lockHash: LOCK,
    checkedAt: new Date(NOW - ageHours * HOUR).toISOString(),
    prodVulns: [],
    total: 8,
    summary: { info: 0, low: 0, moderate: 8, high: 0, critical: 0 },
    ...over,
  });

/** Le seul appel légitime : l'arbre EST celui du cache, et « maintenant » est injecté. */
const read = (text: string, over: { lockHash?: string; ttlMs?: number } = {}) =>
  usableCache(text, { lockHash: LOCK, ttlMs: 24 * HOUR, now: NOW, ...over });

describe('exploitabilité — une entrée ne vaut que pour SON arbre, et pour un âge borné', () => {
  it('une entrée du bon arbre, assez récente, est exploitable — et porte son âge', () => {
    const found = read(entry({}, 23.5));
    assert.ok(found, 'l’entrée doit être exploitable');
    assert.equal(found.total, 8);
    assert.equal(found.ageHours.toFixed(1), '23.5');
    assert.deepEqual(found.prodVulns, []);
  });

  it('un JSON illisible rend null — un cache corrompu ne vaut pas un vert', () => {
    assert.equal(read('{ pas du json'), null);
    assert.equal(read(''), null);
    assert.equal(read('null'), null);
  });

  it('une version étrangère est un contrat qu’on ne connaît pas : null', () => {
    assert.equal(read(entry({ version: CACHE_VERSION + 1 })), null);
    assert.equal(read(entry({ version: '1' })), null);
  });

  it('l’empreinte d’un AUTRE arbre rend null — un repli ne traverse pas un changement de dépendances', () => {
    assert.equal(read(entry({ lockHash: 'un-autre-arbre' })), null);
    assert.equal(read(entry({ lockHash: undefined })), null);
  });

  it('un horodatage illisible rend null', () => {
    assert.equal(read(entry({ checkedAt: 'hier' })), null);
    assert.equal(read(entry({ checkedAt: undefined })), null);
  });

  it('un cache daté du FUTUR rend null (une horloge inversée ne produit pas un âge négatif)', () => {
    assert.equal(read(entry({}, -3)), null);
  });

  it('au-delà du TTL c’est null : 23,5 h passe sous 24 h, 24,1 h ne passe pas', () => {
    assert.ok(read(entry({}, 23.5)), 'sous le TTL, un repli reste exploitable');
    assert.equal(read(entry({}, 24.1)), null);
    assert.equal(read(entry({}, 0.5), { ttlMs: 0 }), null, 'un TTL nul refuse tout');
  });

  it('des champs mal typés ne rendent ni NaN ni undefined : zéro et liste vide', () => {
    const found = read(entry({ total: 'huit', prodVulns: 'non', summary: null }));
    assert.ok(found);
    assert.equal(found.total, 0);
    assert.deepEqual(found.prodVulns, []);
    assert.deepEqual(found.summary, {});
  });
});

describe('le libellé d’un repli — il DIT ce qu’il est', () => {
  it('nomme le cache, son âge et l’absence de mesure en direct', () => {
    const label = cacheFallbackLabel(23.456);
    assert.match(label, /CACHE/);
    assert.match(label, /23\.5h/, 'l’âge doit rester lisible à une décimale');
    assert.match(label, /mesure en direct indisponible/);
  });

  it('un âge illisible ne rend pas « NaN h »', () => {
    assert.match(cacheFallbackLabel(Number.NaN), /\?h/);
  });
});

describe('câblage — la mesure en direct précède la lecture du cache', () => {
  // Source sans commentaires : une assertion sur le CODE ne doit pas lire la prose
  // qui, elle, cite volontiers le cache et son défaut.
  const code = readFileSync(join(root, 'scripts', 'check-audit.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('le gate importe la décision de verdict au lieu de la réécrire', () => {
    assert.match(code, /from '\.\/lib\/audit-verdict\.mjs'/);
    assert.match(code, /isAuditReport/);
    assert.match(code, /usableCache/);
    assert.match(code, /cacheFallbackLabel/);
  });

  it('la tentative de mesure en direct vient AVANT la lecture du cache', () => {
    const live = code.indexOf('runAudit(');
    const cache = code.indexOf('usableCache(');
    assert.ok(live > -1, 'le gate doit mesurer en direct');
    assert.ok(cache > -1, 'le gate doit pouvoir lire un repli');
    assert.ok(live < cache, 'le cache ne doit être lu qu’APRÈS la tentative de mesure');
  });

  it('le repli est ANNONCÉ : son verdict porte son libellé, et le journal le dit', () => {
    assert.match(code, /cacheFallbackLabel\(/, 'le verdict de repli doit porter son libellé');
    assert.match(code, /registre npm injoignable : verdict repris d'un cache/);
  });

  it('aucun rapport n’est lu sans passer par le contrôle de forme', () => {
    // Le défaut mesuré : `JSON.parse(stdout)` acceptait un payload d'erreur comme
    // un rapport. Le seul chemin vers un rapport doit être `reportOf`.
    assert.match(code, /function reportOf\(/);
    assert.match(code, /reportOf\(execSync/);
    assert.match(code, /reportOf\(e\.stdout/);
    assert.doesNotMatch(code, /JSON\.parse\(execSync/, 'aucun rapport ne doit être parsé sans contrôle de forme');
  });
});
