/**
 * Tests de la copie hors GitHub (scripts/lib/backup-offsite.mjs).
 *
 * Ce que ces cas mesurent, et pourquoi ils comptent : une clé qui trie, un
 * refus qui nomme le secret manquant, et un âge qui refuse de conclure sans
 * date. Le reste — l'appel réseau — n'est pas ici : il n'existe pas dans le
 * module, et c'est justement ce qui le rend jugeable sans base ni secret.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFSITE_BUCKET,
  OFFSITE_MAX_AGE_HOURS,
  ageVerdict,
  offsiteManifestKey,
  offsiteObjectKey,
  parseLastVerified,
  uploadPlan,
} from '../scripts/lib/backup-offsite.mjs';

/** Le manifeste tel que `scripts/backup-db.mjs` l'écrit (forme réelle). */
function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'mama-thera-backup-v1',
    project: 'https://rpcjdohfxwukbqngbprw.supabase.co',
    takenAt: '2026-11-08T02:41:07.809Z',
    totalRows: 353,
    tables: [
      { name: 'students', pk: 'id', rows: 200, sha256: 'a'.repeat(64) },
      { name: 'payments', pk: 'id', rows: 153, sha256: 'b'.repeat(64) },
    ],
    payloadSha256: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    ...overrides,
  };
}

const ENV = { supabaseUrl: 'https://rpcjdohfxwukbqngbprw.supabase.co/', serviceKey: 'cle-de-service' };

describe('la clé de la copie hors GitHub', () => {
  it('est triable comme du texte et ne porte aucun espace', () => {
    const key = offsiteObjectKey(manifest());
    assert.match(key, /^\d{8}T\d{6}Z\/db-backup-353l-2t-payload\.json\.enc$/);
    assert.doesNotMatch(key, /\s/, 'une clé Storage avec espace se casse en URL');
  });

  it('suit l’instant du manifeste, pas celui du run : deux dépôts du même contenu se rangent au même endroit', () => {
    const a = offsiteObjectKey(manifest(), new Date('2030-01-01T00:00:00Z'));
    const b = offsiteObjectKey(manifest(), new Date('2031-06-06T12:00:00Z'));
    assert.equal(a, b, 'la date du run ne doit pas déplacer la clé');
    assert.match(a, /^20261108T024107Z\//);
  });

  it('nomme les compteurs pour qu’une copie vide se voie sans ouvrir le manifeste', () => {
    const key = offsiteObjectKey(manifest({ totalRows: 0, tables: [{ name: 'students', pk: 'id', rows: 0, sha256: 'e'.repeat(64) }] }));
    assert.match(key, /db-backup-0l-1t-payload\.json\.enc$/);
  });

  it('place le manifeste à côté du contenu, sous le même préfixe', () => {
    const payload = offsiteObjectKey(manifest());
    const sidecar = offsiteManifestKey(manifest());
    assert.equal(payload.split('/')[0], sidecar.split('/')[0]);
    assert.notEqual(payload, sidecar);
    assert.match(sidecar, /-manifest\.json$/);
  });

  it('retombe sur l’instant fourni quand le manifeste n’a pas de date lisible', () => {
    const key = offsiteObjectKey(manifest({ takenAt: 'hier soir' }), new Date('2026-11-09T10:20:30Z'));
    assert.match(key, /^20261109T102030Z\//);
  });
});

describe('le plan de dépôt', () => {
  it('rend l’URL REST du seau, les en-têtes qui prouvent le dépôt et le manifeste qui l’accompagne', () => {
    const plan = uploadPlan(manifest(), ENV);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.url, `https://rpcjdohfxwukbqngbprw.supabase.co/storage/v1/object/${OFFSITE_BUCKET}/${plan.key}`);
    assert.equal(plan.headers.apikey, 'cle-de-service');
    assert.equal(plan.headers.Authorization, 'Bearer cle-de-service');
    assert.equal(plan.headers['x-upsert'], 'true', 'un run relancé réécrit le même objet au lieu d’échouer');
    assert.equal(plan.manifestHeaders['Content-Type'], 'application/json');
  });

  it('refuse en NOMMANT le secret absent, jamais par une URL vide', () => {
    const noKey = uploadPlan(manifest(), { supabaseUrl: ENV.supabaseUrl });
    assert.equal(noKey.ok, false);
    if (noKey.ok) return;
    assert.ok(noKey.reason, 'un refus doit dire pourquoi');
    assert.match(noKey.reason, /SERVICE_ROLE_KEY/);

    const noUrl = uploadPlan(manifest(), { serviceKey: 'x' });
    assert.equal(noUrl.ok, false);
    if (noUrl.ok) return;
    assert.ok(noUrl.reason, 'un refus doit dire pourquoi');
    assert.match(noUrl.reason, /SUPABASE_URL/);
  });

  it('refuse une URL qui n’est pas http(s) plutôt que de composer une adresse qui n’existe pas', () => {
    const plan = uploadPlan(manifest(), { supabaseUrl: 'rpcjdohfxwukbqngbprw.supabase.co', serviceKey: 'x' });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.ok(plan.reason, 'un refus doit dire pourquoi');
    assert.match(plan.reason, /SUPABASE_URL/);
  });
});

describe('l’âge de la dernière copie relue', () => {
  const now = new Date('2026-11-08T12:00:00Z');

  it('verte juste après, et encore verte à 47 h', () => {
    const fresh = ageVerdict('2026-11-08T09:00:00Z', now);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.ageHours, 3);

    const nearly = ageVerdict('2026-11-06T13:00:00Z', now);
    assert.equal(nearly.ok, true);
    assert.equal(nearly.ageHours, 47);
  });

  it('rouge à 49 h, en nommant l’âge et le seuil', () => {
    const stale = ageVerdict('2026-11-06T11:00:00Z', now);
    assert.equal(stale.ok, false);
    assert.equal(stale.ageHours, 49);
    assert.match(stale.message, /49 h/);
    assert.match(stale.message, new RegExp(`${OFFSITE_MAX_AGE_HOURS} h`));
  });

  it('rouge sans date : « aucune sauvegarde vérifiée connue »', () => {
    for (const value of [null, undefined, '', '   ']) {
      const verdict = ageVerdict(value as string | null, now);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.ageHours, null);
      assert.match(verdict.message, /aucune sauvegarde vérifiée connue/);
    }
  });

  it('rouge sur une date illisible, en citant la valeur bornée', () => {
    const verdict = ageVerdict('le 8 novembre, vers 2 h du matin', now);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ageHours, null);
    assert.match(verdict.message, /illisible/);
  });

  it('rouge sur une date dans le futur : une horloge qui avance rendrait le contrôle aveugle', () => {
    const verdict = ageVerdict('2026-11-09T12:00:00Z', now);
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /futur/);
  });

  it('un seuil invalide retombe sur 48 h au lieu de tout accepter', () => {
    const verdict = ageVerdict('2026-11-01T12:00:00Z', now, Number.NaN);
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /48 h/);
  });
});

describe('la relecture d’un horodatage dans un relevé', () => {
  it('lit l’ISO complet', () => {
    assert.equal(
      parseLastVerified('## Sauvegarde\n\nDernière vérification : 2026-11-08T02:41:07Z (353 lignes).'),
      '2026-11-08T02:41:07Z',
    );
  });

  it('lit la forme lisible et la rend en ISO canonique', () => {
    assert.equal(
      parseLastVerified('Dernière sauvegarde vérifiée : 2026-11-08 02:41 UTC'),
      '2026-11-08T02:41:00Z',
    );
  });

  it('rend null quand aucune date n’est lisible, sans lever', () => {
    assert.equal(parseLastVerified('sauvegarde faite hier soir'), null);
    assert.equal(parseLastVerified(''), null);
    assert.equal(parseLastVerified(null as unknown as string), null);
  });
});
