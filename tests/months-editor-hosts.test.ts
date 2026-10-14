/**
 * ─── LE VERROU : TOUTE PORTE VERS L'ÉDITEUR DES MOIS DÉCLARE SON HÔTE ───────
 *
 * L'application n'a qu'UNE UI de mois (`PaymentMonthsEditor`), mais plusieurs
 * portes l'ouvrent : le carnet des paiements d'une fiche, le parcours de
 * rattrapage de la même fiche, la passe groupée de l'écran École, et le parcours
 * élève par élève du même écran. Les DEUX ÉCRANS en portent donc deux chacun :
 * sans arbitrage, le même reçu afficherait deux éditeurs (vingt-quatre pastilles
 * au lieu de douze), et le `waitForSelector` du pixel-check ne saurait plus lequel
 * il juge — c'est écrit noir sur blanc dans `StudentDetailsModal` et dans
 * `SilentReceiptsView` (`editorHost`, des deux côtés).
 *
 * Ce que la suite verrouille, et pourquoi elle est ÉCRITE ainsi :
 *
 *   • l'inventaire vit dans `tests/months-editor-hosts.ts` (`MONTHS_EDITOR_DOORS`)
 *     et il est confronté à l'ARBRE RÉEL : tout fichier qui rend
 *     `<PaymentMonthsEditor` sans s'y déclarer fait rougir le verrou. C'est la
 *     demande, prise au mot : un TROISIÈME point d'entrée ne peut pas apparaître
 *     en silence, il doit nommer son hôte — et, si son écran en porte déjà une
 *     autre, apporter un jeton neuf ET l'ajouter à l'ensemble des hôtes déclaré
 *     par la fiche ;
 *   • chaque règle est ÉPROUVÉE PAR UNE MUTATION du corpus réel, jamais par un
 *     corpus de jouet : une règle qu'aucune mutation ne fait rougir ne garde
 *     rien (la « preuve de vie » du dépôt) ;
 *   • la PROSE ne compte pas : une porte racontée dans un commentaire, ou un
 *     montage cité dans un commentaire, ne prouve rien ;
 *   • un corpus VIDE ne conclut pas vert : un scan qui n'a rien lu ne peut pas
 *     dire qu'il n'y a pas de porte.
 *
 * Aucun DOM, aucun montage : le verrou juge des SOURCES, comme `write-gates`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listFiles } from '../scripts/lib/source-text.mjs';
import {
  MONTHS_EDITOR,
  MONTHS_EDITOR_DOORS,
  MONTHS_EDITOR_SCREENS,
  doorsIn,
  judgeMonthsEditorHosts,
  type MonthsEditorDoor,
  type MonthsEditorSource,
} from './months-editor-hosts';

const ROOT = join(import.meta.dirname, '..').replace(/\\/g, '/');

/** Le corpus RÉEL : les composants de `src/`, nommés comme l'inventaire les nomme. */
function realCorpus(): MonthsEditorSource[] {
  return listFiles(join(ROOT, 'src'), { ext: /\.tsx$/ }).map((file) => ({
    file: file.startsWith(`${ROOT}/`) ? file.slice(ROOT.length + 1) : file,
    text: readFileSync(file, 'utf8'),
  }));
}

const judge = (sources: readonly MonthsEditorSource[], doors = MONTHS_EDITOR_DOORS) =>
  judgeMonthsEditorHosts({ doors, screens: MONTHS_EDITOR_SCREENS, sources });

/** L'écart visé, par son code — un écart se lit sans décodeur. */
const named = (problems: readonly string[], code: string) =>
  problems.filter((problem) => problem.startsWith(code));

/** Le corpus réel avec un fichier remplacé, ou ajouté s'il n'y était pas. */
const withText = (
  sources: readonly MonthsEditorSource[],
  file: string,
  text: string,
): MonthsEditorSource[] => [
  ...sources.filter((source) => source.file !== file),
  { file, text },
];

/** Une mutation qui DOIT s'appliquer : sinon le cas suivant ne prouverait rien. */
const mutated = (
  sources: readonly MonthsEditorSource[],
  file: string,
  from: string,
  to: string,
): MonthsEditorSource[] => {
  const target = sources.find((source) => source.file === file);
  assert.ok(target, `le corpus doit contenir ${file}`);
  const text = target.text.replace(from, to);
  assert.ok(text !== target.text, `la mutation doit s’appliquer : « ${from} » dans ${file}`);
  return withText(sources, file, text);
};

const NEW_DOOR = 'src/components/NewMonthsDoor.tsx';
const NEW_DOOR_TEXT = `export const NewMonthsDoor = () => (<PaymentMonthsEditor\n  yearMonths={yearMonths} />);\n`;

// ─── L'arbre réel ───────────────────────────────────────────────────────────

describe('les portes de l’éditeur des mois — l’arbre réel', () => {
  it('ne rend AUCUN écart : chaque porte déclare un hôte qui la monte vraiment', () => {
    const { problems } = judge(realCorpus());
    assert.deepEqual(problems, [], `le verrou doit être vert sur l’arbre réel :\n   • ${problems.join('\n   • ')}`);
  });

  it('déclare CHAQUE fichier qui rend l’éditeur — ni oubli, ni entrée périmée', () => {
    const sources = realCorpus();
    const rendered = doorsIn(sources).map((entry) => entry.file);
    const declared = [...MONTHS_EDITOR_DOORS].map((door) => door.door).sort();

    assert.deepEqual(rendered, declared,
      'les fichiers qui rendent <PaymentMonthsEditor> et l’inventaire doivent nommer les MÊMES — un fichier de plus est un point d’entrée non déclaré');
    assert.equal(rendered.some((file) => file === MONTHS_EDITOR), false,
      'l’éditeur ne se rend pas lui-même : il est la porte commune, pas une porte');
    assert.deepEqual(judge(sources).found.map((entry) => entry.file), rendered,
      'le jugement et la lecture du corpus voient les mêmes portes, avec leur ligne');
  });

  it('les DEUX écrans qui portent plusieurs portes déclarent des jetons DISTINCTS', () => {
    const { screens } = judge(realCorpus());
    assert.deepEqual(screens.get('student-file'), [
      'src/components/PaymentLedger.tsx',
      'src/components/PaymentMonthsBackfill.tsx',
    ], 'les deux portes de la fiche — le carnet et le parcours — sont groupées sur le même écran');
    assert.deepEqual(screens.get('silent-receipts-tab'), [
      'src/components/SilentReceiptsPass.tsx',
      'src/components/SilentReceiptsWalk.tsx',
    ], 'et l’écran École en porte deux depuis le parcours élève par élève — la passe par classe et lui');

    const tokens = MONTHS_EDITOR_DOORS.map((door) => door.token);
    assert.deepEqual(tokens, ['ledger', 'backfill', 'pass', 'walk'],
      'un jeton DISTINCT par porte, et aucun silence : les deux écrans partagent désormais leur éditeur');
    assert.equal(new Set(tokens).size, tokens.length, 'deux portes ne s’excluent pas avec un seul jeton');
  });

  it('la prose ne fabrique pas de porte, et ne prouve pas un hôte', () => {
    const sources = realCorpus();
    const proseOnly = withText(
      sources,
      'src/components/CommentOnly.tsx',
      '// Ici on rend <PaymentMonthsEditor> un jour, promis (voir la fiche).\nexport const CommentOnly = () => null;\n',
    );
    assert.equal(named(judge(proseOnly).problems, 'PORTE NON DÉCLARÉE').length, 0,
      'une porte RACONTÉE dans un commentaire n’est pas une porte');

    const hostProseOnly = mutated(
      sources,
      'src/components/StudentDetailsModal.tsx',
      '<PaymentLedger\n',
      '/* <PaymentLedger monté ici autrefois */\n',
    );
    assert.ok(named(judge(hostProseOnly).problems, 'HÔTE MUET').length > 0,
      'un montage cité dans un commentaire ne prouve pas que l’hôte monte la porte');
  });
});

// ─── Chaque règle, éprouvée par une mutation du corpus réel ─────────────────

describe('les portes de l’éditeur des mois — ce que le verrou refuse', () => {
  it('UN TROISIÈME point d’entrée non déclaré fait rougir — et lui seul', () => {
    const sources = [...realCorpus(), { file: NEW_DOOR, text: NEW_DOOR_TEXT }];
    const { problems, found } = judge(sources);

    assert.equal(found.length, MONTHS_EDITOR_DOORS.length + 1, 'la nouvelle porte est bien VUE dans le corpus');
    assert.equal(problems.length, 1, `seule la porte non déclarée doit parler : ${problems.join(' | ')}`);
    assert.ok(named(problems, 'PORTE NON DÉCLARÉE')[0]?.includes(NEW_DOOR),
      'l’écart nomme le fichier coupable et sa ligne');
    assert.equal(named(judge(realCorpus()).problems, 'PORTE NON DÉCLARÉE').length, 0,
      'et l’arbre réel, lui, reste vert : c’est bien l’ajout qui a parlé');
  });

  it('un hôte qui ne monte plus sa porte rougit (HÔTE MUET)', () => {
    const sources = mutated(realCorpus(), 'src/components/StudentDetailsModal.tsx', '<PaymentLedger\n', 'PaymentLedger\n');
    assert.ok(named(judge(sources).problems, 'HÔTE MUET').length > 0,
      'la déclaration doit être VRAIE, pas seulement présente');
  });

  it('une porte qui n’ouvre plus sous sa condition rougit (CONDITION ABSENTE)', () => {
    const sources = mutated(realCorpus(), 'src/components/PaymentLedger.tsx', "editorHost === 'ledger'", 'true');
    const problems = judge(sources).problems;
    assert.ok(named(problems, 'CONDITION ABSENTE').length > 0,
      'le carnet ne s’efface plus devant le parcours : c’est le défaut des deux éditeurs à l’écran');
  });

  it('un hôte qui ne remet plus le jeton rougit (JETON NON REMIS)', () => {
    const sources = mutated(
      realCorpus(),
      'src/components/StudentDetailsModal.tsx',
      'editorHost={editorHost}',
      'editorHost={null}',
    );
    assert.ok(named(judge(sources).problems, 'JETON NON REMIS').length > 0,
      'la moitié « l’hôte remet l’arbitrage » doit être vérifiée, pas supposée');
  });

  it('l’écran École aussi doit REMETTRE ses jetons (JETON NON REMIS, deux fois)', () => {
    // Le même défaut, sur le second écran partagé : la vue qui remet `null`
    // laisserait les DEUX portes sans arbitrage — un par classe, un par élève.
    // La mutation vise les DEUX remises (`replaceAll`) : n'en casser qu'une
    // prouverait la moitié de la règle, et le cas dit laquelle il vise.
    const corpus = realCorpus();
    const target = corpus.find((source) => source.file === 'src/components/SilentReceiptsView.tsx');
    assert.ok(target, 'le corpus doit contenir la vue de l’écran École');
    const text = target.text.replaceAll('editorHost={editorHost}', 'editorHost={null}');
    assert.notEqual(text, target.text, 'la mutation doit s’appliquer aux deux portes');
    const sources = withText(corpus, 'src/components/SilentReceiptsView.tsx', text);

    const problems = named(judge(sources).problems, 'JETON NON REMIS');
    assert.equal(problems.length, 2,
      `les deux portes de l’écran École doivent crier : ${problems.join(' | ')}`);
  });

  it('un jeton de l’écran École qui n’est pas dans son ensemble déclaré rougit (JETON NON DÉCLARÉ)', () => {
    const sources = mutated(
      realCorpus(),
      'src/components/SilentReceiptsView.tsx',
      "useState<'pass' | 'walk' | null>",
      "useState<'pass' | null>",
    );
    const problems = named(judge(sources).problems, 'JETON NON DÉCLARÉ');
    assert.equal(problems.length, 1, `seul le jeton du parcours doit parler : ${problems.join(' | ')}`);
    assert.ok(problems[0]?.includes('walk'),
      'l’écart nomme le jeton fautif : un jeton neuf oblige à étendre la DÉCLARATION des hôtes de la vue');
  });

  it('un jeton qui n’est pas dans l’ensemble déclaré rougit (JETON NON DÉCLARÉ)', () => {
    const sources = mutated(
      realCorpus(),
      'src/components/StudentDetailsModal.tsx',
      "useState<'ledger' | 'backfill' | null>",
      "useState<'ledger' | null>",
    );
    const problems = judge(sources).problems;
    assert.ok(named(problems, 'JETON NON DÉCLARÉ').length > 0,
      'un jeton neuf oblige à étendre la DÉCLARATION des hôtes de la fiche');
  });

  it('un ensemble d’hôtes illisible refuse de conclure (TYPE D’HÔTES ILLISIBLE)', () => {
    const sources = mutated(
      realCorpus(),
      'src/components/StudentDetailsModal.tsx',
      "useState<'ledger' | 'backfill' | null>(null)",
      'useState(null)',
    );
    assert.ok(named(judge(sources).problems, 'TYPE D’HÔTES ILLISIBLE').length > 0,
      'un ensemble qu’on ne lit pas ne devient jamais un vert');
  });

  it('une troisième porte sans jeton sur l’écran partagé rougit (ÉCRAN NON ARBITRÉ)', () => {
    const door: MonthsEditorDoor = {
      door: NEW_DOOR,
      screen: 'student-file',
      host: 'src/components/StudentDetailsModal.tsx',
      mounts: /<NewMonthsDoor\b/,
      token: null,
      handed: null,
      when: { file: NEW_DOOR, pattern: /PaymentMonthsEditor/ },
    };
    const sources = withText(realCorpus(), NEW_DOOR, NEW_DOOR_TEXT);
    const problems = judge(sources, [...MONTHS_EDITOR_DOORS, door]).problems;

    assert.ok(named(problems, 'ÉCRAN NON ARBITRÉ').length > 0,
      'le silence sur un écran partagé est exactement ce que ce verrou refuse');
  });

  it('deux portes qui déclarent le MÊME jeton rougissent (JETON PARTAGÉ)', () => {
    const door: MonthsEditorDoor = {
      door: NEW_DOOR,
      screen: 'student-file',
      host: 'src/components/StudentDetailsModal.tsx',
      mounts: /<NewMonthsDoor\b/,
      token: 'ledger',
      handed: { file: 'src/components/StudentDetailsModal.tsx', pattern: /editorHost=\{editorHost\}/ },
      when: { file: NEW_DOOR, pattern: /PaymentMonthsEditor/ },
    };
    const sources = withText(realCorpus(), NEW_DOOR, NEW_DOOR_TEXT);
    assert.ok(named(judge(sources, [...MONTHS_EDITOR_DOORS, door]).problems, 'JETON PARTAGÉ').length > 0,
      'deux portes ne s’excluent pas avec un seul jeton : elles s’ouvriraient ensemble');
  });

  it('un jeton sur un écran qui ne porte qu’une porte rougit (JETON INUTILE)', () => {
    // Un écran FABRIQUÉ qui ne porte qu'une porte — plus aucun écran du dépôt
    // n'est dans ce cas, donc la règle se prouve sur un corpus de jouet : le
    // jeton n'a rien à arbitrer, et l'annoncer serait une exclusivité imaginaire.
    const HOST = 'src/components/NewWalkHost.tsx';
    const screens = [
      ...MONTHS_EDITOR_SCREENS,
      { id: 'ecran-seul', hosts: HOST, state: null },
    ];
    const door: MonthsEditorDoor = {
      door: NEW_DOOR,
      screen: 'ecran-seul',
      host: HOST,
      mounts: /<NewMonthsDoor\b/,
      token: 'pass',
      handed: { file: HOST, pattern: /<NewMonthsDoor/ },
      when: { file: NEW_DOOR, pattern: /PaymentMonthsEditor/ },
    };
    const sources = [
      ...withText(realCorpus(), NEW_DOOR, NEW_DOOR_TEXT),
      { file: HOST, text: 'export const NewWalkHost = () => (<NewMonthsDoor />);\n' },
    ];
    const { problems } = judgeMonthsEditorHosts({
      doors: [...MONTHS_EDITOR_DOORS, door],
      screens,
      sources,
    });

    assert.ok(named(problems, 'JETON INUTILE').length > 0,
      'un jeton que rien ne partage est une exclusivité imaginaire — le silence DÉCLARÉ est la seule bonne forme');
  });

  it('une porte « seule sur son écran » chez l’hôte d’une autre rougit (ÉCRAN MAL DÉCLARÉ)', () => {
    // Le contournement à fermer : déclarer un écran neuf (donc « rien à arbitrer »)
    // en se faisant monter par la FICHE, qui porte déjà deux portes.
    const door: MonthsEditorDoor = {
      door: NEW_DOOR,
      screen: 'un-ecran-ailleurs',
      host: 'src/components/StudentDetailsModal.tsx',
      mounts: /<NewMonthsDoor\b/,
      token: null,
      handed: null,
      when: { file: NEW_DOOR, pattern: /PaymentMonthsEditor/ },
    };
    const screens = [
      ...MONTHS_EDITOR_SCREENS,
      { id: 'un-ecran-ailleurs', hosts: 'src/components/AutreEcran.tsx', state: null },
    ];
    const sources = withText(realCorpus(), NEW_DOOR, NEW_DOOR_TEXT);
    const { problems } = judgeMonthsEditorHosts({
      doors: [...MONTHS_EDITOR_DOORS, door],
      screens,
      sources,
    });

    assert.ok(named(problems, 'ÉCRAN MAL DÉCLARÉ').length > 0,
      'un hôte commun ne se rejoue pas en « deux écrans » : c’est le chemin silencieux vers deux éditeurs');
  });

  it('une porte qui ne rend plus l’éditeur rougit (PORTE DISPARUE)', () => {
    const sources = mutated(realCorpus(), 'src/components/PaymentMonthsBackfill.tsx', '<PaymentMonthsEditor', 'PaymentMonthsEditor');
    assert.ok(named(judge(sources).problems, 'PORTE DISPARUE').length > 0,
      'une entrée périmée garde une porte qui n’existe plus');
  });

  it('un écran inconnu et une porte déclarée deux fois rougissent, chacun par son nom', () => {
    const unknown: MonthsEditorDoor = { ...MONTHS_EDITOR_DOORS[0]!, door: NEW_DOOR, screen: 'ecran-inconnu' };
    const sources = withText(realCorpus(), NEW_DOOR, NEW_DOOR_TEXT);
    assert.ok(named(judge(sources, [...MONTHS_EDITOR_DOORS.slice(1), unknown]).problems, 'ÉCRAN INCONNU').length > 0);

    const twice = [...MONTHS_EDITOR_DOORS, MONTHS_EDITOR_DOORS[0]!];
    assert.ok(named(judge(realCorpus(), twice).problems, 'PORTE DUPLIQUÉE').length > 0,
      'une porte déclarée deux fois pourrait cacher une sortie de l’écran');
  });

  it('un corpus vide ne conclut pas vert, et un corpus sans porte non plus', () => {
    assert.deepEqual(named(judge([]).problems, 'CORPUS VIDE').length, 1,
      'un regard qui n’a rien atteint n’est pas un état sain');

    const noEditor = [{ file: 'src/components/Autre.tsx', text: 'export const Autre = () => null;\n' }];
    assert.ok(named(judge(noEditor).problems, 'AUCUNE PORTE TROUVÉE').length > 0,
      'un scan qui ne voit aucune porte dit qu’il est aveugle, il ne félicite pas');
  });
});
