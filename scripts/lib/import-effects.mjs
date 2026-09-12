// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/import-effects.mjs — un module qu'un test importe ne doit pas
// ÉCRIRE DEHORS pendant qu'il est importé.
//
// POURQUOI CECI EXISTE
// --------------------
// Le 2026-09-12, `npm run check:automations` a déclaré `Quality & performance
// guard` « vert sans avoir agi », avec le motif de `Dependabot rebase`. Cause
// mesurée dans le journal du runner : `npm test` importe
// `scripts/rebase-dependabot-prs.mjs` pour tester sa boucle de décision, et son
// `main()` tournait au niveau supérieur — sans token, il imprimait l'annotation
// d'inaction dans le journal du job de tests, et l'audit relit ce journal. Une
// suite de tests écrivait donc dans l'exact canal que les audits lisent.
//
// La convention était déjà écrite dans le dépôt (« importer est inerte, exécuter
// déclare ») ; la prose n'a pas suffi, il a fallu le payer. Ce module la
// transforme en fait mesuré, pour la seule population où elle est dangereuse :
// les modules qu'un test importe.
//
// CE QUI COMPTE COMME UN EFFET
// ----------------------------
// Pas « tout appel » : un premier critère large accusait `join(…)`,
// `new Set([…])` et `fileURLToPath(import.meta.url)` — du calcul pur, présent au
// niveau supérieur dans presque tous les fichiers du dépôt. Un garde qui accuse
// 80 lignes justes n'est pas un garde, c'est du bruit. La frontière utile est
// celle de l'OBSERVABLE : un appel qui écrit dans le journal (`console.*`), sur
// le disque, sur le réseau, qui lance un processus, qui termine le processus, ou
// qui programme du travail pour après l'import. Le reste ne regarde personne.
//
// ET LE GARDE D'ENTRÉE
// --------------------
// Le dépôt écrit le garde sous trois formes : `if (process.argv[1] && import.meta
// .url === …)`, `if (isMain)` (la variable au-dessus), et `if (invokedDirectly())`
// (la fonction au-dessus). Les trois sont reconnues ici, sur le TEXTE de la
// condition — parce que la quatrième forme n'échouera pas en silence : elle
// apparaîtra comme un effet, et la corriger coûte une ligne.
//
// L'AST du compilateur TypeScript fait le travail : ce dépôt a déjà vu un garde
// lire 5 % des workflows parce qu'un `\r` traînait, et le balayage naïf qui devait
// écrire ce fichier a « trouvé » `scripts/thing.mjs`… dans une chaîne de test. Un
// analyseur ne confond pas du code avec du texte qui parle de code.
// ─────────────────────────────────────────────────────────────────────────────

import ts from 'typescript';

/** Les nœuds dont le corps n'est PAS évalué à l'import : ils attendent un appel. */
const DEFERRED = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

/**
 * Le garde d'entrée, reconnu par ce qu'il TESTE et non par sa forme exacte :
 * `process.argv[1]` (sommes-nous le programme ?) ou `import.meta.url` (quel
 * fichier est chargé ?).
 */
const ENTRY_GUARD = /process\.argv\[1\]|import\.meta\.url/;

/**
 * Les appels observables depuis l'extérieur, avec la raison imprimée au constat.
 * Ancrés sur le DERNIER segment du nom (`fs.writeFileSync` compte comme
 * `writeFileSync`) pour ne pas dépendre de la façon d'importer.
 */
const EFFECTS = [
  [
    /^(writeFileSync|appendFileSync|rmSync|unlinkSync|rmdirSync|mkdirSync|copyFileSync|renameSync|createWriteStream|writeSync|truncateSync)$/,
    'écrit sur le disque',
  ],
  [
    /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)$/,
    'lance un processus',
  ],
  [/^(fetch|listen|request|connect)$/, 'parle au réseau'],
  [/^(setInterval|setTimeout|setImmediate|queueMicrotask)$/, 'programme du travail après l’import'],
  [/^Worker$/, 'démarre un fil d’exécution'],
];

/**
 * Les objets dont TOUTE méthode est un effet : `console.log`, `console.error`,
 * `process.exit`, `process.kill`… Le premier jet testait le seul DERNIER segment
 * (`log`) contre un motif `console` : `console.log('…')` — l'incident lui-même —
 * passait donc invisible, et c'est le cas de corpus réel qui l'a montré.
 */
const EFFECTFUL_OBJECTS = new Map([['console', 'écrit dans le journal']]);

/**
 * Les méthodes de `process` qui agissent, nommées une par une. `process` n'est
 * PAS un objet entièrement effectuel, contrairement à `console` : `process.argv
 * .slice(2)` et `process.env.X.split()` sont du calcul, et les traiter comme des
 * effets rendrait le garde faux sur n'importe quel fichier un peu outillé.
 */
const EFFECTFUL_CALLEES = [
  [/^process\.(exit|kill|chdir|abort|on|emit|umask)$/, 'agit sur le processus'],
  [/^process\.(stdout|stderr)\.write$/, 'écrit dans le journal'],
];

/**
 * L'appel est-il un effet observable ? `null` si non.
 * `object` = `console` dans `console.log` ; `member` = `log`.
 * @returns {{ member: string, object: string, why: string } | null}
 */
function effectOf(node, source) {
  // `new Worker(url)` compte comme un appel : sans retirer le mot-clé, le
  // « nom » lu serait `new`, et le fil démarré passerait invisible.
  const text = source.slice(node.getStart(), node.getEnd()).replace(/^new\s+/, '');
  const callee = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(text)?.[1];
  if (!callee) return null;
  const parts = callee.split('.');
  const member = parts[parts.length - 1];
  const root = parts[0];
  const onEffectfulObject = EFFECTFUL_OBJECTS.get(root);
  if (onEffectfulObject) return { member, object: root, why: onEffectfulObject };
  for (const [pattern, why] of EFFECTFUL_CALLEES) {
    if (pattern.test(callee)) return { member, object: root, why };
  }
  for (const [pattern, why] of EFFECTS) {
    if (pattern.test(member)) return { member, object: parts.length > 1 ? parts[parts.length - 2] : '', why };
  }
  return null;
}

/** La position (1-based) d'un nœud, telle qu'un humain la lit dans un éditeur. */
function positionOf(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return { line: line + 1, column: character + 1 };
}

/** Le fragment de source d'un nœud, sur une seule ligne et borné. */
function snippetOf(source, node, max = 64) {
  const one = source.slice(node.getStart(), node.getEnd()).split(/\r?\n/)[0].trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * Les fonctions définies DANS ce fichier — déclarations et `const f = () => …`.
 *
 * Elles portent la seconde moitié de la règle, et c'est celle qui manquait : la
 * liste d'effets ne voit que les écritures directes, or l'incident était
 * `main()` appelé au niveau supérieur, dont le `console.log` vit à l'intérieur.
 * Aucune analyse locale ne peut savoir ce qu'un `build()` étranger écrit ; en
 * revanche « ce fichier appelle SA PROPRE fonction à l'import » est exactement la
 * forme qui a fait écrire la suite dans le journal de l'audit, et elle est
 * décidable ici.
 * @returns {Set<string>}
 */
function localFunctions(sourceFile) {
  const names = new Set();
  const walk = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) names.add(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return names;
}

/**
 * Les identifiants qui répondent « suis-je le programme ? » : la fonction
 * `invokedDirectly()` et la variable `isMain` du dépôt, quelle que soit la façon
 * dont elles sont écrites.
 * @returns {Set<string>}
 */
function guardNames(sourceFile, source) {
  const names = new Set();
  const matches = (node) => ENTRY_GUARD.test(source.slice(node.getStart(), node.getEnd()));
  const walk = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && matches(node.body)) {
      names.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && matches(node.initializer)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return names;
}

/**
 * Tout effet observable que l'IMPORT d'un module déclencherait.
 *
 * Pure : le texte entre, les constats sortent (le CLI fait la lecture disque).
 *
 * @param {string} text
 * @param {{ file?: string }} [meta]
 * @returns {{ file: string, line: number, column: number, call: string, why: string }[]}
 */
export function importEffects(text, { file = '' } = {}) {
  const source = String(text ?? '');
  const sourceFile = ts.createSourceFile(file || 'module.mjs', source, ts.ScriptTarget.Latest, true);
  const guards = guardNames(sourceFile, source);
  const locals = localFunctions(sourceFile);
  const findings = [];

  /** La condition d'un `if` interroge-t-elle le garde d'entrée ? */
  const isEntryGuard = (expression) => {
    const condition = source.slice(expression.getStart(), expression.getEnd());
    if (ENTRY_GUARD.test(condition)) return true;
    return [...guards].some((name) => new RegExp(`\\b${name}\\b`).test(condition));
  };

  const visit = (node, deferred, guarded) => {
    if (DEFERRED.has(node.kind)) {
      ts.forEachChild(node, (child) => visit(child, true, guarded));
      return;
    }
    if (ts.isIfStatement(node)) {
      // Un garde ne protège que SON `then` : le `else` n'est pas plus sûr que le
      // reste du fichier. Et le garde HÉRITÉ compte : `if (isMain) { … if (x) {
      // spawn() } }` est protégé, ce que la première version oubliait — elle
      // accusait `orphan-guard.mjs` et `verify-anon-rls.mjs`, dont l'un des trois
      // `fetch`/`spawn` vit dans un `if` imbriqué sous le garde.
      ts.forEachChild(node.thenStatement, (child) =>
        visit(child, deferred, guarded || isEntryGuard(node.expression)),
      );
      if (node.elseStatement) ts.forEachChild(node.elseStatement, (child) => visit(child, deferred, guarded));
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (!deferred && !guarded) {
        const effect = effectOf(node, source);
        const callee = ts.isCallExpression(node) ? node.expression : null;
        const ownCall = callee && ts.isIdentifier(callee) && locals.has(callee.text);
        if (effect || ownCall) {
          findings.push({
            file,
            ...positionOf(sourceFile, node),
            call: snippetOf(source, node),
            why: effect ? effect.why : `appelle la fonction \`${callee.text}\` de ce fichier`,
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, deferred, guarded));
  };

  ts.forEachChild(sourceFile, (child) => visit(child, false, false));
  return findings;
}

/**
 * Le verdict d'un lot de modules, restreint à ceux qu'un test importe.
 *
 * Anti-vacuité : zéro module analysé est un ÉCHEC, jamais un vert — c'est
 * exactement ce que produirait un changement de convention dans les suites
 * (imports par un helper, alias de chemin), et un contrôle qui n'examine rien
 * est le vert qu'il existe pour empêcher.
 *
 * @param {{ files?: { file: string, text: string }[], importedBy?: Record<string, string[]> }} [input]
 * @returns {{ findings: (object & { importedBy: string[] })[], scanned: { modules: number, imports: number } }}
 */
export function inspectImportEffects({ files = [], importedBy = {} } = {}) {
  const findings = [];
  const imported = files.filter((f) => Object.hasOwn(importedBy, f.file));
  for (const { file, text } of imported) {
    for (const finding of importEffects(text, { file })) {
      findings.push({ ...finding, importedBy: importedBy[file] });
    }
  }
  const imports = Object.values(importedBy).reduce((n, list) => n + list.length, 0);
  return { findings, scanned: { modules: imported.length, imports } };
}

/**
 * Le rapport imprimable. Pure.
 * @param {ReturnType<typeof inspectImportEffects>} result
 * @param {{ lookFor?: string }} [meta]
 * @returns {string[]}
 */
export function formatImportEffectsReport(result, { lookFor = 'tests/*.test.ts' } = {}) {
  const { findings, scanned } = result;
  if (findings.length === 0 && scanned.modules === 0) {
    return [
      `❌ aucun module importé par ${lookFor} n'a été trouvé — un contrôle qui n'examine rien ne prouve rien.`,
    ];
  }
  const lines = [];
  for (const f of findings) {
    lines.push(`❌ ${f.file}:${f.line}:${f.column} — \`${f.call}\` s'exécute à l'import : ${f.why}.`);
    lines.push(`   importé par : ${f.importedBy.join(', ')}`);
    lines.push(
      '   sans garde, la suite écrit ailleurs pendant un simple import — c’est ainsi que le journal d’un job de tests',
    );
    lines.push(
      '   a déclaré une AUTRE automatisation « inerte » (voir scripts/lib/automation-evidence.mjs).',
    );
    lines.push(
      '   remède : `const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;`',
    );
    lines.push('   puis `if (invokedDirectly) main().catch(…)` — exécuter déclare, importer se tait.');
  }
  if (findings.length === 0) {
    lines.push(
      `✅ ${scanned.modules} module(s) importés par ${lookFor} (${scanned.imports} import(s)) : aucun n'écrit dehors à l'import.`,
    );
  }
  return lines;
}
