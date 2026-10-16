// Suite for « plusieurs postes, une panne » : le journal d'audit porte une ligne
// par poste bloqué, et l'administrateur a besoin d'un incident par CAUSE.
//
// WHY THIS EXISTS
// ---------------
// Un blocage remonte par POSTE (chaque machine inscrit sa propre ligne, et c'est
// exact — une preuve ne se réécrit pas). Mais vingt postes bloqués par le même
// 404, ce sont vingt lignes identiques à la station près : le motif se noie dans
// la répétition, et un signalement qu'on ne lit plus ne signale rien.
//
// Ce que ces cas protègent, et ce qu'ils REFUSENT de faire :
//   • les rapports sont composés par le module de remontée, et lus ici — les cas
//     passent donc par le PRODUCTEUR (`blockedAuditEntry` / `journalAuditEntry`)
//     et jamais par une copie à la main du format : si le format change, le
//     lecteur casse ici au lieu de mal regrouper en silence ;
//   • « la même panne » veut dire : même code, même version VISÉE, même motif.
//     Deux causes distinctes ne se fondent pas dans un incident — c'est le
//     mauvais sens de l'erreur (une panne disparaîtrait derrière une autre) ;
//   • une entrée ILLISIBLE reste une ligne à part. On ne devine pas une panne à
//     partir d'un texte qu'on n'a pas su lire, et la fondre la ferait
//     disparaître ;
//   • le regroupement est une LECTURE : les remontées brutes restent attachées à
//     l'incident, donc rien n'est caché à l'administrateur.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { AuditLogEntry } from '../src/lib/auditLogger';
import { CONVERSION_CODE, blockedAuditEntry, journalAuditEntry } from '../src/lib/desktopUpdateReport';
import type { QueuedReport } from '../src/lib/desktopUpdateReport';
import { blockedIncidents, incidentRows, parseBlockedReport } from '../src/lib/blockedIncidents';
import { en as adminEn } from '../src/i18n/domains/adminEn';
import { fr as adminFr } from '../src/i18n/domains/adminFr';

/** Un rapport EN DIRECT, composé par le module de remontée lui-même. */
function live(station: string, at: string, options: { currentVersion?: string; version?: string; detail?: string; school?: string } = {}): AuditLogEntry {
  const entry = blockedAuditEntry(
    {
      blocked: { code: 'download', detail: options.detail ?? 'Cannot download "MamaTheraFinance-2.0.0-setup.exe", status 404', station, journal: 'C:/Users/x/update-journal.jsonl', recorded: true },
      version: options.version ?? '2.0.0',
      currentVersion: options.currentVersion ?? '1.0.5',
    },
    // `school` n'est passé que quand le cas s'en sert : un rapport sans nom
    // d'école reste celui de la majorité des cas (et c'est la forme qu'un poste
    // dont la lecture a échoué produira).
    { station, ...(options.school ? { school: options.school } : {}) },
  );
  assert.ok(entry, 'le producteur doit rendre un rapport pour un poste bloqué');
  return { id: `live-${station}-${at}`, action: entry.action, targetType: entry.targetType, targetId: entry.targetId ?? undefined, details: entry.details, createdAt: at };
}

/** Un rapport REMONTÉ DE LA FILE, composé par le module de remontée lui-même. */
function queued(station: string, at: string, options: { occurrences?: number; version?: string; currentVersion?: string; school?: string } = {}): AuditLogEntry {
  const entry: QueuedReport = {
    code: 'download',
    detail: 'Cannot download "MamaTheraFinance-2.0.0-setup.exe", status 404',
    station,
    version: options.version ?? '2.0.0',
    currentVersion: options.currentVersion ?? '1.0.4',
    at: '2026-09-12T21:00:00.000Z',
    occurrences: options.occurrences ?? 3,
  };
  const report = journalAuditEntry(entry, { station, ...(options.school ? { school: options.school } : {}) });
  assert.ok(report);
  return { id: `queued-${station}-${at}`, action: report.action, targetType: report.targetType, targetId: report.targetId ?? undefined, details: report.details, createdAt: at };
}

describe('lire un rapport de poste bloqué', () => {
  it('lit la station, les versions et le motif d’un signalement en direct', () => {
    const parsed = parseBlockedReport(live('POSTE-A', '2026-09-13T08:00:00.000Z'));
    assert.ok(parsed);
    assert.equal(parsed.code, 'download');
    assert.equal(parsed.station, 'POSTE-A');
    assert.equal(parsed.currentVersion, '1.0.5');
    assert.equal(parsed.targetVersion, '2.0.0');
    assert.match(parsed.motif, /Cannot download/);
    assert.equal(parsed.queued, false);
    assert.equal(parsed.occurrences, 1, 'un signalement en direct compte pour un');
  });

  it('le motif ne mange PAS les champs qui le suivent — journal local ni « bloqué N fois »', () => {
    const direct = parseBlockedReport(live('POSTE-A', '2026-09-13T08:00:00.000Z'));
    assert.doesNotMatch(direct?.motif ?? '', /journal local/, 'le chemin du journal est un champ, pas la fin du motif');
    const late = parseBlockedReport(queued('POSTE-B', '2026-09-13T09:00:00.000Z', { occurrences: 7 }));
    assert.equal(late?.occurrences, 7);
    assert.equal(late?.occurredAt, '2026-09-12T21:00:00.000Z');
    assert.equal(late?.queued, true);
    assert.doesNotMatch(late?.motif ?? '', /bloqué 7 fois/);
  });

  it('le nom de l’école, posé juste après la station, ne décale NI le motif NI les versions', () => {
    // Le lecteur cherche ses champs par leur PRÉFIXE (`poste `, `version `,
    // `motif : `) et borne le motif à la rencontre du premier marqueur qui le
    // suit : un champ ajouté après la station ne décale donc rien. Ce cas le
    // mesure — c'est la moitié « lecture » de l'ajout du nom d'école, l'autre
    // moitié étant la composition (`tests/gate-report.test.ts`).
    const withSchool = parseBlockedReport(live('POSTE-A', '2026-09-13T08:00:00.000Z', { school: 'Complexe Scolaire Mama Thera' }));
    const without = parseBlockedReport(live('POSTE-A', '2026-09-13T08:00:00.000Z'));
    assert.ok(withSchool && without);
    assert.equal(withSchool.station, without.station, 'la station reste la première chose lue');
    assert.equal(withSchool.currentVersion, without.currentVersion);
    assert.equal(withSchool.targetVersion, without.targetVersion);
    assert.equal(withSchool.motif, without.motif, 'le champ école ne doit pas entrer dans le motif');
    assert.doesNotMatch(withSchool.motif, /école/, 'ni être lu comme la suite du message d’erreur');

    // Le même contrôle sur une remontée TARDIVE (le champ est posé sur les deux
    // formes du fait) : ni le compte ni l'instant ne doivent en souffrir.
    const late = parseBlockedReport(queued('POSTE-B', '2026-09-13T09:00:00.000Z', { occurrences: 7, school: 'Complexe Scolaire Mama Thera' }));
    assert.equal(late?.occurrences, 7);
    assert.equal(late?.occurredAt, '2026-09-12T21:00:00.000Z');
    assert.equal(late?.queued, true);
    assert.equal(late?.station, 'POSTE-B');
  });

  it('une entrée qui n’est pas un rapport de poste, ou qu’on ne sait pas lire, n’en est pas un', () => {
    assert.equal(parseBlockedReport(null), null);
    assert.equal(parseBlockedReport({ id: 'x', action: 'RECORD_PAYMENT', details: 'paiement', createdAt: '2026-09-13T08:00:00.000Z' }), null);
    // Même action, mais un `details` d'un format inconnu (version antérieure du
    // poste, ligne retouchée à la main) : rien à regrouper.
    assert.equal(
      parseBlockedReport({ id: 'y', action: 'poste bloqué — mise à jour obligatoire (download)', targetType: 'update', details: 'un texte libre', createdAt: '2026-09-13T08:00:00.000Z' }),
      null,
    );
  });
});

describe('plusieurs postes, une panne', () => {
  it('deux postes bloqués par le même 404 sont UN incident, pas deux lignes', () => {
    const logs = [live('POSTE-A', '2026-09-13T08:00:00.000Z'), live('POSTE-B', '2026-09-13T08:30:00.000Z')];
    const incidents = blockedIncidents(logs);
    assert.equal(incidents.length, 1);
    assert.deepEqual(incidents[0].stations, ['POSTE-B', 'POSTE-A'], 'du plus récemment vu au plus ancien');
    assert.equal(incidents[0].reports.length, 2, 'les remontées brutes restent attachées à l’incident');
    assert.equal(incidents[0].occurrences, 2);
    assert.equal(incidents[0].firstAt, '2026-09-13T08:00:00.000Z');
    assert.equal(incidents[0].lastAt, '2026-09-13T08:30:00.000Z');
    assert.deepEqual(incidents[0].reports.map((r) => r.createdAt), ['2026-09-13T08:30:00.000Z', '2026-09-13T08:00:00.000Z']);
  });

  it('le nom de l’école ne fait PAS une panne à part — deux écoles bloquées par le même 404 restent un incident', () => {
    // L'école n'entre pas dans la clé de l'incident, et c'est la même décision que
    // pour la station : une panne est une CAUSE. Un 404 servi par le même canal
    // frappe les deux écoles pour la même raison, et les séparer referait, à
    // l'échelle du parc, la faute que ce module existe pour corriger — un motif
    // noyé dans des répétitions. Ce qui est par école, c'est la LIGNE (chaque
    // remontée porte la sienne), donc l'administrateur qui déplie lit qui est
    // touché, et où.
    const school = 'Complexe Scolaire Mama Thera';
    const incidents = blockedIncidents([
      live('POSTE-A', '2026-09-13T08:00:00.000Z', { school }),
      live('POSTE-B', '2026-09-13T08:30:00.000Z', { school }),
    ]);
    assert.equal(incidents.length, 1);
    assert.deepEqual(incidents[0].stations, ['POSTE-B', 'POSTE-A'], 'les deux machines de l’école sont nommées');
    assert.match(incidents[0].reports[0].details ?? '', /école Complexe Scolaire Mama Thera/);
  });

  it('un signalement en direct et une remontée tardive de la MÊME panne se rejoignent', () => {
    const incidents = blockedIncidents([live('POSTE-A', '2026-09-13T08:00:00.000Z'), queued('POSTE-C', '2026-09-13T09:00:00.000Z', { occurrences: 40 })]);
    assert.equal(incidents.length, 1, 'le canal d’arrivée ne fait pas une panne différente');
    assert.equal(incidents[0].occurrences, 41, '« bloqué 40 fois » ne se lit pas « une fois »');
    assert.deepEqual(incidents[0].stations, ['POSTE-C', 'POSTE-A']);
  });

  it('des postes à des versions INSTALLÉES différentes restent le même incident', () => {
    // Une même panne frappe naturellement un parc dont les postes ne sont pas
    // tous au même numéro : c’est une panne, pas deux.
    const incidents = blockedIncidents([
      live('POSTE-A', '2026-09-13T08:00:00.000Z', { currentVersion: '1.0.3' }),
      live('POSTE-B', '2026-09-13T08:10:00.000Z', { currentVersion: '1.0.4' }),
    ]);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].stations.length, 2);
  });

  it('deux CAUSES différentes ne se fondent pas, même code et même version', () => {
    const incidents = blockedIncidents([
      live('POSTE-A', '2026-09-13T08:00:00.000Z', { detail: 'Cannot download "x-setup.exe", status 404' }),
      live('POSTE-B', '2026-09-13T08:05:00.000Z', { detail: 'net::ERR_NAME_NOT_RESOLVED' }),
    ]);
    assert.equal(incidents.length, 2, 'fusionner deux causes ferait disparaître l’une derrière l’autre');
    assert.equal(incidents[0].stations.length, 1);
  });

  it('une panne sur une version PLUS RÉCENTE est une information neuve, donc un incident', () => {
    const incidents = blockedIncidents([
      live('POSTE-A', '2026-09-13T08:00:00.000Z', { version: '2.0.0' }),
      live('POSTE-A', '2026-09-13T19:00:00.000Z', { version: '2.0.1' }),
    ]);
    assert.equal(incidents.length, 2);
    assert.equal(incidents[0].targetVersion, '2.0.1', 'le plus récent en tête');
  });

  it('la casse et les espaces d’un même message ne font pas deux incidents', () => {
    const incidents = blockedIncidents([
      live('POSTE-A', '2026-09-13T08:00:00.000Z', { detail: 'Cannot download  "x-setup.exe",   status 404' }),
      live('POSTE-B', '2026-09-13T08:05:00.000Z', { detail: 'cannot download "x-setup.exe", status 404' }),
    ]);
    assert.equal(incidents.length, 1);
  });
});

describe('une CONVERSION traverse le même canal sans devenir une panne', () => {
  /** Une remontée de conversion, composée par le PRODUCTEUR — jamais recopiée. */
  const converted = (station: string, at: string): AuditLogEntry => {
    const report = journalAuditEntry(
      {
        code: CONVERSION_CODE,
        detail: "l'installateur annoncé a été exécuté en silencieux",
        station,
        version: '1.0.39',
        currentVersion: '1.0.38',
        at: '2026-10-16T09:00:00.000Z',
      },
      { station },
    );
    assert.ok(report);
    return {
      id: `converted-${station}`,
      action: report.action,
      targetType: report.targetType,
      targetId: report.targetId ?? undefined,
      details: report.details,
      createdAt: at,
    };
  };

  it('elle n’entre dans AUCUN incident, et n’en fabrique pas', () => {
    const conversion = converted('POSTE-A', '2026-10-16T09:00:00.000Z');
    assert.equal(parseBlockedReport(conversion), null, 'ce n’est pas un rapport de poste bloqué');
    assert.equal(blockedIncidents([conversion]).length, 0, 'une conversion n’est pas une panne');
    // Et elle ne rejoint pas l'incident d'un poste VRAIMENT bloqué : la fondre
    // dans les lignes de panne ferait lire le basculement comme un échec — et
    // l'agréger à un incident ferait disparaître la panne derrière la bonne
    // nouvelle, qui est le mauvais sens de l'erreur.
    const rows = incidentRows([live('POSTE-A', '2026-10-16T09:30:00.000Z'), conversion]);
    assert.equal(rows.filter((row) => row.kind === 'incident').length, 1);
    assert.equal(rows.filter((row) => row.kind === 'log').length, 1, 'la conversion reste une ligne à part, lisible telle quelle');
    const only = rows.find((row) => row.kind === 'log');
    assert.ok(only && only.kind === 'log' && /converti en poste installé/.test(only.log.action));
  });

  it('elle NOMME le poste : la seule réponse que la machine puisse donner', () => {
    const rows = incidentRows([converted('POSTE-DIRECTION', '2026-10-16T09:00:00.000Z')]);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.kind, 'log');
    assert.ok(row.kind === 'log');
    assert.match(row.log.details ?? '', /poste POSTE-DIRECTION/);
    assert.match(row.log.details ?? '', /version 1\.0\.38 → 1\.0\.39/);
  });
});

describe('les lignes de la vue', () => {
  it('un incident remplace les lignes de SES postes, et prend la place de la plus récente', () => {
    const rows = incidentRows([
      live('POSTE-A', '2026-09-13T08:00:00.000Z'),
      live('POSTE-B', '2026-09-13T08:30:00.000Z'),
      { id: 'pay-1', action: 'RECORD_PAYMENT', details: 'paiement', createdAt: '2026-09-13T08:15:00.000Z', userName: 'Awa', userRole: 'admin' },
    ]);
    assert.equal(rows.length, 2, 'un incident + le paiement');
    assert.equal(rows[0].kind, 'incident');
    assert.equal(rows[0].at, '2026-09-13T08:30:00.000Z');
    assert.equal(rows[1].kind, 'log');
  });

  it('désactivé, le regroupement rend les lignes brutes : rien n’est perdu', () => {
    const logs = [live('POSTE-A', '2026-09-13T08:00:00.000Z'), live('POSTE-B', '2026-09-13T08:30:00.000Z')];
    // La vue dépliée EST la liste filtrée d'origine — c'est ce que la
    // désactivation du regroupement doit redonner, à l'ordre près.
    const rows = incidentRows(logs);
    assert.equal(rows.length, 1);
    assert.equal(logs.length, 2, 'les deux remontées brutes existent toujours dans le journal');
    const only = rows[0];
    assert.equal(only.kind, 'incident');
    assert.ok(only.kind === 'incident' && only.incident.reports.length === 2, 'l’incident les porte, donc la vue dépliée les retrouve');
  });

  it('une entrée illisible reste une ligne à part — jamais fondue par défaut', () => {
    const rows = incidentRows([
      live('POSTE-A', '2026-09-13T08:00:00.000Z'),
      { id: 'legacy', action: 'poste bloqué — mise à jour obligatoire (download)', targetType: 'update', details: 'ancien format', createdAt: '2026-09-13T08:20:00.000Z' },
    ]);
    assert.equal(rows.filter((r) => r.kind === 'incident').length, 1);
    assert.equal(rows.filter((r) => r.kind === 'log').length, 1);
    assert.equal(blockedIncidents([{ id: 'legacy', action: 'poste bloqué — mise à jour obligatoire (download)', targetType: 'update', details: 'ancien format', createdAt: '2026-09-13T08:20:00.000Z' }]).length, 0);
  });
});

describe('le câblage de la vue administrateur', () => {
  // Ce que la vue FAIT se prouve dans tests/views-render.test.tsx, sur la vue
  // rendue avec de vrais rapports : une ligne par panne, remontées repliées puis
  // dépliées, et un CSV qui suit la vue (regroupé / dégroupé). Deux assertions
  // par expression régulière sur AuditView.tsx vivaient ici : elles restaient
  // vertes si la vue n’affichait plus rien, donc elles ne prouvaient rien.
  it('les libellés existent dans les deux langues, avec leurs jetons', () => {
    const keys = [
      'auditFilterGroupIncidents',
      'auditIncidentAction',
      'auditIncidentMotif',
      'auditIncidentStations',
      'auditIncidentCount',
      'auditIncidentOccurrences',
      'auditIncidentSpan',
      'auditIncidentMore',
      'auditIncidentShow',
      'auditIncidentHide',
    ] as const;
    for (const key of keys) {
      assert.equal(typeof adminEn[key], 'string', `${key} manque en anglais`);
      assert.equal(typeof adminFr[key], 'string', `${key} manque en français`);
      assert.ok(adminEn[key].length > 0 && adminFr[key].length > 0, `${key} ne peut pas être vide`);
    }
    for (const key of ['auditIncidentCount', 'auditIncidentOccurrences', 'auditIncidentMore'] as const) {
      assert.match(adminFr[key], /\{count\}/);
      assert.match(adminEn[key], /\{count\}/);
    }
    assert.match(adminFr.auditIncidentSpan, /\{from\}/);
    assert.match(adminFr.auditIncidentSpan, /\{to\}/);
    assert.match(adminFr.auditIncidentAction, /\{code\}/);
    assert.match(adminEn.auditIncidentAction, /\{code\}/);
  });
});
