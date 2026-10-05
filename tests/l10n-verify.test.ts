/**
 * Le contrôle de cohérence i18n doit MORDRE, pas seulement rassurer.
 *
 * `scripts/l10n-verify.mjs` vérifie trois choses sur les domaines
 * (`src/i18n/domains/*.ts`) : la parité en/fr, l'ORDRE des clés en/fr dans
 * chaque domaine, et l'absence de clé définie dans PLUSIEURS domaines (le
 * spread du baril écraserait silencieusement l'une des deux définitions).
 *
 * Les deux derniers points ont été ajoutés après avoir trouvé une collision
 * réelle (`noStudentsInSystemTitle`/`Hint` définis à la fois dans `common` et
 * dans `admin` : la valeur de `admin` gagnait, celle de `common` était morte).
 * Un contrôle qui ne prouve pas qu'il sait échouer ne vaut pas mieux qu'un
 * commentaire : chaque cas ci-dessous pointe le script sur une RACINE D'ESSAI
 * et vérifie le message et le code de sortie.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/l10n-verify.mjs';

function run(domainsDir?: string) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: domainsDir ? { ...process.env, L10N_DOMAINS_DIR: domainsDir } : process.env,
  });
}

/** Crée une racine d'essai et y écrit les fichiers de domaine fournis. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mama-l10n-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const both = (en: string[], fr: string[]): string =>
  `export const en = {\n${en.map((k) => `  ${k}: "x",`).join('\n')}\n};\n` +
  `export const fr = {\n${fr.map((k) => `  ${k}: "x",`).join('\n')}\n};\n`;

describe('l10n-verify — les contrôles d’ordre et de doublons mordent', () => {
  it('la racine réelle passe (parité, ordre, aucun doublon)', () => {
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Ordre des clés identique en\/fr dans chaque domaine, aucun doublon/);
  });

  it('accepte une racine d’essai cohérente', () => {
    const dir = fixture({
      'common.ts': both(['alpha', 'beta'], ['alpha', 'beta']),
      'other.ts': both(['gamma'], ['gamma']),
    });
    try {
      const result = run(dir);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Ordre des clés identique en\/fr/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse une clé définie dans deux domaines, en nommant les coupables', () => {
    const dir = fixture({
      'common.ts': both(['alpha', 'beta'], ['alpha', 'beta']),
      // `beta` vit aussi dans `other` : le spread écraserait common.
      'other.ts': both(['beta'], ['beta']),
    });
    try {
      const result = run(dir);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /PLUSIEURS domaines/);
      assert.match(result.stdout, /en: beta → common , other/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un ordre en/fr divergent dans un domaine', () => {
    const dir = fixture({
      'common.ts': both(['alpha', 'beta', 'gamma'], ['alpha', 'gamma', 'beta']),
    });
    try {
      const result = run(dir);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /Ordre des clés divergent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse de rassurer en silence quand aucun domaine n’est lu', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-l10n-empty-'));
    mkdirSync(join(dir, 'sub'), { recursive: true }); // un dossier vide, aucun .ts
    try {
      const result = run(dir);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /Rien à vérifier/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
