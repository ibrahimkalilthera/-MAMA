// Suite for the channel installer resolver (scripts/lib/channel-installer.mjs).
//
// WHY THIS EXISTS
// ---------------
// Prouver une correction sur un bundle extrait ne prouve pas que les postes la
// reçoivent : l'octet qui voyage est l'INSTALLEUR. Ce module est celui qui décide
// quel fichier un poste téléchargerait à partir de ce que le canal publie, donc
// ses refus sont les seuls garde-fous entre « on croit prouver le bon binaire »
// et « on prouve un autre fichier ».
//
// Un `latest.yml` réel est repris mot pour mot : c'est sa forme qui compte, pas
// une forme inventée par le test.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installerEntry, publishedInstaller } from '../scripts/lib/channel-installer.mjs';

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
].join('\n');

const ASSETS = [
  { name: 'MamaTheraFinance-1.0.8-setup.exe', browser_download_url: 'https://example.test/download/setup.exe' },
  { name: 'MamaTheraFinance-1.0.8-setup.exe.blockmap', browser_download_url: 'https://example.test/download/setup.exe.blockmap' },
  { name: 'latest.yml', browser_download_url: 'https://example.test/download/latest.yml' },
];

describe("l'installeur d'un flux publié", () => {
  it("prend l'entrée `setup.exe` du flux, pas le blockmap, et se réclame du numéro du flux", () => {
    const v = publishedInstaller({ text: FEED, assets: ASSETS, tag: 'v1.0.8' });
    assert.equal(v.ok, true, v.problems.join(' | '));
    assert.equal(v.installer?.name, 'MamaTheraFinance-1.0.8-setup.exe');
    assert.equal(v.installer?.url, 'https://example.test/download/setup.exe');
    assert.equal(v.installer?.size, 129081184);
    assert.equal(v.installer?.sha512, 'c2hhNTEyLXNldHVw');
    assert.equal(v.installer?.version, '1.0.8');
  });

  it('refuse un flux annoncé que la release ne porte pas — le canal promettrait un fichier introuvable', () => {
    const v = publishedInstaller({ text: FEED, assets: ASSETS.filter((a) => !/setup\.exe$/.test(a.name)), tag: 'v1.0.8' });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /personne ne peut télécharger/);
    assert.equal(v.installer, null);
  });

  it("refuse un flux illisible au lieu de le lire comme un flux vide", () => {
    const v = publishedInstaller({ text: 'pas: du tout: du yaml', assets: ASSETS, tag: 'v1.0.8' });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /illisible/);
  });

  it('refuse un flux absent : sans lui, personne ne sait quel fichier les postes téléchargent', () => {
    const v = publishedInstaller({ text: null, assets: ASSETS, tag: 'v1.0.8' });
    assert.equal(v.ok, false);
    assert.equal(v.installer, null);
  });

  it("refuse un installeur qui ne porte pas le numéro du flux — un poste recevrait un autre binaire", () => {
    const v = publishedInstaller({
      text: FEED.replaceAll('MamaTheraFinance-1.0.8-', 'MamaTheraFinance-1.0.7-'),
      assets: [{ name: 'MamaTheraFinance-1.0.7-setup.exe', browser_download_url: 'https://example.test/download/old.exe' }],
      tag: 'v1.0.8',
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /ne porte pas le numéro du flux/);
  });

  it('refuse deux installeurs annoncés : un poste n’a pas à choisir, ce contrôle non plus', () => {
    const v = publishedInstaller({
      text: FEED.replace('sha512: c2hhNTEyLWJsb2NrbWFw', 'sha512: c2hhNTEyLWJsb2NrbWFw')
        .replace('url: MamaTheraFinance-1.0.8-setup.exe.blockmap', 'url: MamaTheraFinance-1.0.8-extra-setup.exe'),
      assets: [...ASSETS],
      tag: 'v1.0.8',
    });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /2 installeurs/);
  });

  it('aucun installeur annoncé est un refus nommé : un canal sans installeur n’équipe personne', () => {
    const picked = installerEntry({ files: [{ url: 'MamaTheraFinance-1.0.8-setup.exe.blockmap', sha512: 'x', size: 1 }] });
    assert.equal(picked.ok, false);
    assert.match(picked.problems.join(' '), /AUCUN installeur/);
  });

  it('un `path` de tête qui désigne autre chose que l’installeur est NOMMÉ, pas fatal', () => {
    const v = publishedInstaller({
      text: FEED.replace('path: MamaTheraFinance-1.0.8-setup.exe', 'path: MamaTheraFinance-1.0.8-setup.exe.blockmap'),
      assets: ASSETS,
      tag: 'v1.0.8',
    });
    assert.equal(v.ok, true, v.problems.join(' | '));
    assert.match(v.warnings.join(' '), /path/);
  });
});
