// Suite for the part of `lint:chain` that is about TIME (package.json).
//
// WHY THIS EXISTS
// ---------------
// Measured on this tree, per link, through the chain's own runner
// (`node scripts/with-pinned-node.mjs --node scripts/quality-chain.mjs lint`):
//
//   link          cold      warm (caches present)
//   lint:tsc      33,4 s    7,8 s
//   lint:eslint     7,4 s   2,0 s
//   lint:stylelint  1,1 s   1,1 s
//   lint (total)   46,6 s  15,4 s
//
// `tsc --noEmit` re-typechecked the world on every commit; `eslint .` re-linted
// it; and both ran TWICE per change through the hooks (pre-commit, then
// pre-push) even with the content-addressed skip in place, because a changed
// tree is precisely the case that skip cannot cover. Three flags remove the
// repetition:
//
//   tsc    --incremental --tsBuildInfoFile node_modules/tsconfig.tsbuildinfo
//   eslint --cache --cache-location node_modules/.eslintcache
//   stylelint --cache --cache-location node_modules/.stylelintcache
//
// The flags are cheap to delete and expensive to lose silently — a future edit
// that drops them restores a 45 s chain and NOTHING else would say so. Hence
// this suite. What it does NOT assert is a duration: a timing assertion on a
// shared machine is a flake, and the honest proof of the gain is the table
// above, re-measurable with one command.
//
// Two properties matter more than the flags themselves, and each is a case
// below:
//
//   1. **the caches live where git cannot see them.** The hook's keep-the-green
//      decision (`scripts/lib/chain-cache.mjs`) refuses to skip while the tree
//      is dirty. A cache file the repository tracks would make every lint run
//      dirty the tree, so the skip would NEVER fire — the speed-up would
//      quietly cancel the other speed-up. Under `node_modules/` (ignored) it
//      cannot.
//   2. **the gates keep their teeth.** `--cache` must not arrive with a relaxed
//      severity: `--max-warnings 0` on eslint and `--noEmit` on tsc are
//      asserted next to the new flags, so "faster" can never be read as "more
//      permissive".
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { resolveScript } from '../scripts/lib/chain-links.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/**
 * The RESOLVED plan, not the package.json text. The chain spawns each link as
 * an explicit argv (see ./lib/chain-links.mjs): a flag that the resolver drops
 * would never reach tsc, so asserting on the raw string would prove the wrong
 * thing.
 */
const links = resolveScript(pkg.scripts['lint:chain'], { root }).links;
const byLabel = new Map(links.map((l: { label: string }) => [l.label, l]));
const argsOf = (label: string): string[] => {
  const link = byLabel.get(label) as { args: string[] } | undefined;
  assert.ok(link, `maillon ${label} absent de lint:chain`);
  return link.args;
};

/** True when `flag value` appears consecutively — position is part of the claim. */
const hasFlagValue = (args: string[], flag: string, value: string): boolean =>
  args.some((arg, i) => arg === flag && args[i + 1] === value);

describe('lint:chain — ce qu’on rejoue sans rien revérifier', () => {
  it('tsc garde son vérificateur incrémental, et écrit son index hors de git', () => {
    const args = argsOf('tsc');
    assert.ok(args.includes('--incremental'), 'tsc doit rester incrémental : sans ça, 33 s par commit');
    assert.ok(
      hasFlagValue(args, '--tsBuildInfoFile', 'node_modules/tsconfig.tsbuildinfo'),
      'l’index de tsc doit vivre sous node_modules (ignoré par git)',
    );
  });

  it('eslint et stylelint gardent leur cache, dans un dossier que git ignore', () => {
    assert.ok(
      hasFlagValue(argsOf('eslint'), '--cache-location', 'node_modules/.eslintcache'),
      'eslint doit garder son cache sous node_modules',
    );
    assert.ok(
      hasFlagValue(argsOf('stylelint'), '--cache-location', 'node_modules/.stylelintcache'),
      'stylelint doit garder son cache sous node_modules',
    );
  });

  it('« plus rapide » n’est pas « plus permissif » : les seuils restent là', () => {
    const eslint = argsOf('eslint');
    const i = eslint.indexOf('--max-warnings');
    assert.equal(eslint[i + 1], '0', 'le plafond de warnings d’eslint doit rester à 0');
    assert.ok(argsOf('tsc').includes('--noEmit'), 'tsc doit rester en vérification seule');
  });

  it('les caches vivent sous node_modules/, que .gitignore ignore', () => {
    // The property, not the paths: whatever the cache locations become, they
    // must stay inside the one directory the repository never tracks — otherwise
    // a lint run dirties the tree and the hook's skip can no longer fire.
    for (const [label, flag] of [
      ['eslint', '--cache-location'],
      ['stylelint', '--cache-location'],
      ['tsc', '--tsBuildInfoFile'],
    ] as const) {
      const args = argsOf(label);
      const value = args[args.indexOf(flag) + 1];
      assert.ok(
        String(value).replace(/\\/g, '/').startsWith('node_modules/'),
        `${label} : « ${value} » doit être sous node_modules/`,
      );
    }
    const ignore = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    assert.ok(
      ignore.includes('node_modules/'),
      '.gitignore doit ignorer node_modules/ — c’est ce qui rend ces caches invisibles',
    );
    assert.ok(
      !ignore.some((l) => /^!.*node_modules/.test(l)),
      'aucune exception de négation ne doit rouvrir node_modules',
    );
  });
});
