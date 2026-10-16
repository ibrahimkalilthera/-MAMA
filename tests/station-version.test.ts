// Suite du BATTEMENT DE VERSION d'un poste (§7 du canal) — la moitié qui
// compose et qui envoie.
//
// CE QUE CES CAS PROTÈGENT
// ------------------------
// Le relevé de parc n'a de valeur que s'il est VRAI : une ligne écrite pour un
// autre poste, ou une ligne écrite avec un état inventé, ferait dire au relevé
// le contraire de ce que les machines vivent. Trois propriétés portent ça :
//
//   • ce qui part est COMPOSÉ ici et testé ici (`stationBeatArgs`, pure) — et un
//     battement que la base refuserait n'est JAMAIS envoyé à l'aveugle
//     (`stationBeatProblem` le nomme avant l'appel, sinon un refus se perdrait
//     dans une réponse HTTP que personne ne lit) ;
//   • l'absence de pont (page web, battement désactivé sur une machine) est un
//     no-op SILENCIEUX, pas un échec : il n'y a pas d'identité de poste à
//     envoyer, donc rien à raconter ;
//   • un envoi raté ne fait jamais tomber l'application : le relevé perd une
//     ligne, la mise à jour continue. Une écriture refusée n'a aucun effet sur
//     le canal, et c'est la propriété que la spécification exige.
//
// Et deux cas vérifient l'ACCORD avec la migration (`..._station_versions.sql`)
// plutôt que de faire confiance à deux copies d'un même contrat : le nom de la
// fonction appelée, les noms d'arguments envoyés, et le fait que la base
// rafraîchit bien `seen_at` — sans quoi « silencieux depuis N jours » ne
// mesurerait rien du tout.
//
// Et la signature comparée est la signature EFFECTIVE — la DERNIÈRE déclaration
// dans l'ordre des migrations —, jamais la première : le 2026-10-21 le geste a
// gagné un argument (`p_install_mode`, la forme du poste, et avec elle la trace
// des conversions portable → installé). Comparer au fichier d'origine laisserait
// cette suite vérifier un contrat qui n'est plus celui de la base — le faux vert
// exact que ces cas existent pour empêcher.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  INSTALL_MODES,
  LAST_CHECK_STATES,
  STATION_BEAT_RPC,
  readStationBeat,
  sendStationBeat,
  stationBeatArgs,
  stationBeatProblem,
} from '../src/lib/stationVersion';
import type { StationBeatArgs, StationBeatPayload } from '../src/lib/stationVersion';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase/migrations');

/** La migration qui a créé la table et le geste (leurs formes de base). */
const MIGRATION = readFileSync(join(MIGRATIONS_DIR, '20261018000000_station_versions.sql'), 'utf8');

/**
 * TOUTES les déclarations du geste, dans l'ordre des migrations — et la dernière
 * est celle qui gouverne.
 *
 * Une migration peut remplacer une fonction ; c'est le cas ici (la forme du
 * poste est un argument de plus). La signature qui compte n'est donc pas la
 * première écrite, mais la dernière en date : c'est elle que PostgREST résoudra
 * quand un poste appellera.
 */
const BEAT_DECLARATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .flatMap((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    return [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([\s\S]*?)\)\s*RETURNS/gi)].map(
      (match) => ({ name, fn: match[1]!, args: match[2]! }),
    );
  });
const EFFECTIVE_BEAT = BEAT_DECLARATIONS.filter((entry) => entry.fn === STATION_BEAT_RPC).at(-1);
const EFFECTIVE_SQL = readFileSync(join(MIGRATIONS_DIR, EFFECTIVE_BEAT!.name), 'utf8');

/** Un battement valide, que chaque cas décale d'un seul champ. */
const beat = (over: Partial<StationBeatPayload> = {}): StationBeatPayload => ({
  stationId: 'st_0123456789abcdef0123456789abcdef',
  appVersion: '1.0.32',
  osVersion: '10',
  lastCheck: 'ok',
  lastCheckVersion: '1.0.33',
  installMode: 'installed',
  checkedAt: '2026-10-14T10:00:00.000Z',
  ...over,
});

/** Un pont de laboratoire : ce qu'il rend, et ce qu'il a reçu. */
const bridge = (payload: StationBeatPayload | null, boom = false) => {
  const calls: number[] = [];
  return {
    calls,
    api: {
      stationBeat: async () => {
        calls.push(Date.now());
        if (boom) throw new Error('pont muet');
        return payload;
      },
    },
  };
};

describe('ce qui part du poste, et sous quels noms', () => {
  it('un battement valide porte les noms d’arguments de la base, sans en inventer', () => {
    const args = stationBeatArgs(beat());
    assert.ok(args);
    assert.deepEqual(Object.keys(args).sort(), [
      'p_app_version',
      'p_install_mode',
      'p_last_check',
      'p_last_check_version',
      'p_os_version',
      'p_station_id',
    ]);
    assert.equal(args.p_station_id, 'st_0123456789abcdef0123456789abcdef');
    assert.equal(args.p_app_version, '1.0.32');
    assert.equal(args.p_os_version, '10');
    assert.equal(args.p_last_check, 'ok');
    assert.equal(args.p_last_check_version, '1.0.33');
    // La forme du poste part TELLE QUELLE : c'est la base qui la compare à la
    // ligne en place, et c'est ce qui fait d'une conversion un fait daté.
    assert.equal(args.p_install_mode, 'installed');
    assert.deepEqual(INSTALL_MODES, ['portable', 'installed']);
  });

  it('l’absence d’un champ facultatif vaut null, jamais une chaîne vide', () => {
    const args = stationBeatArgs(beat({ osVersion: '', lastCheckVersion: null, installMode: null }));
    assert.ok(args);
    assert.equal(args.p_os_version, null);
    assert.equal(args.p_last_check_version, null);
    // « pas mesurée » s'écrit `null`, et la base garde alors la forme déjà
    // mesurée : une session de développement ne devient pas un poste de plus.
    assert.equal(args.p_install_mode, null);
    assert.equal(stationBeatProblem(beat({ installMode: null })), null, 'ne pas mesurer n’est pas un refus');
  });

  it('une forme INCONNUE est refusée avant l’appel, en nommant les formes connues', () => {
    // La base la refuserait par sa contrainte — mais son refus serait un 400 que
    // personne ne lit, et la répartition du parc compterait une forme qui
    // n'existe pas.
    const weird = beat({ installMode: 'portable-installe' });
    const problem = String(stationBeatProblem(weird));
    assert.match(problem, /forme du poste inconnue/);
    for (const mode of INSTALL_MODES) assert.match(problem, new RegExp(mode));
    assert.equal(stationBeatArgs(weird), null);
  });

  it('les espaces autour d’un identifiant ne le rendent pas valide par accident', () => {
    const args = stationBeatArgs(beat({ stationId: '  st_0123456789abcdef  ' }));
    assert.ok(args);
    assert.equal(args.p_station_id, 'st_0123456789abcdef');
  });
});

describe('un battement que la base refuserait n’est jamais envoyé', () => {
  it('un identifiant trop court est refusé, et le motif est nommé', () => {
    const short = beat({ stationId: 'st_123' });
    assert.match(String(stationBeatProblem(short)), /hors bornes \(8\.\.64\)/);
    assert.equal(stationBeatArgs(short), null);
  });

  it('un identifiant trop long est refusé aussi', () => {
    const long = beat({ stationId: 'x'.repeat(65) });
    assert.match(String(stationBeatProblem(long)), /hors bornes \(8\.\.64\)/);
    assert.equal(stationBeatArgs(long), null);
  });

  it('un état de contrôle inconnu est refusé, et l’état attendu est dit', () => {
    const weird = beat({ lastCheck: 'probably-fine' });
    const problem = String(stationBeatProblem(weird));
    assert.match(problem, /état de contrôle inconnu/);
    for (const state of LAST_CHECK_STATES) assert.match(problem, new RegExp(state.replace('-', '\\-')));
    assert.equal(stationBeatArgs(weird), null);
  });

  it('un état de contrôle absent est refusé (le silence n’est pas un état)', () => {
    assert.match(String(stationBeatProblem(beat({ lastCheck: '' }))), /inconnu/);
    assert.equal(stationBeatArgs(beat({ lastCheck: undefined })), null);
  });

  it('une version installée absente est refusée : un relevé sans version ne relève rien', () => {
    assert.equal(stationBeatArgs(beat({ appVersion: '' })), null);
    assert.match(String(stationBeatProblem(beat({ appVersion: '' }))), /version installée/);
  });

  it('une version de système ou une version proposée trop longue est refusée', () => {
    assert.equal(stationBeatArgs(beat({ osVersion: 'w'.repeat(33) })), null);
    assert.equal(stationBeatArgs(beat({ lastCheckVersion: 'v'.repeat(33) })), null);
  });

  it('un battement invalide ne réveille pas la base, et le refus est publié', () => {
    const sent: StationBeatArgs[] = [];
    const logs: string[] = [];
    return sendStationBeat({
      // Cinq caractères, sous la borne basse de 8 — le battement que la base
      // refuserait. Un identifiant qui n'est « court » que de nom (dix
      // caractères) passerait la validation, et le cas ne prouverait rien.
      api: bridge(beat({ stationId: 'court' })).api,
      rpc: async (args) => {
        sent.push(args);
        return true;
      },
      log: (m) => logs.push(m),
    }).then((outcome) => {
      assert.equal(outcome.sent, false);
      assert.deepEqual(sent, [], 'la base n’a pas été appelée pour un battement invalide');
      assert.match(outcome.detail, /hors bornes/);
      assert.equal(logs.length, 1, 'le refus est dit une fois, pas tu');
    });
  });
});

describe('un poste sans pont, ou bloqué, se tait sans rien casser', () => {
  it('sans pont (page web), c’est un no-op silencieux et aucun appel n’a lieu', async () => {
    let called = false;
    const outcome = await sendStationBeat({
      api: null,
      rpc: async () => {
        called = true;
        return true;
      },
      log: () => {},
    });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.detail, '');
    assert.equal(called, false);
  });

  it('un battement désactivé (le pont rend null) est un no-op silencieux', async () => {
    const probe = bridge(null);
    let called = false;
    const outcome = await sendStationBeat({
      api: probe.api,
      rpc: async () => {
        called = true;
        return true;
      },
      log: () => {},
    });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.detail, '');
    assert.equal(called, false);
    assert.equal(probe.calls.length, 1, 'le pont a bien été interrogé une fois');
  });

  it('un pont qui jette ne fait rien tomber : on retentera au prochain démarrage', async () => {
    const outcome = await sendStationBeat({
      api: bridge(beat(), true).api,
      rpc: async () => {
        throw new Error('ne doit pas être appelé');
      },
      log: () => {},
    });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.detail, '');
  });

  it('lecture directe : un pont absent ou fautif rend null, jamais une exception', async () => {
    assert.equal(await readStationBeat(null), null);
    assert.equal(await readStationBeat({}), null);
    assert.equal(await readStationBeat(bridge(beat(), true).api), null);
  });
});

describe('un envoi raté est DIT, et n’interrompt rien', () => {
  it('un appel refusé rend sent:false avec la cause, sans exception', async () => {
    const outcome = await sendStationBeat({
      api: bridge(beat()).api,
      rpc: async () => {
        throw new Error('permission denied for function record_station_beat');
      },
      log: () => {},
    });
    assert.equal(outcome.sent, false);
    assert.match(outcome.detail, /permission denied/);
  });

  it('un appel qui rend faux est un refus nommé', async () => {
    const outcome = await sendStationBeat({
      api: bridge(beat()).api,
      rpc: async () => false,
      log: () => {},
    });
    assert.equal(outcome.sent, false);
    assert.match(outcome.detail, /refusé par la base/);
  });

  it('un envoi réussi reçoit EXACTEMENT les arguments composés', async () => {
    const received: StationBeatArgs[] = [];
    const outcome = await sendStationBeat({
      api: bridge(beat()).api,
      rpc: async (args) => {
        received.push(args);
        return true;
      },
      log: () => {},
    });
    assert.equal(outcome.sent, true);
    assert.match(outcome.detail, /1\.0\.32/);
    assert.deepEqual(received, [stationBeatArgs(beat())]);
  });
});

describe('l’accord avec la migration, vérifié plutôt que supposé', () => {
  it('la fonction appelée est celle que la DERNIÈRE migration déclare', () => {
    assert.ok(EFFECTIVE_BEAT, 'aucune migration ne déclare le geste');
    assert.equal(EFFECTIVE_BEAT!.fn, STATION_BEAT_RPC);
    assert.equal(MIGRATION.includes('CREATE OR REPLACE FUNCTION public.record_station_beat'), true);
  });

  it('chaque argument envoyé existe dans la signature SQL EFFECTIVE', () => {
    const declared = new Set([...EFFECTIVE_BEAT!.args.matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1]));
    const sent = Object.keys(stationBeatArgs(beat()) as StationBeatArgs);
    assert.ok(sent.length > 0);
    for (const name of sent) {
      assert.ok(declared.has(name), `« ${name} » est envoyé mais absent de la signature SQL (${[...declared].join(', ')})`);
    }
    // Et l'inverse, pour l'argument qui vient d'arriver : le nom envoyé est
    // exactement celui que la base attend (`p_install_mode`).
    assert.equal(declared.has('p_install_mode'), true, 'la forme du poste est un argument de la fonction');
  });

  it('le geste a UNE signature : la nouvelle est précédée du retrait de l’ancienne', () => {
    // Postgres identifie une fonction par (nom, types d'arguments) : un
    // `CREATE OR REPLACE` avec un argument de plus AJOUTE une surcharge au lieu
    // de remplacer. Deux surcharges rendraient ambigu l'appel d'un poste resté
    // sur la version en service — et un poste qui ne peut plus battre est la
    // panne silencieuse même que ce relevé existe pour supprimer.
    assert.match(
      EFFECTIVE_SQL,
      /DROP FUNCTION IF EXISTS public\.record_station_beat\(TEXT, TEXT, TEXT, TEXT, TEXT\)/,
    );
  });

  it('la conversion portable → installé est datée par la BASE, et la PREMIÈRE seule', () => {
    // Le sens, d'abord : c'est `portable` → `installed`, et lui seul — relancer
    // l'exe portable sur une machine installée n'est pas une conversion.
    assert.match(EFFECTIVE_SQL, /station_versions\.install_mode = 'portable'/);
    assert.match(EFFECTIVE_SQL, /excluded\.install_mode = 'installed'/);
    // La date vient du battement qui a porté la transition (`seen_at`, posé par
    // la base), et `COALESCE` garde celle déjà inscrite : une seconde lecture de
    // la même conversion ne la déplace pas.
    assert.match(EFFECTIVE_SQL, /COALESCE\(station_versions\.converted_at, excluded\.seen_at\)/);
    assert.match(
      EFFECTIVE_SQL,
      /COALESCE\(station_versions\.converted_to_version, excluded\.app_version\)/,
    );
  });

  it('un battement SANS forme n’efface pas celle déjà mesurée', () => {
    // Le poste resté sur une version qui n'envoie pas encore `install_mode`
    // continue de battre : il ne perd pas la forme qu'il avait déclarée, sinon
    // une conversion serait oubliée par le battement suivant.
    assert.match(
      EFFECTIVE_SQL,
      /install_mode = COALESCE\(excluded\.install_mode, station_versions\.install_mode\)/,
    );
  });

  it('la base rafraîchit seen_at : sans ça, « silencieux depuis N jours » ne mesurerait rien', () => {
    assert.match(EFFECTIVE_SQL, /seen_at = excluded\.seen_at/);
  });

  it('la table ne garde qu’une ligne par poste', () => {
    assert.match(MIGRATION, /station_id TEXT PRIMARY KEY/);
    assert.match(MIGRATION, /ON CONFLICT \(station_id\) DO UPDATE/);
  });
});
