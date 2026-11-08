/**
 * Le journal de pannes du PROCESSUS PRINCIPAL — la moitié que la page ne peut pas
 * écrire.
 *
 * `src/lib/incidentJournal.ts` couvre les exceptions du rendu ; il ne peut rien
 * dire d'un processus principal qui meurt, ni d'un rendu qui disparaît (écran
 * blanc, fenêtre toujours ouverte). Ces pannes-là n'existaient nulle part, et
 * c'est exactement ce qu'un guichet raconte le lendemain : « ça a planté ».
 *
 * Ce qui est prouvé ici : le fichier reste LISIBLE (une ligne abîmée n'emporte
 * pas les autres), BORNÉ (un poste qui tourne des années ne remplit pas son
 * disque), EXPURGÉ (aucun élève, aucun montant, aucun jeton d'URL), et la
 * capture ne remplace pas le comportement d'Electron — elle l'observe.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_ENTRIES,
  appendIncident,
  incidentsPath,
  installProcessCapture,
  readIncidents,
  redact,
} from '../electron/incident-journal.cjs';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'mama-incidents-'));
}

describe('redact — un diagnostic, pas un registre', () => {
  it('masque les courriels, les requêtes d’URL et les suites de chiffres', () => {
    const text = redact(
      'échec pour awa.diallo@example.com — paiement 45000 sur https://exemple.test/rpc?token=abc123',
    );
    assert.doesNotMatch(text, /@example\.com/, 'un courriel ne doit pas survivre');
    assert.doesNotMatch(text, /45000/, 'un montant est une donnée d’école');
    assert.doesNotMatch(text, /token=abc123/, 'une requête d’URL peut porter un jeton');
    assert.match(text, /\[courriel\]/);
  });

  it('borne le message : une pile entière n’est pas un rapport à coller', () => {
    const long = 'x'.repeat(1000);
    const text = redact(long, 60);
    assert.equal(text.length, 60);
    assert.match(text, /…$/);
  });
});

describe('appendIncident / readIncidents — le journal du poste', () => {
  it('inscrit une panne et la relit, la plus récente d’abord', () => {
    const userDataDir = freshDir();
    assert.equal(appendIncident({ userDataDir, kind: 'uncaught', message: 'TypeError: x' }), true);
    assert.equal(appendIncident({ userDataDir, kind: 'renderer-gone', message: 'crashed' }), true);
    const entries = readIncidents({ userDataDir });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, 'renderer-gone', 'la plus récente passe devant');
    assert.equal(entries[0].code, null, 'une panne sans code n’invente pas un zéro');
    assert.equal(entries[1].message, 'TypeError: x');
  });

  it('ne dépasse jamais MAX_ENTRIES : le poste tourne des années', () => {
    const userDataDir = freshDir();
    for (let i = 0; i < MAX_ENTRIES + 12; i += 1) {
      appendIncident({ userDataDir, kind: 'uncaught', message: `panne ${i}` });
    }
    const entries = readIncidents({ userDataDir, limit: MAX_ENTRIES + 50 });
    assert.equal(entries.length, MAX_ENTRIES);
    // Ce sont les PLUS RÉCENTES qui survivent : la plus ancienne des douze
    // premières a bien été oubliée, la dernière écrite est là.
    assert.equal(entries[0].message, `panne ${MAX_ENTRIES + 11}`);
    assert.equal(entries[entries.length - 1].message, `panne ${12}`);
    const lines = readFileSync(incidentsPath({ userDataDir }), 'utf8').trim().split('\n');
    assert.equal(lines.length, MAX_ENTRIES, 'le FICHIER est borné, pas seulement la lecture');
  });

  it('une ligne abîmée n’emporte pas les autres', () => {
    const userDataDir = freshDir();
    appendIncident({ userDataDir, kind: 'uncaught', message: 'première' });
    writeFileSync(
      incidentsPath({ userDataDir }),
      `${readFileSync(incidentsPath({ userDataDir }), 'utf8')}{"at":"2026-11-08T00:00:00.000Z","kind":\n`,
      'utf8',
    );
    const entries = readIncidents({ userDataDir });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, 'première');
  });

  it('un dossier absent rend une liste vide, jamais une erreur', () => {
    assert.deepEqual(readIncidents({ userDataDir: join(freshDir(), 'jamais-cree') }), []);
  });

  it('un disque qui refuse l’écriture ne fait pas tomber l’appelant', () => {
    const userDataDir = freshDir();
    const failingFs = {
      mkdirSync: () => {
        throw new Error('EACCES');
      },
      appendFileSync: () => {
        throw new Error('EACCES');
      },
      readFileSync,
      writeFileSync,
    };
    assert.equal(
      appendIncident({ userDataDir, kind: 'uncaught', message: 'x', fs: failingFs as never }),
      false,
    );
  });
});

describe('installProcessCapture — observer, jamais avaler', () => {
  it('inscrit une exception non attrapée et un rejet sans gestionnaire', () => {
    const dir = freshDir();
    const written: Array<{ kind: string; message: unknown }> = [];
    const off = installProcessCapture({
      userDataDir: dir,
      proc: new EventEmitter() as unknown as NodeJS.Process,
      app: new EventEmitter(),
      write: (input) => {
        written.push(input);
        return true;
      },
    });
    const proc = new EventEmitter();
    // (le premier montage ne sert qu'à vérifier le débranchement plus bas)
    off();

    const recording = installProcessCapture({
      userDataDir: dir,
      proc: proc as unknown as NodeJS.Process,
      app: new EventEmitter(),
      write: (input) => {
        written.push(input);
        return true;
      },
    });
    proc.emit('uncaughtException', new TypeError('boum'));
    proc.emit('unhandledRejection', 'promesse sans catch');
    assert.deepEqual(
      written.map((w) => w.kind),
      ['uncaught', 'rejection'],
    );
    assert.match(String(written[0].message), /TypeError: boum/);
    recording();
  });

  it('inscrit un rendu qui disparaît et un processus enfant mort', () => {
    const written: Array<{ kind: string; message: unknown; code?: number | null }> = [];
    const app = new EventEmitter();
    const off = installProcessCapture({
      userDataDir: freshDir(),
      proc: new EventEmitter() as unknown as NodeJS.Process,
      app,
      write: (input) => {
        written.push(input);
        return true;
      },
    });
    app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 133 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
    assert.equal(written[0].kind, 'renderer-gone');
    assert.match(String(written[0].message), /crashed/);
    assert.equal(written[0].code, 133, 'le code de sortie aide à réparer');
    assert.equal(written[1].kind, 'child-gone');
    off();
  });

  it('un code de sortie NÉGATIF à neuf chiffres survit tel quel', () => {
    // Trouvé par l'exercice réel du 2026-11-08 : `Page.crash` sur l'app
    // empaquetée rendait `code -#`, parce que la règle qui masque les suites de
    // chiffres (identifiants, montants) avalait aussi le code de sortie. Sur un
    // poste qui plante, c'est justement le seul chiffre qui distingue un déficit
    // mémoire d'une violation CSP.
    const userDataDir = freshDir();
    assert.equal(
      appendIncident({ userDataDir, kind: 'renderer-gone', message: 'le rendu s’est arrêté : crashed', code: -1073741819 }),
      true,
    );
    const [entry] = readIncidents({ userDataDir });
    assert.equal(entry.code, -1073741819);
    assert.doesNotMatch(entry.message, /#/, 'le code ne doit pas être recopié dans le texte expurgé');
  });

  it('le débranchement retire les écouteurs : pas de capture fantôme', () => {
    const written: unknown[] = [];
    const proc = new EventEmitter();
    const off = installProcessCapture({
      userDataDir: freshDir(),
      proc: proc as unknown as NodeJS.Process,
      app: new EventEmitter(),
      write: (input) => {
        written.push(input);
        return true;
      },
    });
    off();
    proc.emit('uncaughtException', new Error('après débranchement'));
    assert.equal(written.length, 0);
  });
});

describe('le pont desktop expose la lecture seule', () => {
  it('preload déclare incidents.list, jamais d’écriture', () => {
    const source = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');
    assert.match(source, /incidents:\s*\{/, 'le canal doit exister pour l’écran');
    assert.match(source, /list:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('incidents:list'\)/);
    assert.doesNotMatch(source, /incidents:[\s\S]{0,400}?ipcRenderer\.send/, 'aucun envoi vers le main');
  });

  it('main enregistre le canal en lecture seule', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main.cjs'), 'utf8');
    assert.match(source, /ipcMain\.handle\('incidents:list'/);
    assert.match(source, /installProcessCapture\(\{ userDataDir: app\.getPath\('userData'\), app \}\)/);
  });
});
