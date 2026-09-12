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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
type JournalEntry = Record<string, unknown> &
  { key?: string; occurrences?: number; reportedAt?: string | null };

const {
  MAX_ENTRIES,
  MAX_DETAIL,
  JOURNAL_FILE,
  journalPath,
  normalizeEntry,
  readEntries,
  appendEntry,
  entryKey,
  pendingReports,
  markReported,
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
  entryKey: (entry: Record<string, unknown>) => string;
  pendingReports: (file: string, options?: { limit?: number; fs?: unknown }) => JournalEntry[];
  markReported: (
    file: string,
    keys: string[],
    options?: { fs?: unknown; at?: string; maxEntries?: number },
  ) => { marked: number; written: boolean };
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
      // `reportedAt` fait partie du contrat stocké : c'est la marque de la FILE
      // D'ATTENTE (null = jamais remonté), et un poste déjà installé dont le
      // journal n'a pas le champ doit rester en attente — ce que la lecture fait.
      assert.deepEqual(Object.keys(/** @type {object} */ (JSON.parse(lines[0]))).sort(), [
        'appVersion', 'at', 'code', 'currentVersion', 'detail', 'reportedAt', 'station', 'version',
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

describe('la file d’attente : ce qui reste à REMONTER', () => {
  // Le journal ne sert à rien s'il reste sur la machine. Or un poste d'école
  // démarre bloqué devant personne — l'envoi au journal d'audit est alors
  // structurellement impossible — donc les entrées doivent POUVOIR attendre, et
  // repartir au prochain démarrage connecté. Ces cas protègent les trois
  // décisions de cette file : une identité par panne, un compte qui survit à la
  // déduplication, et un marquage qui ne dit que ce qui est réellement parti.
  const panne = { code: 'download', detail: '404', version: '2.0.0', currentVersion: '1.0.2' };

  it('une panne répétée trente fois n’attend qu’UNE fois — mais le compte est gardé', () => {
    const { dir, file } = tmpFile();
    try {
      for (let i = 0; i < 30; i += 1) appendEntry(file, panne);
      const pending = pendingReports(file);
      assert.equal(pending.length, 1, 'même panne = une seule remontée');
      assert.equal(pending[0].occurrences, 30, 'le poste a buté trente fois : ça doit se dire');
      assert.equal(pending[0].code, 'download');
      assert.equal(pending[0].key, entryKey(pending[0]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une panne sur une version PLUS RÉCENTE est une information neuve', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, { ...panne, version: '2.0.0' });
      appendEntry(file, { ...panne, version: '2.1.0' });
      assert.equal(pendingReports(file).length, 2, 'la version fait partie de l’identité');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marquer ce qui est PARTI retire la panne de la file — et seulement elle', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, panne);
      appendEntry(file, { ...panne, code: 'install', detail: 'installation non aboutie' });
      const [first] = pendingReports(file);
      const result = markReported(file, [first.key as string]);
      assert.deepEqual(result, { marked: 1, written: true });
      const left = pendingReports(file);
      assert.equal(left.length, 1);
      assert.notEqual(left[0].key, first.key, 'c’est l’autre panne qui reste');
      assert.equal(left[0].code, 'download', 'la file garde ce qui n’a pas été envoyé');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le marquage tient au REDÉMARRAGE : ce qui est parti ne repart pas', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, panne);
      const [first] = pendingReports(file);
      markReported(file, [first.key as string]);
      // Relecture depuis le disque (pas un état en mémoire) : c'est le seul
      // niveau où la promesse compte, puisqu'entre-temps l'application a fermé.
      assert.deepEqual(pendingReports(file), []);
      // Et une NOUVELLE occurrence de la même panne ne repart pas non plus : la
      // clé est déjà marquée dans le journal.
      appendEntry(file, panne);
      const text = readFileSync(file, 'utf8');
      assert.match(text, /"reportedAt":"/, 'la marque est écrite dans le fichier, pas seulement en mémoire');
      assert.deepEqual(pendingReports(file), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une clé inconnue ne marque RIEN : un envoi raté doit pouvoir réessayer', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, panne);
      const result = markReported(file, ['une-autre-panne|9.9.9|0.0.1']);
      assert.deepEqual(result, { marked: 0, written: true });
      assert.equal(pendingReports(file).length, 1, 'la panne attend toujours son envoi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marquer un poste SANS journal ne crée aucun fichier — un marquage ne doit rien faire apparaître', () => {
    const { dir, file } = tmpFile();
    try {
      assert.deepEqual(markReported(file, ['a|b|c']), { marked: 0, written: false });
      assert.deepEqual(markReported(file, []), { marked: 0, written: false });
      assert.equal(existsSync(file), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une écriture impossible rend un marquage NON écrit, sans jeter — la panne reste en file', () => {
    const { dir, file } = tmpFile();
    try {
      appendEntry(file, panne);
      const [first] = pendingReports(file);
      const result = markReported(file, [first.key as string], {
        fs: {
          readFileSync: readFileSync.bind(null),
          mkdirSync: () => {
            throw new Error('disque plein');
          },
          writeFileSync: () => {
            throw new Error('disque plein');
          },
        },
      });
      assert.deepEqual(result, { marked: 0, written: false });
      assert.equal(pendingReports(file).length, 1, 'rien n’a été perdu : le poste réessaiera');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la file est bornée, et ce sont les pannes RÉCENTES qui survivent', () => {
    const { dir, file } = tmpFile();
    try {
      for (let i = 0; i < MAX_ENTRIES + 20; i += 1) {
        appendEntry(file, { code: 'download', detail: `e${i}`, version: `2.0.${i}` });
      }
      const pending = pendingReports(file, { limit: MAX_ENTRIES });
      assert.ok(pending.length <= MAX_ENTRIES, `la file déborde : ${pending.length}`);
      assert.equal(pending[0].version, `2.0.${MAX_ENTRIES + 19}`, 'la plus récente est en tête');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('les entrées écrites AVANT l’existence de la file sont bien en attente', () => {
    // Le cas réel du parc déjà installé : son journal ne connaît pas
    // `reportedAt`, donc rien n'est marqué — et c'est EXACT, ces blocages ne sont
    // jamais partis.
    const { dir, file } = tmpFile();
    try {
      writeFileSync(file, JSON.stringify({ at: '2026-09-01T00:00:00.000Z', code: 'download', detail: 'ancien', version: '1.0.1', currentVersion: '1.0.0' }) + '\n');
      const pending = pendingReports(file);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].reportedAt, null);
      assert.equal(pending[0].occurrences, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
