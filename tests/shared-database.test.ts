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
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync as spawnSyncSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  ALLOWED_DIVERGENCE,
  SHARED_PROJECT_REF,
  SHARED_PROJECT_URL,
  USER_FACING_MODES,
  assetUrlsIn,
  bareAssetRefs,
  describeDatabase,
  projectRefOf,
  supabaseRefsIn,
} from '../scripts/lib/shared-project.mjs';

const root0 = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = root0;
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

describe('lire un déploiement RÉEL : la page ne dit pas tout', () => {
  it('les modules se trouvent dans la page ET dans le code qu’elle charge', () => {
    const html =
      '<script type="module" crossorigin src="/assets/index-ABC.js"></script>' +
      '<script src="https://cdn.example.com/tracker.js"></script>';
    assert.deepEqual(assetUrlsIn(html, 'https://ecole.example/'), [
      'https://ecole.example/assets/index-ABC.js',
      'https://cdn.example.com/tracker.js',
    ]);
    // Le morceau qui porte le client Supabase n'est nommé QUE dans le code :
    // chercher seulement dans la page rendait « aucun module », donc un faux
    // échec — c'est ce qui est arrivé au premier essai sur le site réel.
    const entry =
      'const d=["assets/App-1.js","assets/vendor-supabase-2.js"];import("assets/App-1.js");';
    assert.deepEqual(bareAssetRefs(entry), ['assets/App-1.js', 'assets/vendor-supabase-2.js']);
  });

  it('les refs se lisent dans les deux écritures, sans doublon', () => {
    const js =
      'u="https://rpcjdohfxwukbqngbprw.supabase.co";' +
      'v="rpcjdohfxwukbqngbprw.supabase.co";' +
      'w="https://unautreprojetxyz12.supabase.co";';
    assert.deepEqual(supabaseRefsIn(js).sort(), [SHARED_PROJECT_REF, 'unautreprojetxyz12'].sort());
    // Un bundle muet rend une liste vide, jamais une ref inventée : c'est
    // l'appelant qui en fait un échec, pas la lecture.
    assert.deepEqual(supabaseRefsIn('console.log(1)'), []);
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

  it('le site déployé est vérifié, et ce contrôle a son workflow', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['check:shared-db:live'], /--live https:\/\//);
    const workflow = readFileSync(join(root, '.github', 'workflows', 'shared-db-watch.yml'), 'utf8');
    // La variable d'environnement d'un hébergeur ne produit AUCUN commit : sans
    // cron, une bascule attendrait le prochain push pour être vue.
    assert.match(workflow, /schedule:/);
    assert.match(workflow, /run: npm run check:shared-db:live/);
    assert.match(workflow, /node-version-file: \.nvmrc/);
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

  it('un site qui sert une AUTRE base fait échouer le contrôle (serveur local, pas de réseau)', async () => {
    // Le contrôle du déploiement n'a de valeur que s'il peut échouer : un site
    // qui sert la base de staging est exactement ce qu'on veut voir rouge.
    const { createServer } = await import('node:http');
    const { spawn } = await import('node:child_process');
    const divergent = `u="https://${STAGING_REF}.supabase.co";`;
    const page =
      '<script type="module" src="/assets/index-ABC.js"></script>';
    const server = createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      if (path === '/assets/index-ABC.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(divergent);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      // `spawn` ASYNCHRONE, et pas `spawnSync` : un appel synchrone bloque la
      // boucle d'événements du test, donc le serveur ne peut plus répondre et
      // l'enfant attend indéfiniment — un interblocage qui a réellement duré
      // 5 minutes ici avant d'être compris.
      const run = await new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [join(root, 'scripts', 'check-shared-db.mjs'), '--live', `http://127.0.0.1:${port}`],
          { cwd: root },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ code, out }));
      });
      assert.equal(run.code, 1, `attendu 1, obtenu ${run.code}\n${run.out}`);
      assert.match(run.out, /SERT une autre base/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('un checkout SANS fichier d’environnement ne fait pas échouer la chaîne (c’est le runner CI)', async () => {
    // Régression payée cher : `.env` est ignoré par git, donc le runner n'en a
    // aucun, et la première version sortait en 2 — quatre commits rouges d'affilée
    // et le déploiement Vercel bloqué, pour un contrôle qui prétendait lutter
    // contre les faux verts. « Rien à juger » et « on m'a demandé un verdict
    // impossible » sont deux cas différents.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const empty = mkdtempSync(join(tmpdir(), 'shared-db-empty-'));
    const run = (root: string) => {
      const r = spawnSyncSync(process.execPath, [join(root0, 'scripts', 'check-shared-db.mjs')], {
        encoding: 'utf8',
        cwd: root0,
        env: { ...process.env, CHECK_SHARED_DB_ROOT: root },
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    try {
      const none = run(empty);
      assert.equal(none.status, 0, `un checkout sans env doit passer, obtenu ${none.status}\n${none.out}`);
      assert.match(none.out, /non applicable/);
      // Un fichier présent mais divergent, lui, doit ROUGIR : la règle n'est pas
      // devenue permissive, elle distingue l'absence d'un fichier de son contenu.
      writeFileSync(join(empty, '.env'), 'VITE_SUPABASE_URL=https://unautreprojetxyz12.supabase.co\n');
      const divergent = run(empty);
      assert.equal(divergent.status, 1, `attendu 1\n${divergent.out}`);
      assert.match(divergent.out, /ne verrait pas les mêmes données/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('l’installeur est vérifié AVANT d’être empaqueté', () => {
    // La chaîne qualité vérifie les fichiers d'environnement ; le paquet, lui,
    // contient ce qui a été RÉELLEMENT embarqué — et c'est le paquet que les
    // utilisateurs installent. L'ordre compte : vérifier après la signature ne
    // sert à rien, l'artefact est déjà produit.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    // L'empaquetage vit dans `electron:build` (dist et release l'appellent) :
    // c'est donc LUI qui doit vérifier avant de signer, et l'aliasing est vérifié
    // à part — un `dist` qui n'appellerait plus l'empaquetage vérifié passerait
    // sinon pour vert.
    const build = pkg.scripts['electron:build'] as string;
    const guard = build.indexOf('check-shared-db.mjs --dist electron-ui-dist');
    assert.ok(guard !== -1, 'electron:build doit vérifier la base embarquée');
    assert.ok(
      guard < build.indexOf('electron-builder'),
      'electron:build : la vérification doit précéder l’empaquetage',
    );
    for (const script of ['electron:dist', 'electron:release']) {
      assert.match(
        pkg.scripts[script] as string,
        /npm run electron:build/,
        `${script} doit passer par l’empaquetage vérifié`,
      );
    }
  });
});
