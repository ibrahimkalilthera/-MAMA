/**
 * ─── Le nom de l'école : le contrat, la base, et la file hors ligne ────────
 *
 * Le sujet du jour : une école pouvait installer dix postes et personne ne
 * savait, en lisant une remontée, de quelle école elle parlait — le nom de
 * machine répond « laquelle ? », jamais « de quelle école ? ». Le nom de l'école
 * est donc devenu un FAIT de l'établissement (`app_settings`, clé `school.name`),
 * écrit une fois, porté par chaque remontée de poste à côté du nom de la machine
 * (`src/lib/desktopUpdateReport.ts`).
 *
 * Ce que cette suite verrouille, et chaque point paie un défaut connu :
 *
 *   • **ce qui n'est pas lu est REFUSÉ, jamais rangé de travers.** Un nom hors
 *     bornes, d'un autre type, ou portant le séparateur des rapports de poste
 *     (` · `) rend `null` — ni tronqué, ni « réparé ». Un nom tronqué s'écrirait
 *     en base sans que personne ne l'ait écrit, et un nom portant le séparateur
 *     décalerait la lecture de TOUTES les remontées de cette école
 *     (`src/lib/blockedIncidents.ts` découpe ses champs dessus) ;
 *   • **« la base n'a pas répondu » et « aucune école n'a déclaré son nom » sont
 *     deux états DIFFÉRENTS.** Le premier rend `null`, le second `{ declared:
 *     null }` : les confondre afficherait « non déclaré » devant une coupure
 *     réseau, c'est-à-dire ferait passer une ignorance pour un fait — et
 *     inviterait à réécrire un nom déjà publié ;
 *   • **l'écriture a TROIS issues, pas deux** (`saved` / `queued` / `refused`) :
 *     un 200 au corps vide (écriture retirée par une politique), une file pleine
 *     ou une valeur hors contrat ne sont pas des enregistrements, et un geste
 *     réellement mis en file n'est pas un échec ;
 *   • **le rejeu écrit la ligne du chemin en ligne, mot pour mot** : la même
 *     `schoolNameRow`, sans `updated_by` (les comptes `auth.users` ne voyagent
 *     pas, donc une ligne qui les nomme ne se restaure pas — voir
 *     `scripts/lib/db-tables.mjs`) ; et un rejeu plus permissif que l'écran
 *     écrirait un nom que l'écran n'accepterait jamais.
 *
 * `supabaseClient`, `networkUtils`, `offlineQueue` et `auditLogger` sont simulés
 * AVANT l'import, comme dans tests/display-preferences-db.test.ts : le vrai client
 * ne se charge pas sous le runner, et l'état hors ligne comme le journal doivent
 * être pilotés depuis le cas, pas subis.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb } from './fakes';
import { mockModule } from './module-mock';
// L'erreur RÉELLE de la file, capturée AVANT le mock : la file simulée doit
// refuser avec la forme que l'appelant attrape, pas avec une erreur inventée.
import { OfflineQueueWriteError } from '../src/lib/offlineQueue';
import {
  REPORT_FIELD_SEPARATOR,
  SCHOOL_NAME_KEY,
  SCHOOL_NAME_MAX,
  isSchoolName,
  normalizeSchoolName,
  parseSchoolName,
  schoolField,
  schoolNameRow,
} from '../src/lib/schoolName';

// ─── Le faux client : il enregistre les requêtes, et rend ce que le cas pose ──
interface Call {
  op: 'select' | 'upsert';
  table: string;
  columns?: string;
  payload?: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** Le filtre de la lecture : la clé demandée, et elle seule. */
  eqColumn?: string;
  eqValue?: unknown;
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
  eq: (column: string, value: unknown) => Chain;
}

/** Une requête thenable : on l'attend, et `.select()/.eq()` la précisent. */
function chain(table: string, resolveWith: () => Result): Chain {
  const promise = Promise.resolve().then(resolveWith);
  const api = {
    // Le `.select()` d'APRÈS une écriture : c'est lui qui demande ce qui a été
    // écrit — sans lui, un 200 ne prouverait rien (corps vide = policy a filtré).
    select: (columns?: string) => {
      calls.push({ op: 'select', table, columns });
      return api;
    },
    eq: (column: string, value: unknown) => {
      const last = calls.at(-1);
      if (last) {
        last.eqColumn = column;
        last.eqValue = value;
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
  OfflineQueueWriteError,
});

const { fetchSchoolName, publishSchoolName } = await import('../src/lib/dataOps/settings');
const { replaySchoolName, schoolNameAuditInfo } = await import('../src/lib/offlineReplaySchoolName');

beforeEach(() => {
  calls = [];
  readResult = { data: null, error: null };
  writeResult = { data: null, error: null };
  offline = false;
  queueThrows = false;
  enqueued = [];
  audits = [];
});

describe('normalizeSchoolName — une valeur non mesurée reste null', () => {
  it('ramène un nom collé à sa forme canonique', () => {
    assert.equal(normalizeSchoolName('  Complexe   Scolaire\nMama Thera  '), 'Complexe Scolaire Mama Thera');
    assert.equal(normalizeSchoolName('École\tTest'), 'École Test', 'un caractère de contrôle est un accident de copier-coller, pas un nom');
  });

  it('refuse ce qui n’est pas une chaîne, plutôt que de le convertir', () => {
    for (const value of [42, null, undefined, {}, ['école'], true]) {
      assert.equal(normalizeSchoolName(value), null, `« ${String(value)} » n’est pas un nom`);
    }
  });

  it('refuse hors bornes — SANS tronquer : tronquer écrirait un nom que personne n’a écrit', () => {
    assert.equal(normalizeSchoolName('A'), null, 'un nom d’un seul caractère n’en est pas un');
    assert.equal(normalizeSchoolName('AB'), 'AB', 'deux caractères passent : c’est la borne basse du contrat');
    assert.equal(normalizeSchoolName('M'.repeat(SCHOOL_NAME_MAX)), 'M'.repeat(SCHOOL_NAME_MAX));
    assert.equal(normalizeSchoolName('M'.repeat(SCHOOL_NAME_MAX + 1)), null);
  });

  it('refuse un nom qui porterait le séparateur des rapports de poste', () => {
    // Le séparateur découpe les champs d'une remontée : un nom qui le contient
    // décalerait la lecture de TOUTES les remontées de cette école — un défaut
    // qui ne casse rien et qui fait lire autre chose que ce qui est écrit.
    assert.equal(normalizeSchoolName(`École${REPORT_FIELD_SEPARATOR}bis`), null);
    assert.equal(isSchoolName(`École${REPORT_FIELD_SEPARATOR}bis`), false);
    assert.equal(isSchoolName('Complexe Scolaire Mama Thera'), true);
  });
});

describe('schoolNameRow / parseSchoolName / schoolField — les deux bouts de la même ligne', () => {
  it('la ligne d’app_settings : la clé, la valeur, l’horodatage — et AUCUN auteur', () => {
    const row = schoolNameRow('Complexe Scolaire Mama Thera', new Date('2026-10-16T10:00:00.000Z'));
    assert.deepEqual(Object.keys(row).sort(), ['key', 'updated_at', 'value']);
    assert.equal(row.key, SCHOOL_NAME_KEY);
    assert.equal(row.value, 'Complexe Scolaire Mama Thera');
    assert.equal(row.updated_at, '2026-10-16T10:00:00.000Z');
    assert.equal(
      'updated_by' in row,
      false,
      'jamais d’auteur : les comptes `auth.users` ne voyagent pas, et une ligne qui les nomme ne se restaure pas',
    );
  });

  it('une ligne illisible est IGNORÉE — on n’affiche pas un nom qu’on n’a pas su lire', () => {
    assert.equal(parseSchoolName([{ key: SCHOOL_NAME_KEY, value: 'Complexe Scolaire Mama Thera' }]), 'Complexe Scolaire Mama Thera');
    assert.equal(parseSchoolName([{ key: SCHOOL_NAME_KEY, value: 42 }]), null);
    assert.equal(parseSchoolName([{ key: SCHOOL_NAME_KEY, value: 'A' }]), null);
    assert.equal(parseSchoolName([{ key: SCHOOL_NAME_KEY }]), null);
    assert.equal(parseSchoolName([{ key: 'display.theme', value: 'midnight' }]), null, 'une autre clé n’est pas un nom d’école');
    assert.equal(parseSchoolName([]), null, 'aucune ligne = aucune école n’a déclaré son nom (un FAIT, pas une panne)');
    assert.equal(parseSchoolName(null as never), null);
  });

  it('le champ d’une remontée est « école <nom> », ou RIEN — jamais « inconnue »', () => {
    assert.equal(schoolField('Complexe Scolaire Mama Thera'), 'école Complexe Scolaire Mama Thera');
    for (const rien of [null, undefined, '', 'A', `École${REPORT_FIELD_SEPARATOR}fausse`]) {
      assert.equal(schoolField(rien), null, `« ${String(rien)} » ne doit rien produire du tout`);
    }
  });
});

describe('fetchSchoolName — lire sans rien inventer', () => {
  it('lit la SEULE clé du nom, et rend le nom déclaré', async () => {
    readResult = { data: [{ key: SCHOOL_NAME_KEY, value: 'Complexe Scolaire Mama Thera' }], error: null };

    assert.deepEqual(await fetchSchoolName(), { declared: 'Complexe Scolaire Mama Thera' });

    const read = calls[0];
    assert.equal(read?.op, 'select');
    assert.equal(read?.table, 'app_settings', 'la table que la sauvegarde emporte');
    assert.equal(read?.eqColumn, 'key');
    assert.equal(read?.eqValue, SCHOOL_NAME_KEY, 'la lecture cible une clé, pas toute la table des réglages');
  });

  it('une école qui n’a jamais déclaré son nom est un FAIT, pas une panne', async () => {
    readResult = { data: [], error: null };
    assert.deepEqual(await fetchSchoolName(), { declared: null });
  });

  it('rend `null` quand la base n’a pas répondu, jamais « non déclaré »', async () => {
    // `{ declared: null }` ferait exactement ce que ce module refuse : une
    // coupure réseau se lirait comme une école qui n'a rien écrit, et l'écran
    // inviterait à réécrire un nom que l'école avait déjà publié.
    readResult = { data: null, error: { message: 'network unreachable' } };
    assert.equal(await fetchSchoolName(), null);

    readResult = { data: null, error: null };
    assert.equal(await fetchSchoolName(), null, 'une réponse vide n’est pas non plus « rien de déclaré »');
  });

  it('une valeur illisible n’est pas adoptée', async () => {
    readResult = { data: [{ key: SCHOOL_NAME_KEY, value: 42 }], error: null };
    assert.deepEqual(await fetchSchoolName(), { declared: null }, 'on dit qu’il n’est pas déclaré plutôt que d’afficher autre chose');
  });
});

describe('publishSchoolName — écrire, et le dire honnêtement', () => {
  it('refuse un nom hors contrat SANS écrire', async () => {
    assert.equal(await publishSchoolName('A'), 'refused');
    assert.equal(await publishSchoolName(`École${REPORT_FIELD_SEPARATOR}fausse`), 'refused');
    assert.deepEqual(calls, [], 'aucune requête ne part pour un nom que personne ne relira');
    assert.deepEqual(audits, [], 'et rien ne se journalise');
  });

  it('publie la ligne d’app_settings — la même forme que le rejeu, sans `updated_by`', async () => {
    writeResult = { data: [{ key: SCHOOL_NAME_KEY }], error: null };

    assert.equal(await publishSchoolName('  Complexe  Scolaire Mama Thera '), 'saved');

    const write = calls.find((c) => c.op === 'upsert');
    assert.ok(write, 'un UPSERT part');
    assert.equal(write.table, 'app_settings');
    assert.equal(write.options?.onConflict, 'key', 'un nom remplace sa ligne, il ne s’y ajoute pas');
    assert.equal(write.payload?.key, SCHOOL_NAME_KEY);
    assert.equal(write.payload?.value, 'Complexe Scolaire Mama Thera', 'c’est la forme CANONIQUE qui part, pas la frappe');
    assert.match(String(write.payload?.updated_at), /^\d{4}-\d{2}-\d{2}T/, 'l’horodatage accompagne la ligne');
    assert.equal('updated_by' in (write.payload ?? {}), false);
    assert.ok(
      calls.some((c) => c.op === 'select' && c.columns === 'key'),
      'la requête demande CE QUI a été écrit (.select), sinon un 200 ne prouve rien',
    );
  });

  it('un 200 au corps VIDE (écriture retirée par une politique) n’est PAS un enregistrement', async () => {
    writeResult = { data: [], error: null };
    assert.equal(await publishSchoolName('Complexe Scolaire Mama Thera'), 'refused');
    assert.deepEqual(audits, [], 'un refus ne se journalise pas comme un réglage modifié');
  });

  it('une erreur PostgREST reste une erreur', async () => {
    writeResult = { data: null, error: { message: 'permission denied' } };
    assert.equal(await publishSchoolName('Complexe Scolaire Mama Thera'), 'refused');
    assert.deepEqual(audits, []);
  });

  it('hors ligne, le nom part dans la file au lieu d’être perdu', async () => {
    offline = true;

    assert.equal(await publishSchoolName(' Complexe Scolaire Mama Thera '), 'queued');
    assert.deepEqual(calls, [], 'hors ligne, AUCUNE requête ne part — c’est ce qui distingue « mis en file » de « tenté puis perdu »');
    assert.deepEqual(
      enqueued,
      [{ type: 'setSchoolName', payload: { name: 'Complexe Scolaire Mama Thera' } }],
      'le NOM voyage (déjà canonique), pas la clé `app_settings` : la correspondance n’existe qu’au contrat',
    );
    assert.deepEqual(audits, [], 'rien n’est en base : le geste n’est pas journalisé comme un réglage modifié');
  });

  it('une file qui refuse n’est pas un succès', async () => {
    offline = true;
    queueThrows = true;
    assert.equal(await publishSchoolName('Complexe Scolaire Mama Thera'), 'refused');
    assert.deepEqual(calls, []);
  });

  it('le geste enregistré est journalisé sur la clé publiée', async () => {
    writeResult = { data: [{ key: SCHOOL_NAME_KEY }], error: null };
    assert.equal(await publishSchoolName('Complexe Scolaire Mama Thera'), 'saved');

    assert.equal(audits.length, 1, 'un seul geste, une seule entrée');
    assert.equal(audits[0]?.action, 'UPDATE_SETTING');
    assert.equal(audits[0]?.targetType, 'app_settings');
    assert.equal(audits[0]?.targetId, SCHOOL_NAME_KEY);
    assert.equal(audits[0]?.details, `${SCHOOL_NAME_KEY} = Complexe Scolaire Mama Thera`);
  });
});

describe('replaySchoolName — le rejeu écrit la ligne du chemin en ligne, ou rien', () => {
  it('écrit la même ligne qu’en ligne, et rend vrai seulement si la base l’a prise', async () => {
    const { db, rows, queries } = makeFakeDb();

    assert.equal(await replaySchoolName(db, { name: 'Complexe Scolaire Mama Thera' }), true);

    assert.deepEqual(queries, ['app_settings']);
    const written = rows.find((r) => r.table === 'app_settings')?.row;
    assert.ok(written, 'une ligne est écrite');
    assert.equal(written?.key, SCHOOL_NAME_KEY);
    assert.equal(written?.value, 'Complexe Scolaire Mama Thera');
    assert.equal('updated_by' in (written ?? {}), false, 'le rejeu n’invente pas plus d’auteur que le chemin en ligne');
  });

  it('refuse un nom hors contrat SANS écrire — la file est modifiable à la main', async () => {
    const { db, queries } = makeFakeDb();

    assert.equal(await replaySchoolName(db, { name: 'A' }), false);
    assert.equal(await replaySchoolName(db, { name: `École${REPORT_FIELD_SEPARATOR}fausse` }), false);
    assert.equal(await replaySchoolName(db, { name: undefined as never }), false);
    assert.deepEqual(queries, [], 'un rejeu plus permissif que l’écran écrirait un nom que l’écran n’accepterait jamais');
  });

  it('une écriture retirée par une politique (200 au corps vide) n’est pas une réussite', async () => {
    const { db } = makeFakeDb({ emptyWrites: ['app_settings'] });
    assert.equal(
      await replaySchoolName(db, { name: 'Complexe Scolaire Mama Thera' }),
      false,
      'compter ce rejeu comme parti retirerait de la file un nom que la base n’a jamais reçu',
    );
  });

  it('une base en échec laisse le geste en file', async () => {
    const { db } = makeFakeDb({ failTables: ['app_settings'] });
    assert.equal(await replaySchoolName(db, { name: 'Complexe Scolaire Mama Thera' }), false);
  });

  it('le journal d’un rejeu dit la clé et la valeur NORMALISÉE', () => {
    const info = schoolNameAuditInfo({ name: '  Complexe   Mama Thera ' }, ' (hors ligne)');
    assert.equal(info.action, 'UPDATE_SETTING');
    assert.equal(info.targetType, 'app_settings');
    assert.equal(info.targetId, SCHOOL_NAME_KEY);
    assert.equal(
      info.details,
      `${SCHOOL_NAME_KEY} = Complexe Mama Thera (hors ligne)`,
      'une entrée de journal doit dire ce qui est parti en base, pas ce que le localStorage portait',
    );
    // Un contenu hors contrat ne peut pas se journaliser comme un nom écrit.
    assert.equal(schoolNameAuditInfo({ name: 'A' }, '').details, `${SCHOOL_NAME_KEY} = `);
  });
});
