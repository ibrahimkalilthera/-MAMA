// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/chain-links.mjs — run a package.json script WITHOUT a shell and
// WITHOUT a PATH lookup.
//
// WHY THIS EXISTS
// ---------------
// The quality chain used to run its steps as `npm run <script>`. That is correct
// for a human (npm is where the scripts are declared), but it is a strange way
// for the chain to reach its own tools: npm spawns a shell, the shell resolves
// `node`, `eslint`, `tsc` and `stylelint` through PATH, and the pin therefore
// depends on the ORDER of PATH — which is why `node_modules/.bin` had to carry
// node/npm/npx wrappers at all (see ./bin-shims.mjs). Every link cost three node
// processes (npm → shell → tool) and one silent assumption: that whatever PATH
// says is the runtime this project pins.
//
// This module removes the assumption. A script string is split into its `&&`
// links, each link is classified, and each one is turned into an EXPLICIT
// argv for the CURRENT node (`process.execPath`, i.e. the runtime the launcher
// already pinned):
//
//   node scripts/check-component-props.mjs   → [<abs>/check-component-props.mjs]
//   eslint . --max-warnings 0               → [<abs>/node_modules/eslint/bin/eslint.js, ., --max-warnings, 0]
//   tsc --noEmit                            → [<abs>/node_modules/typescript/bin/tsc, --noEmit]
//
// The tool entry is READ from the installed package's own `bin` field — the same
// declaration npm's `.bin` wrappers are generated from — so "the explicit path"
// and "the path npm would have used" are the same file, not a convention that
// can drift with a package upgrade. The command name is NOT assumed to be the
// package name: `tsc` is declared by `typescript`, and the declaration is the
// only authority on where it runs from — so a command that names no package is
// searched in the packages this project DECLARES (`package.json` dependencies).
// A table of aliases would be a second definition of what npm already knows.
//
// WHAT IT REFUSES TO DO
// ---------------------
// It never falls back to PATH. A link that cannot be resolved explicitly (a
// tool that is not installed, a shell builtin, a pipeline) is an ERROR naming
// the link and the paths probed: silently resolving it the old way would
// reintroduce, one link at a time, exactly the dependency this closes. The same
// rule as the version gate — a chain that ends up on another runtime must fail,
// not proceed.
//
// Pure where it matters: text in, plan out. The filesystem is injectable, so
// every failure branch (package missing, manifest unreadable, `bin` absent,
// entry declared but not on disk) is asserted instead of hoped for.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { splitCommandSegments, tokenize } from './ci-commands.mjs';

/** The interpreters whose script is run by the current node, not looked up. */
const NODE_COMMANDS = new Set(['node', 'node.exe']);

/** A path we may turn absolute: the extensions the chain actually runs. */
const SCRIPT_EXT = /\.(mjs|cjs|js|ts|tsx)$/i;

/** Default manifest reader. Injected in tests, like every other seam here. */
function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Classify one link of a script. The splitter (shared with the CI gate, so the
 * two cannot disagree about what a `&&` link is) has already removed quotes and
 * comments.
 *
 * @param {string} segment
 * @returns {{ kind: 'node' | 'tool', tool: string | null, args: string[] } | null}
 */
export function classifyLink(segment) {
  const tokens = tokenize(segment);
  if (!tokens.length) return null;
  if (NODE_COMMANDS.has(tokens[0])) return { kind: 'node', tool: null, args: tokens.slice(1) };
  return { kind: 'tool', tool: tokens[0], args: tokens.slice(1) };
}

/**
 * The script a `node …` link runs, when it names one. A glob pattern
 * (`tests/*.test.ts`) is not a name — it is an expansion node performs itself —
 * so it never labels a link.
 */
function scriptArg(args) {
  return args.find((arg) => !arg.startsWith('-') && SCRIPT_EXT.test(arg) && !/[*?]/.test(arg)) ?? null;
}

/**
 * Short name of a link, for the chain's per-link progress lines: the script's
 * basename (`check-line-budget.mjs`) or the tool (`eslint`) — never the whole
 * argv, which would bury the one thing a reader wants.
 *
 * @param {{ kind: 'node' | 'tool', tool: string | null, args: string[] }} link
 * @returns {string}
 */
export function linkLabel(link) {
  if (link.kind === 'tool') return link.tool ?? 'inconnu';
  const script = scriptArg(link.args);
  return script ? script.split(/[\\/]/).pop() : `node ${link.args[0] ?? ''}`.trim();
}

/**
 * The entry a package declares for a command name, per npm's own rule: an
 * object `bin` maps command → path; a string `bin` is the package's single
 * command, installed under the package's (unscoped) name. No "first value"
 * guessing — a package that declares only `tsserver` does not provide `tsc`.
 */
function declaredBin(pkg, tool) {
  const bin = pkg?.bin;
  if (typeof bin === 'string') {
    const name = typeof pkg?.name === 'string' ? pkg.name.split('/').pop() : null;
    return name === tool ? bin : null;
  }
  if (bin && typeof bin === 'object') return typeof bin[tool] === 'string' ? bin[tool] : null;
  return null;
}

/**
 * Where a local tool keeps its JavaScript entry: the `bin` field of the package
 * installed under `node_modules`, resolved against that package's directory.
 *
 * Two steps, and the second is the point: the package bearing the command's
 * name (`eslint`), then the packages this project declares — because `tsc` is
 * declared by `typescript`.
 *
 * @param {object} options
 * @param {string} options.root project root
 * @param {string} options.tool bare command name (`eslint`, or `@scope/name`)
 * @param {(p: string) => boolean} [options.exists]
 * @param {(p: string) => any} [options.readPackage]
 * @returns {{ entry: string | null, packageDir: string | null, source: 'bin' | null,
 *            tried: string[], packages: string[] }}
 */
export function resolveToolEntry({ root, tool, exists = existsSync, readPackage = readPackageJson }) {
  const tried = [];
  const packages = [];
  const attempt = (packageName) => {
    packages.push(packageName);
    const manifest = join(root, 'node_modules', ...String(packageName).split('/'), 'package.json');
    tried.push(manifest);
    if (!exists(manifest)) return null;
    let pkg;
    try {
      pkg = readPackage(manifest);
    } catch {
      return null;
    }
    const declared = declaredBin(pkg, tool);
    if (!declared) return null;
    const packageDir = join(root, 'node_modules', ...String(packageName).split('/'));
    const entry = join(packageDir, declared);
    tried.push(entry);
    return exists(entry) ? { entry, packageDir, source: /** @type {'bin'} */ ('bin'), tried, packages } : null;
  };

  const direct = attempt(tool);
  if (direct) return direct;

  for (const name of declaredPackages({ root, exists, readPackage })) {
    if (name === tool) continue;
    const hit = attempt(name);
    if (hit) return hit;
  }
  return { entry: null, packageDir: null, source: null, tried, packages };
}

/**
 * The packages the project declares (dependencies, then devDependencies), which
 * is what a missing direct name is searched in. Unreadable or absent manifest →
 * no candidates: the resolution then fails loudly instead of guessing.
 */
function declaredPackages({ root, exists = existsSync, readPackage = readPackageJson }) {
  const manifest = join(root, 'package.json');
  if (!exists(manifest)) return [];
  let pkg;
  try {
    pkg = readPackage(manifest);
  } catch {
    return [];
  }
  return [...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})];
}

/**
 * A local script file becomes absolute (the run no longer depends on cwd being
 * right); a flag, or a glob pattern node expands itself (`tests/*.test.ts`),
 * is passed through untouched.
 */
function absoluteIfLocalScript(arg, { root, exists }) {
  if (arg.startsWith('-') || !SCRIPT_EXT.test(arg)) return arg;
  if (isAbsolute(arg)) return arg;
  const candidate = join(root, arg);
  return exists(candidate) ? candidate : arg;
}

/**
 * Resolve ONE link into argv for the current node.
 *
 * @param {{ kind: 'node' | 'tool', tool: string | null, args: string[] }} link
 * @param {{ root: string, exists?: (p: string) => boolean, readPackage?: (p: string) => any }} options
 * @returns {{ label: string, args: string[], entry: string | null, source: 'bin' | null }}
 * @throws when the link cannot be resolved explicitly — never a PATH fallback.
 */
export function resolveLink(link, { root, exists = existsSync, readPackage = readPackageJson }) {
  if (link.kind === 'tool') {
    const found = resolveToolEntry({ root, tool: link.tool, exists, readPackage });
    if (!found.entry) {
      throw new Error(
        `aucun paquet déclaré ne fournit l'entrée de \`${link.tool}\` ` +
          `(paquets essayés : ${found.packages.slice(0, 6).join(', ')}` +
          `${found.packages.length > 6 ? `, … ${found.packages.length} au total` : ''}). ` +
          'Installez la dépendance, ou lancez ce maillon par npm.',
      );
    }
    return { label: link.tool, args: [found.entry, ...link.args], entry: found.entry, source: found.source };
  }
  return {
    label: linkLabel(link),
    args: link.args.map((arg) => absoluteIfLocalScript(arg, { root, exists })),
    entry: null,
    source: null,
  };
}

/**
 * Resolve a whole package.json script: one entry per `&&` link, in order.
 *
 * An unresolvable link, or a script that yields no link at all, is an ERROR:
 * a plan that silently contains nothing is a chain that silently proves
 * nothing — the failure mode this repo has paid for twice (the inert `git.cmd`
 * shim, the CRLF-parsed CI that read 5 % of the workflows).
 *
 * @param {string} scriptText the script's value, as written in package.json
 * @param {{ root: string, exists?: (p: string) => boolean, readPackage?: (p: string) => any }} options
 * @returns {{ links: {label: string, args: string[], entry: string | null, source: 'bin' | null, segment: string}[], segments: number }}
 */
export function resolveScript(scriptText, { root, exists = existsSync, readPackage = readPackageJson }) {
  const source = String(scriptText ?? '');
  const segments = splitCommandSegments(source);
  const links = [];
  const unresolved = [];

  for (const segment of segments) {
    const link = classifyLink(segment);
    if (!link) continue;
    try {
      links.push({ ...resolveLink(link, { root, exists, readPackage }), segment });
    } catch (error) {
      unresolved.push({ segment, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} maillon(s) non résoluble(s) explicitement :\n` +
        unresolved.map((u) => `  • ${u.segment}\n    ${u.message}`).join('\n'),
    );
  }
  if (links.length === 0) {
    throw new Error(`aucun maillon lu dans « ${source} » — un plan vide ne prouve rien (vérifiez la commande).`);
  }
  return { links, segments: segments.length };
}
