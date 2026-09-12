// Suite for "every install reads the SAME database".
//
// WHY THIS EXISTS
// ---------------
// A payment entered on the office PC has to be visible on the director's laptop.
// That only holds if every build — the Windows setup, the web deploy — resolves
// the same Supabase project. Nothing checked it: the ref was scattered across
// vercel.json, four workflows and six scripts, and the APPLICATION never named
// it at all. `.env` is gitignored (so it is whatever the building machine had)
// and `.env.staging` names a different project, which is exactly how two installs
// end up on two databases while every user believes they share one.
//
// The definition now lives once, in scripts/lib/shared-project.mjs, and the
// guard refuses a user-facing build that resolves elsewhere. These cases lock
// the decisions; the real artefacts are checked by running the guard itself
// (`npm run check:shared-db -- --dist electron-ui-dist`), which is where the
// committed `dist/` and `electron-ui-dist/` were measured.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  ALLOWED_DIVERGENCE,
  SHARED_PROJECT_REF,
  SHARED_PROJECT_URL,
  USER_FACING_MODES,
  describeDatabase,
  projectRefOf,
} from '../scripts/lib/shared-project.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGING_REF = ALLOWED_DIVERGENCE[0].projectRef;

describe('la base partagée est nommée une fois', () => {
  it('son URL se déduit de sa ref (les deux ne peuvent pas diverger)', () => {
    assert.equal(SHARED_PROJECT_REF, 'rpcjdohfxwukbqngbprw');
    assert.equal(SHARED_PROJECT_URL, `https://${SHARED_PROJECT_REF}.supabase.co`);
  });

  it('elle est lue depuis un seul module : ni copie, ni seconde table', () => {
    const app = readFileSync(join(root, 'src', 'lib', 'sharedDatabase.ts'), 'utf8');
    assert.match(app, /from '\.\.\/\.\.\/scripts\/lib\/shared-project\.mjs'/);
    // La ref ne doit pas être réécrite en clair dans l'application : une seconde
    // écriture, c'est une seconde vérité le jour où le projet change.
    assert.doesNotMatch(app, /rpcjdohfxwukbqngbprw/);
    const guard = readFileSync(join(root, 'scripts', 'check-shared-db.mjs'), 'utf8');
    assert.doesNotMatch(guard, /rpcjdohfxwukbqngbprw/);
  });

  it('l’exception staging est déclarée, unique, et motivée', () => {
    assert.equal(ALLOWED_DIVERGENCE.length, 1);
    const [staging] = ALLOWED_DIVERGENCE;
    assert.equal(staging.mode, 'staging');
    assert.equal(staging.projectRef, STAGING_REF);
    // Une base de test qui se présente comme la production est pire qu'une base
    // de test : l'audit et le badge lisent VITE_APP_ENV.
    assert.deepEqual(staging.requires, { VITE_APP_ENV: 'staging' });
    assert.ok(staging.because.length > 20, 'la raison doit être lisible par un humain');
    assert.deepEqual(USER_FACING_MODES, ['production', 'staging']);
  });
});

describe('la ref se lit dans une URL Supabase, et seulement là', () => {
  it('les URLs du projet sont reconnues (http(s), .co et .in)', () => {
    assert.equal(projectRefOf(`${SHARED_PROJECT_URL}/rest/v1/students`), SHARED_PROJECT_REF);
    assert.equal(projectRefOf('http://abcdefghijklmnop.supabase.co'), 'abcdefghijklmnop');
    assert.equal(projectRefOf('https://abcdefghijklmnop.supabase.in'), 'abcdefghijklmnop');
  });

  it('ce qui n’est pas une URL Supabase ne rend pas de ref inventée', () => {
    for (const value of ['', null, undefined, 'postgresql://db.example.com:5432/postgres', 'https://example.com']) {
      assert.equal(projectRefOf(value as string), null, String(value));
    }
  });
});

describe('l’application sait dire sur quelle base elle est', () => {
  it('base partagée → rien à signaler', () => {
    const d = describeDatabase(SHARED_PROJECT_URL);
    assert.equal(d.isShared, true);
    assert.equal(d.diverges, false);
    assert.equal(d.label, SHARED_PROJECT_REF);
  });

  it('staging → hors production déclarée, mais pas une dérive', () => {
    const d = describeDatabase(`https://${STAGING_REF}.supabase.co`);
    assert.equal(d.isStaging, true);
    assert.equal(d.isShared, false);
    assert.equal(d.diverges, false, 'staging est prévu, il ne doit pas crier');
  });

  it('toute AUTRE base est une dérive — l’état qui ne doit jamais être silencieux', () => {
    const d = describeDatabase('https://unautreprojetxyz.supabase.co');
    assert.equal(d.diverges, true);
    assert.equal(d.isShared, false);
    assert.equal(d.isStaging, false);
  });

  it('une base illisible ne se fait pas passer pour la base partagée', () => {
    const d = describeDatabase(undefined);
    assert.equal(d.isShared, false);
    assert.equal(d.diverges, false, 'l’absence de config échoue déjà au démarrage (MISSING_CONFIG_MESSAGE)');
    assert.equal(d.label, 'ref inconnue');
  });
});

describe('le câblage : le badge et la chaîne qualité', () => {
  it('le badge n’existe que pour la dérive, et il est visible en production', () => {
    const badge = readFileSync(join(root, 'src', 'components', 'ToastNotification.tsx'), 'utf8');
    assert.match(badge, /database\?: \{ ref: string \| null; isShared: boolean; diverges: boolean \}/);
    // La version précédente sortait par un `if (env === 'production') return
    // null` AVANT toute alerte : une base non partagée aurait été masquée
    // précisément en production. Le badge de dérive doit donc être rendu dans
    // tous les environnements, et le badge d'environnement rester, lui, filtré.
    assert.match(badge, /const diverged =/, 'le badge de dérive doit être calculé indépendamment');
    assert.match(badge, /env === 'production' \? null/, 'le badge d’environnement reste filtré en production');
    assert.match(badge, /return \(\s*<>\s*\{diverged\}/, 'la dérive est rendue hors de ce filtre');
    assert.doesNotMatch(
      badge,
      /if \(env === 'production'\) return null/,
      'plus de sortie anticipée : elle masquait la dérive en production',
    );
    const shell = readFileSync(join(root, 'src', 'components', 'AppShell.tsx'), 'utf8');
    assert.match(shell, /<EnvBadge env=\{appEnv\} database=\{database\} \/>/);
    assert.match(shell, /import \{ database \} from '\.\.\/lib\/sharedDatabase'/);
  });

  it('la chaîne qualité exécute le garde-fou, et le script est appelable par son nom', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:shared-db'], /check-shared-db\.mjs/);
    assert.match(
      pkg.scripts['lint:chain'],
      /check-shared-db\.mjs/,
      'un garde-fou absent de la chaîne ne garde rien',
    );
  });

  it('l’installeur est vérifié AVANT d’être empaqueté', () => {
    // La chaîne qualité vérifie les fichiers d'environnement ; le paquet, lui,
    // contient ce qui a été RÉELLEMENT embarqué — et c'est le paquet que les
    // utilisateurs installent. L'ordre compte : vérifier après la signature ne
    // sert à rien, l'artefact est déjà produit.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const script of ['electron:dist', 'electron:release']) {
      const cmd = pkg.scripts[script] as string;
      const guard = cmd.indexOf('check-shared-db.mjs --dist electron-ui-dist');
      assert.ok(guard !== -1, `${script} doit vérifier la base embarquée`);
      assert.ok(
        guard < cmd.indexOf('electron-builder'),
        `${script} : la vérification doit précéder l’empaquetage`,
      );
    }
  });
});
