// Suite for electron/update-journal.cjs — le journal local d'un poste bloqué
// par la porte du retard.
//
// WHY THIS EXISTS
// ---------------
// La porte du retard empêchait un poste de continuer, mais pas de rester muet :
// le processus principal écrivait ses échecs dans `console.log`, c'est-à-dire
// nulle part pour qui n'ouvre pas les outils de développement — et le processus
// principal d'une application empaquetée, personne ne l'ouvre. Un poste d'école
// pouvait donc rester des semaines bloqué sans que quiconque sache pourquoi.
//
// Ce que ces cas protègent, dans l'ordre où un poste les vit : le journal part
// vide (aucun blocage = pas d'erreur), il tient une entrée et la relit, il se
// borne (une école garde son poste des années), il survit à une ligne coupée en
// pleine écriture (coupure de courant pendant un blocage — le moment exact où on
// en a besoin), et il n'échoue JAMAIS d'une manière qui empêcherait une mise à
// jour (disque plein, droits refusés).
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  MAX_ENTRIES,
  MAX_DETAIL,
  JOURNAL_FILE,
  journalPath,
  normalizeEntry,
  readEntries,
  appendEntry,
} = require('../electron/update-journal.cjs') as {
  MAX_ENTRIES: number;
  MAX_DETAIL: number;
  JOURNAL_FILE: string;
  journalPath: (input: { userDataDir: string }) => string;
  normalizeEntry: (raw: unknown, nowMs?: number) => Record<string, unknown> | null;
  readEntries: (file: string, options?: { limit?: number; fs?: unknown }) => Record<string, unknown>[];
  appendEntry: (
    file: string,
    entry: Record<string, unknown>,
    options?: { maxEntries?: number; nowMs?: number; fs?: unknown },
  ) => boolean;
};

function tmpFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'update-journal-'));
  return { dir, file: join(dir, JOURNAL_FILE) };
}

describe('le journal d’un poste bloqué', () => {
  it('vit dans userData, à côté des autres états du poste', () => {
    assert.equal(journalPath({ userDataDir: 'C:/data' }), join('C:/data', 'update-journal.jsonl'));
  });

  it('un journal qui n’existe pas encore se lit comme vide, sans jeter', () => {
    const { dir, file } = tmpFile();
    try {
      assert.deepEqual(readEntries(file), [], 'un poste jamais bloqué n’a pas de journal — et ce n’est pas une erreur');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une entrée écrite se relit telle quelle, la plus récente d’abord', () => {
    const { dir, file } = tmpFile();
    try {
      assert.equal(appendEntry(file, { code: 'download', version: '2.0.0', currentVersion: '1.0.0', station: 'PC-BUREAU', detail: '404' }), true);
      assert.equal(appendEntry(file, { code: 'install', version: '2.0.1', currentVersion: '1.0.0', station: 'PC-BUREAU', detail: 'installation non aboutie' }), true);

      const entries = readEntries(file);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].code, 'install', 'la plus récente en tête : c’est celle qui décrit l’état actuel');
      assert.equal(entries[1].code, 'download');
      assert.equal(entries[0].station, 'PC-BUREAU');
      // Une ligne = un objet JSON : le fichier doit être lisible à l'œil, et par
      // un outil qui lit du JSONL — pas un format maison.
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2);
      assert.deepEqual(Object.keys(/** @type {object} */ (JSON.parse(lines[0]))).sort(), [
        'appVersion', 'at', 'code', 'currentVersion', 'detail', 'station', 'version',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une seule entrée par écriture — pas d’accumulation d’octets dans un fichier append', () => {
    const { dir, file } = tmpFile();
    try {
      for (let i = 0; i < 5; i += 1) appendEntry(file, { code: 'download', detail: `essai ${i}` });
      const entries = readEntries(file, { limit: 100 });
      assert.equal(entries.length, 5);
      assert.equal(entries[0].detail, 'essai 4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le journal est BORNÉ, et ce sont les entrées récentes qui survivent', () => {
    const { dir, file } = tmpFile();
    try {
      for (let i = 0; i < MAX_ENTRIES + 20; i += 1) appendEntry(file, { code: 'download', detail: `essai ${i}` });
      const entries = readEntries(file, { limit: MAX_ENTRIES + 50 });
      assert.equal(entries.length, MAX_ENTRIES, 'un poste d’école tourne des années : le journal ne peut pas grandir sans fin');
      assert.equal(entries[0].detail, `essai ${MAX_ENTRIES + 19}`, 'la plus récente est là');
      assert.equal(
        entries[entries.length - 1].detail,
        'essai 20',
        'les plus anciennes sont celles qui partent — un journal tronqué par le mauvais côté ne dit plus rien de l’état actuel',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une ligne coupée en pleine écriture est ignorée, pas fatale', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, { code: 'download', detail: 'premier' });
      // Coupure de courant au milieu de l'écriture suivante — le fichier finit
      // sur une ligne tronquée, exactement comme un vrai crash.
      writeFileSync(file, readFileSync(file, 'utf8') + '{"code":"insta');
      const entries = readEntries(file);
      assert.equal(entries.length, 1, 'la ligne abîmée ne doit pas rendre tout le journal illisible');
      assert.equal(entries[0].detail, 'premier');
      // Et le journal reste utilisable après coup.
      assert.equal(appendEntry(file, { code: 'install', detail: 'après le crash' }), true);
      assert.equal(readEntries(file)[0].detail, 'après le crash');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une écriture impossible rend false SANS jeter — un journal ne bloque pas une mise à jour', () => {
    const failing = {
      readFileSync: () => '',
      mkdirSync: () => {},
      writeFileSync: () => { throw new Error('disque plein'); },
    };
    assert.equal(
      appendEntry('C:/introuvable/journal.jsonl', { code: 'download', detail: 'x' }, { fs: failing }),
      false,
      'disque plein : l’appelant continue, la porte reste décidée par la politique',
    );
  });

  it('une entrée qui ne dit rien est refusée, et les champs sont bornés', () => {
    assert.equal(normalizeEntry(null), null);
    assert.equal(normalizeEntry({ detail: 'sans code' }), null, 'sans code, l’entrée n’est pas exploitable');
    const entry = normalizeEntry({ code: 'download', detail: 'x'.repeat(MAX_DETAIL + 200) });
    assert.equal((entry?.detail as string).length, MAX_DETAIL, 'un message d’erreur, pas un roman');
    // Une version absente vaut null, jamais la chaîne « null » — sinon le
    // rapport de l'administrateur afficherait « version null ».
    assert.equal(entry?.version, null);
    assert.equal(entry?.currentVersion, null);
  });

  it('le fichier est créé même si userData n’existe pas encore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'update-journal-'));
    const file = join(dir, 'profond', 'userData', JOURNAL_FILE);
    try {
      assert.equal(appendEntry(file, { code: 'manual', detail: 'portable' }), true);
      assert.equal(readEntries(file).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la lecture est bornée aussi : on peut demander 1 entrée', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, { code: 'download', detail: 'a' });
      appendEntry(file, { code: 'download', detail: 'b' });
      assert.deepEqual(readEntries(file, { limit: 1 }).map((e) => e.detail), ['b']);
      assert.deepEqual(readEntries(file, { limit: 0 }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le module est importable par le processus principal sans dépendre d’electron', () => {
    // Le journal doit pouvoir être testé (et chargé) HORS d'Electron : un module
    // qui exigerait `electron` ne serait vérifiable qu'en lançant l'application.
    const source = readFileSync(join(root, 'electron', 'update-journal.cjs'), 'utf8');
    assert.doesNotMatch(source, /require\('electron'\)/);
    assert.match(source, /require\('node:fs'\)/);
  });
});
