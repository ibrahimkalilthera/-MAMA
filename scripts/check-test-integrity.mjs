#!/usr/bin/env node
/**
 * Test-integrity gate — a suite that cannot fail must not pass for green.
 *
 * The three ways this repository has already been lied to by its own tests are
 * documented in scripts/lib/test-integrity.mjs: an inert `mock.module()`, a
 * platform branch asserted without injecting the platform (green on the machine
 * that wrote it, red on the other CI OS), and a suite skipped on one platform
 * whose tests never ran while the job reported "Tests ✓".
 *
 * Static by design: all three are decidable from the source, and a runtime probe
 * would have to trust the very suite it is auditing. Conservative by design too
 * — every rule was calibrated until the CURRENT repository is clean, because a
 * gate that is red on legitimate code is a gate people learn to route around.
 *
 * The one legitimate exception is a suite that MUST be host-specific (the git
 * shim is a .cmd: it needs a real cmd.exe). Such a suite declares itself with
 * `@platform-skip : <raison>`; the gate then accepts it AND prints it in its
 * summary on every run, so the missing coverage stays visible instead of
 * silently counting as passing tests.
 *
 * Runs inside `npm run lint` (pre-commit, pre-push and the CI quality job).
 */
import { RULES, analyzeRepo } from './lib/test-integrity.mjs';

const { findings, suites, mocks, declaredSkips } = analyzeRepo();

// Aucune suite analysée ⇒ rien n'a été prouvé. Ce contrôle a réellement imprimé
// « ✅ 0 suites » une fois : le dossier renommé ou le filtre cassé suffit, et le
// vert était exactement ce qu'un run vert-néant produit.
if (suites === 0) {
  console.error('❌ Rien à vérifier : 0 suite de tests analysée — un audit vide n’est pas un audit.');
  process.exit(2);
}

if (findings.length > 0) {
  console.error(`❌ Suites de tests neutralisées (${findings.length}) :`);
  for (const finding of findings) {
    const rule = RULES[finding.rule];
    console.error(`   ${finding.file}:${finding.line}  —  ${rule.label}`);
    console.error(`        ${finding.detail}`);
    console.error(`        → ${rule.remedy}`);
  }
  console.error('\n   Une suite qui ne peut pas échouer n’est pas une suite verte : c’est une suite absente.');
  process.exit(1);
}

console.log(
  `✅ ${suites} suites, ${mocks} mock(s) — aucun mock orphelin ni vide, plateformes injectées, sauts déclarés.`,
);
for (const skip of declaredSkips) {
  console.log(`ℹ️  couverture neutralisée (déclarée, assumée) : ${skip}`);
}
