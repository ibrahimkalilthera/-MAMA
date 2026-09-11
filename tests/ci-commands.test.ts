// Suite for scripts/lib/ci-commands.mjs — the CI ↔ package.json parity core.
//
// The gate protects a property that has already been lost once: CI hand-copying
// a subset of the lint chain and proving less than the machine, green on both
// sides. So the cases here are not about the happy path — they are the three
// shapes a recopy takes (exact, fragment, tool), the ones that must NOT fire
// (`npm run x`, environment tools, a script link called by name), and the two
// ways the gate could be vacuous at the END (nothing read, allowlist rotted).
//
// Plain-node suite (no DOM, no module mocks): the core is pure text in/findings
// out — that is what makes the parse worth asserting instead of hoping.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  CI_ALLOWLIST,
  WORKFLOW_DIR,
  buildScriptIndex,
  entryScript,
  extractRunBlocks,
  formatCiReport,
  inspectCiCommands,
  isScriptInvocation,
  normalizeKey,
  splitCommandSegments,
  tokenize,
  toolIdentity,
} = await import('../scripts/lib/ci-commands.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

type Allowlist = Record<string, { script?: string; reason: string }>;

/** A one-file world: package.json scripts + a workflow, nothing else. */
const audit = (scripts: Record<string, string>, workflow: string, allowlist: Allowlist = {}) =>
  inspectCiCommands({
    pkg: { scripts },
    workflows: [{ file: '.github/workflows/test.yml', text: workflow }],
    allowlist,
  });

/** Minimal workflow wrapper so a step body reads like the real thing. */
const step = (body: string, name = 'Étape') => `jobs:\n  b:\n    steps:\n      - name: ${name}\n${body}`;

describe('tokenize / normalizeKey', () => {
  it('découpe sur les espaces, citations comprises', () => {
    assert.deepEqual(tokenize('node scripts/x.mjs --check'), ['node', 'scripts/x.mjs', '--check']);
  });

  it('retire les guillemets mais garde le contenu espacé en un seul jeton', () => {
    assert.deepEqual(tokenize(`stylelint "src/**/*.css"`), ['stylelint', 'src/**/*.css']);
    assert.deepEqual(tokenize(`echo "deux mots"`), ['echo', 'deux mots']);
  });

  it('la clé canonique ne dépend ni des espaces ni du type de guillemets', () => {
    assert.equal(
      normalizeKey(tokenize(`  node   scripts/x.mjs   --check `)),
      'node scripts/x.mjs --check',
    );
    assert.equal(
      normalizeKey(tokenize(`stylelint "src/**/*.css"`)),
      normalizeKey(tokenize(`stylelint 'src/**/*.css'`)),
    );
  });
});

describe('splitCommandSegments', () => {
  it('coupe sur &&, ||, ;, | et les retours à la ligne', () => {
    assert.deepEqual(splitCommandSegments('a && b || c ; d | e'), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(splitCommandSegments('a\nb\n'), ['a', 'b']);
  });

  it('ne coupe pas à l’intérieur des guillemets (les segments sont du texte brut, les clés sont canoniques)', () => {
    assert.deepEqual(splitCommandSegments(`grep -qi '^x-frame:' <<<"$h" || echo "a && b"`), [
      `grep -qi '^x-frame:' <<<"$h"`,
      `echo "a && b"`,
    ]);
  });

  it('ignore les commentaires et le corps des heredocs — c’est du texte, pas des commandes', () => {
    const body = ['# un commentaire', "cat > .env <<'EOF'", 'VITE_URL=https://x', 'EOF', 'node a.mjs']
      .join('\n');
    assert.deepEqual(splitCommandSegments(body), ['cat > .env', 'node a.mjs']);
  });
});

describe('toolIdentity', () => {
  it('voit le même outil derrière npx, npm exec et l’appel direct', () => {
    assert.equal(toolIdentity(tokenize('npx eslint .')), 'eslint');
    assert.equal(toolIdentity(tokenize('npm exec eslint -- .')), 'eslint');
    assert.equal(toolIdentity(tokenize('eslint . --max-warnings 0')), 'eslint');
  });

  it('identifie un script node par son script, pas par l’interpréteur', () => {
    assert.equal(toolIdentity(tokenize('node scripts/x.mjs --check')), 'node scripts/x.mjs');
    assert.equal(toolIdentity(tokenize('node --import tsx --test a.test.ts')), 'node a.test.ts');
  });

  it('un `node` sans script est trop générique pour juger', () => {
    assert.equal(toolIdentity(tokenize('node -e "console.log(1)"')), null);
  });
});

describe('extractRunBlocks', () => {
  it('lit le `run:` en ligne et attribue l’étape', () => {
    const blocks = extractRunBlocks(step('        run: npm ci', 'Installer'));
    assert.deepEqual(blocks, [{ line: 5, step: 'Installer', command: 'npm ci' }]);
  });

  it('lit un bloc `run: |` jusqu’à la dé-indentation, avec le bon numéro de ligne', () => {
    const text = step(['        run: |', '          set -e', '          node a.mjs', '', '      - name: Après'].join('\n'), 'Bloc');
    const blocks = extractRunBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].line, 5);
    assert.equal(blocks[0].step, 'Bloc');
    assert.equal(blocks[0].command.trim().split('\n').length, 2);
  });

  it('CRLF : les fichiers du dépôt sont en CRLF, la lecture doit être identique', () => {
    // Paid for: with a plain split('\n') the trailing \r made the run/anchor
    // regexes miss almost every step (8 workflows read as 4 commands), i.e. a
    // gate silently reading 10% of the CI and reporting green.
    const lf = extractRunBlocks(step('        run: npm ci', 'Installer'));
    const crlf = extractRunBlocks(step('        run: npm ci', 'Installer').replace(/\n/g, '\r\n'));
    assert.deepEqual(crlf, lf);
    assert.deepEqual(extractRunBlocks('        run: |\r\n          node a.mjs\r\n'), [
      { line: 1, step: null, command: '          node a.mjs' },
    ]);
    assert.deepEqual(
      extractRunBlocks('        run: |\r\n          node a.mjs\r\n'),
      extractRunBlocks('        run: |\n          node a.mjs\n'),
    );
  });
});

describe('isScriptInvocation', () => {
  it('reconnaît l’appel d’un script — la façon correcte', () => {
    for (const cmd of ['npm run lint', 'npm test', 'npm ci', 'npm run electron:ui']) {
      assert.equal(isScriptInvocation(tokenize(cmd)), true, cmd);
    }
    assert.equal(isScriptInvocation(tokenize('node scripts/x.mjs')), false);
  });
});

describe('inspectCiCommands — les trois formes de recopie', () => {
  it('exacte : la même commande qu’un script, et l’allowlist ne la sauve pas', () => {
    const found = audit(
      { 'check:contrast': 'node scripts/theme-contrast-audit.mjs' },
      step('        run: node scripts/theme-contrast-audit.mjs', 'Contraste'),
      { 'node scripts/theme-contrast-audit.mjs': { reason: 'je préfère' } },
    );
    assert.equal(found.violations.length, 1);
    assert.equal(found.violations[0].rule, 'exact');
    assert.equal(found.violations[0].script, 'check:contrast');
    assert.equal(found.violations[0].step, 'Contraste');
    assert.match(found.violations[0].remedy!, /npm run check:contrast/);
  });

  it('fragment : un maillon d’une chaîne `&&`, donc une garantie qui peut se perdre', () => {
    const scripts = { 'lint:chain': 'node scripts/check-node-version.mjs && eslint .' };
    const workflow = step('        run: node scripts/check-node-version.mjs');
    assert.equal(audit(scripts, workflow).violations[0].rule, 'fragment');
    const allowed = audit(scripts, workflow, {
      'node scripts/check-node-version.mjs': { reason: 'preuve par job' },
    });
    assert.equal(allowed.violations.length, 0);
    assert.equal(allowed.allowed[0].occurrences, 1);
    assert.equal(allowed.staleAllowlist.length, 0);
  });

  it('le remède nomme l’entrée publique, pas le maillon interne', () => {
    // `lint` lance `lint:chain` sous le runtime épinglé (`--npm`) : dire à un
    // job CI « npm run lint:chain » serait lui conseiller de sauter le pin.
    const found = audit(
      {
        lint: 'node scripts/with-pinned-node.mjs --npm lint:chain',
        'lint:chain': 'node scripts/check-node-version.mjs && eslint . --max-warnings 0',
      },
      step('        run: npx eslint .'),
    );
    assert.match(found.violations[0].remedy!, /npm run lint\b/);
    assert.doesNotMatch(found.violations[0].remedy!, /lint:chain/);
  });

  it('outil : la commande est réécrite à la main avec ses propres drapeaux', () => {
    const found = audit(
      { 'lint:chain': 'eslint . --max-warnings 0 && tsc --noEmit' },
      step('        run: npx eslint .'),
    );
    assert.equal(found.violations.length, 1);
    assert.equal(found.violations[0].rule, 'tool');
    assert.equal(found.violations[0].script, 'lint:chain');
  });
});

describe('entryScript — la commande à conseiller', () => {
  it('remonte les maillons `--npm` jusqu’à l’entrée, sans boucler sur un cycle', () => {
    const index = buildScriptIndex({
      scripts: {
        a: 'node scripts/with-pinned-node.mjs --npm b',
        b: 'node scripts/with-pinned-node.mjs --npm c',
        c: 'eslint .',
      },
    });
    assert.equal(entryScript('c', index), 'a');
    assert.equal(entryScript('a', index), 'a', 'une entrée sans appelant est son propre remède');
    const cyclic = { linkOwner: new Map([['x', 'y'], ['y', 'x']]) };
    assert.ok(['x', 'y'].includes(entryScript('x', cyclic)), 'un cycle ne doit pas figer le garde');
  });

  it('une composition `npm run x` n’est pas un maillon interne', () => {
    const index = buildScriptIndex({
      scripts: { 'a:ui': 'vite build', 'a:dist': 'npm run a:ui && electron-builder --win' },
    });
    assert.equal(entryScript('a:ui', index), 'a:ui');
  });
});

describe('inspectCiCommands — ce qui ne doit PAS déclencher', () => {
  it('appeler un script par son nom, même s’il est un maillon d’un autre script', () => {
    const found = audit(
      { 'electron:dist': 'npm run electron:ui && electron-builder --win' },
      step('        run: npm run electron:ui'),
    );
    assert.equal(found.violations.length, 0);
  });

  it('les commandes de l’environnement : `rm -rf build/` n’est pas une recopie de `clean`', () => {
    const found = audit(
      { clean: 'rm -rf dist' },
      step('        run: rm -rf build/'),
    );
    assert.equal(found.violations.length, 0);
  });

  it('la structure shell n’est pas une commande, mais ce qu’elle enveloppe est jugé', () => {
    const result = audit({ 'lint:chain': 'node scripts/x.mjs' }, step(['        run: |', '          if [ -f x ]; then node scripts/x.mjs; fi'].join('\n')));
    assert.equal(result.violations.length, 1, 'le vrai maillon reste détecté');
    assert.equal(result.scanned.commands, 1, '`if`/`then`/`fi` ne sont pas des commandes');
    assert.equal(result.violations[0].command, 'then node scripts/x.mjs', 'la commande derrière `then` est jugée');
  });
});

describe('inspectCiCommands — les façons d’être vert à tort', () => {
  it('une allowlist qui ne correspond plus est signalée obsolète', () => {
    const found = audit({ 'lint:chain': 'node scripts/a.mjs' }, step('        run: npm ci'), {
      'node scripts/a.mjs': { reason: 'périmé' },
    });
    assert.deepEqual(found.staleAllowlist, ['node scripts/a.mjs']);
  });

  it('zéro commande lue est une ERREUR, jamais un vert silencieux', () => {
    const result = inspectCiCommands({ pkg, workflows: [], allowlist: {} });
    assert.equal(result.scanned.commands, 0);
    const lines = formatCiReport(result);
    assert.ok(lines.some((l) => l.includes('ne prouve rien')), lines.join('\n'));
    assert.ok(!lines.some((l) => l.startsWith('✅')), 'aucune ligne verte sur un monde vide');
  });

  it('le rapport nomme le fichier, la ligne, l’étape et le remède', () => {
    const found = audit({ 'check:x': 'node scripts/x.mjs' }, step('        run: node scripts/x.mjs', 'X'));
    const lines = formatCiReport(found).join('\n');
    assert.match(lines, /❌ \.github\/workflows\/test\.yml:5 \(étape « X »\)/);
    assert.match(lines, /npm run check:x/);
  });
});

describe('le dépôt réel : 0 recopie, et le garde lit bien toute la CI', () => {
  const files = readdirSync(join(root, WORKFLOW_DIR)).filter((n) => /\.ya?ml$/.test(n)).sort();
  const result = inspectCiCommands({
    pkg,
    workflows: files.map((n) => ({
      file: `${WORKFLOW_DIR}/${n}`,
      text: readFileSync(join(root, WORKFLOW_DIR, n), 'utf8'),
    })),
    allowlist: CI_ALLOWLIST,
  });

  it('ne trouve aucune recopie et aucune entrée d’allowlist périmée', () => {
    assert.deepEqual(
      result.violations.map((v) => `${v.file}:${v.line} — ${v.command}`),
      [],
    );
    assert.deepEqual(result.staleAllowlist, []);
  });

  it('lit chaque workflow, et aucune commande d’un `run:` n’échappe à l’extraction', () => {
    assert.equal(result.scanned.workflows, files.length);
    const runLines = files.reduce(
      (n, f) => n + (readFileSync(join(root, WORKFLOW_DIR, f), 'utf8').match(/^\s*run:/gm)?.length ?? 0),
      0,
    );
    const blocks = files.reduce(
      (n, f) => n + extractRunBlocks(readFileSync(join(root, WORKFLOW_DIR, f), 'utf8')).length,
      0,
    );
    assert.equal(blocks, runLines, 'chaque `run:` du dépôt doit être lu');
    assert.ok(result.scanned.commands > blocks, 'les blocs shell doivent rendre plusieurs commandes');
  });

  it('l’exception d’allowlist reste exercée (sinon elle serait déjà obsolète)', () => {
    const entry = result.allowed.find((a) => a.key === 'node scripts/check-node-version.mjs');
    assert.ok(entry, 'l’entrée de parité Node doit correspondre à de vrais pas de CI');
    assert.ok(entry!.occurrences >= 2, `occurrences : ${entry!.occurrences}`);
  });

  it('la CI appelle le contraste par son nom, plus par la commande recopiée', () => {
    const guard = readFileSync(join(root, '.github/workflows/perf-guard.yml'), 'utf8');
    assert.match(guard, /run: npm run check:contrast/);
    assert.doesNotMatch(guard, /run: node scripts\/theme-contrast-audit\.mjs/);
  });

  it('le garde est branché dans la chaîne locale', () => {
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-ci-commands\.mjs/);
  });
});
