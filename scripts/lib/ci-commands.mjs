// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/ci-commands.mjs — what the workflows run vs what package.json
// already defines.
//
// WHY THIS EXISTS
// ---------------
// CI drifted from the repo once already: the `quality` job hand-copied a subset
// of the lint chain (`npx eslint .` + `npx tsc` + two guard scripts) and
// silently skipped six gates, stylelint and the test-harness guard among them —
// so the runner proved less than the machine did, while both looked green. The
// test suite has guarded that ONE job ever since; this module turns the same
// rule into a gate over EVERY workflow, because nothing about the drift was
// specific to lint: the contrast job hand-ran the very script `check:contrast`
// already names.
//
// THREE WAYS A STEP RECOPIES, and the remedy for each:
//   exact    — the step runs a command identical to a package.json script
//              (`node scripts/theme-contrast-audit.mjs` vs `check:contrast`) →
//              `npm run check:contrast`. NOT allowlistable: there is no reading
//              of "the same thing, defined twice" that is worth keeping.
//   fragment — the step runs one `&&` link of a script, so changing the script
//              leaves CI behind (`node scripts/check-node-version.mjs` is the
//              first link of `lint:chain`) → call the script, or allowlist it
//              with a reason.
//   tool     — the step drives a tool the repo already routes through a script,
//              with its own flags (`npx eslint .`) → the flags ARE the drift.
//              Allowlistable, like a fragment.
//
// Anti-vacuity: zero workflows or zero commands read is an ERROR, never a pass
// — a gate that reads nothing proves nothing, the failure mode the inert
// `git.cmd` shim and the "non applicable" contrast section both taught here.
//
// Pure: text in, findings out (the CLI does the file I/O). No YAML dependency —
// the workflow style used in this repo (`run:` inline, or a `|` block scalar)
// is parsed directly, keeping this gate dependency-free like its siblings.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the workflows live. */
export const WORKFLOW_DIR = '.github/workflows';

/**
 * One CI step that recopies a command package.json defines.
 * @typedef {object} CiFinding
 * @property {string} file workflow path, e.g. `.github/workflows/perf-guard.yml`
 * @property {number} line 1-based line of the `run:`
 * @property {string|null} step the step's `name:`, when the parse can attribute it
 * @property {string} command the command as written
 * @property {string} key its canonical form (the comparison key)
 * @property {'exact'|'fragment'|'tool'} rule which of the three shapes it is
 * @property {string} script the package.json script it duplicates
 * @property {string} [remedy] set on violations, not on allowlisted findings
 */

/**
 * An allowlist hit: a command that repeats a script link on purpose.
 * @typedef {object} CiAllowed
 * @property {string} key the command
 * @property {string} reason why it is allowed to repeat
 * @property {string} [script] the link it repeats
 * @property {number} occurrences how many CI steps it covers
 */

/**
 * @typedef {object} CiAudit
 * @property {CiFinding[]} violations
 * @property {CiAllowed[]} allowed
 * @property {string[]} staleAllowlist
 * @property {{ workflows: number, commands: number }} scanned
 */

/** @typedef {Record<string, { script?: string, reason: string }>} CiAllowlist */

/**
 * Generic runner/OS commands. The `tool` rule is about a tool the PROJECT
 * routes through a script; `rm`, `curl`, `git` and friends are the
 * environment's — flagging every `rm -rf` because `clean` happens to use `rm`
 * would turn a gate into noise, and noise is how a gate stops being read.
 */
export const ENVIRONMENT_COMMANDS = new Set([
  'age', 'apt-get', 'awk', 'base64', 'basename', 'brew', 'cargo', 'cat', 'cd',
  'chmod', 'chown', 'cmake', 'command', 'corepack', 'cp', 'curl', 'cut',
  'cygpath', 'date', 'df', 'dirname', 'docker', 'du', 'echo', 'env', 'eval',
  'exit', 'export', 'false', 'find', 'git', 'go', 'grep', 'groups', 'head',
  'id', 'install', 'jq', 'kill', 'ls', 'make', 'mkdir', 'mktemp', 'mv',
  'node', 'npm', 'npx', 'openssl', 'perl', 'pnpm', 'powershell', 'printf',
  'ps', 'pwsh', 'python', 'python3', 'readlink', 'rm', 'rmdir', 'ruby',
  'rustc', 'sed', 'seq', 'set', 'sleep', 'sort', 'source', 'stat', 'sudo',
  'supabase', 'tar', 'taskkill', 'tasklist', 'tee', 'test', 'time', 'timeout',
  'touch', 'tr', 'true', 'uname', 'uniq', 'unset', 'unzip', 'wait', 'wc',
  'wget', 'which', 'whoami', 'xargs', 'yarn', 'zip',
]);

/** Shell structure tokens and condition builtins — never a command on their own. */
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'select', 'function', 'in', '!', '{', '}', '(', ')', '[',
  '[[', ']]',
]);

/**
 * Drop the structure a segment may start with, keeping the command behind it:
 * `then node scripts/x.mjs` is the `node` call, and skipping the whole segment
 * (the first version did) would make a recopy inside an `if` clause invisible —
 * precisely the "gate that reads some of the CI" this module exists to avoid.
 */
function commandHead(tokens) {
  let i = 0;
  while (i < tokens.length && SHELL_KEYWORDS.has(tokens[i])) {
    // `[ -f x ]` / `[[ ... ]]` is a condition, and everything behind it belongs
    // to the condition — `-f x ]` is not a command.
    if (tokens[i] === '[' || tokens[i] === '[[') return [];
    i++;
  }
  return tokens.slice(i);
}

/**
 * Allowlist: a command that legitimately repeats a package.json link, with the
 * reason it must. An entry that stops matching FAILS the gate — an allowlist
 * that silently rots is how a gate keeps passing after the thing it excused is
 * gone.
 *
 * `node scripts/check-node-version.mjs` is the first link of `lint:chain`, but
 * the jobs that install Node without running the chain must still prove in
 * THEIR OWN log that the runner executes the pinned major: one job's proof does
 * not cover another job's runner, and setup-node succeeding is exactly what the
 * gate is there to not take on faith.
 */
/** @type {CiAllowlist} */
export const CI_ALLOWLIST = {
  'node scripts/check-node-version.mjs': {
    script: 'lint:chain',
    reason: 'chaque job qui installe Node doit prouver le majeur réellement exécuté dans SON log',
  },
};

/** Split a shell fragment into tokens, dropping the quotes around quoted args. */
export function tokenize(text) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const ch of String(text ?? '')) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Canonical form of a command: whitespace collapsed, quotes dropped. */
export function normalizeKey(tokens) {
  return (Array.isArray(tokens) ? tokens : tokenize(tokens))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join(' ');
}

/** Drop heredoc bodies (`cat > .env <<'EOF' … EOF`), which are data, not commands. */
function stripHeredocs(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (!marker) {
      out.push(line);
      continue;
    }
    out.push(line.slice(0, marker.index));
    const name = marker[2];
    i++;
    while (i < lines.length && lines[i].trim() !== name) i++;
  }
  return out.join('\n');
}

/**
 * Every command of a shell fragment, one per element: split on `&&`, `||`,
 * `;`, `|` and newlines, outside quotes, with comments and heredoc bodies
 * removed. Shell structure (`then`, `fi`, `do`…) is dropped: it is not a
 * command, and keeping it would only pad the count.
 */
export function splitCommandSegments(text) {
  const source = stripHeredocs(
    String(text ?? '')
      .split(/\r?\n/)
      .map((line) => (/^\s*#/.test(line) ? '' : line))
      .join('\n'),
  );
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (source.startsWith('&&', i) || source.startsWith('||', i)) {
      out.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Is this segment an invocation of an npm script — i.e. the RIGHT way? */
export function isScriptInvocation(tokens) {
  const t = Array.isArray(tokens) ? tokens : tokenize(tokens);
  if (!['npm', 'pnpm', 'yarn'].includes(t[0])) return false;
  if (t[0] !== 'npm') return t[1] === 'run';
  return ['run', 'test', 'start', 'ci', 'install', 'i', 'exec'].includes(t[1]);
}

/**
 * The tool a segment drives, ignoring the package-manager prefixes, so
 * `npx eslint .` and `eslint .` are recognised as the same tool.
 * `node <script>` is identified by its script (the interpreter is shared by
 * everything); a bare `node` with no script yields null — too generic to judge.
 */
export function toolIdentity(tokens) {
  const t = (Array.isArray(tokens) ? tokens : tokenize(tokens)).filter(
    (tok) => !SHELL_KEYWORDS.has(tok),
  );
  if (!t.length) return null;
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    if (['npx', 'exec', 'dlx', '--yes', '-y', '--no-install'].includes(tok)) {
      i++;
      continue;
    }
    if (['npm', 'pnpm', 'yarn'].includes(tok) && ['exec', 'dlx'].includes(t[i + 1])) {
      i += 2; // `<pm> exec` — the runner, not the tool
      continue;
    }
    break;
  }
  const head = t[i];
  if (!head) return null;
  if (!['node', 'node.exe'].includes(head)) return head;
  const script = t.slice(i + 1).find((tok) => /\.(mjs|cjs|js|ts|tsx)$/i.test(tok));
  return script ? `node ${script}` : null;
}

/**
 * `run:` blocks of a workflow, with the step name they belong to and their line
 * number. Handles both `run: cmd` and the `run: |` / `run: >` block scalars.
 */
export function extractRunBlocks(yamlText) {
  const lines = String(yamlText ?? '').split(/\r?\n/);
  const blocks = [];
  let step = null;
  for (let i = 0; i < lines.length; i++) {
    const named = /^(\s*)-\s+name:\s*(.+?)\s*$/.exec(lines[i]);
    if (named) {
      step = { indent: named[1].length, name: named[2].replace(/^['"]|['"]$/g, '') };
      continue;
    }
    const run = /^(\s*)run:\s*(.*)$/.exec(lines[i]);
    if (!run) continue;
    const start = i;
    const indent = run[1].length;
    const rest = run[2].trim();
    const isBlock = /^[|>][-+]?\d*$/.test(rest);
    let command = rest;
    if (isBlock) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '') {
          body.push('');
          continue;
        }
        if (line.search(/\S/) <= indent) break;
        body.push(line);
      }
      command = body.join('\n').replace(/^\n+|\n+$/g, '');
      i = j - 1;
    }
    blocks.push({
      line: start + 1,
      step: step && step.indent < indent ? step.name : null,
      command,
    });
  }
  return blocks;
}

/**
 * Index of everything package.json already defines: the whole command of each
 * script, each of its `&&` links, and the tool each link drives.
 *
 * Links that are themselves invocations of another script (`electron:ui` inside
 * `electron:dist`) are NOT indexed: calling a script by name is the compliant
 * move, never a recopy.
 */
/**
 * @param {{ scripts?: Record<string, string> }} pkg
 * @returns {{
 *   byCommand: Map<string, string>,
 *   bySegment: Map<string, string>,
 *   byTool: Map<string, string>,
 *   linkOwner: Map<string, string>,
 * }}
 */
export function buildScriptIndex(pkg) {
  const byCommand = new Map();
  const bySegment = new Map();
  const byTool = new Map();
  const scripts = pkg?.scripts ?? {};
  for (const [name, raw] of Object.entries(scripts)) {
    const command = String(raw);
    byCommand.set(normalizeKey(tokenize(command)), name);
    for (const segment of splitCommandSegments(command)) {
      const tokens = tokenize(segment);
      if (!tokens.length || isScriptInvocation(tokens)) continue;
      const key = normalizeKey(tokens);
      if (key && !bySegment.has(key)) bySegment.set(key, name);
      const identity = toolIdentity(tokens);
      if (identity && !ENVIRONMENT_COMMANDS.has(identity) && !byTool.has(identity)) {
        byTool.set(identity, name);
      }
    }
  }
  // Internal links, declared by the repo's own convention: `node
  // scripts/with-pinned-node.mjs --npm lint:chain` means lint:chain is a link
  // that `lint` runs under the pinned runtime. A plain `npm run a:ui` inside
  // `a:dist` is ordinary composition, NOT a link — advising `a:dist` for a step
  // that legitimately wants the UI build would be advice to run more than asked.
  const linkOwner = new Map();
  for (const [name, raw] of Object.entries(scripts)) {
    const tokens = tokenize(String(raw));
    tokens.forEach((tok, i) => {
      const next = tokens[i + 1];
      if (tok === '--npm' && next && Object.hasOwn(scripts, next) && !linkOwner.has(next)) {
        linkOwner.set(next, name);
      }
    });
  }
  return { byCommand, bySegment, byTool, linkOwner };
}

/**
 * The public entry that runs `name` (walking the `--npm` links up, cycle-safe).
 * @param {string} name
 * @param {{ linkOwner?: Map<string, string> }} [index]
 * @returns {string}
 */
export function entryScript(name, index) {
  const seen = new Set([name]);
  let current = name;
  while (index?.linkOwner?.has(current)) {
    const next = index.linkOwner.get(current);
    if (seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** The remedy, stated once per rule — and naming the command a CI job should run. */
function remedy(rule, scriptName, index) {
  const target = entryScript(scriptName, index);
  if (rule === 'exact') return `écrivez \`npm run ${target}\``;
  return `appelez \`npm run ${target}\``;
}

/**
 * Every CI step that recopies something package.json defines.
 *
 * @param {{ pkg: { scripts?: Record<string, string> }, workflows: {file: string, text: string}[], allowlist?: CiAllowlist }} input
 * @returns {CiAudit}
 */
export function inspectCiCommands({ pkg, workflows = [], allowlist = {} }) {
  const index = buildScriptIndex(pkg);
  const violations = [];
  const allowed = new Map();
  const seen = new Map();
  let commands = 0;

  for (const { file, text } of workflows) {
    for (const block of extractRunBlocks(text)) {
      for (const segment of splitCommandSegments(block.command)) {
        const tokens = commandHead(tokenize(segment));
        if (!tokens.length) continue;
        commands++;
        if (isScriptInvocation(tokens)) continue;

        const key = normalizeKey(tokens);
        let rule = null;
        let owner = null;
        if (index.byCommand.has(key)) {
          rule = 'exact';
          owner = index.byCommand.get(key);
        } else if (index.bySegment.has(key)) {
          rule = 'fragment';
          owner = index.bySegment.get(key);
        } else {
          const identity = toolIdentity(tokens);
          if (identity && index.byTool.has(identity)) {
            rule = 'tool';
            owner = index.byTool.get(identity);
          }
        }
        if (!rule) continue;

        const entry = { file, line: block.line, step: block.step, command: segment, key, rule, script: owner };
        if (rule !== 'exact' && Object.hasOwn(allowlist, key)) {
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (!allowed.has(key)) {
            allowed.set(key, { ...allowlist[key], key, occurrences: [] });
          }
          allowed.get(key).occurrences.push(entry);
          continue;
        }
        violations.push({ ...entry, remedy: remedy(rule, owner, index) });
      }
    }
  }

  const staleAllowlist = Object.keys(allowlist)
    .filter((key) => !seen.has(key))
    .sort();
  for (const [key, entry] of allowed) entry.occurrences = entry.occurrences.length;
  return {
    violations,
    allowed: [...allowed.values()].sort((a, b) => a.key.localeCompare(b.key)),
    staleAllowlist,
    scanned: { workflows: workflows.length, commands },
  };
}

/**
 * Human report, as printable lines. Pure.
 * @param {CiAudit} result
 * @returns {string[]}
 */
export function formatCiReport(result) {
  const { violations, allowed, staleAllowlist, scanned } = result;
  const lines = [];
  const place = (v) =>
    `${v.file}:${v.line}${v.step ? ` (étape « ${v.step} »)` : ''}`;
  for (const v of violations) {
    const label =
      v.rule === 'exact'
        ? `recopie exactement le script \`${v.script}\``
        : v.rule === 'fragment'
          ? `recopie un maillon de \`${v.script}\``
          : `lance \`${toolIdentity(tokenize(v.command))}\` à la main alors que \`${v.script}\` le route déjà`;
    lines.push(`❌ ${place(v)} — ${label} — ${v.remedy} (une seule définition, celle du poste).`);
    lines.push(`   commande : ${v.command}`);
  }
  for (const key of staleAllowlist) {
    lines.push(
      `❌ ALLOWLIST obsolète — plus aucun workflow ne recopie « ${key} » : retirez l'entrée.`,
    );
  }
  if (scanned.workflows === 0 || scanned.commands === 0) {
    lines.push(
      `❌ aucun commande lue (${scanned.workflows} workflow(s)) — un garde qui ne lit rien ne prouve rien ; vérifiez ${WORKFLOW_DIR}/.`,
    );
  }
  if (violations.length || staleAllowlist.length || scanned.commands === 0) return lines;

  for (const entry of allowed) {
    lines.push(
      `⏳ ${entry.key} — ${entry.occurrences} étape(s) (grandfathered : ${entry.reason})`,
    );
  }
  const suffix = allowed.length ? `, ${allowed.length} commande(s) grandfathered` : '';
  lines.push(
    `✅ ${scanned.workflows} workflow(s), ${scanned.commands} commande(s) CI — aucune ne recopie package.json${suffix}.`,
  );
  return lines;
}
