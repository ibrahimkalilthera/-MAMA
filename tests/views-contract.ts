// ─────────────────────────────────────────────────────────────────────────────
// tests/views-contract.ts — les valeurs par défaut d'une vue, DÉRIVÉES du contrat.
//
// Pourquoi ce fichier existe : `tests/views-harness.tsx` portait ~200 lignes de
// `noop` recopiés pour couvrir les props de `MainViewsProps`. Chaque prop nouvelle
// exigeait donc d'éditer le harnais à la main — et un oubli ne se voyait pas
// toujours : la prop valait `undefined`, la vue rendait autre chose, et le cas
// passait (ou tombait sur un `TypeError` trois fichiers plus loin).
//
// Ici les valeurs sont dérivées du CONTRAT lui-même (`src/app/mainViewsProps.ts`,
// lu par l'API du compilateur — pas par un motif, donc le formatage n'y change
// rien) : chaque prop reçoit une valeur de SON type.
//
//   `X[]`                        → `[]`
//   `Dispatch<SetStateAction<T>>` → une fonction
//   `(id: string) => Promise<T[]>` → une fonction async qui rend `[]`
//   une interface LOCALE         → un objet dont chaque membre est dérivé à son tour
//   une union de littéraux       → son premier membre
//   `T | null`                   → `null`
//   `LucideIcon` / `ComponentType<…>` → un composant qui ne rend rien
//
// Trois propriétés qui l'empêchent de devenir un faux vert :
//   • ce qui n'est pas dérivable est NOMMÉ (`unclassified` : nom + type) au lieu
//     de devenir `undefined` en silence — le harnais refuse alors de construire
//     les props, donc la suite tombe avec le nom de la prop à traiter ;
//   • les valeurs rendues par une fonction sont REFABRIQUÉES à chaque appel : une
//     vue qui pousse dans le tableau rendu ne corrompt pas l'appel suivant (le
//     harnais d'avant y faisait attention à la main, cas par cas) ;
//   • le contrat est la seule source : une prop ajoutée est dérivée sans éditer ce
//     fichier, et `tests/views-contract.test.ts` le mesure sur un contrat
//     SYNTHÉTIQUE — sinon on ne testerait que le contrat d'aujourd'hui.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Le fichier qui déclare les props — le même que le contrôle de câblage lit. */
export const CONTRACT_FILE = 'src/app/mainViewsProps.ts';

/** L'interface des props des vues. */
const CONTRACT_TYPE = 'MainViewsProps';

/** Un cas que la dérivation ne sait pas produire, nommé plutôt que deviné. */
export interface Unclassified {
  name: string;
  type: string;
  reason: string;
}

/** Ce que la dérivation a produit, et ce qu'elle n'a pas su produire. */
export interface Derivation {
  props: Record<string, unknown>;
  unclassified: Unclassified[];
}

/** Le fichier lu, résolu depuis CE fichier (donc indépendant du dossier courant). */
function contractText(): string {
  return readFileSync(join(TESTS_DIR, '..', CONTRACT_FILE), 'utf8');
}

function parse(file: string, text: string): ts.SourceFile {
  // `true` = garder les positions : c'est ce qui permet de lire le texte exact
  // d'un type, même écrit sur plusieurs lignes (les quatre `ComponentType<…>` du
  // contrat le sont) — un lecteur ligne à ligne les aurait tronqués.
  const path = isAbsolute(file) ? file : join(TESTS_DIR, '..', file.replace(/^\.\//, ''));
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Les interfaces et alias LOCAUX du module : ce qui se dérive sans autre fichier. */
function declarations(source: ts.SourceFile) {
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) interfaces.set(statement.name.text, statement);
    else if (ts.isTypeAliasDeclaration(statement)) aliases.set(statement.name.text, statement);
  }
  return { interfaces, aliases };
}

/** Le nom d'un membre, ou `null` quand il n'est pas un nom simple. */
function memberName(member: ts.TypeElement): string | null {
  if (!('name' in member) || !member.name) return null;
  const name = member.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

/**
 * Les valeurs de type « composant ».
 *
 * `() => null` rend `null` en JSX, ce qu'aucun cas ne mesure. Ce qui est délibéré
 * (un composant dont le CONTENU compte, comme `Suspense`) sort de la dérivation et
 * est déclaré par le harnais — c'est son rôle, pas celui du contrat.
 */
const componentStub = () => null;

/** Les types importés qui ont une forme connue, à défaut d'être dans ce module. */
const KNOWN_IMPORTED: Record<string, () => unknown> = {
  LucideIcon: () => componentStub,
  ComponentType: () => componentStub,
  FunctionComponent: () => componentStub,
  ReactNode: () => null,
  // `Date` n'est pas importé, c'est le global — et sa valeur ne se dérive pas de
  // son type. Une date FIXE plutôt qu'une date du jour : un rendu qui change
  // selon le calendrier de la machine n'est pas mesurable. Le contenu de cette
  // date n'est lu par aucun cas (les dates affichées passent par `formatDate`).
  Date: () => new Date(0),
};

/**
 * La valeur par défaut d'un type, dérivée récursivement.
 *
 * `stack` porte les types NOMMÉS en cours de dérivation : un contrat qui se
 * référencerait lui-même (deux interfaces qui se pointent) rendrait `null` au lieu
 * de boucler — une suite qui pend n'est pas un échec, c'est un piège.
 */
function derive(
  type: ts.TypeNode | undefined,
  context: { interfaces: Map<string, ts.InterfaceDeclaration>; aliases: Map<string, ts.TypeAliasDeclaration> },
  stack: string[] = [],
): { value?: unknown; unclassified?: Unclassified } {
  if (!type) return { unclassified: { name: '', type: 'MISSING', reason: 'membre sans annotation de type' } };

  // `(A)` : la parenthèse ne change rien au type.
  if (ts.isParenthesizedTypeNode(type)) return derive(type.type, context, stack);

  if (ts.isLiteralTypeNode(type)) {
    const literal = type.literal;
    if (ts.isStringLiteral(literal)) return { value: literal.text };
    if (ts.isNumericLiteral(literal)) return { value: Number(literal.text) };
    if (ts.isPrefixUnaryExpression(literal) && ts.isNumericLiteral(literal.operand)) {
      return { value: -Number(literal.operand.text) };
    }
    if (literal.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
    if (literal.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
    return { value: null };
  }

  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { value: '' };
    case ts.SyntaxKind.NumberKeyword:
      return { value: 0 };
    case ts.SyntaxKind.BooleanKeyword:
      return { value: false };
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return { value: undefined };
    case ts.SyntaxKind.NullKeyword:
      return { value: null };
    default:
      break;
  }

  if (ts.isArrayTypeNode(type) || ts.isTupleTypeNode(type)) return { value: [] };

  if (ts.isTypeLiteralNode(type)) {
    const entries: Record<string, unknown> = {};
    for (const member of type.members) {
      const name = memberName(member);
      if (!name) return { unclassified: { name: '', type: member.getText(), reason: 'membre de type littéral sans nom simple' } };
      const derived = deriveElement(member, context, stack);
      if (derived.unclassified) return { unclassified: { ...derived.unclassified, name } };
      entries[name] = derived.value;
    }
    return { value: entries };
  }

  if (ts.isUnionTypeNode(type)) {
    // `T | null` → `null` : c'est la valeur d'un état au repos, et c'est ce que le
    // harnais écrivait à la main pour les six props nullables du contrat. Le
    // `null` d'une union est un type LITTÉRAL (`LiteralTypeNode` de `null`), pas
    // le mot-clé `NullKeyword` : les confondre faisait retomber sur le premier
    // membre, donc un état « absent » devenait un objet ou une chaîne vide.
    if (type.types.some((member) => ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword)) {
      return { value: null };
    }
    return derive(type.types[0], context, stack);
  }

  // `A & B` (par exemple `ManagedClass = SchoolClass & { rowId?: string }`) : la
  // première branche suffit à rendre une valeur du bon type.
  if (ts.isIntersectionTypeNode(type)) return derive(type.types[0], context, stack);

  if (ts.isTypeOperatorNode(type) || ts.isOptionalTypeNode(type) || ts.isRestTypeNode(type)) {
    return derive(type.type, context, stack);
  }

  if (ts.isFunctionTypeNode(type)) return functionFor(type.type, context, stack);

  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    const arg = type.typeArguments?.[0];

    if (name === 'Array' || name === 'ReadonlyArray') return { value: [] };
    if (name === 'Record') return { value: {} };
    if (name === 'Dispatch' || name === 'SetStateAction') return { value: () => {} };
    if (name === 'RefObject' || name === 'MutableRefObject') return { value: { current: null } };
    // Une VALEUR de type `Promise<T>` est une promesse, pas une fonction : la
    // confondre avec le type de retour d'une fonction faisait qu'une prop
    // asynchrone rendait une fonction (et la vue attendait une promesse en vain).
    if (name === 'Promise') return { value: Promise.resolve(derive(arg, context, stack).value) };

    if (Object.hasOwn(KNOWN_IMPORTED, name)) return { value: KNOWN_IMPORTED[name]() };

    const localInterface = context.interfaces.get(name);
    if (localInterface) {
      if (stack.includes(name)) return { value: null };
      const entries: Record<string, unknown> = {};
      for (const member of localInterface.members) {
        const memberLabel = memberName(member) ?? name;
        const derived = deriveElement(member, context, [...stack, name]);
        if (derived.unclassified) return { unclassified: { ...derived.unclassified, name: memberLabel } };
        entries[memberLabel] = derived.value;
      }
      return { value: entries };
    }

    const localAlias = context.aliases.get(name);
    if (localAlias) {
      if (stack.includes(name)) return { value: null };
      return derive(localAlias.type, context, [...stack, name]);
    }

    return {
      unclassified: {
        name: '',
        type: type.getText(),
        reason: `type « ${name} » déclaré ailleurs que dans le module du contrat : la dérivation ne peut pas lire sa forme, donc elle ne la devine pas`,
      },
    };
  }

  return {
    unclassified: { name: '', type: type.getText(), reason: `type non dérivable (${ts.SyntaxKind[type.kind]})` },
  };
}

/** Un membre d'interface ou d'objet littéral : propriété, ou méthode. */
function deriveElement(
  member: ts.TypeElement,
  context: { interfaces: Map<string, ts.InterfaceDeclaration>; aliases: Map<string, ts.TypeAliasDeclaration> },
  stack: string[],
): { value?: unknown; unclassified?: Unclassified } {
  if (ts.isPropertySignature(member)) return derive(member.type, context, stack);
  if (ts.isMethodSignature(member)) return functionFor(member.type, context, stack);
  return { unclassified: { name: '', type: member.getText(), reason: 'membre de contrat inattendu' } };
}

/**
 * Une fonction dérivée de son type de RETOUR — parce que c'est le retour qu'une
 * vue lit : `getChildrenForParent` rend `Student[]`, donc `[]`, et pas `undefined`.
 *
 * La valeur est recalculée à CHAQUE appel (`() => derive(...)`) : deux appels
 * rendent deux objets distincts, comme les `() => []` que le harnais écrivait à la
 * main. Un tableau partagé corrompu par une vue serait un faux vert de plus.
 */
function functionFor(
  returnType: ts.TypeNode | undefined,
  context: { interfaces: Map<string, ts.InterfaceDeclaration>; aliases: Map<string, ts.TypeAliasDeclaration> },
  stack: string[],
): { value?: unknown; unclassified?: Unclassified } {
  // `Promise<T>` dans un type de RETOUR, c'est une fonction ASYNCHRONE : on
  // déroule la promesse avant de dériver, sinon la fonction rendrait une promesse
  // de fonction (mesuré : la vue recevait une fonction au `await`).
  const promised = promiseArgument(returnType);
  if (promised) return { value: async () => derive(promised, context, stack).value };
  const isVoid =
    !returnType || returnType.kind === ts.SyntaxKind.VoidKeyword || returnType.kind === ts.SyntaxKind.UndefinedKeyword;
  if (isVoid) return { value: () => {} };
  return { value: () => derive(returnType, context, stack).value };
}

/** Le `T` de `Promise<T>`, ou `undefined` quand le type n'est pas une promesse. */
function promiseArgument(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (!type || !ts.isTypeReferenceNode(type) || type.typeName.getText() !== 'Promise') return undefined;
  return type.typeArguments?.[0];
}

/**
 * Les props complètes : ce qui se dérive, plus ce qui est DÉCLARÉ.
 *
 * Refuse de construire si une prop n'est ni l'une ni l'autre. Un ensemble de props
 * auquel il manque un nom n'est pas « presque complet » : la vue lit `undefined`,
 * rend autre chose, et le cas qui la mesure passe pour une raison qui n'est pas
 * celle qu'il croit. Le refus est donc ici, pas dans la vue.
 *
 * @param derivation ce que le contrat a donné
 * @param declared les valeurs déclarées pour leur CONTENU (et pour ce qui n'est
 *   pas un type du module)
 */
export function assembleProps(derivation: Derivation, declared: Record<string, unknown> = {}): Record<string, unknown> {
  const missing = derivation.unclassified.filter((item) => !Object.hasOwn(declared, item.name));
  if (missing.length) {
    throw new Error(
      'contrat de props non couvert — ces props ne se dérivent pas de leur type et ne sont pas déclarées :\n' +
        missing.map((item) => `   • ${item.name}: ${item.type} — ${item.reason}`).join('\n') +
        '\n   → soit sa forme se dérive (tests/views-contract.ts), soit elle est déclarée avec sa raison.',
    );
  }
  return { ...derivation.props, ...declared };
}

/** Les noms des props du contrat, dans l'ordre du fichier. */
export function contractPropNames({ file = CONTRACT_FILE, text }: { file?: string; text?: string } = {}): string[] {
  const source = parse(file, text ?? readFileSync(join(TESTS_DIR, '..', file), 'utf8'));
  const contract = declarations(source).interfaces.get(CONTRACT_TYPE);
  if (!contract) throw new Error(`le contrat « ${CONTRACT_TYPE} » est introuvable dans ${file}`);
  return contract.members.map((member, index) => {
    const name = memberName(member);
    if (!name) throw new Error(`${file} : membre ${index} du contrat sans nom simple — le lecteur doit être adapté`);
    return name;
  });
}

/** Les valeurs par défaut de toutes les props du contrat, et ce qui a résisté. */
export function deriveContractDefaults({ file = CONTRACT_FILE, text }: { file?: string; text?: string } = {}): Derivation {
  const source = parse(file, text ?? readFileSync(join(TESTS_DIR, '..', file), 'utf8'));
  const context = declarations(source);
  const contract = context.interfaces.get(CONTRACT_TYPE);
  if (!contract) throw new Error(`le contrat « ${CONTRACT_TYPE} » est introuvable dans ${file}`);

  const props: Record<string, unknown> = {};
  const unclassified: Unclassified[] = [];
  for (const member of contract.members) {
    const name = memberName(member);
    if (!name) {
      unclassified.push({ name: `(membre ${unclassified.length})`, type: member.getText(), reason: 'nom de prop non lisible' });
      continue;
    }
    const derived = deriveElement(member, context, []);
    if (derived.unclassified) {
      unclassified.push({ name, type: derived.unclassified.type, reason: derived.unclassified.reason });
      continue;
    }
    props[name] = derived.value;
  }
  return { props, unclassified };
}
