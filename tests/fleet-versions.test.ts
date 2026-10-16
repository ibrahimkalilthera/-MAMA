// Suite du relevé du parc — `scripts/fleet-versions.mjs` (§7 du canal de mise à
// jour, `docs/CANAL_MISE_A_JOUR.md`).
//
// POURQUOI CETTE SUITE EXISTE
// ---------------------------
// Le relevé du parc est la seule chose qui puisse répondre à « toutes les
// stations sont passées » autrement qu'en le prouvant poste par poste. Ses deux
// moitiés qui ÉCRIVENT étaient déjà éprouvées (`station-beat.test.ts`,
// `station-version.test.ts`) ; celle qui LIT ne l'était pas — et c'est celle
// dont un humain tire une conclusion sur son parc.
//
// Ce qui est verrouillé ici n'est donc pas sa couleur du jour (au moment où
// cette suite est écrite, le relevé rend zéro poste : le battement vient d'être
// livré) mais les quatre propriétés qui font qu'un relevé est utilisable :
//
//   • **un drapeau inconnu est un REFUS** — `--silence-days` (au lieu de
//     `--silent-days`) serait ignoré par un lecteur permissif, et le relevé
//     sortirait avec le seuil par défaut en croyant avoir appliqué celui qu'on
//     lui a donné : un vert inexplicable ;
//   • **l'ordre des versions est NUMÉRIQUE** — `1.0.9` avant `1.0.10` serait un
//     ordre de chaîne, donc un ordre faux, sur la ligne même qu'on lit pour
//     savoir qui est en retard ;
//   • **un état inconnu est COMPTÉ, jamais fondu dans « ok »** — un poste qui
//     bat avec un contrôle qui a échoué ne doit pas grossir la part des postes
//     sains ;
//   • **le silence se mesure sur `seen_at`**, et un poste qu'on n'a pas su juger
//     (horodatage illisible) est NOMMÉ au lieu de disparaître du relevé.
//
// Et un cinquième, qui est le contrat du volume : au-delà de `--max-rows` le
// relevé ÉCHOUE, parce que la clé publique peut appeler le geste d'écriture et
// qu'un relevé vert sur une table qui s'emballe masquerait exactement ce qu'on
// lui demande de voir.
//
// Et les deux lectures ajoutées le 2026-10-21 — la FORME de chaque poste et la
// trace des conversions portable → installé — sont éprouvées ici pour la même
// raison : c'est ce qu'un humain lira pour savoir si les postes d'école qu'il
// faut convertir à la main le sont encore, et une répartition qui fondrait
// « pas mesurée » dans « installée » lui dirait le contraire de ce qu'elle a lu.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_MAX_ROWS,
  DEFAULT_SILENT_DAYS,
  STATION_INSTALL_MODE_MIGRATION,
  USAGE,
  censusEvidence,
  censusReport,
  checkStateBreakdown,
  convertedStations,
  firstConversion,
  installModeBreakdown,
  parseFlags,
  readRefusalMessage,
  silentStations,
  versionDistribution,
  volumeVerdict,
} from '../scripts/fleet-versions.mjs';

const DAY_MS = 86_400_000;
/** Un instant fixe : le relevé ne doit pas dépendre de l'horloge du jour. */
const NOW = Date.parse('2026-10-15T12:00:00Z');

const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

const station = (over: Record<string, unknown> = {}) => ({
  station_id: 'st_0123456789abcdef',
  app_version: '1.0.34',
  os_version: '10',
  last_check: 'ok',
  last_check_version: '1.0.34',
  seen_at: daysAgo(0),
  // La forme est un fait distinct de la version : un poste installé et un poste
  // portable peuvent exécuter la MÊME version, et c'est justement ce que ce
  // relevé doit savoir dire.
  install_mode: 'installed',
  converted_at: null,
  converted_to_version: null,
  ...over,
});

describe('fleet:versions — les drapeaux', () => {
  it('applique les seuils demandés', () => {
    const flags = parseFlags(['--silent-days=14', '--max-rows=500']);
    assert.deepEqual(flags.problems, []);
    assert.equal(flags.silentDays, 14);
    assert.equal(flags.maxRows, 500);
  });

  it('REFUSE un drapeau inconnu au lieu d’appliquer le défaut en silence', () => {
    // Le piège nommé : `--silence-days` (au lieu de `--silent-days`) serait
    // silencieusement ignoré par un lecteur permissif, et le relevé sortirait
    // avec le seuil par défaut en croyant avoir appliqué celui qu'on lui a donné.
    const flags = parseFlags(['--silence-days=3']);
    assert.equal(flags.problems.length, 1);
    assert.match(flags.problems[0]!, /drapeau inconnu/);
    assert.equal(flags.silentDays, DEFAULT_SILENT_DAYS, 'le seuil par défaut ne doit pas passer pour un seuil appliqué');
  });

  it('REFUSE un seuil qui n’est pas un entier ≥ 1', () => {
    for (const bad of ['--silent-days=0', '--max-rows=-4']) {
      const flags = parseFlags([bad]);
      assert.equal(flags.problems.length, 1, bad);
      assert.match(flags.problems[0]!, /entier ≥ 1/);
      assert.equal(flags.maxRows, DEFAULT_MAX_ROWS);
    }
  });

  it('REFUSE aussi une valeur non numérique, en nommant le jeton fautif', () => {
    // `--silent-days=abc` ne se lit pas comme un drapeau appliqué : le refus est
    // bruyant et cite le jeton exact, donc l'utilisateur sait QUOI corriger. Le
    // contrat qui compte ici est le refus, pas le libellé qui le décrit.
    const flags = parseFlags(['--silent-days=abc']);
    assert.equal(flags.problems.length, 1);
    assert.match(flags.problems[0]!, /--silent-days=abc/);
    assert.equal(flags.silentDays, DEFAULT_SILENT_DAYS);
  });

  it('reconnaît --help sans rien refuser', () => {
    assert.equal(parseFlags(['--help']).help, true);
    assert.equal(parseFlags(['-h']).help, true);
    assert.match(USAGE, /--silent-days=N/);
  });
});

describe('fleet:versions — la répartition par version', () => {
  it('trie par NOMBRE, puis par version en comparaison NUMÉRIQUE', () => {
    const rows = [
      station({ app_version: '1.0.9' }),
      station({ app_version: '1.0.10' }),
      station({ app_version: '1.0.10' }),
    ];
    const distribution = versionDistribution(rows);
    assert.deepEqual(
      distribution.map((entry: { version: string }) => entry.version),
      ['1.0.10', '1.0.9'],
    );
    assert.equal(distribution[0]!.count, 2);
    assert.ok(Math.abs(distribution[0]!.share - 2 / 3) < 1e-9);
  });

  it('départage deux versions à égalité de postes : la plus récente d’abord', () => {
    // `1.0.9` avant `1.0.10` serait un ordre de chaîne, donc un ordre faux.
    const distribution = versionDistribution([
      station({ app_version: '1.0.9' }),
      station({ app_version: '1.0.10' }),
    ]);
    assert.equal(distribution[0]!.version, '1.0.10');
  });

  it('nomme une version illisible au lieu de la fondre dans une autre', () => {
    const distribution = versionDistribution([station({ app_version: '' })]);
    assert.equal(distribution[0]!.version, '(version illisible)');
  });
});

describe('fleet:versions — le dernier contrôle', () => {
  it('liste les quatre états connus, même à zéro', () => {
    const breakdown = checkStateBreakdown([]);
    assert.deepEqual(
      breakdown.map((entry: { state: string }) => entry.state),
      ['ok', 'feed-absent', 'html', 'unreachable'],
    );
    assert.ok(breakdown.every((entry: { count: number }) => entry.count === 0));
  });

  it('COMPTE un état inconnu, et ne le fond jamais dans « ok »', () => {
    const breakdown = checkStateBreakdown([station({ last_check: 'bidon' }), station()]);
    const ok = breakdown.find((entry: { state: string }) => entry.state === 'ok');
    const unknown = breakdown.find((entry: { state: string }) => entry.state === 'bidon');
    assert.equal(ok!.count, 1, 'un état inconnu ne doit pas grossir la part des postes sains');
    assert.equal(unknown!.count, 1);
  });
});

describe('fleet:versions — les postes silencieux', () => {
  it('mesure le silence sur `seen_at`, jamais sur la version', () => {
    const rows = [
      station({ station_id: 'st_aaaa000000000000', seen_at: daysAgo(10) }),
      station({ station_id: 'st_bbbb000000000000', seen_at: daysAgo(1) }),
    ];
    const silent = silentStations(rows, { silentDays: DEFAULT_SILENT_DAYS, nowMs: NOW });
    assert.equal(silent.length, 1, 'un poste à la bonne version mais muet depuis 10 jours est SILENCIEUX');
    assert.equal(silent[0]!.stationId, 'st_aaaa000000000000');
    assert.ok(Math.abs((silent[0]!.days ?? 0) - 10) < 0.01);
  });

  it('NOMME un poste dont l’horodatage est illisible au lieu de le laisser disparaître', () => {
    const silent = silentStations([station({ station_id: 'st_cccc000000000000', seen_at: 'pas-une-date' })], {
      silentDays: 7,
      nowMs: NOW,
    });
    assert.equal(silent.length, 1);
    assert.equal(silent[0]!.stationId, 'st_cccc000000000000');
    assert.equal(silent[0]!.days, null, 'un silence inconnu n’est pas une durée');
    assert.match(String(silent[0]!.note), /horodatage illisible/);
  });

  it('trie du plus silencieux au plus récent, et ne perd pas un identifiant illisible', () => {
    const silent = silentStations(
      [
        station({ station_id: 'st_dddd000000000000', seen_at: daysAgo(3) }),
        station({ station_id: '', seen_at: daysAgo(30) }),
      ],
      { silentDays: 1, nowMs: NOW },
    );
    assert.equal(silent.length, 2);
    assert.equal(silent[0]!.stationId, '(identifiant illisible)');
  });
});

describe('fleet:versions — le seuil de volume', () => {
  it('refuse au-delà du seuil, en nommant le compte et le seuil', () => {
    const verdict = volumeVerdict({ total: 201, maxRows: 200 });
    assert.equal(verdict.ok, false);
    assert.match(String(verdict.problem), /201/);
    assert.match(String(verdict.problem), /200/);
  });

  it('accepte exactement au seuil', () => {
    assert.equal(volumeVerdict({ total: 200, maxRows: 200 }).ok, true);
  });
});

describe('fleet:versions — le relevé écrit', () => {
  it('dit qu’un parc vide est un FAIT, pas un feu vert', () => {
    const report = censusReport({ rows: [], total: 0, nowMs: NOW });
    assert.match(report, /aucun poste recensé/);
    assert.match(report, /pas un feu vert/);
  });

  it('dit ce qu’il ne peut PAS voir, à chaque exécution', () => {
    const report = censusReport({ rows: [], total: 0, nowMs: NOW });
    assert.match(report, /JAMAIS battu est invisible/);
    assert.match(report, /Seuil de volume : 200 ligne\(s\)\./);
  });

  it('ne compte PAS un poste silencieux comme à jour', () => {
    const report = censusReport({
      rows: [station({ station_id: 'st_eeee000000000000', seen_at: daysAgo(9) })],
      total: 1,
      silentDays: 7,
      nowMs: NOW,
    });
    assert.match(report, /postes SILENCIEUX/);
    assert.match(report, /ne PAS compter comme à jour/);
    assert.match(report, /st_eeee000000000000/);
  });

  it('un parc VIDE publie une preuve SANS `count` — le contrat refuse `--acted --count 0`', () => {
    // Le défaut réellement payé le jour où la veille a été branchée : le relevé
    // publiait `--acted --count 0`, que le contrat REFUSE (« une preuve qui
    // déclare avoir agi sur zéro chose se contredit elle-même ») — le script
    // sortait donc en 2, en rouge, sur un parc vide qui est pourtant une issue
    // NORMALE (le battement vient d'être livré). Le zéro ne disparaît pas : il
    // est dans la raison.
    const evidence = censusEvidence({ total: 0, projectRef: 'rpcjdohfxwukbqngbprw' });
    assert.equal(evidence.acted, true);
    assert.equal(evidence.count, null, 'compter zéro serait une preuve qui se contredit');
    assert.match(evidence.reason, /0 poste\(s\) recensé\(s\)/);
  });

  it('nomme le compte, les silencieux et le débordement de volume quand il y en a', () => {
    const evidence = censusEvidence({
      total: 3,
      silent: [{}, {}],
      failing: 1,
      silentDays: 7,
      maxRows: 200,
      volumeOk: false,
    });
    assert.equal(evidence.count, 3);
    assert.match(evidence.reason, /3 poste\(s\) recensé\(s\)/);
    assert.match(evidence.reason, /2 silencieux depuis 7 jour\(s\)/);
    assert.match(evidence.reason, /1 dont le dernier contrôle n’a pas abouti/);
    assert.match(evidence.reason, /VOLUME au-delà du seuil de 200 ligne\(s\)/);
  });

  it('nomme un poste qui bat mais dont le dernier contrôle a échoué', () => {
    const report = censusReport({
      rows: [station({ last_check: 'html' })],
      total: 1,
      nowMs: NOW,
    });
    assert.match(report, /l’origine a répondu du HTML/);
    assert.match(report, /1 poste\(s\) battent mais leur dernier contrôle n’a PAS abouti/);
  });

  it('nomme les conversions OBSERVÉES dans la preuve, et se tait quand il n’y en a aucune', () => {
    // Une preuve qui déclarerait « 0 conversion » à chaque exécution ferait du
    // zéro une information qu'il n'est pas. Ce qui compte est l'autre sens : le
    // jour où un poste d'école bascule, la veille quotidienne le dit.
    const none = censusEvidence({ total: 1, conversions: [] });
    assert.doesNotMatch(none.reason, /conversion/);
    const some = censusEvidence({
      total: 2,
      conversions: [{ stationId: 'st_aaaa000000000000', convertedToVersion: '1.0.38' }],
    });
    assert.match(some.reason, /1 conversion\(s\) portable → installé observée\(s\)/);
    assert.match(some.reason, /st_aaaa000000000000 → 1\.0\.38/);
  });

  it('ANNONCE la première conversion dans la preuve, avec sa date — pas seulement un compte', () => {
    // Une liste de conversions dans un journal de CI, personne ne la lit ;
    // l'annonce, si : c'est le fait que cette veille existe pour publier.
    const evidence = censusEvidence({
      total: 2,
      conversions: [{ stationId: 'st_later', convertedToVersion: '1.0.39' }],
      first: { stationId: 'st_first', convertedToVersion: '1.0.38', convertedAt: '2026-10-16T05:12:00.000Z' },
    });
    assert.match(evidence.reason, /1ʳᵉ conversion portable → installé observée le 2026-10-16T05:12:00\.000Z/);
    assert.match(evidence.reason, /st_first → 1\.0\.38/);
  });

  it('ne dit rien d’une « première » quand il n’y en a pas — et jamais un zéro inventé', () => {
    const none = censusEvidence({ total: 1, conversions: [], first: null });
    assert.doesNotMatch(none.reason, /1ʳᵉ conversion/);
  });
});

describe('fleet:versions — la forme du poste', () => {
  it('compte chaque forme, et ne fond JAMAIS « non mesurée » dans « installée »', () => {
    const { modes, unmeasured } = installModeBreakdown([
      station({ install_mode: 'installed' }),
      station({ install_mode: 'installed' }),
      station({ install_mode: 'portable' }),
      station({ install_mode: null }),
      station({ install_mode: 'zombie' }),
    ]);
    const count = (mode: string) => modes.find((entry: { mode: string }) => entry.mode === mode)!.count;
    assert.equal(count('installed'), 2);
    assert.equal(count('portable'), 1);
    assert.equal(count('zombie'), 1, 'une forme inconnue est comptée, jamais blanchie');
    assert.equal(unmeasured, 1, 'un poste qui ne dit rien de sa forme n’est pas un poste installé');
  });

  it('nomme ce qu’un poste PORTABLE implique, au lieu de le laisser deviner', () => {
    const report = censusReport({
      rows: [station({ install_mode: 'portable' }), station({ install_mode: null })],
      total: 2,
      nowMs: NOW,
    });
    assert.match(report, /forme des postes/);
    assert.match(report, /ENCORE portable/);
    assert.match(report, /ne se corrige PAS à distance/);
    assert.match(report, /non mesurée/);
  });
});

describe('fleet:versions — les conversions portable → installé', () => {
  it('ne retient QUE ce que la base a daté : un poste installé depuis toujours n’est pas converti', () => {
    const converted = convertedStations([
      station({ station_id: 'st_aaaa000000000000', install_mode: 'installed', converted_at: null }),
      station({
        station_id: 'st_bbbb000000000000',
        install_mode: 'installed',
        converted_at: '2026-10-16T05:00:00.000Z',
        converted_to_version: '1.0.38',
      }),
    ]);
    assert.equal(converted.length, 1, 'on ne compte pas comme converti ce qu’on n’a jamais vu portable');
    assert.equal(converted[0]!.stationId, 'st_bbbb000000000000');
    assert.equal(converted[0]!.convertedToVersion, '1.0.38');
    assert.equal(converted[0]!.backToPortable, false);
  });

  it('trie la plus récente d’abord, et nomme un poste relancé en portable SANS perdre la trace', () => {
    const converted = convertedStations([
      station({ station_id: 'st_older', converted_at: '2026-10-02T08:00:00.000Z', converted_to_version: '1.0.36' }),
      station({ station_id: 'st_newer', converted_at: '2026-10-16T05:00:00.000Z', converted_to_version: '1.0.38' }),
      station({ station_id: 'st_back', install_mode: 'portable', converted_at: '2026-10-10T08:00:00.000Z' }),
    ]);
    assert.deepEqual(
      converted.map((entry: { stationId: string }) => entry.stationId),
      ['st_newer', 'st_back', 'st_older'],
    );
    assert.equal(converted[1]!.backToPortable, true, 'relancer l’exe portable n’efface pas le fait daté');
  });

  it('le relevé écrit nomme la date et la version DU PASSAGE, pas celle du jour', () => {
    const report = censusReport({
      rows: [
        station({
          station_id: 'st_cccc000000000000',
          app_version: '1.0.39',
          install_mode: 'installed',
          converted_at: '2026-10-15T09:00:00.000Z',
          converted_to_version: '1.0.38',
        }),
      ],
      total: 1,
      nowMs: NOW,
    });
    assert.match(report, /conversions portable → installé OBSERVÉES/);
    assert.match(report, /st_cccc000000000000/);
    assert.match(report, /2026-10-15T09:00:00\.000Z/);
    assert.match(report, /→  1\.0\.38/);
    assert.match(report, /fait DATÉ par la base/);
  });

  it('un zéro de conversion DIT ce qu’il ne peut pas couvrir, au lieu de laisser croire à rien', () => {
    const report = censusReport({ rows: [station()], total: 1, nowMs: NOW });
    assert.match(report, /aucune conversion observée/);
    assert.match(report, /AVANT l’arrivée de cette trace/);
    assert.match(report, /une installation manuelle, une fois/);
  });

  it('LA PREMIÈRE conversion est celle qui a eu lieu en premier, pas la plus récente', () => {
    const first = firstConversion([
      station({ station_id: 'st_recent', converted_at: '2026-10-16T05:00:00.000Z', converted_to_version: '1.0.39' }),
      station({ station_id: 'st_premier', converted_at: '2026-10-02T08:00:00.000Z', converted_to_version: '1.0.38' }),
      station({ station_id: 'st_aucune' }),
    ]);
    assert.equal(first?.stationId, 'st_premier');
    assert.equal(first?.convertedToVersion, '1.0.38');
    assert.equal(firstConversion([station()]), null, 'un poste installé depuis toujours ne fait pas une « première »');
  });

  it('un horodatage ILLISIBLE ne prend pas le titre de « première », et l’égalité se départage', () => {
    // Nommer « première » une ligne dont on ignore la date serait annoncer un
    // fait qu'on n'a pas lu ; à égalité d'instant, le plus petit identifiant
    // gagne, pour qu'un relevé relu deux fois dise la même chose.
    const withUnreadable = firstConversion([
      station({ station_id: 'st_illisible', converted_at: 'pas-une-date' }),
      station({ station_id: 'st_lisible', converted_at: '2026-10-16T05:00:00.000Z' }),
    ]);
    assert.equal(withUnreadable?.stationId, 'st_lisible');
    const onlyUnreadable = firstConversion([station({ station_id: 'st_illisible', converted_at: 'pas-une-date' })]);
    assert.equal(onlyUnreadable, null, 'aucune date lisible = aucune « première » à annoncer');
    const tie = firstConversion([
      station({ station_id: 'st_zzz', converted_at: '2026-10-16T05:00:00.000Z' }),
      station({ station_id: 'st_aaa', converted_at: '2026-10-16T05:00:00.000Z' }),
    ]);
    assert.equal(tie?.stationId, 'st_aaa');
  });

  it('le relevé ANNONCE la première conversion en tête, avant toute liste', () => {
    const report = censusReport({
      rows: [
        station({
          station_id: 'st_premier',
          install_mode: 'installed',
          converted_at: '2026-10-02T08:00:00.000Z',
          converted_to_version: '1.0.38',
        }),
        station({ station_id: 'st_recent', converted_at: '2026-10-16T05:00:00.000Z', converted_to_version: '1.0.39' }),
      ],
      total: 2,
      nowMs: NOW,
    });
    const announcement = report.split('\n').findIndex((line: string) => line.includes('🔔 PREMIÈRE conversion'));
    const list = report.split('\n').findIndex((line: string) => line.includes('── conversions portable → installé OBSERVÉES'));
    assert.ok(announcement >= 0, 'la première conversion est annoncée');
    assert.ok(list > 0 && announcement < list, 'et elle l’est AVANT la liste : une liste se lit quand on la cherche');
    assert.match(report, /observée le 2026-10-02T08:00:00\.000Z/);
    assert.match(report, /poste st_premier — version du passage 1\.0\.38/);
    assert.match(report, /n’a plus besoin d’une installation manuelle/);
    assert.match(report, /ne porte AUCUN nom d’école/, 'et l’annonce dit ce qu’elle ne peut PAS nommer');
  });

  it('l’annonce dit aussi son ABSENCE, et distingue « rien » de « rien de lisible »', () => {
    const empty = censusReport({ rows: [station({ install_mode: 'portable' })], total: 1, nowMs: NOW });
    assert.match(empty, /🔔 aucune conversion portable → installé observée à ce jour/);
    assert.match(empty, /aucun poste ne bat encore|Aucun poste portable n’a encore basculé/);
    const unreadable = censusReport({
      rows: [station({ converted_at: 'pas-une-date', converted_to_version: '1.0.38' })],
      total: 1,
      nowMs: NOW,
    });
    assert.match(unreadable, /des conversions sont inscrites mais AUCUNE n’a de date lisible/);
  });
});

describe('fleet:versions — le refus de lecture, et son remède', () => {
  it('un refus qui ne parle pas d’une colonne manquante reste un refus NU', () => {
    const message = readRefusalMessage({ status: 401, body: '{"message":"Invalid API key"}' });
    assert.equal(message, 'la base a répondu HTTP 401 — {"message":"Invalid API key"}');
    assert.doesNotMatch(message, /EN RETARD/);
  });

  it('une base en RETARD est nommée AVEC la migration à appliquer', () => {
    // C'est le cas réel : la forme du poste arrive dans le code avant la base
    // (les migrations s'appliquent à la main), et PostgREST refuse alors TOUTE la
    // lecture. Un « HTTP 400 » nu enverrait chercher la panne du côté du lecteur.
    const message = readRefusalMessage({
      status: 400,
      body: '{"code":"42703","message":"column station_versions.install_mode does not exist"}',
    });
    assert.match(message, /HTTP 400/);
    assert.match(message, /EN RETARD/);
    assert.ok(message.includes(STATION_INSTALL_MODE_MIGRATION), 'la migration est nommée, pas sous-entendue');
    assert.match(message, /install_mode/);
    assert.match(message, /npm run db:apply/);
  });
});
