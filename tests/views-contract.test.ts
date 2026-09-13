// Suite for tests/views-contract.ts + tests/views-harness.tsx — les valeurs par
// défaut d'une vue sont DÉRIVÉES du contrat de props.
//
// WHY THIS EXISTS
// ---------------
// Le harnais de rendu portait ~200 lignes de `noop` recopiés, une par prop : chaque
// prop nouvelle exigeait donc de l'éditer à la main dans `MainViewsProps`
// (186 → 215 props au fil des mois). Un oubli ne se voyait pas toujours — la prop
// valait `undefined`, la vue rendait autre chose, et le cas passait.
//
// La dérivation résout le mécanique, mais elle a deux façons de mentir, et ce sont
// elles qui sont verrouillées ici :
//   • elle pourrait ne rien produire pour une prop (trou silencieux) — d'où
//     `assembleProps`, qui REFUSE de construire et nomme la prop ;
//   • elle ne pourrait marcher que pour le contrat d'AUJOURD'HUI — d'où les cas
//     sur un contrat SYNTHÉTIQUE : une prop nouvelle y est dérivée sans qu'on
//     touche à un seul fichier du harnais.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { CONTRACT_FILE, assembleProps, contractPropNames, deriveContractDefaults } from './views-contract';
import { declaredDefaults, makeProps } from './views-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractText = readFileSync(join(ROOT, CONTRACT_FILE), 'utf8');

/**
 * Un contrat de toutes pièces : c'est ce qui mesure la promesse, pas l'exemple.
 * `extra` déclare les types locaux dont le corps a besoin.
 */
const synthetic = (body: string, extra = '') =>
  deriveContractDefaults({ file: 'tmp-contract.ts', text: `${extra}\ninterface MainViewsProps {\n${body}\n}\n` });

describe('la dérivation couvre le contrat réel', () => {
  const names = contractPropNames();
  const derivation = deriveContractDefaults();

  it('dérive une valeur par prop, et ce qu’elle ne dérive pas est NOMMÉ', () => {
    assert.ok(names.length >= 150, `le contrat complet est lu (${names.length} props)`);
    assert.equal(
      Object.keys(derivation.props).length,
      names.length - derivation.unclassified.length,
      'chaque prop est soit dérivée, soit déclarée non dérivable — jamais oubliée',
    );
    for (const item of derivation.unclassified) {
      assert.ok(item.name && item.type && item.reason, 'une prop non dérivable porte son nom, son type ET sa raison');
    }
  });

  it('les seules props non dérivables sont celles qui vivent hors du module', () => {
    // Deux types venus d'ailleurs (`AuthState`, `TranslationDict`) : leur forme
    // n'est pas dans le fichier du contrat, donc la dérivation ne peut pas la lire
    // — elle le dit au lieu de deviner. Un type inconnu de plus ici serait une
    // perte de couverture déguisée en couverture.
    assert.deepEqual(
      derivation.unclassified.map((item) => item.name).sort(),
      ['auth', 't'],
      'la liste des non-dérivables est courte et connue',
    );
    for (const item of derivation.unclassified) assert.match(item.reason, /déclaré ailleurs|ne peut pas lire sa forme/);
  });

  it('les formes sont dérivées, pas devinées : littéral, tableau, setter, fonction de retour, objet local', () => {
    const props = derivation.props;
    // Union de littéraux → premier membre.
    assert.equal(props.activeTab, 'dashboard');
    assert.equal(props.theme, 'navy');
    assert.equal(props.staffModalMode, 'employee');
    // `T | null` → `null` (une absence, pas une chaîne vide ni le premier membre).
    assert.equal(props.expandedParentId, null);
    assert.equal(props.schoolLogo, null);
    assert.equal(props.studentSortKey, null);
    // Tableaux → `[]`, setters → fonction, composants → un composant.
    assert.deepEqual(props.pieData, []);
    assert.equal(typeof props.setTheme, 'function');
    assert.equal(typeof props.DashboardCharts, 'function');
    // Interface LOCALE → objet dont chaque membre est dérivé à son tour.
    assert.deepEqual(props.payrollWindowStatus, {
      currentDay: 0,
      currentCalendarYear: 0,
      currentCalendarMonth: 0,
      totalPaidCurrentMonth: 0,
      isOverdue: false,
      isOpen: false,
    });
  });

  it('une fonction est dérivée de son type de RETOUR — la vue lit le retour, pas la fonction', async () => {
    const props = derivation.props;
    // `getStatus` rend une interface locale : la vue lit `.label`, donc un noop
    // rendrait `undefined` et la vue jetterait.
    assert.deepEqual((props.getStatus as () => unknown)(), { label: '', color: '', icon: null, standing: '' });
    // `getChildrenForParent` rend `Student[]` : la vue itère dessus.
    assert.deepEqual((props.getChildrenForParent as () => unknown[])(), []);
    assert.equal((props.getParentOutstandingBalance as () => number)(), 0);
    assert.equal((props.getDayName as () => string)(), '');
    // `() => Promise<void>` : une promesse est rendue, pas une valeur — une vue
    // qui l'attend ne doit pas recevoir `undefined` au premier `await`.
    const fetchAuditLogs = props.fetchAuditLogs as () => Promise<unknown>;
    const pending = fetchAuditLogs();
    assert.equal(typeof (pending as Promise<unknown>).then, 'function');
    assert.equal(await pending, undefined, 'et elle se résout vraiment (void)');
  });

  it('deux appels rendent deux objets — un tableau partagé corrompu par une vue serait un faux vert', () => {
    const props = derivation.props;
    const read = props.getChildrenForParent as () => unknown[];
    const first = read();
    first.push('corrompu');
    assert.deepEqual(read(), [], 'ce que la vue pousse dans le retour ne survit pas à l’appel suivant');
    assert.notEqual(read(), read(), 'et ce ne sont pas le même tableau');
  });

  it('deux lectures INDÉPENDANTES du fichier donnent la même liste de props', () => {
    // La dérivation lit le contrat par l'API du compilateur ; ici on refait la
    // lecture TEXTUELLE du même fichier — le corps de l'interface, puis les noms à
    // deux espaces d'indentation, exactement comme `tests/mainviews-props.test.ts`.
    // Deux lecteurs indépendants d'accord, c'est ce qui rend l'angle mort de l'un
    // visible au lieu d'être hérité en silence par l'autre. Sans le découpage du
    // corps, la lecture textuelle ramasse aussi les membres des AUTRES interfaces
    // du fichier (`CurrentTheme`, `ParentLedgerEntry`…) : mesuré, 215 lignes de
    // plus — c'est justement le genre d'écart que cette comparaison doit montrer.
    const body = contractText.match(/interface MainViewsProps \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const regex = [...body.matchAll(/^\s{2}([A-Za-z0-9_]+)(\?)?:/gm)].map((m) => m[1]);
    assert.deepEqual([...contractPropNames()].sort(), [...regex].sort());
  });
});

describe('une prop NOUVELLE se dérive sans éditer un seul fichier', () => {
  it('dérive chaque forme du contrat — y compris des formes absentes d’aujourd’hui', () => {
    const { props, unclassified } = synthetic(
      [
        '  setThing: Dispatch<SetStateAction<string[]>>;',
        '  loadThings: (id: string) => Promise<string[]>;',
        '  row: LocalRow;',
        '  rows: LocalRow[];',
        '  maybe: LocalRow | null;',
        '  count: number;',
        '  label: string;',
        '  flag: boolean;',
        '  choice: "a" | "b";',
        '  Icon: LucideIcon;',
        '  nothing: () => void;',
        '  inline: { name: string; amount?: number }[];',
      ].join('\n'),
      'interface LocalRow { id: string; amount: number }\n',
    );

    assert.deepEqual(unclassified, [], 'aucune prop de ce contrat n’est laissée de côté');
    assert.deepEqual(
      Object.keys(props).sort(),
      ['Icon', 'choice', 'count', 'flag', 'label', 'loadThings', 'maybe', 'nothing', 'row', 'rows', 'setThing', 'inline'].sort(),
      'chaque prop nommée reçoit une valeur',
    );
    assert.equal(props.count, 0);
    assert.equal(props.label, '');
    assert.equal(props.flag, false);
    assert.equal(props.choice, 'a', 'une union prend son premier membre');
    assert.equal(props.maybe, null, 'et `T | null` reste une absence');
    assert.deepEqual(props.rows, []);
    assert.deepEqual(props.inline, []);
    assert.equal(typeof props.Icon, 'function');
    assert.equal(typeof props.setThing, 'function');
    assert.equal(typeof props.nothing, 'function');
    assert.equal(props.nothing, props.nothing, 'une fonction dérivée est stable');
  });

  it('une prop non dérivable est NOMMÉE dans le rapport, jamais rendue `undefined`', () => {
    const { props, unclassified } = synthetic('  known: number;\n  mystery: SomeOpaqueThing;\n');

    assert.equal(props.known, 0);
    assert.equal(Object.hasOwn(props, 'mystery'), false, 'elle n’est pas posée à `undefined` : elle n’est pas posée');
    assert.equal(unclassified.length, 1);
    assert.equal(unclassified[0].name, 'mystery');
    assert.equal(unclassified[0].type, 'SomeOpaqueThing');
    assert.match(unclassified[0].reason, /ne peut pas lire sa forme/);
  });

  it('assembler REFUSE un contrat troué, en nommant la prop à traiter', () => {
    // C'est la ceinture du mécanisme : sans elle, la prop non dérivable sortirait
    // en `undefined` et la vue rendrait autre chose, en silence.
    const derivation = synthetic('  mystery: SomeOpaqueThing;\n');

    assert.throws(
      () => assembleProps(derivation),
      (error: Error) => error.message.includes('mystery') && error.message.includes('SomeOpaqueThing'),
      'le refus nomme la prop ET son type',
    );
    // Déclarée pour son contenu, elle passe — et c'est la valeur déclarée qu'on lit.
    assert.deepEqual(assembleProps(derivation, { mystery: 'valeur-du-cas' }), { mystery: 'valeur-du-cas' });
  });
});

describe('le harnais assemble les props dérivées et déclarées', () => {
  it('couvre TOUTES les props du contrat, sans trou ni prop en trop', () => {
    const names = new Set(contractPropNames());
    const props = makeProps();
    const missing = [...names].filter((name) => !Object.hasOwn(props, name));
    assert.deepEqual(missing, [], 'aucune prop du contrat ne manque dans ce que le harnais construit');
    const extra = Object.keys(props).filter((name) => !names.has(name));
    assert.deepEqual(extra, [], 'et aucune prop étrangère au contrat n’y est ajoutée');
  });

  it('chaque valeur déclarée existe encore dans le contrat', () => {
    // Sinon une prop renommée laisserait une déclaration orpheline : le harnais
    // garderait une valeur pour personne, et la prop renommée tomberait dans le
    // trou (elle serait dérivée, ou pire, non dérivable et déclarée à côté).
    const names = new Set(contractPropNames());
    const orphans = Object.keys(declaredDefaults).filter((name) => !names.has(name));
    assert.deepEqual(orphans, [], 'une déclaration doit viser une prop qui existe');
  });

  it('ce qui n’est pas dérivable est DÉCLARÉ ici, avec sa raison', () => {
    const unclassified = deriveContractDefaults().unclassified.map((item) => item.name);
    const undeclared = unclassified.filter((name) => !Object.hasOwn(declaredDefaults, name));
    assert.deepEqual(undeclared, [], 'les props non dérivables du contrat réel sont déclarées');
  });

  it('les données du cas sont posées APRÈS les défauts, et le défaut reste vide', () => {
    const props = makeProps({ searchTerm: 'awa', staff: [{ id: 's1' }] as never });
    assert.equal(props.searchTerm, 'awa');
    assert.equal((props.staff as unknown[]).length, 1);
    // Défaut VIDE : un cas qui veut des données doit les passer.
    assert.deepEqual(makeProps().staff, []);
    assert.deepEqual(makeProps().expenses, []);
    assert.deepEqual(makeProps().auditLogs, []);
  });
});
