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
//     n'aboutit pas (bloqué MÊME hors obligation : c'est un fait), des octets
//     qui ne répondent pas à ce que le flux annonce (le remède est sur le canal),
//     un téléchargement en échec sur un poste obligé. Le bruit de la progression
//     normale, lui, ne doit PAS être signalé — sinon le vrai cas se noie ;
//   • et un poste PORTABLE n'est plus un cas bloqué : mesuré le 2026-10-16 sur un
//     poste en 1.0.30, l'ancienne règle l'enfermait dans une porte qu'il ne
//     pouvait pas satisfaire (main humaine obligatoire). Il installe maintenant
//     lui-même l'installeur annoncé (`updateAction`), donc « il ne peut pas
//     avancer seul » n'est plus vrai — et s'il n'y arrive pas, la sentinelle
//     d'installation le dira APRES une tentative, pas à sa place ;
//   • ce qui part au journal d'audit est COMPOSÉ et testable, et il nomme le
//     poste : c'est la première question de l'administrateur ;
//   • le nom de l'ÉCOLE l'accompagne, juste après celui du poste. Il vient du
//     rendu (une session lit `app_settings`), jamais du journal local — le
//     processus principal n'a pas de session —, et son absence est SILENCIEUSE :
//     « école inconnue » se lirait comme un nom d'école parmi d'autres.
//   • et le câblage est vérifié dans les fichiers, parce qu'une décision juste
//     que personne n'appelle ne signale rien.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  CONVERSION_CODE,
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
// Le poste ÉCRIT le fait de la conversion (`station-beat.cjs`) ; ce module le LIT.
const { CONVERSION_CODE: STATION_CONVERSION_CODE } = require('../electron/station-beat.cjs') as {
  CONVERSION_CODE: string;
};
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('quand un poste est-il bloqué par la porte', () => {
  it('une installation tentée et revenue sur la même version est un blocage, même hors obligation', () => {
    const verdict = gateFailure({ installPending: true });
    assert.equal(verdict.blocked, true);
    assert.equal(verdict.code, 'install');
    assert.match(verdict.detail, /non aboutie/);
  });

  it('un poste obligé qui peut encore avancer seul n’est PAS bloqué — portable compris', () => {
    // La décision a changé le 2026-10-16, et c'est une mesure qui l'a changée : un
    // poste portable en 1.0.30 savait tout et ne pouvait rien appliquer, parce
    // qu'on l'envoyait sur la page des versions avec une porte fermée. Ce qu'un
    // poste portable peut faire vit désormais dans `updateAction` (il installe
    // l'installeur annoncé), donc il ne relève plus des causes de blocage : une
    // porte fermée n'est plus une impasse, juste une étape obligée.
    const verdict = gateFailure({ forced: true, status: 'available' });
    assert.equal(verdict.blocked, false);
    assert.equal(verdict.code, 'none');
    assert.match(verdict.detail, /avancer seul/);
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
      { blocked: { code: 'install', detail: 'installation non aboutie' }, version: '2.0.0', currentVersion: '1.0.0' },
      { station: 'PC-BIBLIOTHEQUE' },
    );
    assert.match(entry?.details ?? '', /poste PC-BIBLIOTHEQUE/);
  });

  it('le nom de l’école suit celui du poste, et son ABSENCE est silencieuse', () => {
    // « De quelle école me parle ce poste ? » est la question que le relevé de
    // parc ne peut PAS trancher : son identité de poste est aléatoire et rangée
    // sur la machine (voir §7 du canal). Le nom de l'école est donc composé par
    // le poste, et placé JUSTE APRÈS le sien, avant `version` et `motif` :
    // `src/lib/blockedIncidents.ts` cherche ces marqueurs par leur préfixe et
    // borne le motif à leur rencontre, donc un champ ajouté au milieu ne décale
    // rien — collé après le motif, il se lirait comme la suite du message
    // d'erreur, et le regroupement des pannes changerait de clé.
    const entry = blockedAuditEntry(state, { school: 'Complexe Scolaire Mama Thera' });
    assert.match(
      entry?.details ?? '',
      /^poste PC-DIRECTION · école Complexe Scolaire Mama Thera · version 1\.0\.0 → 2\.0\.0/,
    );

    // Rien de LU (aucune école déclarée, lecture ratée, réseau coupé) : aucun
    // champ du tout. Un « école inconnue » de remplissage ferait chercher une
    // école qui n'existe pas, et un nom illisible (trop court, portant le
    // séparateur des rapports) est traité comme une absence — c'est la règle de
    // `schoolField`, et elle vaut ici comme partout dans le canal.
    for (const rien of [null, undefined, '', 'A', 'École · fausse']) {
      const sans = blockedAuditEntry(state, { school: rien });
      assert.doesNotMatch(sans?.details ?? '', /école/, `« ${String(rien)} » ne doit produire aucun champ école`);
    }
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
    // Les chemins qui bloquent réellement un poste obligé.
    //
    // L'échec de téléchargement part au journal APRÈS avoir été classé : « le
    // réseau a lâché » et « le canal sert autre chose que ce qu'il annonce » ont
    // des remèdes opposés, et les confondre enverrait un parc chercher une panne
    // d'école inexistante. La classe est donc lue dans le MÊME appel.
    assert.match(main, /reportBlocked\(\{[\s\S]{0,200}status: 'error',[\s\S]{0,120}checksumFault: fault\.fault \? fault\.detail : null/, 'un échec de téléchargement sur un poste obligé doit partir au journal, avec sa cause');
    assert.match(main, /checksumFault: fault\.fault \? fault\.detail : null/, 'la cause classée accompagne le blocage');
    assert.match(
      main,
      /reportBlocked\(\{ forced: gate\.forced, version: i\.version \}\)/,
      'un poste obligé se signale dès l’annonce : ce qui reste à signaler, ce sont les causes où il ne peut PAS avancer',
    );
    assert.match(
      main,
      /if \(action\.action === 'install'\) return installPortable\(origin\)/,
      'un poste portable doit INSTALLER l’installeur annoncé, pas partir sur la page des versions',
    );
    assert.doesNotMatch(
      main,
      /isPortable\) \{\s*shell\.openExternal\(RELEASES_URL\)/,
      'aucun chemin ne doit plus renvoyer un portable vers le navigateur POUR une mise à jour qu’il peut appliquer',
    );
    assert.match(main, /reportBlocked\(\{ installPending: true/, 'une installation non aboutie se signale dès le démarrage');
    // La conversion : la forme d'AVANT est lue avant que le battement ne remplace
    // le relevé — c'est le seul instant où elle existe encore —, et le fait part
    // au journal du poste, donc au journal d'audit avec son NOM.
    assert.match(main, /const previous = readStation\(stationBeatFile\)/, 'la forme d’avant se lit avant l’écriture, sinon elle n’existe plus');
    assert.match(
      main,
      /const conversion = conversionFact\(previous, written\)/,
      'la conversion se constate sur les deux relevés, pas sur une déduction',
    );
    assert.match(
      main,
      /if \(conversion\) \{[\s\S]{0,200}appendEntry\(journalFile, \{[\s\S]{0,80}\.\.\.conversion,[\s\S]{0,40}station,/,
      'une conversion s’inscrit au journal du poste, avec le nom de la machine',
    );
  });

  it('le code de la conversion est LE MÊME des deux côtés du canal', () => {
    // Le poste l'écrit (`electron/station-beat.cjs`), le rendu le lit (ici) : deux
    // modules, un seul fait. Un désaccord ferait lire une conversion comme une
    // panne — ou l'inverse, et c'est le mauvais sens de l'erreur dans les deux cas.
    assert.equal(CONVERSION_CODE, STATION_CONVERSION_CODE);
    assert.equal(CONVERSION_CODE, 'converted');
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
    assert.match(
      shell,
      /onReport=\{\(state\) => reportBlockedStation\(state, \{ school: schoolName \}\)\}/,
      'le signalement en direct porte aussi l’école lue par la session',
    );
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

  it('l’école accompagne chaque remontée tardive — un blocage COMME une conversion', async () => {
    const sent: BlockedReport[] = [];
    const conversion: QueuedReport = {
      key: 'converted|1.0.39|1.0.38',
      code: CONVERSION_CODE,
      version: '1.0.39',
      currentVersion: '1.0.38',
    };
    const outcome = await flushJournalReports({
      api: bridge([RAPPORT, conversion]),
      log: (entry) => {
        sent.push(entry);
        return true;
      },
      school: 'Complexe Scolaire Mama Thera',
    });
    assert.equal(outcome.sent, 2);
    assert.equal(sent.length, 2, 'les deux formes de fait passent par la même file');
    for (const entry of sent) {
      assert.match(
        entry.details,
        /poste POSTE-ECOLE-1 · école Complexe Scolaire Mama Thera/,
        'chaque remontée dit de quelle école parle ce poste, juste après son nom',
      );
    }

    // Aucun nom lu (école jamais déclarée, ou lecture ratée) : le champ
    // disparaît des DEUX formes, sans phrase de remplacement.
    const sansEcole: BlockedReport[] = [];
    await flushJournalReports({
      api: bridge([RAPPORT, conversion]),
      log: (entry) => {
        sansEcole.push(entry);
        return true;
      },
    });
    for (const entry of sansEcole) assert.doesNotMatch(entry.details, /école/);
  });

  it('une CONVERSION remonte par la même file — nommée par le poste, et pas comme un blocage', async () => {
    // « Quelle école s'est convertie ? » est la question que la première
    // conversion pose. Le relevé de parc ne peut pas y répondre (identité
    // aléatoire, aucun nom) ; le poste, lui, sait comment on l'appelle — et c'est
    // par cette file, la même que celle des pannes, que le nom remonte.
    const sent: BlockedReport[] = [];
    const conversion: QueuedReport = {
      key: 'converted|1.0.39|1.0.38',
      code: CONVERSION_CODE,
      detail: "l'installateur annoncé a été exécuté en silencieux",
      version: '1.0.39',
      currentVersion: '1.0.38',
      at: '2026-10-16T09:12:00.000Z',
    };
    const outcome = await flushJournalReports({
      api: bridge([conversion]),
      log: (entry) => {
        sent.push(entry);
        return true;
      },
    });
    assert.equal(outcome.sent, 1);
    assert.equal(outcome.marked, 1, 'une conversion remontée se marque comme un blocage remonté');
    const [entry] = sent;
    assert.match(entry.action, /converti en poste installé/);
    assert.doesNotMatch(entry.action, /bloqué/, 'une bonne nouvelle ne se dit pas « poste bloqué » : on chercherait une porte fermée qui n’existe pas');
    assert.match(entry.details, /poste POSTE-ECOLE-1/, 'le nom du poste est la seule réponse que la machine puisse donner');
    assert.match(entry.details, /conversion portable → installé/);
    assert.match(entry.details, /version 1\.0\.38 → 1\.0\.39/);
    assert.match(entry.details, /constat : /);
    assert.match(entry.details, /constaté le 2026-10-16T09:12:00\.000Z/, 'une remontée tardive dit QUAND le poste a basculé');
    assert.equal(entry.targetType, 'update');
    assert.equal(entry.targetId, '1.0.39', 'la version du PASSAGE, celle que le poste exécute maintenant');
    assert.equal(outcome.stillQueued.length, 0);
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
    assert.match(
      shell,
      /void flushJournalReports\(\{ api, school: schoolName \}\)\.catch\(\(\) => \{\}\)/,
      'un échec de remontée ne doit pas casser l’application, et l’école voyage avec la file',
    );
    // La file attend que la LECTURE du nom ait rendu son verdict : une remontée
    // partie sans l'école ne se rattrape pas (le processus principal marque ce
    // qui est parti), et un échec de lecture ne bloque pas indéfiniment — il
    // laisse partir la file sans le champ, ce qui est exact.
    assert.match(shell, /if \(schoolName === null && !schoolNameReadFailed\) return/);
    assert.match(shell, /\}, \[currentUser\?\.username, schoolName, schoolNameReadFailed\]\)/);
    assert.match(shell, /flushedQueueFor\.current === username/, 'un passage par session, pas à chaque rendu');
    assert.match(shell, /if \(!username \|\| flushedQueueFor\.current === username\) return/);
  });
});
