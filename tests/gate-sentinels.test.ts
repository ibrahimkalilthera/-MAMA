// Suite for scripts/lib/gate-sentinels.mjs + the gate that runs it.
//
// The rule it locks: a marker that a control re-reads from RUN LOGS may only be
// printed by the automation whose voice it is. Everything else that prints it
// writes a sentence in a journal that looks exactly like a declaration — the
// 2026-09-12 incident, where a test job's log carried Dependabot's inaction mark
// and the audit blamed the workflow that owned the log.
//
// Two remedies already exist upstream (the structured proof carries its subject;
// importing a script no longer works). Neither closes the last hole: a suite
// printing a marker from INSIDE a test body — deferred code, so the import gate
// never sees it, and the log receives it all the same.
//
// Note on style, because it is the point: the fixture below is COMPOSED, never
// written as a printing line. This suite lives in tests/, which this very gate
// scans — a literal `console.log(evidenceLine(…))` in the source would make the
// suite fail the rule it is testing. Same lesson as the marker itself.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVIDENCE_PREFIX } from '../scripts/lib/automation-evidence.mjs';
import {
  DEFINITIONS,
  GATE_SENTINELS,
  blankComments,
  formatSentinelReport,
  inspectSentinelPrinters,
} from '../scripts/lib/gate-sentinels.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Le mot « imprimer » et le nom du canal, sans jamais les coller en source. */
const PRINT = ['console', '.', 'log'].join('');

describe('la règle — qui a le droit d’imprimer une sentinelle', () => {
  it('une suite qui imprime une sentinelle est un constat, avec fichier et ligne', () => {
    const text = [
      "import { evidenceAnnotation } from '../scripts/lib/automation-evidence.mjs';",
      '',
      "it('x', () => {",
      `  ${PRINT}(evidenceAnnotation({ workflow: 'dependabot-rebase.yml', acted: false }));`,
      '});',
      '',
    ].join('\n');
    const { findings } = inspectSentinelPrinters({ files: [{ file: 'tests/x.test.ts', text }] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'tests/x.test.ts');
    assert.equal(findings[0].line, 4);
    assert.equal(findings[0].token, EVIDENCE_PREFIX);
  });

  it('l’automatisation dont c’est la voix garde le droit de parler', () => {
    const { findings } = inspectSentinelPrinters({
      files: [{ file: 'scripts/rebase-dependabot-prs.mjs', text: `${PRINT}(evidenceAnnotation(X));\n` }],
    });
    assert.deepEqual(findings, [], 'l’émetteur est déclaré : sa sortie EST la déclaration');
  });

  it('le fichier qui DÉFINIT la preuve est exempté (il la nomme, il ne l’imprime pas)', () => {
    const { findings } = inspectSentinelPrinters({
      files: [{ file: DEFINITIONS, text: `${PRINT}(evidenceAnnotation(X));\n` }],
    });
    assert.deepEqual(findings, []);
  });

  it('imprimer autre chose reste permis : le garde ne juge que les sentinelles', () => {
    const text = [`${PRINT}('✅ les 10 automatisations ont agi');`, `${PRINT}(\`total \${n}\`);`, ''].join('\n');
    assert.deepEqual(inspectSentinelPrinters({ files: [{ file: 'scripts/x.mjs', text }] }).findings, []);
  });

  it('la sentinelle est bien celle du canal STRUCTURÉ — il n’en reste qu’une', () => {
    // Le transport par journal est mort : sa marque textuelle n’existe plus, donc
    // la surveillance porte sur le seul sentier qui reste (l’annotation).
    const text = `${PRINT}('${EVIDENCE_PREFIX}' + JSON.stringify(x));\n`;
    const { findings } = inspectSentinelPrinters({ files: [{ file: 'tests/y.test.ts', text }] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].token, EVIDENCE_PREFIX);
    assert.equal(GATE_SENTINELS.length, 1, 'deux entrées pour un canal, c’est une à retirer');
  });

  it('un commentaire qui CITE l’impression n’en est pas une (le run réel a mordu sur sa propre prose)', () => {
    const text = [
      '// un exemple de garde :',
      `//   ${PRINT}(evidenceLine({ workflow: 'x.yml', acted: false }));`,
      '/* et en bloc : ',
      `   ${PRINT}(evidenceLine(X));`,
      '*/',
      '',
    ].join('\n');
    assert.deepEqual(inspectSentinelPrinters({ files: [{ file: 'tests/n.test.ts', text }] }).findings, []);
    // Et le blanchiment garde les numéros de ligne : un constat doit tomber juste.
    assert.equal(blankComments(text).split('\n').length, text.split('\n').length);
  });

  it('zéro fichier, zéro sentinelle : le rapport refuse de conclure', () => {
    const report = formatSentinelReport(inspectSentinelPrinters({ files: [] }));
    assert.match(report[0], /ne prouve rien/);
  });
});

describe('l’inventaire — il n’existe qu’une fois, et il est lu', () => {
  it('les sentinelles viennent des constantes partagées, jamais recopiées', () => {
    assert.deepEqual(
      GATE_SENTINELS.map((s) => s.token).sort(),
      [EVIDENCE_PREFIX].sort(),
      'un marqueur renommé doit être surveillé sans qu’on y pense',
    );
    for (const sentinel of GATE_SENTINELS) {
      assert.ok(sentinel.readBy, 'chaque sentinelle nomme le contrôle qui la lit');
      assert.ok(sentinel.emitters.length > 0, 'sinon personne ne pourrait jamais la déclarer');
      // Le lecteur doit réellement lire le marqueur : une entrée qui ne pointe
      // vers rien serait de la décoration.
      const reader = readFileSync(join(root, sentinel.readBy), 'utf8');
      assert.match(reader, /automation-evidence|EVIDENCE|INERT/, `le lecteur ${sentinel.readBy} doit lire la marque`);
    }
  });

  it('le producteur déclare bien la sentinelle qu’il émet, et une seule fois', () => {
    const producer = readFileSync(join(root, 'scripts', 'rebase-dependabot-prs.mjs'), 'utf8');
    assert.match(producer, /evidenceAnnotation\(\{ workflow: WORKFLOW_FILE, acted: false/, 'la preuve d’inaction est signée');
    assert.match(producer, /evidenceAnnotation\(\{\s*workflow: WORKFLOW_FILE,\s*acted: true/, 'et celle d’action aussi');
    assert.match(producer, /const inertReason =/, 'la raison est écrite une fois et partagée');
  });

  it('le CLI lit tests/ ET scripts/, et la chaîne qualité le fait tourner', () => {
    const cli = readFileSync(join(root, 'scripts', 'check-gate-sentinels.mjs'), 'utf8');
    assert.match(cli, /walk\(join\(ROOT, 'tests'\)/, 'une suite de tests est un imprimeur comme un autre');
    assert.match(cli, /walk\(join\(ROOT, 'scripts'\)/, 'un script peut imprimer dans le journal du job');
    assert.match(cli, /ne peut rien prouver/, 'un dossier illisible est un échec');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:gate-sentinels'], /check-gate-sentinels\.mjs/);
    assert.match(pkg.scripts['lint:chain'], /node scripts\/check-gate-sentinels\.mjs/);
  });

  it('le corpus réel est propre (c’est le contrôle, vu de loin)', () => {
    const out = execFileSync(process.execPath, ['scripts/check-gate-sentinels.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(out, /aucun n’imprime une sentinelle/);
  });
});
