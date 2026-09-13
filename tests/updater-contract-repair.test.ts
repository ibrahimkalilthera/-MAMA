// Suite for scripts/lib/updater-contract-repair.mjs (+ the CLI's refusals).
//
// WHY THIS EXISTS
// ---------------
// Un poste qui a installé la 1.0.6, la 1.0.7 ou la 1.0.8 porte un contrat
// (`resources/app-update.yml`) qui promet un signataire de TEST. C'est SON code
// qui refuse l'installeur, donc rien côté canal ne peut le débloquer : le seul
// remède est de retirer la promesse de CE fichier. Ce module le fait — et ce qui
// compte ici, c'est surtout ce qu'il REFUSE de faire : toucher une promesse
// satisfiable, ou conclure sans avoir relu les octets écrits.
//
// Le contrat reproduit ci-dessous est celui MESURÉ dans les installeurs publiés,
// mot pour mot : c'est sa forme qui compte, pas une forme inventée par le test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { contractState, stripPublisherPromise } from '../scripts/lib/updater-contract-repair.mjs';
import { parsePublisherNames } from '../scripts/lib/updater-trust.mjs';

/** Le contrat EMBARQUÉ dans les installeurs 1.0.6 → 1.0.8, mot pour mot. */
const FROZEN_CONTRACT = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
  'publisherName:',
  '  - Mama Thera Finance (test)',
].join('\n');

/** Le contrat de la 1.0.9 publiée : aucune promesse, donc un poste normal. */
const FREE_CONTRACT = [
  'owner: ibrahimkalilthera',
  "repo: '-MAMA'",
  'provider: github',
  'updaterCacheDirName: mama-thera-finance-updater',
].join('\n');

const CLI = 'scripts/repair-frozen-updater.mjs';

/** Un dossier d'installation jetable : `<tmp>/resources/app-update.yml`. */
function fixture(contract: string): string {
  const dir = mkdtempSync('.probe-repair-');
  mkdirSync(join(dir, 'resources'), { recursive: true });
  writeFileSync(join(dir, 'resources', 'app-update.yml'), contract, 'utf8');
  return dir;
}

function runCli(args: string[]): { code: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: String(stdout ?? '') };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

const contractOf = (dir: string) => readFileSync(join(dir, 'resources', 'app-update.yml'), 'utf8');

describe('ce qu’impose un contrat de mise à jour', () => {
  it('le signataire de test MESURÉ est un gel, et le verdict dit pourquoi', () => {
    const state = contractState(FROZEN_CONTRACT);
    assert.equal(state.frozen, true);
    assert.deepEqual(state.names, ['Mama Thera Finance (test)']);
    assert.match(state.because, /certificat auto-signé n’est approuvé/);
  });

  it('sans promesse, le poste n’est pas gelé : il se met à jour', () => {
    const state = contractState(FREE_CONTRACT);
    assert.equal(state.promised, false);
    assert.equal(state.frozen, false);
    assert.match(state.because, /sha512/);
  });

  it('une promesse VIDE est un gel par construction, comme pour electron-updater', () => {
    const state = contractState('publisherName:\nprovider: github\n');
    assert.equal(state.frozen, true);
    assert.match(state.because, /liste vide/);
  });

  it('une promesse satisfiable n’est PAS un gel — la retirer baisserait la sécurité', () => {
    const state = contractState('publisherName:\n  - Mama Thera Finance\nprovider: github\n');
    assert.equal(state.promised, true);
    assert.equal(state.frozen, false);
    assert.match(state.because, /satisfiable/);
  });
});

describe('retirer la promesse, sans toucher au reste', () => {
  it('la forme mesurée part, la promesse disparaît, le reste est intact', () => {
    const { text, changed, removed } = stripPublisherPromise(FROZEN_CONTRACT);
    assert.equal(changed, true);
    assert.deepEqual(removed, ['publisherName:', '  - Mama Thera Finance (test)']);
    assert.equal(parsePublisherNames(text).promised, false, 'la référence est le parseur, pas cette fonction');
    // Le reste est là, octet pour octet : c'est ce fichier que le poste lit.
    for (const line of ["repo: '-MAMA'", 'provider: github', 'updaterCacheDirName: mama-thera-finance-updater']) {
      assert.ok(text.includes(line), line);
    }
    assert.doesNotMatch(text, /Mama Thera Finance \(test\)/);
  });

  it('la clé SUIVANTE n’est jamais emportée par la liste', () => {
    const text = 'publisherName:\n  - Mama Thera Finance (test)\nprovider: github\nupdaterCacheDirName: mama-thera-finance-updater\n';
    const stripped = stripPublisherPromise(text);
    assert.equal(stripped.text, 'provider: github\nupdaterCacheDirName: mama-thera-finance-updater\n');
  });

  it('la forme en ligne est retirée aussi', () => {
    const stripped = stripPublisherPromise('publisherName: Mama Thera Finance (test)\nprovider: github\n');
    assert.equal(stripped.text, 'provider: github\n');
  });

  it('les fins de ligne CRLF sont préservées', () => {
    const text = 'publisherName:\r\n  - Mama Thera Finance (test)\r\nprovider: github\r\n';
    const stripped = stripPublisherPromise(text);
    assert.equal(stripped.text, 'provider: github\r\n');
  });

  it('sans promesse, RIEN n’est écrit et l’opération le dit', () => {
    const stripped = stripPublisherPromise(FREE_CONTRACT);
    assert.equal(stripped.changed, false);
    assert.equal(stripped.text, FREE_CONTRACT, 'un fichier libre reste identique, octet pour octet');
  });
});

describe('le CLI : il répare ce qui est gelé, et rien d’autre', () => {
  it('sans `--apply`, il NOMME le gel, n’écrit pas un octet, et sort en rouge', () => {
    const dir = fixture(FROZEN_CONTRACT);
    try {
      const { code, output } = runCli([`--dir=${dir}`]);
      // Sortir en 0 sur un poste gelé ferait passer le gel pour un état normal :
      // la lecture est aussi un CONTRÔLE, et un poste qui ne recevra plus rien
      // est exactement ce qu'une stratégie de parc doit pouvoir repérer.
      assert.equal(code, 1, 'un contrat gelé trouvé rend un verdict rouge, même sans écrire');
      assert.match(output, /GELÉ/);
      assert.match(output, /rien n’a été écrit/);
      assert.match(output, /est le geste qui répare/);
      assert.match(output, /Relancez avec « --apply »|Relancez avec `--apply`/);
      assert.equal(contractOf(dir), FROZEN_CONTRACT, 'la lecture ne modifie pas le contrat');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('`--apply` retire la promesse, sauvegarde l’original, et relit ce qu’il a écrit', () => {
    const dir = fixture(FROZEN_CONTRACT);
    try {
      const { code, output } = runCli([`--dir=${dir}`, '--apply']);
      assert.equal(code, 0);
      assert.equal(parsePublisherNames(contractOf(dir)).promised, false);
      assert.equal(readFileSync(`${join(dir, 'resources', 'app-update.yml')}.bak`, 'utf8'), FROZEN_CONTRACT);
      assert.match(output, /promesse retirée/);
      assert.match(output, /RELANCER l’application/, 'le poste ne relit ce fichier qu’au démarrage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un second passage ne « répare » rien : il dit que le poste est libre', () => {
    const dir = fixture(FROZEN_CONTRACT);
    try {
      runCli([`--dir=${dir}`, '--apply']);
      const second = runCli([`--dir=${dir}`, '--apply']);
      assert.equal(second.code, 0);
      assert.match(second.output, /déjà libre/);
      assert.doesNotMatch(second.output, /promesse retirée/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('une promesse SATISFIABLE est laissée en place, et le refus est expliqué', () => {
    const contract = 'repo: \'-MAMA\'\nprovider: github\nupdaterCacheDirName: mama-thera-finance-updater\npublisherName:\n  - Mama Thera Finance\n';
    const dir = fixture(contract);
    try {
      const { code, output } = runCli([`--dir=${dir}`, '--apply']);
      assert.equal(code, 0);
      assert.equal(contractOf(dir), contract, 'une garantie ne se retire pas par accident');
      assert.match(output, /laissé en place/);
      assert.match(output, /--apply --force/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('`--force` retire une promesse satisfiable — explicitement', () => {
    const contract = 'repo: \'-MAMA\'\nprovider: github\nupdaterCacheDirName: mama-thera-finance-updater\npublisherName:\n  - Mama Thera Finance\n';
    const dir = fixture(contract);
    try {
      const { code, output } = runCli([`--dir=${dir}`, '--apply', '--force']);
      assert.equal(code, 0);
      assert.equal(parsePublisherNames(contractOf(dir)).promised, false);
      assert.match(output, /sur demande explicite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le contrat d’une AUTRE application n’est ni compté ni touché', () => {
    const contract = 'repo: \'autre/application\'\nprovider: github\nupdaterCacheDirName: autre-updater\npublisherName:\n  - Autre Editeur (test)\n';
    const dir = fixture(contract);
    try {
      const { code, output } = runCli([`--dir=${dir}`, '--apply']);
      assert.equal(code, 0);
      assert.equal(contractOf(dir), contract, 'ce script ne répare pas les mises à jour des autres');
      assert.match(output, /0 contrat\(s\) de cette application/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un dossier sans contrat est un refus NOMMÉ, pas un vert silencieux', () => {
    const dir = mkdtempSync('.probe-repair-empty-');
    try {
      const { code, output } = runCli([`--dir=${dir}`]);
      assert.equal(code, 2, 'viser un dossier qui n’en est pas un ne peut pas conclure « rien à faire »');
      assert.match(output, /aucun « app-update\.yml »/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('le remède est câblé dans package.json, pour un parc', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.equal(pkg.scripts['repair:frozen-updater'], `node ${CLI}`);
    assert.ok(existsSync(CLI));
  });
});
