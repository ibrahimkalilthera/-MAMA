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
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_MAX_ROWS,
  DEFAULT_SILENT_DAYS,
  USAGE,
  censusEvidence,
  censusReport,
  checkStateBreakdown,
  parseFlags,
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
});
