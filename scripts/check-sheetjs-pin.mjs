/**
 * SheetJS (xlsx) pin guard.
 *
 * `xlsx` is installed from the SheetJS CDN tarball — NOT the npm registry —
 * because the npm-registry package (0.18.5, last published years ago) carries
 * known vulnerabilities (CVE-2023-30533 and friends). The CDN tarball is
 * pinned by exact version and commented in package.json, but nothing enforced
 * that pin: a future `npm install xlsx@latest` or an editor "quick fix" would
 * silently reintroduce the vulnerable registry version (or a `^` range), and
 * because the dep is a URL, neither `npm audit` nor Dependabot ever sees it.
 *
 * This gate closes that gap: it verifies package.json AND package-lock.json
 * both point at the exact pinned CDN tarball, so the pin can only change as a
 * deliberate, reviewed diff (bump the constant + the comment together).
 *
 * Usage: node scripts/check-sheetjs-pin.mjs   (wired into `npm run lint`)
 */

import { readFileSync } from 'node:fs';

const PINNED_XLSX = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
const PINNED_VERSION = '0.20.3';

const failures = [];

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

const declared = pkg.dependencies && pkg.dependencies.xlsx;
if (declared !== PINNED_XLSX) {
  failures.push(
    `package.json: dependencies.xlsx = ${JSON.stringify(declared)} — attendu ${JSON.stringify(PINNED_XLSX)}\n` +
    '  La version npm-registry (0.18.5) est vulnérable (CVE-2023-30533). Ne passer' +
    ' que par le tarball CDN pinné (voir scripts/check-sheetjs-pin.mjs).'
  );
}

// package-lock.json (lockfileVersion 3) stores URL deps under
// packages["node_modules/xlsx"]: `resolved` = the tarball URL, `version` = the
// published version. Check both so the lockfile cannot silently point elsewhere.
const lockPack = lock.packages && lock.packages['node_modules/xlsx'];
const lockResolved = lockPack && lockPack.resolved;
const lockVersion = lockPack && lockPack.version;

if (lockResolved !== PINNED_XLSX || lockVersion !== PINNED_VERSION) {
  failures.push(
    `package-lock.json: resolved=${JSON.stringify(lockResolved)} version=${JSON.stringify(lockVersion)}` +
    ` — attendu ${JSON.stringify(PINNED_XLSX)} / ${JSON.stringify(PINNED_VERSION)}. ` +
    'Re-synchronisez le lockfile avec `npm install` après un bump délibéré du pin.'
  );
}

if (failures.length > 0) {
  console.error(`❌ Pin SheetJS dérivé (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`✅ xlsx pinné sur le tarball CDN ${PINNED_VERSION} (package.json + package-lock.json cohérents).`);