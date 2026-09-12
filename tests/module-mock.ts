/**
 * tests/module-mock.ts — the ONE place that knows how `mock.module()` names its
 * exports, because that name is a property of the RUNTIME, not of the pin.
 *
 * MEASURED HERE (2026-09-12), same probe on the three runtimes this machine has
 * (a builtin mock of `node:child_process`, then `import { spawn }`):
 *
 *   node 22.23.2  `namedExports` → the fake reaches the module.
 *                 `exports` → UNKNOWN option, silently ignored: the mock is
 *                 registered and proves nothing, `spawn` comes back undefined.
 *                 That is exactly the inert mock scripts/lib/test-integrity.mjs
 *                 exists to catch — here it fails loudly only because the suite
 *                 calls the fake immediately.
 *   node 24.20.0  both reach the module; `namedExports` prints
 *                 "DeprecationWarning: mock.module(): options.namedExports is
 *                 deprecated. Use options.exports instead."
 *   node 26.8.1   same as 24.20.0: both work, `namedExports` deprecated.
 *
 * The consolidation is nodejs/node#61727, released in 25.9.0 and backported to
 * the 24.x LTS line (hence the warning on 24.20.0) — so a suite that must pass
 * "wherever it runs" cannot hardcode either name, and neither can it pick one
 * because of what `.nvmrc` says: the pin describes CI, not the machine.
 *
 * HOW IT DECIDES — a probe, not a version table. The consolidated API VALIDATES
 * `options.exports` (it must be an object) and does so BEFORE registering
 * anything; the older API ignores the unknown key entirely. So one call carrying
 * a value the validator can only refuse is a capability probe whose answer is
 * the error code. A "which minor introduced it" table would be a second copy of
 * Node's changelog, and it would be wrong the day another line backports the
 * change.
 *
 * The probe chooses that value as `null` rather than an option mix such as
 * `{ exports, namedExports }`: the mix does throw on a consolidated runtime, but
 * only AFTER emitting the very `DeprecationWarning` this migration removes — a
 * probe that leaves the warning behind would defeat its own purpose (measured: it
 * printed once per test process).
 *
 * The probe borrows `node:os` and imports nothing: on the older API the call
 * succeeds and registers an empty mock, which is restored in the same tick —
 * before any import can observe it (the suites that mock `node:os` themselves
 * were the ones this had to be verified against).
 *
 * SCOPE: the object you pass is the module's NAMED exports, which is all the
 * suite needs. A default export is deliberately not modelled: for a builtin
 * mock the namespace's `default` is the module object itself (measured — it
 * carries the named exports either way), and no suite here mocks one.
 */
import { mock } from 'node:test';

/**
 * What the probe offers as `exports`: only the option's own validator can refuse
 * it (`options.exports` must be an object), and an unknown option is ignored, so
 * the two answers are distinguishable — and neither path warns.
 */
export const PROBE_EXPORTS = null;

/** The codes the validator uses to refuse that value on a consolidated runtime. */
export const PROBE_ERROR_CODES = new Set(['ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE']);

/** The builtin the probe borrows; never imported by the probe itself. */
export const PROBE_SPECIFIER = 'node:os';

/**
 * The slice of `node:test`'s mock tracker this module needs — narrow on purpose,
 * so the probe is testable against a fake tracker instead of only against the
 * runtime (a measured capability deserves both proofs).
 */
export interface MockModuleApi {
  module(specifier: string, options: object): { restore?: () => void } | undefined;
}

/**
 * Does this runtime understand `options.exports`? Probed, never assumed: the
 * positive answer is the option's OWN validation error, and anything else
 * (including a tracker without `module`, i.e. a run missing
 * `--experimental-test-module-mocks`) is read as "no", so the caller gets the
 * shape the older API can actually honour.
 */
export function supportsMockExports(
  mockApi: MockModuleApi = mock as unknown as MockModuleApi,
  specifier: string = PROBE_SPECIFIER,
): boolean {
  try {
    const probe = mockApi.module(specifier, { exports: PROBE_EXPORTS });
    probe?.restore?.();
    return false;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return code !== undefined && PROBE_ERROR_CODES.has(code);
  }
}

let support: boolean | undefined;

/** {@link supportsMockExports}, asked once per process (the answer cannot change). */
export function mockExportsSupported(): boolean {
  support ??= supportsMockExports();
  return support;
}

/**
 * The options to hand to `mock.module()` for the given named exports, in the
 * shape the running Node actually reads.
 *
 * @param namedExports the fake's named exports (`{ spawn: () => … }`)
 * @param supported the decision, defaulting to the probe — a seam, so both
 *                  branches are assertable without a second runtime
 * @returns `{ exports }` on a consolidated runtime, `{ namedExports }` otherwise
 */
export function moduleMockOptions(
  namedExports: Record<string, unknown>,
  supported: boolean = mockExportsSupported(),
): { exports: Record<string, unknown> } | { namedExports: Record<string, unknown> } {
  return supported ? { exports: namedExports } : { namedExports };
}

/**
 * Register a module mock whose fake is the given named exports — what every
 * suite here wants — without naming an option the running Node does not read.
 *
 * Kept as one call rather than "build options, then call `mock.module`" so a
 * suite cannot half-migrate: the specifier stays in the call (the integrity gate
 * reads it there to prove the mocked module is actually loaded), and no site can
 * reintroduce `namedExports`/`exports` by hand.
 */
export function mockModule(specifier: string, namedExports: Record<string, unknown>): void {
  mock.module(specifier, moduleMockOptions(namedExports));
}
