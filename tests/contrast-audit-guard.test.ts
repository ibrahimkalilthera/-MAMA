/**
 * Static guard over scripts/theme-contrast-audit.mjs: overlay scans must
 * NEVER pass a surface that was not actually verified.
 *
 * The floating chat panel (and every motion overlay) mounts with an entrance
 * animation (opacity 0 → 1). The old scan recorded a step as ✅ as soon as
 * the [role="dialog"] guard fired and zero failures came back — but scanning
 * mid-entrance yields **0 scanned texts** (ancestors still below the
 * visibility threshold), which sailed through as "0 textes scannés" without
 * ever checking the panel's real colors. Two invariants close the hole:
 *
 *   1. the scanner polls until the visible-text count is stable AND > 0
 *      (entrance animation finished) before recording the step;
 *   2. a step that settles at 0 scanned texts is recorded as an UNCOVERED
 *      step (KO) — "0 texte scanné — couverture non vérifiée" — never a pass.
 *
 * Pure suite: no DOM, no puppeteer — plain node:test + fs reading the audit
 * source, mirroring tests/pdf-stamp-guard.test.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_SRC = readFileSync(join(ROOT, 'scripts/theme-contrast-audit.mjs'), 'utf8');

describe('contrast audit guard — an overlay must be fully visible before its scan counts', () => {
  it('polls until the visible-text count is stable and > 0 before recording', () => {
    // The settle loop must keep rescanning while the entrance animation is
    // still fading the overlay in (checked === 0), and only stop once a real,
    // stable content count is reached.
    assert.match(AUDIT_SRC, /res\.checked\s*>\s*0\s*&&\s*res\.checked\s*===\s*prev/,
      'the scan must wait for a stable, non-zero text count (entrance animation over)');
    assert.match(AUDIT_SRC, /for\s*\(\s*;;\s*\)\s*\{\s*res\s*=\s*await\s*page\.evaluate/,
      'the settle wait must re-run the scanner until the overlay is settled');
  });

  it('records a settled 0-text scan as an uncovered step (KO), never a pass', () => {
    // Pass condition requires both a verified (checked > 0) surface AND zero
    // failures — the old `failuresStep.length === 0` alone is forbidden.
    assert.match(AUDIT_SRC, /verified\s*&&\s*failuresStep\.length\s*===\s*0/,
      'a step must only pass when texts were actually scanned and none failed');
    assert.match(AUDIT_SRC, /couverture non vérifiée/,
      'a 0-text scan must be reported as unverified coverage');
    assert.doesNotMatch(AUDIT_SRC, /recordCheck\s*\(\s*theme,\s*step,\s*failuresStep\.length\s*===\s*0\s*,/,
      'the old pass-on-zero-failures-only gate must not come back');
  });

  it('the floating chat step still opens the panel through the shared scan path', () => {
    // The chat step must keep returning a dialog root+guard (openOverlay →
    // scanAndRecord), not a bespoke bypass that skips the settle logic.
    const chatBlock = AUDIT_SRC.slice(AUDIT_SRC.indexOf("'Chat IA flottant'"));
    assert.match(chatBlock, /rootSel:\s*'\[role="dialog"\]'/,
      'the chat step must scan the [role="dialog"] root');
    assert.match(chatBlock, /guard:\s*'\(\(\) => !!document\.querySelector/,
      'the chat step must wait for the dialog presence guard');
  });
});
