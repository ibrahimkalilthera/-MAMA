// ─────────────────────────────────────────────────────────────────────────────
// UN WORKFLOW QUE YAML REFUSE NE TOURNE PAS — ET RIEN NE LE DISAIT
//
// Ce que cette suite garde est mesuré, pas supposé. Le 2026-10-14, `014baeb`
// (1.0.32) a ajouté à `.github/workflows/public-rls-watch.yml` deux noms d'étape
// français portant un ` : ` NON QUOTÉ. YAML y voit une clé au milieu d'une
// valeur, refuse le fichier entier, et GitHub tue alors chaque run AU DÉMARRAGE :
// zéro job, aucun log, sur toutes les branches. La veille « une table de public
// sans RLS » — celle qui existe parce que la clé publique du site avait rendu
// 14 lignes d'élèves, de parents et de notes médicales — est restée morte deux
// jours, et les onze branches Dependabot ont porté la faute : leurs runs
// échouaient au démarrage pour la même raison que celui de `main`.
//
// La règle vit dans `scripts/lib/workflow-scalars.mjs`, la porte dans
// `scripts/check-workflow-syntax.mjs`. Ce que cette suite éprouve :
//
//   1. la règle ATTRAPE la panne réelle — les deux lignes telles qu'elles ont
//      été commitées —, et la répare en les quotant ;
//   2. elle ne mord PAS sur trois formes légitimes (valeur quotée, contenu d'un
//      bloc littéral, commentaire final) : un garde qui rougit sur du code
//      légitime est un garde qu'on contourne ;
//   3. la porte REFUSE DE NE RIEN LIRE, des deux façons (fichier illisible ou
//      absent, et zéro scalaire examiné) — une règle qui ne regarde plus rien
//      n'est pas un vert ;
//   4. l'arbre réel est propre, et la porte est câblée + inventoriée.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUARD_INVENTORY, IMMUNITY } from '../scripts/lib/guard-immunity.mjs';
import { bareScalar, countMappingScalars, findBrokenScalars } from '../scripts/lib/workflow-scalars.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'scripts/check-workflow-syntax.mjs';
const WORKFLOWS = '.github/workflows';
const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Les deux lignes EXACTES de la panne — celles que `014baeb` a commitées. */
const BROKEN_NAMES = [
  "      - name: Gate — politiques RLS : la base porte-t-elle ce que les migrations déclarent ?",
  "      - name: Gate — index, contraintes et déclencheurs : la base porte-t-elle ce que les migrations déclarent ?",
].join('\n');

type Run = { status: number | undefined; stdout: string; stderr: string };

/** Lance la porte dans un dossier donné — le lecteur lit `$cwd/.github/workflows`. */
function runGate(cwd: string): Run {
  try {
    const stdout = execFileSync(process.execPath, [join(root, GATE)], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Écrit une arborescence `.github/workflows/` de fixtures, lance `fn`. */
function withWorkflows<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mama-workflow-syntax-'));
  try {
    mkdirSync(join(dir, WORKFLOWS), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, WORKFLOWS, name), content, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('workflow-syntax — un scalaire non quoté qui porte « : » tue le workflow', () => {
  it('la panne réelle est attrapée, avec ses lignes', () => {
    const found = findBrokenScalars(BROKEN_NAMES);
    assert.equal(found.length, 2, 'les deux noms d’étape doivent être accusés');
    assert.deepEqual(found.map((f) => f.line), [1, 2]);
    assert.deepEqual(found.map((f) => f.key), ['name', 'name']);
    assert.match(found[0].text, /politiques RLS : la base/);
  });

  it('la réparer suffit : la même ligne quotée n’est plus accusée', () => {
    const quoted = BROKEN_NAMES.split('\n')
      .map((line) => line.replace("name: Gate", "name: 'Gate").concat("'"))
      .join('\n');
    assert.deepEqual(findBrokenScalars(quoted), [], 'une valeur quotée est légitime');
  });

  it('les trois formes légitimes ne sont pas accusées (guillemets, bloc littéral, commentaire)', () => {
    const legit = [
      'run: echo "a: b"', // le `:` est DANS une chaîne
      'name: "Gate — RLS : la base"', // entièrement quoté
      'run: |',
      '  echo "dans un bloc: ceci est du shell"', // bloc littéral : ce n'est pas du YAML
      '  yaml_in_heredoc: pas jugé non plus',
      'timeout-minutes: 10  # mesure : 8 min sur un runner lent', // le commentaire final est coupé
      'if: ${{ github.event_name == \'push\' }}',
      'paths: [main]', // collection en ligne
      'image: node:20', // `:` sans espace : YAML l’accepte
    ].join('\n');
    assert.deepEqual(findBrokenScalars(legit), [], 'aucune de ces formes n’est cassée');
    assert.equal(bareScalar('echo "a: b"'), 'echo', 'les segments quotés sortent du jugement');
    assert.equal(bareScalar('x  # note : y'), 'x', 'le commentaire final aussi');
  });

  it('le compteur de vacuité compte ce qui est RÉELLEMENT examiné', () => {
    assert.ok(countMappingScalars(BROKEN_NAMES) >= 2, 'les deux lignes comptent');
    assert.equal(countMappingScalars('# rien que de la prose\n'), 0, 'un fichier sans scalaire compte 0');
    assert.equal(
      countMappingScalars('run: |\n  foo: bar\n  baz: qux\n'),
      1,
      'le contenu d’un bloc littéral n’est pas un scalaire : seule la clé du bloc compte',
    );
  });

  it('les vingt workflows du dépôt sont acceptés (et il y en a bien vingt à lire)', () => {
    const names = readdirSync(join(root, WORKFLOWS)).filter((n) => /\.ya?ml$/.test(n)).sort();
    assert.ok(names.length >= 20, `seulement ${names.length} workflow(s) lus — le corpus a rétréci`);
    let examined = 0;
    const findings: string[] = [];
    for (const name of names) {
      const text = read(join(WORKFLOWS, name));
      examined += countMappingScalars(text);
      for (const hit of findBrokenScalars(text)) findings.push(`${name}:${hit.line} ${hit.text}`);
    }
    assert.ok(examined > 0, 'le dépôt doit offrir des scalaires à juger');
    assert.deepEqual(findings, [], `scalaire(s) refusé(s) par YAML :\n${findings.join('\n')}`);
  });

  it('la porte mord : un fichier cassé fait échouer le run, en nommant la ligne', () => {
    withWorkflows({ 'broken.yml': `name: x\njobs:\n  a:\n    steps:\n${BROKEN_NAMES}\n` }, (dir) => {
      const result = runGate(dir);
      assert.equal(result.status, 1, 'une valeur cassée doit faire échouer la porte');
      assert.match(result.stderr, /broken\.yml:5/, 'la ligne fautive est nommée');
      assert.match(result.stderr, /ne PEUT PAS tourner/);
    });
  });

  it('la porte refuse la vacuité, dans ses deux formes', () => {
    withWorkflows({ 'readme.txt': 'pas un workflow\n' }, (dir) => {
      assert.equal(runGate(dir).status, 2, 'aucun fichier de workflow lu → sortie 2');
    });
    withWorkflows({ 'prose.yml': '# rien que de la prose\n' }, (dir) => {
      const result = runGate(dir);
      assert.equal(result.status, 2, 'aucun scalaire examiné → sortie 2');
      assert.match(result.stderr, /Rien à juger/);
    });
  });

  it('la porte est câblée dans `npm run lint` et déclarée dans l’inventaire', () => {
    const chain = [PKG.scripts.lint, PKG.scripts['lint:chain']].join(' && ');
    assert.match(chain, /node scripts\/check-workflow-syntax\.mjs/, 'la porte doit tourner à chaque commit');

    const entry = GUARD_INVENTORY.find((e: { check: string }) => e.check === 'check-workflow-syntax.mjs');
    assert.ok(entry, 'un contrôle non déclaré est un échec de check-guard-immunity');
    const needs = (entry as { needs?: string[] }).needs ?? [];
    assert.ok(needs.includes(IMMUNITY.NON_VACUOUS), 'il doit refuser la vacuité');
    const exempt = (entry as { exempt?: Record<string, string> }).exempt ?? {};
    assert.ok(
      (exempt[IMMUNITY.PROSE_BLIND] ?? '').length > 20,
      'l’exemption de prose doit dire POURQUOI (la règle blanchit elle-même)',
    );
  });
});
