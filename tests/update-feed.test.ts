// Suite for the byte-promise verdict (electron/update-feed.cjs).
//
// WHY THIS EXISTS
// ---------------
// Un poste ne se met pas à jour sur une version, il se met à jour sur une
// PROMESSE D'OCTETS. `electron-updater` refuse ce qui n'y répond pas — mais il le
// refusait sous un seul motif, `download`, qui mélange deux pannes aux remèdes
// OPPOSÉS : « le réseau de l'école a lâché » (se répare sur le poste) et « le
// canal sert autre chose que ce qu'il annonce » (se répare sur le canal, et
// concerne tous les postes). Ce module est celui qui les distingue, donc ses
// branches de refus sont le sujet de cette suite.
//
// Deux cas valent la suite à eux seuls :
//   • le lecteur du flux est confronté à celui des scripts de CI sur le MÊME
//     texte — deux lecteurs du même fichier qui divergeraient en silence
//     rendraient le verdict faux sans que rien ne rougisse ;
//   • le hacheur est exercé sur un VRAI fichier, parce que la seule chose qu'un
//     hacheur ne peut pas inventer est l'empreinte des octets.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseLatestYml } from '../scripts/lib/latest-yml.mjs';

const require = createRequire(import.meta.url);
const {
  parseFeed,
  feedUrlFrom,
  feedEntryFor,
  checksumVerdict,
  hashFile,
  cachedDownload,
} = require('../electron/update-feed.cjs');

/** Un `latest.yml` réel (1.0.8 publiée) : c'est sa forme qui compte. */
const FEED = [
  'version: 1.0.8',
  'files:',
  '  - url: MamaTheraFinance-1.0.8-setup.exe',
  '    sha512: c2hhNTEyLXNldHVw',
  '    size: 129081184',
  '  - url: MamaTheraFinance-1.0.8-setup.exe.blockmap',
  '    sha512: c2hhNTEyLWJsb2NrbWFw',
  '    size: 135294',
  'path: MamaTheraFinance-1.0.8-setup.exe',
  'sha512: c2hhNTEyLXNldHVw',
  'releaseDate: 2026-09-13T09:00:00.000Z',
  '',
].join('\n');

describe('la promesse d’octets du flux, telle que le poste la lit', () => {
  it('les deux lecteurs du même fichier disent la MÊME chose (CI et poste)', () => {
    const fromCi = parseLatestYml(FEED);
    const fromPoste = parseFeed(FEED);
    assert.ok(fromCi && fromPoste);
    assert.deepEqual(fromPoste, {
      version: fromCi.version,
      files: fromCi.files,
      path: fromCi.path,
      sha512: fromCi.sha512,
    });
  });

  it('un flux illisible est `null`, jamais un objet vide qui se lirait « rien à annoncer »', () => {
    assert.equal(parseFeed('pas: du tout: du yaml'), null);
    assert.equal(parseFeed('version: 1.0.8\nfiles:\n  - url: x-setup.exe\n    sha512: y\n'), null);
  });

  it("l'entrée de LA version annoncée est choisie par son numéro, pas par la première ligne", () => {
    const entry = feedEntryFor(FEED, { version: '1.0.8' });
    assert.equal(entry?.url, 'MamaTheraFinance-1.0.8-setup.exe');
    assert.equal(entry?.size, 129081184);
    assert.equal(feedEntryFor(FEED, { fileName: 'MamaTheraFinance-1.0.8-setup.exe.blockmap' })?.url, 'MamaTheraFinance-1.0.8-setup.exe.blockmap');
    assert.equal(feedEntryFor(FEED, { version: '9.9.9' })?.url, 'MamaTheraFinance-1.0.8-setup.exe');
  });

  it("l'URL du flux vient d'`app-update.yml` ou d'un mode preuve, jamais d'une constante recopiée", () => {
    assert.equal(
      feedUrlFrom({ appUpdateYml: 'provider: generic\nurl: https://example.test/feed/\n' }),
      'https://example.test/feed/latest.yml',
    );
    assert.equal(feedUrlFrom({ feedOverride: 'http://127.0.0.1:9450/' }), 'http://127.0.0.1:9450/latest.yml');
    assert.equal(feedUrlFrom({ appUpdateYml: 'provider: generic\n' }), null);
  });
});

describe('le verdict : ces octets répondent-ils à la promesse ?', () => {
  const entry = { url: 'MamaTheraFinance-1.0.8-setup.exe', sha512: 'attendu', size: 129081184 };

  it('octets COMPLETS sous une autre empreinte : c’est le CANAL, et c’est nommé', () => {
    const v = checksumVerdict({ entry, served: { file: entry.url, sha512: 'servi', size: 129081184 } });
    assert.equal(v.fault, true);
    assert.equal(v.code, 'checksum');
    assert.match(v.detail, /COMPLETS/);
    assert.match(v.detail, /tous les postes/);
  });

  it('octets TRONQUÉS : c’est un téléchargement, pas une accusation contre le canal', () => {
    const v = checksumVerdict({ entry, served: { file: entry.url, sha512: 'servi', size: 10 } });
    assert.equal(v.fault, false);
    assert.equal(v.code, 'download');
    assert.match(v.detail, /incomplet/);
  });

  it('octets conformes : aucune objection, et le verdict le dit', () => {
    const v = checksumVerdict({ entry, served: { file: entry.url, sha512: 'attendu', size: 129081184 } });
    assert.equal(v.fault, false);
    assert.equal(v.code, 'none');
  });

  it('quand la bibliothèque a DÉJÀ écarté le fichier, son refus reste la preuve', () => {
    const v = checksumVerdict({ entry, served: null, updaterDetail: 'sha512 checksum mismatch, expected X got Y' });
    assert.equal(v.fault, true);
    assert.equal(v.code, 'checksum');
    assert.match(v.detail, /CANAL/);
  });

  it('une panne de réseau ordinaire n’accuse PAS le canal', () => {
    const v = checksumVerdict({ entry, served: null, updaterDetail: 'net::ERR_CONNECTION_RESET' });
    assert.equal(v.fault, false);
    assert.equal(v.code, 'unknown');
  });

  it('sans promesse lisible, on n’accuse rien : une accusation sans preuve est pire que le silence', () => {
    const v = checksumVerdict({ entry: null, served: null, updaterDetail: 'net::ERR_CONNECTION_RESET' });
    assert.equal(v.fault, false);
    assert.equal(v.code, 'unknown');
  });

  it('un fichier annoncé SANS taille ne fait pas passer la troncature pour une divergence', () => {
    const v = checksumVerdict({ entry: { ...entry, size: null }, served: { file: entry.url, sha512: 'servi', size: 3 } });
    assert.equal(v.fault, false, 'sans taille annoncée, on ne peut pas conclure à une divergence');
  });
});

describe('et ce que le poste HACHE pour de vrai', () => {
  it('un vrai fichier rend l’empreinte et la taille de ses octets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'update-feed-'));
    try {
      const file = join(dir, 'setup.exe');
      const bytes = Buffer.from('octets de preuve — 129 Mo n’ajoutent rien à ce cas');
      writeFileSync(file, bytes);
      const served = await hashFile(file);
      assert.equal(served?.size, bytes.length);
      assert.equal(served?.sha512, createHash('sha512').update(bytes).digest('base64'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un fichier absent rend `null`, jamais un digest vide qui se lirait « conforme »', async () => {
    assert.equal(await hashFile(join(tmpdir(), 'inexistant-update-feed-xyz', 'setup.exe')), null);
  });

  it('le fichier cherché est celui que le flux NOMME, pas le plus gros du dossier', () => {
    const dir = mkdtempSync(join(tmpdir(), 'update-feed-cache-'));
    try {
      writeFileSync(join(dir, 'un-voisin-setup.exe'), 'x');
      assert.equal(cachedDownload({ cacheDir: dir, fileName: 'MamaTheraFinance-1.0.8-setup.exe' }), null);
      writeFileSync(join(dir, 'MamaTheraFinance-1.0.8-setup.exe'), 'y');
      assert.equal(cachedDownload({ cacheDir: dir, fileName: 'MamaTheraFinance-1.0.8-setup.exe' }), join(dir, 'MamaTheraFinance-1.0.8-setup.exe'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
