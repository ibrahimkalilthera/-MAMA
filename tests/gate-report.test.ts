// Suite for the « bloqué par la porte » chain: when a station is stuck behind
// the forced-update gate, who decides that, what is said to the administrator,
// and is the wiring really in place.
//
// WHY THIS EXISTS
// ---------------
// La porte du retard est née pour empêcher un poste de rester des mois en
// arrière ; elle ne l'aidait pas à se faire connaître. L'échec d'un poste
// OBLIGÉ partait dans la console du processus principal — donc nulle part — et
// l'administrateur n'apprenait un poste bloqué qu'en se déplaçant jusqu'à lui.
//
// Ce que ces cas protègent :
//   • la décision « ce poste est bloqué » appartient à la POLITIQUE (pure, ici
//     testée), pas au processus principal — sinon elle serait recopiée, et deux
//     copies d'une règle divergent toujours ;
//   • trois causes, et elles ne se valent pas : une installation tentée qui
//     n'aboutit pas (bloqué MÊME hors obligation : c'est un fait), un portable
//     qui ne peut structurellement pas satisfaire la porte, un téléchargement
//     en échec sur un poste obligé. Le bruit de la progression normale, lui, ne
//     doit PAS être signalé — sinon le vrai cas se noie ;
//   • ce qui part au journal d'audit est COMPOSÉ et testable, et il nomme le
//     poste : c'est la première question de l'administrateur ;
//   • et le câblage est vérifié dans les fichiers, parce qu'une décision juste
//     que personne n'appelle ne signale rien.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { blockId, blockedAuditEntry, reportBlockedStation } from '../src/lib/desktopUpdateReport';
import { en as adminEn } from '../src/i18n/domains/adminEn';
import { fr as adminFr } from '../src/i18n/domains/adminFr';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { gateFailure } = require('../electron/updater-policy.cjs') as {
  gateFailure: (input: Record<string, unknown>) => { blocked: boolean; code: string; detail: string };
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('quand un poste est-il bloqué par la porte', () => {
  it('une installation tentée et revenue sur la même version est un blocage, même hors obligation', () => {
    const verdict = gateFailure({ installPending: true });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, 'install');
    assert.match(verdict.detail, /non aboutie/);
  });

  it('un portable obligé est bloqué PAR CONSTRUCTION : il ne peut pas satisfaire la porte seul', () => {
    const verdict = gateFailure({ forced: true, isPortable: true, status: 'available' });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, 'manual');
    assert.match(verdict.detail, /NSIS/);
  });

  it('obligé et téléchargement en échec : bloqué, avec le motif réel', () => {
    const verdict = gateFailure({ forced: true, status: 'error', detail: 'net::ERR_INTERNET_DISCONNECTED' });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, 'download');
    assert.equal(verdict.detail, 'net::ERR_INTERNET_DISCONNECTED');
  });

  it('obligé mais en progrès, ou prêt : PAS bloqué — signaler noierait le vrai cas', () => {
    for (const status of ['checking', 'available', 'downloading', 'downloaded', 'current']) {
      assert.equal(gateFailure({ forced: true, status }).blocked, false, `status ${status} n’est pas un blocage`);
    }
  });

  it('une mise à jour FACULTATIVE en échec n’est pas un blocage — le poste peut continuer', () => {
    const verdict = gateFailure({ forced: false, status: 'error', detail: 'x' });
    assert.equal(verdict.blocked, false);
    assert.equal(verdict.code, 'none');
  });

  it('un échec de téléchargement sans détail le dit, au lieu d’afficher du vide', () => {
    assert.match(gateFailure({ forced: true, status: 'error' }).detail, /aucun détail/);
  });
});

describe('ce qui part au journal d’audit', () => {
  const state = {
    blocked: { code: 'download', detail: 'HTTP 404', station: 'PC-DIRECTION', journal: 'C:/data/update-journal.jsonl', recorded: true },
    version: '2.0.0',
    currentVersion: '1.0.0',
  };

  it('nomme le poste, la version et le motif — sans résumer le motif', () => {
    const entry = blockedAuditEntry(state);
    assert.ok(entry);
    assert.equal(entry.action, 'poste bloqué — mise à jour obligatoire (download)');
    assert.equal(entry.targetType, 'update');
    assert.equal(entry.targetId, '2.0.0');
    assert.match(entry.details, /poste PC-DIRECTION/);
    assert.match(entry.details, /version 1\.0\.0 → 2\.0\.0/);
    assert.match(entry.details, /motif : HTTP 404/);
    assert.match(entry.details, /journal local : C:\/data\/update-journal\.jsonl/);
  });

  it('un journal local NON écrit est dit : sinon on chercherait un fichier inexistant', () => {
    const entry = blockedAuditEntry({ ...state, blocked: { ...state.blocked, recorded: false } });
    assert.match(entry?.details ?? '', /journal local non écrit/);
  });

  it('un poste non bloqué ne produit AUCUN rapport', () => {
    assert.equal(blockedAuditEntry({ blocked: null }), null);
    assert.equal(blockedAuditEntry(null), null);
    assert.equal(blockedAuditEntry(undefined), null);
  });

  it('le nom du poste vient du processus principal quand l’entrée ne le porte pas', () => {
    const entry = blockedAuditEntry(
      { blocked: { code: 'manual', detail: 'portable' }, version: '2.0.0', currentVersion: '1.0.0' },
      { station: 'PC-BIBLIOTHEQUE' },
    );
    assert.match(entry?.details ?? '', /poste PC-BIBLIOTHEQUE/);
  });

  it('un blocage a une IDENTITÉ : même code et même version = même blocage', () => {
    assert.equal(blockId(state), 'download|2.0.0');
    assert.equal(blockId(state), blockId({ ...state }), 'deux lectures du même état ne sont pas deux blocages');
    assert.equal(blockId({ ...state, version: '2.0.1' }), 'download|2.0.1', 'une version plus récente est une information neuve');
    assert.equal(blockId({ ...state, blocked: { ...state.blocked, code: 'install' } }), 'install|2.0.0');
    assert.equal(blockId({ blocked: null }), null);
  });

  it('un poste non bloqué n’envoie rien, et ne charge même pas le client Supabase', async () => {
    const outcome = await reportBlockedStation({ blocked: null });
    assert.deepEqual(outcome, { sent: false, detail: '' });
  });
});

describe('le câblage du signalement', () => {
  it('le processus principal tient le journal, décide via la politique, et expose ses deux canaux', () => {
    const main = read('electron/main.cjs');
    assert.match(main, /require\('\.\/update-journal\.cjs'\)/, 'le journal local doit être branché');
    assert.match(main, /gateFailure/, 'le blocage est décidé par la politique, jamais recopié ici');
    assert.match(main, /appendEntry\(journalFile/, 'un blocage s’inscrit dans le journal');
    assert.match(main, /ipcMain\.handle\('updates:journal'/, 'l’interface doit pouvoir lire le journal');
    assert.match(main, /ipcMain\.handle\('updates:open-journal'/, 'un humain devant le poste doit pouvoir l’ouvrir');
    // Les deux chemins qui bloquent réellement un poste obligé.
    assert.match(main, /reportBlocked\(\{ forced: pressure\.forced, status: 'error', detail \}\)/, 'un échec de téléchargement sur un poste obligé doit partir au journal');
    assert.match(main, /reportBlocked\(\{ forced: gate\.forced, version: i\.version \}\)/, 'un portable obligé ne pourra jamais satisfaire la porte : ça se signale');
    assert.match(main, /reportBlocked\(\{ installPending: true/, 'une installation non aboutie se signale dès le démarrage');
  });

  it('le pont expose le journal sans ouvrir de surface générique', () => {
    const preload = read('electron/preload.cjs');
    assert.match(preload, /journal: \(\) => ipcRenderer\.invoke\('updates:journal'\)/);
    assert.match(preload, /openJournal: \(\) => ipcRenderer\.invoke\('updates:open-journal'\)/);
    assert.doesNotMatch(preload, /invoke\([^)]*process\.argv/, 'aucun canal générique');
  });

  it('le bandeau signale depuis AppShell, qui seul connaît la session', () => {
    const shell = read('src/components/AppShell.tsx');
    assert.match(shell, /import \{ reportBlockedStation \} from '\.\.\/lib\/desktopUpdateReport'/);
    assert.match(shell, /onReport=\{\(state\) => reportBlockedStation\(state\)\}/);
  });

  it('le bandeau affiche l’état du signalement au lieu de le supposer', () => {
    const banner = read('src/components/UpdateBanner.tsx');
    assert.match(banner, /data-update-report=\{reported \? \(reported\.sent \? 'sent' : 'local'\) : 'pending'\}/);
    assert.match(banner, /reportedFor\.current === blockKey/, 'un seul envoi par blocage — sinon le journal d’audit devient illisible');
    assert.match(banner, /labels\.blockedReportLocal\.replace\('\{path\}'/, 'un échec d’envoi doit dire où le blocage a été inscrit');
  });

  it('les libellés du signalement existent dans les DEUX langues', () => {
    const keys = [
      'updateBlockedTitle',
      'updateBlockedDetail',
      'updateBlockedReportPending',
      'updateBlockedReportSent',
      'updateBlockedReportLocal',
      'updateBlockedJournal',
    ] as const;
    for (const key of keys) {
      assert.equal(typeof adminEn[key], 'string', `${key} manque en anglais`);
      assert.equal(typeof adminFr[key], 'string', `${key} manque en français`);
      assert.ok(adminEn[key].length > 0 && adminFr[key].length > 0, `${key} ne peut pas être vide`);
    }
    // Les gabarits doivent porter le marqueur que l'interface remplace, sinon le
    // texte s'afficherait avec « {path} » en clair devant un utilisateur bloqué.
    assert.match(adminFr.updateBlockedDetail, /\{detail\}/);
    assert.match(adminEn.updateBlockedDetail, /\{detail\}/);
    assert.match(adminFr.updateBlockedReportLocal, /\{path\}/);
    assert.match(adminEn.updateBlockedReportLocal, /\{path\}/);
  });
});
