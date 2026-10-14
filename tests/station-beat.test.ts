// Suite du BATTEMENT DE VERSION d'un poste (§7 du canal) — la moitié qui vit
// SUR la machine : `electron/station-beat.cjs`.
//
// CE QUE CES CAS PROTÈGENT
// ------------------------
// Le relevé de parc (section 6) se lit poste par poste ; il ne vaut donc que si
// ce que chaque poste inscrit est VRAI. Trois propriétés portent ça, et chacune
// a payé un défaut ailleurs dans ce dépôt :
//
//   • **l'identité ne se régénère jamais** : un poste qui perd son identifiant
//     apparaîtrait comme un poste DE PLUS, et « 12 postes » ne voudrait plus rien
//     dire — d'où le rattrapage d'un fichier abîmé plutôt que la pose d'un neuf ;
//   • **aucun état inventé** : un battement sans état de contrôle valide n'est pas
//     écrit, parce que combler le trou par « ok » déclarerait une vérification qui
//     n'a pas eu lieu — le contraire de ce que ce relevé existe pour dire ;
//   • **jamais fatal** : un disque plein, des droits refusés, un fichier coupé en
//     pleine écriture ne doivent pas empêcher une mise à jour.
//
// Et il se DÉSACTIVE (`STATION_HEARTBEAT=off`) : l'école peut refuser d'être
// recensée sans toucher au canal.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

const {
  BEAT_OFF,
  ID_PREFIX,
  MIN_ID,
  MAX_ID,
  LAST_CHECK_STATES,
  stationPath,
  randomStationId,
  readStation,
  ensureStationId,
  recordBeat,
  beatPayload,
} = require('../electron/station-beat.cjs') as {
  BEAT_OFF: string;
  ID_PREFIX: string;
  MIN_ID: number;
  MAX_ID: number;
  LAST_CHECK_STATES: readonly string[];
  stationPath: (input: { userDataDir: string }) => string;
  randomStationId: (random?: () => number) => string;
  readStation: (
    file: string,
    options?: { fs?: unknown },
  ) => { stationId: string; appVersion: string | null; lastCheck: string | null } | null;
  ensureStationId: (
    file: string,
    options?: { fs?: unknown; random?: () => number; nowMs?: number },
  ) => string;
  recordBeat: (
    file: string,
    facts?: Record<string, unknown>,
    options?: { fs?: unknown; random?: () => number; nowMs?: number },
  ) => Record<string, unknown> | null;
  beatPayload: (input?: { userDataDir?: string; fs?: unknown; env?: object }) => Record<
    string,
    unknown
  > | null;
};

const AT = Date.parse('2026-10-14T10:00:00.000Z');
const AT_ISO = '2026-10-14T10:00:00.000Z';
/** Un identifiant de la forme attendue, pour les fixtures écrites à la main. */
const ID = `${ID_PREFIX}0123456789abcdef0123456789abcdef`;
/** Ce que rend la source aléatoire injectée `0.5` : trente-deux « 8 ». */
const DRAWN = `${ID_PREFIX}${'8'.repeat(32)}`;

/** Un dossier `userData` jetable, retiré à la fin de chaque cas. */
function withStation(run: (file: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mama-station-'));
  try {
    run(stationPath({ userDataDir: dir }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('l’identité d’un poste — aléatoire, écrite une fois, jamais régénérée', () => {
  it('l’identifiant ne vient QUE de la source aléatoire injectée, et il est borné', () => {
    // Deux sources différentes rendent deux identifiants différents : la valeur
    // n'est donc dérivée d'aucun nom de machine, d'aucun compte (§7).
    assert.equal(randomStationId(() => 0.5), DRAWN);
    assert.equal(randomStationId(() => 0.1875), `${ID_PREFIX}${'3'.repeat(32)}`);
    const drawn = randomStationId();
    assert.ok(drawn.startsWith(ID_PREFIX));
    assert.ok(drawn.length >= MIN_ID && drawn.length <= MAX_ID);
  });

  it('une identité DÉJÀ écrite est RÉUTILISÉE, même avec une autre source aléatoire', () => {
    withStation((file) => {
      const first = ensureStationId(file, { random: () => 0.5, nowMs: AT });
      const written = readFileSync(file, 'utf8');
      const second = ensureStationId(file, { random: () => 0.1875, nowMs: AT });
      assert.equal(second, first, 'le second démarrage ne tire pas un poste de plus');
      assert.equal(readFileSync(file, 'utf8'), written, 'et le relevé n’est pas réécrit');
      assert.equal(readStation(file)?.stationId, first);
    });
  });

  it('un poste sans relevé reçoit une identité neuve, et le squelette ne porte aucun fait', () => {
    withStation((file) => {
      const id = ensureStationId(file, { random: () => 0.5, nowMs: AT });
      assert.equal(id, DRAWN);
      assert.equal(existsSync(file), true, 'l’identité est gardée pour le prochain démarrage');
      const record = readStation(file);
      assert.equal(record?.stationId, id);
      // `checkedAt` dit quand le poste est apparu, PAS quand il a battu : un
      // squelette qui porterait un état compterait un contrôle qui n'a pas eu lieu.
      assert.equal(record?.appVersion, null);
      assert.equal(record?.lastCheck, null);
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { checkedAt?: string };
      assert.equal(raw.checkedAt, AT_ISO);
    });
  });

  it('un fichier ABÎMÉ rend son identifiant RATTRAPÉ — un incident de disque ne fabrique pas un poste', () => {
    withStation((file) => {
      // Le cas réel : une écriture coupée par une panne de courant laisse le JSON
      // invalide, mais la chaîne `stationId` intacte en clair.
      const broken = `{"stationId":"${ID}","appVe`;
      writeFileSync(file, broken);
      assert.equal(ensureStationId(file, { random: () => 0.5, nowMs: AT }), ID);
      assert.equal(readFileSync(file, 'utf8'), broken, 'et le rattrapage n’écrase rien');
    });
  });

  it('un fichier abîmé SANS identifiant lisible en tire un neuf, et le réécrit proprement', () => {
    withStation((file) => {
      writeFileSync(file, '{ pas du json');
      assert.equal(ensureStationId(file, { random: () => 0.5, nowMs: AT }), DRAWN);
      assert.equal(readStation(file)?.stationId, DRAWN, 'le fichier est redevenu lisible');
    });
  });

  it('un relevé absent ou illisible se lit `null` : une absence n’est pas une erreur', () => {
    withStation((file) => {
      assert.equal(readStation(file), null, 'aucun relevé — pas encore, pas une panne');
      // « court » fait SEPT caractères, sous la borne basse : l'identifiant est
      // refusé, et le texte ne porte rien de rattrapable non plus.
      writeFileSync(file, '{ "stationId": "court" }');
      assert.equal(readStation(file), null, 'un identifiant hors bornes ne vaut pas un poste');
    });
  });
});

describe('les faits inscrits — bornés, et jamais inventés', () => {
  it('sans version installée, rien n’est écrit — un relevé sans version ne relève rien', () => {
    withStation((file) => {
      assert.equal(recordBeat(file, { lastCheck: 'ok' }, { nowMs: AT }), null);
      assert.equal(existsSync(file), false, 'et aucun identifiant n’est consommé pour rien');
    });
  });

  it('un état de contrôle inconnu n’est pas ramené à « ok » : la vérification n’a pas eu lieu', () => {
    withStation((file) => {
      const facts = { appVersion: '1.0.32', lastCheck: 'peut-être' };
      assert.equal(recordBeat(file, facts, { nowMs: AT }), null);
      assert.equal(recordBeat(file, { appVersion: '1.0.32' }, { nowMs: AT }), null, 'l’état absent non plus');
      assert.equal(existsSync(file), false);
    });
  });

  it('un champ trop long est REFUSÉ, jamais tronqué — le relevé ne ment pas sur ce qu’il mesure', () => {
    withStation((file) => {
      const record = recordBeat(
        file,
        { appVersion: '1.0.32', osVersion: 'w'.repeat(33), lastCheck: 'ok' },
        { random: () => 0.5, nowMs: AT },
      );
      assert.ok(record);
      assert.equal(record.osVersion, null, '33 caractères ne deviennent pas 32');
      assert.equal(readStation(file)?.appVersion, '1.0.32');
      // La version INSTALLÉE est indispensable : hors bornes, tout le battement part.
      const tooLong = { appVersion: 'x'.repeat(33), lastCheck: 'ok' };
      assert.equal(recordBeat(file, tooLong, { random: () => 0.5, nowMs: AT }), null);
    });
  });

  it('le fait écrit est relu tel quel, sous l’identité du poste', () => {
    withStation((file) => {
      const facts = {
        appVersion: '1.0.32',
        osVersion: '10',
        lastCheck: 'feed-absent',
        lastCheckVersion: '1.0.33',
      };
      const record = recordBeat(file, facts, { random: () => 0.5, nowMs: AT });
      assert.ok(record);
      assert.equal(record.stationId, DRAWN);
      assert.equal(record.lastCheck, 'feed-absent');
      assert.equal(record.checkedAt, AT_ISO);
      const reread = readStation(file);
      assert.equal(reread?.stationId, record.stationId);
      assert.equal(reread?.appVersion, '1.0.32');
      assert.equal(reread?.lastCheck, 'feed-absent');
    });
  });

  it('un état inconnu LU dans un fichier n’est pas recopié comme un contrôle', () => {
    withStation((file) => {
      writeFileSync(file, JSON.stringify({ stationId: ID, appVersion: '1.0.32', lastCheck: 'bizarre' }));
      const record = readStation(file);
      assert.equal(record?.stationId, ID);
      assert.equal(record?.lastCheck, null, 'un état hors des quatre n’est pas un état');
      assert.deepEqual(LAST_CHECK_STATES, ['ok', 'feed-absent', 'html', 'unreachable']);
    });
  });
});

describe('ce que le pont remet au rendu', () => {
  it('le battement ÉTEINT rend `null` : refuser d’être recensé est permis', () => {
    withStation((file, dir) => {
      recordBeat(file, { appVersion: '1.0.32', lastCheck: 'ok' }, { random: () => 0.5, nowMs: AT });
      assert.equal(beatPayload({ userDataDir: dir, env: { STATION_HEARTBEAT: BEAT_OFF } }), null);
      assert.equal(
        beatPayload({ userDataDir: dir, env: { STATION_HEARTBEAT: 'OFF' } }),
        null,
        'la casse ne compte pas',
      );
      assert.equal(
        beatPayload({ userDataDir: dir, env: { STATION_HEARTBEAT: ' off ' } }),
        null,
        'les espaces non plus',
      );
      assert.ok(beatPayload({ userDataDir: dir, env: {} }), 'sans la variable, il reste actif');
    });
  });

  it('sans `userData` connu, ou sans relevé exploitable, il n’y a rien à rendre', () => {
    withStation((file, dir) => {
      assert.equal(beatPayload({ env: {} }), null);
      assert.equal(beatPayload({ userDataDir: dir, env: {} }), null, 'aucun relevé encore');
      // Le squelette (identité seule) n'est pas un battement : la base le
      // refuserait, et un 400 que personne ne lit ne vaut pas mieux que rien.
      ensureStationId(file, { random: () => 0.5, nowMs: AT });
      assert.equal(beatPayload({ userDataDir: dir, env: {} }), null);
    });
  });

  it('un relevé complet part au rendu, `stationId` compris', () => {
    withStation((file, dir) => {
      const facts = {
        appVersion: '1.0.32',
        osVersion: '10',
        lastCheck: 'html',
        lastCheckVersion: '1.0.33',
      };
      const record = recordBeat(file, facts, { random: () => 0.5, nowMs: AT });
      const payload = beatPayload({ userDataDir: dir, env: {} });
      assert.ok(payload);
      assert.deepEqual(payload, record);
    });
  });
});

describe('jamais fatal : un disque qui refuse ne casse ni le battement ni l’application', () => {
  /** Un `fs` dont toute ÉCRITURE est refusée, et dont la lecture rend ENOENT. */
  const refusingFs = {
    readFileSync: () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdirSync: () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    },
    writeFileSync: () => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    },
  };

  it('un disque plein rend le fait inscrit, sans jeter — la mise à jour continue', () => {
    withStation((file) => {
      let thrown: unknown = null;
      let record: Record<string, unknown> | null = null;
      try {
        record = recordBeat(
          file,
          { appVersion: '1.0.32', lastCheck: 'ok' },
          { fs: refusingFs, random: () => 0.5, nowMs: AT },
        );
      } catch (error) {
        thrown = error;
      }
      assert.equal(thrown, null, 'aucune exception ne remonte du battement');
      assert.ok(record, 'le fait reste vrai pour cette session, même non écrit');
      assert.equal(record.stationId, DRAWN);
      assert.equal(existsSync(file), false);
    });
  });

  it('un disque illisible ne fait pas jeter non plus : le pont rend `null` et se tait', () => {
    withStation((file, dir) => {
      assert.doesNotThrow(() => ensureStationId(file, { fs: refusingFs, random: () => 0.5 }));
      assert.equal(beatPayload({ userDataDir: dir, fs: refusingFs, env: {} }), null);
    });
  });
});
