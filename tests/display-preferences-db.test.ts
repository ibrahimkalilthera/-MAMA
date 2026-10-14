/**
 * Suite de l'accès BASE des préférences d'affichage — `src/lib/dataOps/settings.ts`.
 *
 * Le sujet du jour : le thème, la densité des tableaux, le verre des icônes et la
 * langue vivaient dans le `localStorage` du poste et NULLE PART ailleurs, donc un
 * poste réinstallé repartait aux défauts compilés. Ils sont maintenant des lignes
 * d'`app_settings` (préfixe `display.`), la table que la sauvegarde emporte : ce
 * que cette suite verrouille, c'est que la copie durable soit LUE sans être
 * inventée, et ÉCRITE sans mentir.
 *
 * Quatre invariants, chacun payé par un défaut connu du dépôt :
 *
 *   • une lecture qui ÉCHOUE rend `null`, jamais `{}` — « la base n'a pas
 *     répondu » et « l'école n'a rien réglé » sont deux états différents, et les
 *     confondre ferait passer une panne réseau pour une école neuve ;
 *   • une valeur que la préférence n'admet PAS n'est jamais adoptée : peindre un
 *     thème inexistant ou poser une langue sans traduction ne se voit que sur le
 *     poste d'une école ;
 *   • une valeur hors contrat n'est pas PUBLIÉE du tout (aucune requête) — et le
 *     refus est dit (`false`) ;
 *   • un 200 avec un corps VIDE (écriture retirée par une politique) n'est pas un
 *     succès : c'est la règle d'honnêteté des autres écritures du dépôt (voir
 *     tests/staff-write-honesty.test.ts), appliquée ici à `app_settings`.
 *
 * `supabaseClient`, `networkUtils`, `offlineQueue` et `auditLogger` sont simulés
 * AVANT l'import, comme dans tests/staff-write-honesty.test.ts : le vrai client ne
 * se charge pas sous le runner (pas d'`import.meta.env`), et l'état hors ligne
 * comme la file doivent être pilotés depuis le cas, pas subis.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule } from './module-mock';
// L'erreur RÉELLE de la file, capturée AVANT le mock : la file simulée doit
// refuser avec la forme que l'appelant attrape, pas avec une erreur inventée.
import { OfflineQueueWriteError } from '../src/lib/offlineQueue';

interface Call {
  op: 'select' | 'upsert';
  table: string;
  columns?: string;
  payload?: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** Le filtre de la lecture : les quatre clés demandées, et elles seules. */
  inColumn?: string;
  inValues?: unknown[];
}

interface Result {
  data: unknown;
  error: unknown;
}

let calls: Call[] = [];
let readResult: Result = { data: null, error: null };
let writeResult: Result = { data: null, error: null };
let offline = false;
let queueThrows = false;
let enqueued: { type: string; payload: unknown }[] = [];
let audits: Record<string, unknown>[] = [];

interface Chain extends PromiseLike<Result> {
  select: (columns?: string) => Chain;
  in: (column: string, values: unknown[]) => Chain;
}

/** Une requête thenable : on l'attend, et `.select()/.in()` la précisent. */
function chain(table: string, resolveWith: () => Result): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    // Le `.select()` d'APRÈS une écriture : c'est lui qui demande ce qui a été
    // écrit — sans lui, un 200 ne prouverait rien (corps vide = policy a filtré).
    // Il est enregistré comme une requête à part entière, avec sa table.
    select: (columns?: string) => {
      calls.push({ op: 'select', table, columns });
      return api;
    },
    in: (column: string, values: unknown[]) => {
      // Le filtre s'attache à l'appel DÉJÀ enregistré : une requête, une ligne.
      const last = calls.at(-1);
      if (last) {
        last.inColumn = column;
        last.inValues = values;
      }
      return api;
    },
    then: promise.then.bind(promise),
  } as unknown as Chain;
  return api;
}

const fakeSupabase = {
  from: (table: string) => ({
    select: (columns?: string) => {
      calls.push({ op: 'select', table, columns });
      return chain(table, () => readResult);
    },
    upsert: (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ op: 'upsert', table, payload, options });
      return chain(table, () => writeResult);
    },
  }),
};

mockModule('../src/lib/supabaseClient', { supabase: fakeSupabase });
mockModule('../src/lib/networkUtils', { isStationOffline: () => offline });
mockModule('../src/lib/auditLogger', {
  logAuditEvent: (entry: Record<string, unknown>) => {
    audits.push(entry);
    return Promise.resolve();
  },
});
mockModule('../src/lib/offlineQueue', {
  enqueueOfflineAction: (type: string, payload: unknown) => {
    if (queueThrows) throw new OfflineQueueWriteError('queue-full', '2000 gestes');
    enqueued.push({ type, payload });
    return { id: 'off-1' };
  },
  // La classe est bien exportée : la file simulée refuse avec elle, et c'est le
  // refus que le module sous test doit transformer en `false`.
  OfflineQueueWriteError,
});

const { fetchDisplayPreferences, publishDisplayPreference } = await import('../src/lib/dataOps/settings');

beforeEach(() => {
  calls = [];
  readResult = { data: null, error: null };
  writeResult = { data: null, error: null };
  offline = false;
  queueThrows = false;
  enqueued = [];
  audits = [];
});

describe('fetchDisplayPreferences — lire la copie durable sans rien inventer', () => {
  it('lit les QUATRE clés (et elles seules) et rend les préférences reconnues', async () => {
    readResult = {
      data: [
        { key: 'display.theme', value: 'emerald' },
        { key: 'display.density', value: 'compact' },
        { key: 'display.icon_glass', value: 'discreet' },
        { key: 'display.language', value: 'en' },
      ],
      error: null,
    };

    assert.deepEqual(await fetchDisplayPreferences(), {
      theme: 'emerald',
      density: 'compact',
      iconGlass: 'discreet',
      language: 'en',
    });

    const read = calls[0];
    assert.equal(read?.op, 'select');
    assert.equal(read?.table, 'app_settings', 'la lecture vise la table sauvée et restaurée');
    assert.deepEqual(
      read?.inValues,
      ['display.theme', 'display.density', 'display.icon_glass', 'display.language'],
      'la requête demande les quatre clés de préférences, pas toute la table des réglages d’équipe',
    );
  });

  it('ignore une clé inconnue, un type inattendu et une valeur non admise', async () => {
    readResult = {
      data: [
        { key: 'inactivity_minutes', value: 15 }, // un réglage d'équipe, pas une préférence
        { key: 'display.theme', value: 42 }, // un JSONB d'un autre type
        { key: 'display.density', value: 'cozy' }, // une densité qui n'existe pas
        { key: 'display.language', value: null },
      ],
      error: null,
    };

    assert.deepEqual(
      await fetchDisplayPreferences(),
      {},
      'aucune préférence illisible ne doit être adoptée — pas même par défaut',
    );
  });

  it('rend `null` quand la base n’a pas répondu, jamais « l’école n’a rien réglé »', async () => {
    // `{}` ferait exactement ce que ce module refuse : un échec réseau se lirait
    // comme une école neuve, et personne ne saurait qu'on n'a pas regardé.
    readResult = { data: null, error: { message: 'permission denied' } };
    assert.equal(await fetchDisplayPreferences(), null);

    readResult = { data: null, error: null };
    assert.equal(await fetchDisplayPreferences(), null, 'une réponse vide n’est pas non plus « rien de réglé »');
  });
});

describe('publishDisplayPreference — écrire la copie durable, et le dire honnêtement', () => {
  it('refuse une valeur hors contrat SANS écrire', async () => {
    assert.equal(await publishDisplayPreference('theme', 'gothic'), false);
    assert.deepEqual(calls, [], 'aucune requête ne doit partir pour une valeur que personne ne relira');
    assert.deepEqual(audits, [], 'et rien ne se journalise');
  });

  it('publie la ligne d’app_settings — la même forme que le rejeu, sans `updated_by`', async () => {
    writeResult = { data: [{ key: 'display.theme' }], error: null };

    assert.equal(await publishDisplayPreference('theme', 'midnight'), true);

    const write = calls.find((c) => c.op === 'upsert');
    assert.ok(write, 'un UPSERT part');
    assert.equal(write.table, 'app_settings');
    assert.equal(write.options?.onConflict, 'key', 'une préférence remplace sa ligne, elle ne s’y ajoute pas');
    assert.equal(write.payload?.key, 'display.theme');
    assert.equal(write.payload?.value, 'midnight');
    assert.match(String(write.payload?.updated_at), /^\d{4}-\d{2}-\d{2}T/, 'l’horodatage accompagne la ligne');
    assert.equal(
      'updated_by' in (write.payload ?? {}),
      false,
      'jamais d’auteur : les comptes `auth.users` ne voyagent pas, et une ligne qui les nomme ne se restaure pas',
    );
    assert.ok(
      calls.some((c) => c.op === 'select' && c.columns === 'key'),
      'la requête demande CE QUI a été écrit (.select), sinon un 200 ne prouve rien',
    );
  });

  it('un 200 avec un corps VIDE (écriture retirée par une politique) n’est PAS un succès', async () => {
    writeResult = { data: [], error: null };
    assert.equal(await publishDisplayPreference('density', 'compact'), false);
    assert.deepEqual(audits, [], 'un refus ne se journalise pas comme un réglage modifié');
  });

  it('une erreur PostgREST reste une erreur', async () => {
    writeResult = { data: null, error: { message: 'permission denied' } };
    assert.equal(await publishDisplayPreference('density', 'compact'), false);
    assert.deepEqual(audits, []);
  });

  it('hors ligne, le changement part dans la file au lieu d’être perdu', async () => {
    offline = true;

    assert.equal(await publishDisplayPreference('iconGlass', 'crisp'), true, 'la copie durable le prendra au retour du réseau');
    assert.deepEqual(calls, [], 'hors ligne, AUCUNE requête ne part — c’est ce qui distingue « mis en file » de « tenté puis perdu »');
    assert.deepEqual(
      enqueued,
      [{ type: 'setDisplayPreference', payload: { name: 'iconGlass', value: 'crisp' } }],
      'le NOM de la préférence voyage, pas la clé `app_settings` : la correspondance n’existe qu’à un endroit',
    );
  });

  it('une file qui refuse n’est pas un succès', async () => {
    offline = true;
    queueThrows = true;

    assert.equal(
      await publishDisplayPreference('iconGlass', 'crisp'),
      false,
      'un geste que la file n’a pas rangé ne doit pas être annoncé publié',
    );
    assert.deepEqual(calls, []);
  });

  it('le geste publié est journalisé comme un réglage modifié, sur la clé publiée', async () => {
    writeResult = { data: [{ key: 'display.density' }], error: null };
    assert.equal(await publishDisplayPreference('density', 'compact'), true);

    assert.equal(audits.length, 1, 'un seul geste, une seule entrée');
    assert.equal(audits[0]?.action, 'UPDATE_SETTING');
    assert.equal(audits[0]?.targetType, 'app_settings');
    assert.equal(audits[0]?.targetId, 'display.density');
    assert.equal(audits[0]?.details, 'display.density = compact');
  });
});
