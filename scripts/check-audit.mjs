/**
 * Security gate — blocks reintroduced vulnerabilities before they can ship.
 *
 * Runs in two places with the same two gates:
 *   • CI (perf-guard.yml, `quality` job): strict — any failure blocks the push.
 *   • The husky pre-commit hook (invoked with AUDIT_CACHE=1 AUDIT_SOFT_OFFLINE=1):
 *     same gates, measured LIVE first like everywhere else; the cache is only a
 *     FALLBACK for an unreachable registry (offline development), and a fallback
 *     verdict SAYS so. An unreachable registry with no usable cache only warns —
 *     the CI push gate stays the enforcement point.
 *
 * Fails when any of these holds:
 *   1. ANY production/runtime dependency has a known vulnerability
 *      (`npm audit --omit=dev` non-empty) — nothing vulnerable may ship.
 *   2. The total vulnerability count exceeds the documented baseline
 *      (see DEV_BASELINE, defined in this file) — i.e. a brand-new vulnerability appears anywhere
 *      in the tree, beyond the documented dev-only set (see below).
 *   3. (CI only) the registry is unreachable and the audit cannot run —
 *      an unverifiable dependency tree must not pass silently.
 *
 * Originally DEV_BASELINE was 29 (exact, dev-only Vercel-CLI pins — tar,
 * undici, js-yaml, … — tracked upstream in vercel/vercel#11543). They left the
 * root lockfile entirely when the vercel CLI moved to the isolated tools/
 * manifest (deployed via GitHub Actions); the baseline went back to 0, and any
 * single vulnerability then failed the gate.
 *
 * ─── Pourquoi 7, et pourquoi ce n'est pas un abandon (2026-10-05) ──────────
 *
 * Sept avis dev-only sont apparus dans la chaîne de `stylelint` (`globby` →
 * `fast-glob` → `micromatch` → `braces`) et AUCUN correctif n'existe en amont :
 * `braces@3.0.3`, `micromatch@4.0.8` et `fast-glob@3.3.3` sont les DERNIÈRES
 * versions publiées, et l'avis couvre `braces <= 3.0.3`. Un `overrides` ne peut
 * pas viser une version qui n'existe pas, et le « correctif » que npm propose
 * est un DOWNGRADE (stylelint 7.7.0) qui casserait la chaîne CSS. Le gate de
 * PRODUCTION, lui, n'a pas bougé : il reste à ZÉRO vulnérabilité runtime —
 * c'est lui qui protège ce qui est livré — et c'est ce premier volet que
 * `npm audit fix` a payé ici (`dompurify` 3.4.14 → 3.4.16, en plage, sans
 * `--force`).
 *
 * Relever cette base est un acte délibéré, daté et chiffré, jamais un silence :
 * il exige de mettre à jour DEV_BASELINE ici *et* DEVELOPMENT_HISTORY.md. À
 * rabaisser dès que l'amont publie un correctif — le gate annonce de lui-même,
 * dans son verdict vert, combien de vulnérabilités ont été corrigées depuis.
 *
 * ─── Pourquoi 15, et ce que le cache avait masqué (2026-10-06) ────────────
 *
 * L'arbre portait DÉJÀ 16 avis le 5 au soir : la CI n'en voyait que 7 parce
 * qu'elle relisait un cache `audit-gate` de 23,5 h (perf-guard.yml, run du
 * 2026-10-06 03:15 — le `npm ci` du MÊME job annonçait « 16 vulnerabilities
 * (8 moderate, 8 high) »). Un cache périmé n'est pas une mesure : dès qu'il
 * a expiré, le gate a lu le chiffre vrai.
 *
 * `npm audit fix` (en plage, sans `--force`) a payé ce qui était payable :
 * `source-map-js` (GHSA-68fv-2mgg-jv7q, DoS par sections d'index) est monté en
 * 1.2.2, et la chaîne `electron-builder` a été rafraîchie dans sa plage
 * (26.15.3 → 26.17.0). Restent 15, toutes dev-only, dont AUCUNE n'a de
 * correctif en plage :
 *   • la chaîne `stylelint` (7 — `braces`, `micromatch`, `fast-glob`, `globby`,
 *     `stylelint`, `stylelint-order`, `stylelint-scss`) : l'avis `braces
 *     <= 3.0.3` (GHSA-vfj7-8cjw-p6xm) n'a AUCUNE version patchée en amont, et
 *     le « correctif » de npm est un DOWNGRADE vers stylelint 7.7.0 ;
 *   • la chaîne d'outillage `electron-builder` (8 — `@electron/get`,
 *     `app-builder-lib`, `dmg-builder`, `electron-builder`,
 *     `electron-builder-squirrel-windows`, `global-agent`, `roarr`,
 *     `sprintf-js`) : correctif = DOWNGRADE majeur vers electron-builder 26.5.0.
 * Le gate de PRODUCTION, lui, ne bouge toujours pas : ZÉRO vulnérabilité
 * runtime — c'est lui qui protège ce qui est livré.
 *
 * ─── Pourquoi 8, et où est passée la chaîne `braces` (2026-10-06) ──────────
 *
 * Les 7 avis `high` de la chaîne `stylelint → micromatch → braces` ont QUITTÉ
 * l'arbre racine : `stylelint` (avec ses deux plugins) vit désormais dans un
 * manifeste isolé, `tools/csslint/`, exactement comme le CLI Vercel avant lui —
 * mêmes raisons, même remède. Mesuré : arbre racine 15 → **8**, et ZÉRO `high`.
 *
 * Ce qui n'a PAS changé, et qu'il faut dire : `braces@3.0.3` n'est pas corrigé
 * (aucune version corrigée n'existe en amont — `<= 3.0.3`, patched: none), et le
 * CSS reste vérifié par la MÊME version de stylelint, avec le MÊME
 * `stylelint.config.js`, via `scripts/stylelint-tools.mjs`. Rien n'est masqué :
 * les 7 avis restent VISIBLES à chaque push, en avertissement seul, dans l'audit
 * de l'arbre isolé (`scripts/report-tools-audit.mjs`). Ils ne font simplement
 * plus échouer le gate qui ne protège que l'application.
 *
 * Ce qu'il reste ici : la chaîne d'outillage `electron-builder` (8, moderate,
 * dev-only, jamais embarquée) — même nature, même remède possible si elle gêne.
 *
 * Cache (AUDIT_CACHE=1): `node_modules/.cache/audit-gate.json`, keyed on the
 * sha256 of package-lock.json, valid for AUDIT_CACHE_TTL_HOURS (default 24).
 *
 * ─── Un vert sans mesure, deux fois (2026-10-06) ─────────────────────────
 *
 * 1. LE CACHE. La veille, ce cache avait rendu le job vert (`Total audit count 7
 *    within baseline 7 (cached, 23.5h old)`) alors que la dette était DÉJÀ
 *    publiée en amont : la clé du cache est le lockfile, or un avis se publie
 *    sans que le lockfile change. Le gate MESURE DONC EN DIRECT D'ABORD, à
 *    chaque run ; le cache n'est ouvert que si la mesure est IMPOSSIBLE (registre
 *    injoignable), et le verdict dit alors qu'il vient d'un cache, avec son âge.
 *
 * 2. LA RÉPONSE D'ERREUR. `npm audit --json` écrit aussi du JSON sur stdout
 *    quand le registre ne répond pas (`{"error": …}`), parfois en sortant 0.
 *    Lu comme un rapport, ce payload n'a pas de `vulnerabilities` : le gate
 *    annonçait « Production … audit clean » et « Total audit count 0 » sur un
 *    audit qui n'avait RIEN regardé. Seule la forme d'un rapport réel est
 *    acceptée (`isAuditReport`).
 *
 * Les deux règles vivent, pures et asserées, dans `./lib/audit-verdict.mjs`.
 *
 * AUDIT_CACHE_REFRESH=1 désactive le repli : le verdict doit être une mesure en
 * direct, ou un échec.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_VERSION, cacheFallbackLabel, isAuditReport, usableCache } from './lib/audit-verdict.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';

const DEV_BASELINE = 8;
const CACHED = process.env.AUDIT_CACHE === '1';
const SOFT_OFFLINE = process.env.AUDIT_SOFT_OFFLINE === '1';
const FORCE_REFRESH = process.env.AUDIT_CACHE_REFRESH === '1';
const TTL_MS = (Number(process.env.AUDIT_CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;
const CACHE_FILE = path.resolve('node_modules/.cache/audit-gate.json');

/**
 * Runs `npm audit --json <args>` and returns the parsed report (null if it could
 * not run).
 *
 * Bounded on purpose: `--fetch-timeout`/`--fetch-retries` and an `execSync`
 * timeout turn « le registre ne répond pas » into a FAST finding instead of an
 * open-ended wait that would eat the step's budget. That finding is what opens
 * the fallback (or fails) — never a silent wait.
 */
function runAudit(args) {
  const bounded = '--fetch-timeout=45000 --fetch-retries=1';
  const command = `npm audit --json ${args} ${bounded}`;
  try {
    return reportOf(execSync(command, { encoding: 'utf8', timeout: 120000 }));
  } catch (e) {
    // Un audit qui TROUVE des vulnérabilités sort non-zéro et laisse quand même
    // son rapport sur stdout — mais un registre injoignable y laisse un payload
    // d'ERREUR (`{"error": …}`), parfois avec un code de sortie 0. Seule la FORME
    // d'un rapport réel compte : un payload d'erreur lu comme un rapport, c'est
    // « zéro vulnérabilité » annoncé sur un audit qui n'a rien regardé.
    return reportOf(e.stdout ?? '');
  }
}

/**
 * Le texte est-il un RAPPORT d'audit, ou seulement du JSON ? Le discriminant vit
 * dans ./lib/audit-verdict.mjs (`isAuditReport`), où son absence est asserée.
 */
function reportOf(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''));
    return isAuditReport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const summaryOf = (m = {}) =>
  `info:${m.info ?? 0} low:${m.low ?? 0} moderate:${m.moderate ?? 0} high:${m.high ?? 0} critical:${m.critical ?? 0}`;

/** Stable identity of the dependency tree: sha256 of the lockfile (the audit's input). */
function lockHash() {
  try {
    return createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex').slice(0, 16);
  } catch {
    return 'no-lockfile';
  }
}

/**
 * Le REPLI — lu seulement quand la mesure en direct est IMPOSSIBLE, jamais
 * autrement. La décision d'exploitabilité (version, arbre, âge) vit dans
 * ./lib/audit-verdict.mjs, où chaque refus est asseré.
 */
function readFallbackCache(hash) {
  if (!CACHED || FORCE_REFRESH) return null;
  try {
    return usableCache(fs.readFileSync(CACHE_FILE, 'utf8'), { lockHash: hash, ttlMs: TTL_MS });
  } catch {
    return null;
  }
}

function writeCache(hash, prodVulns, total, summary) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ version: CACHE_VERSION, lockHash: hash, checkedAt: new Date().toISOString(), prodVulns, total, summary }, null, 2)
    );
  } catch (e) {
    // Best-effort only: a cache failure must never fail the gate.
    console.warn(`⚠️  Could not write the audit cache (${e.message}).`);
  }
}

// ─── Gates (shared by live and cached results) ──────────────────────────────

function enforceProductionGate(prodVulns, source) {
  if (prodVulns.length > 0) {
    const names = prodVulns.map((v) => `${v.name} (${v.severity})`).join(', ');
    console.error(`❌ Production audit FAILED ${source}— ${prodVulns.length} vulnerable runtime package(s): ${names}`);
    process.exit(1);
  }
  console.log(`✅ Production (--omit=dev) audit clean — no runtime vulnerabilities. ${source}`);
}

function enforceTotalGate(total, summary, source) {
  if (total > DEV_BASELINE) {
    console.error(`❌ Total vulnerabilities (${total}) exceed the documented baseline (${DEV_BASELINE}). ${source}`);
    console.error('   A new vulnerability appeared in the dependency tree.');
    console.error('   Investigate it before raising the baseline (update DEV_BASELINE here + DEVELOPMENT_HISTORY.md).');
    process.exit(1);
  }
  console.log(`✅ Total audit count ${total} within baseline ${DEV_BASELINE} (${summary}). ${source}`);
  if (total < DEV_BASELINE) {
    console.log(`   ${DEV_BASELINE - total} vulnerability(ies) fixed since the baseline was set.`);
  }
}

function unreachable() {
  if (SOFT_OFFLINE) {
    console.warn('⚠️  npm audit could not run (registry unreachable or report unreadable).');
    console.warn('   Gate skipped for this offline commit — the CI quality job re-checks on push.');
    // « Sauté » n'est ni une mesure ni un silence : la preuve le dira tel quel.
    gateSkipped = true;
    return;
  }
  console.error('❌ npm audit could not run (registry unreachable or report unreadable).');
  console.error('   An unverifiable dependency tree must not pass the security gate.');
  process.exit(1);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

/** Ce que le gate a MESURÉ (jamais ce qu'on espère) — c'est la preuve publiée. */
let gate;
/** Vrai si le gate a été sauté (registre injoignable, commit hors ligne). */
let gateSkipped = false;

const hash = lockHash();

/**
 * La mesure en direct n'a pas pu aller au bout : le cache n'est alors qu'un
 * REPLI, et il le DIT (avec son âge). Sans repli exploitable, c'est
 * `unreachable()` — jamais un vert silencieux.
 */
function fallbackOrFail() {
  const cached = readFallbackCache(hash);
  if (!cached) return unreachable();
  console.warn(
    `⚠️  registre npm injoignable : verdict repris d'un cache de ${cached.ageHours.toFixed(1)} h ` +
      '— AUCUNE mesure en direct pour ce run (voir scripts/lib/audit-verdict.mjs).',
  );
  const source = ` ${cacheFallbackLabel(cached.ageHours)}`;
  enforceProductionGate(cached.prodVulns, source);
  enforceTotalGate(cached.total, summaryOf(cached.summary), source);
  gate = { prodVulns: cached.prodVulns.length, total: cached.total, source: `repli cache, ${cached.ageHours.toFixed(1)}h` };
}

// ─── 1. La MESURE EN DIRECT — toujours, et en premier ───────────────────────
// Le cache ne remplace plus la mesure : un cache encore « frais » peut masquer un
// avis publié DEPUIS, puisque sa clé est le lockfile et que les avis, eux, ne
// touchent pas le lockfile.
const prod = runAudit('--omit=dev');
if (prod) {
  const prodVulns = Object.values(prod.vulnerabilities || {}).filter((v) => v.severity !== 'info');
  enforceProductionGate(prodVulns, '');

  const all = runAudit('');
  const total = all?.metadata?.vulnerabilities?.total;
  if (typeof total === 'number') {
    if (CACHED) writeCache(hash, prodVulns, total, all.metadata?.vulnerabilities);
    enforceTotalGate(total, summaryOf(all.metadata?.vulnerabilities), '');
    gate = { prodVulns: prodVulns.length, total, source: 'live' };
  } else {
    // ─── 2. Le REPLI — seulement ici, et il se nomme ────────────────────────
    fallbackOrFail();
  }
} else {
  fallbackOrFail();
}

// La substance de ce gate, publiée par le gate : les deux chiffres qu'il vient
// de mesurer. Le workflow n'a plus à écrire une phrase qui vaudrait aussi bien
// pour un arbre sain que pour un gate qui n'a rien regardé.
if (gateSkipped) {
  publishEvidence({
    acted: false,
    reason: 'npm audit injoignable — gate sauté (audit en ligne relancé par la CI du push)',
  });
} else if (gate) {
  publishEvidence({
    acted: true,
    reason: `audit des dépendances (${gate.source}) : ${gate.prodVulns} vulnérabilité(s) de production, ${gate.total} au total (baseline ${DEV_BASELINE})`,
  });
}
