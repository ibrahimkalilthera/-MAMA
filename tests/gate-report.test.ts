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

import {
  blockId,
  blockedAuditEntry,
  flushJournalReports,
  journalAuditEntry,
  reportBlockedStation,
} from '../src/lib/desktopUpdateReport';
import type { BlockedReport, FlushOutcome, JournalQueueApi, QueuedReport } from '../src/lib/desktopUpdateReport';
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
    assert.match(shell, /import \{ flushJournalReports, reportBlockedStation \} from '\.\.\/lib\/desktopUpdateReport'/);
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

describe('la file d’attente : un poste bloqué sans session remonte au démarrage connecté', () => {
  // Le signalement en direct exige une session. Or le cas normal d'un poste
  // d'école est de démarrer bloqué DEVANT PERSONNE : à cet instant, le journal
  // local est le seul canal, et un blocage qui ne saurait pas attendre serait
  // perdu — c'est-à-dire exactement le silence que ce mécanisme répare. Ces cas
  // protègent les trois règles de la remontée : on envoie ce qui attend, on ne
  // marque que ce qui est PARTI, et rien ne fuit quand il n'y a rien à faire.
  const RAPPORT: QueuedReport = {
    key: 'download|2.0.0|1.0.2',
    code: 'download',
    detail: 'Cannot download …setup.exe, status 404',
    version: '2.0.0',
    currentVersion: '1.0.2',
    at: '2026-09-12T21:00:00.000Z',
    occurrences: 3,
  };

  const bridge = (entries: QueuedReport[], over: Partial<JournalQueueApi> = {}): JournalQueueApi => ({
    pendingReports: async () => ({ station: 'POSTE-ECOLE-1', entries }),
    markReported: async (keys) => ({ marked: keys.length, written: true }),
    ...over,
  });

  it('les blocages en attente PARTENT, et sont marqués — une seule fois, en une requête', async () => {
    const marked: string[][] = [];
    const sent: BlockedReport[] = [];
    const outcome = await flushJournalReports({
      api: bridge([RAPPORT, { ...RAPPORT, key: 'install|2.0.0|1.0.2', code: 'install' }], {
        markReported: async (keys) => {
          marked.push(keys);
          return { marked: keys.length, written: true };
        },
      }),
      log: (entry) => {
        sent.push(entry);
        return true;
      },
    });
    assert.equal(outcome.queued, 2);
    assert.equal(outcome.sent, 2);
    assert.equal(outcome.failed, 0);
    assert.equal(outcome.marked, 2);
    assert.deepEqual(outcome.stillQueued, []);
    assert.deepEqual(marked, [['download|2.0.0|1.0.2', 'install|2.0.0|1.0.2']]);
    assert.match(sent[0].details, /poste POSTE-ECOLE-1/);
  });

  it('un envoi RATÉ reste en file : on ne marque que ce qui est vraiment parti', async () => {
    const marked: string[][] = [];
    const outcome = await flushJournalReports({
      api: bridge([RAPPORT, { ...RAPPORT, key: 'install|2.0.0|1.0.2', code: 'install' }], {
        markReported: async (keys) => {
          marked.push(keys);
          return { marked: keys.length, written: true };
        },
      }),
      // Le second envoi échoue (réseau, RLS, session expirée…).
      log: (entry) => !entry.action.includes('(install)'),
    });
    assert.equal(outcome.sent, 1);
    assert.equal(outcome.failed, 1);
    assert.deepEqual(outcome.stillQueued, ['install|2.0.0|1.0.2'], 'ce qui a échoué reste à remonter');
    assert.deepEqual(marked, [['download|2.0.0|1.0.2']], 'on ne marque PAS l’envoi raté');
  });

  it('un envoi qui JETTE est un échec, jamais un silence', async () => {
    const outcome = await flushJournalReports({
      api: bridge([RAPPORT]),
      log: () => {
        throw new Error('session expirée');
      },
    });
    assert.equal(outcome.sent, 0);
    assert.equal(outcome.failed, 1);
    assert.deepEqual(outcome.stillQueued, ['download|2.0.0|1.0.2']);
  });

  it('un marquage qui échoue ne retire rien de ce qui est RÉELLEMENT parti du journal d’audit', async () => {
    const outcome = await flushJournalReports({
      api: bridge([RAPPORT], {
        markReported: async () => {
          throw new Error('journal protégé');
        },
      }),
      log: () => true,
    });
    assert.equal(outcome.sent, 1, 'l’audit a reçu le rapport');
    assert.equal(outcome.marked, 0, 'mais le poste ne l’a pas marqué');
  });

  it('file vide, pont absent ou pont muet : RIEN n’est envoyé, rien n’est écrit', async () => {
    const impossible = () => {
      throw new Error('aucun envoi ne doit partir');
    };
    const vide = await flushJournalReports({ api: bridge([]), log: impossible });
    assert.deepEqual(vide, { queued: 0, sent: 0, failed: 0, marked: 0, stillQueued: [] } as FlushOutcome);
    // Hors application de bureau : aucune surface de mise à jour du tout.
    assert.deepEqual(await flushJournalReports({}), {
      queued: 0,
      sent: 0,
      failed: 0,
      marked: 0,
      stillQueued: [],
    });
    // Un pont qui ne répond pas (processus principal occupé, fenêtre fermée).
    assert.deepEqual(
      await flushJournalReports({
        api: {
          pendingReports: async () => {
            throw new Error('pont muet');
          },
          markReported: async () => null,
        },
      }),
      { queued: 0, sent: 0, failed: 0, marked: 0, stillQueued: [] },
    );
  });

  it('une entrée sans identité n’est PAS envoyée : elle ne pourrait pas être marquée', async () => {
    const outcome = await flushJournalReports({
      api: bridge([{ code: 'download', detail: 'sans clé' }] as QueuedReport[]),
      log: () => {
        throw new Error('aucun envoi ne doit partir');
      },
    });
    assert.equal(outcome.sent, 0);
    assert.equal(outcome.failed, 1);
  });

  it('le rapport dit QUAND et COMBIEN de fois — ce que la déduplication pourrait perdre', () => {
    const entry = journalAuditEntry(RAPPORT);
    assert.ok(entry);
    assert.match(entry.action, /remonté depuis le journal du poste/, 'une remontée tardive se distingue d’un signalement en direct');
    assert.equal(entry.targetId, '2.0.0');
    assert.equal(entry.targetType, 'update');
    assert.match(entry.details, /constaté le 2026-09-12T21:00:00\.000Z/);
    assert.match(entry.details, /bloqué 3 fois/, '« bloqué 40 fois » ne doit pas se lire « bloqué une fois »');
    assert.match(entry.details, /Cannot download/, 'le motif est recopié, jamais résumé');
  });

  it('une entrée sans code ne produit aucun rapport, et le motif manquant est DIT', () => {
    assert.equal(journalAuditEntry(null), null);
    assert.equal(journalAuditEntry({} as QueuedReport), null);
    const sansMotif = journalAuditEntry({ code: 'download', version: '2.0.0' });
    assert.ok(sansMotif);
    assert.match(sansMotif.details, /motif : non précisé/);
    assert.doesNotMatch(sansMotif.details, /bloqué \d+ fois/, 'une seule occurrence ne se compte pas');
  });

  it('le pont expose la file, borné, sans surface générique', () => {
    const preload = read('electron/preload.cjs');
    assert.match(preload, /pendingReports: \(\) => ipcRenderer\.invoke\('updates:pending-reports'\)/);
    assert.match(preload, /markReported: \(keys\) =>\s*\n?\s*ipcRenderer\.invoke\('updates:mark-reported'/);
    assert.match(preload, /slice\(0, 20\)\.map\(String\)/, 'le nombre de clés est borné avant de traverser le pont');
    assert.doesNotMatch(preload, /invoke\([^)]*process\.argv/, 'aucun canal générique');
  });

  it('le processus principal tient la file, et borne lui aussi ce qui vient de l’interface', () => {
    const main = read('electron/main.cjs');
    assert.match(main, /pendingReports, markReported \} = require\('\.\/update-journal\.cjs'\)/);
    assert.match(main, /ipcMain\.handle\('updates:pending-reports'/);
    assert.match(main, /entries: pendingReports\(journalFile, \{ limit: 20 \}\)/);
    assert.match(main, /\.\.\.markReported\(journalFile, Array\.isArray\(keys\) \? keys\.map\(String\)\.slice\(0, 20\) : \[\]\)/);
  });

  it('la remontée part d’AppShell, qui seul connaît la session — une fois par utilisateur', () => {
    const shell = read('src/components/AppShell.tsx');
    assert.match(shell, /import \{ flushJournalReports, reportBlockedStation \} from '\.\.\/lib\/desktopUpdateReport'/);
    assert.match(shell, /void flushJournalReports\(\{ api \}\)\.catch\(\(\) => \{\}\)/, 'un échec de remontée ne doit pas casser l’application');
    assert.match(shell, /flushedQueueFor\.current === username/, 'un passage par session, pas à chaque rendu');
    assert.match(shell, /if \(!username \|\| flushedQueueFor\.current === username\) return/);
  });
});
