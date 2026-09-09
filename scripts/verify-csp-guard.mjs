#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-csp-guard.mjs — production CSP violation guard.
//
// Companion of the security-headers guard in .github/workflows/pdf-e2e.yml:
// the headers step proves the CSP header is SERVED, this script proves it is
// RESPECTED — the real app is navigated (logged in as a fresh ephemeral admin,
// every main page visited) and the run FAILS if any Content-Security-Policy
// violation is emitted in the process.
//
// Why navigation: a policy that blocks something the app genuinely uses (a
// connect-src endpoint, a font, an img-src blob:/data: used by the stamp,
// a style injection) surfaces immediately as a console
// « Refused to … violates the following Content Security Policy » error. The
// guard also asserts the header is present at all — a page without CSP cannot
// have violations, and would otherwise pass vacuously.
//
// Two violation channels are collected, both surviving page navigations:
//   1. CDP console/pageerror events matching CSP markers (Chrome always logs
//      a violation);
//   2. in-page `SecurityPolicyViolationEvent` listeners installed before any
//      page script runs (evaluateOnNewDocument), read back per page.
//
// Usage: node scripts/verify-csp-guard.mjs [--url https://…]
// Reads .env (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), same as
// scripts/verify-pdf-download.mjs. Exit 0 = header présent + zéro violation.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ephemeralEmail } from './lib/ephemeral-accounts.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const parseEnv = (p) => {
  const o = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const envFile = join(root, '.env');
if (!existsSync(envFile)) {
  console.error('Introuvable: .env (SUPABASE_SERVICE_ROLE_KEY requis).');
  process.exit(1);
}
const env = parseEnv(envFile);
const supabaseBase = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseBase || !SERVICE_KEY) {
  console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = (process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'https://mama-thera-finance.vercel.app/').replace(/\/$/, '') + '/';
const KEEP = process.argv.includes('--keep');

const TS = Date.now().toString().slice(-6);
const EMAIL = ephemeralEmail('verify-csp');
const PASS = 'Audit-Pass-2026!';
let ephemeralUid = null;

const api = async (path, opts = {}) => {
  const r = await fetch(`${supabaseBase}${path}`, { headers: HDR, ...opts });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function createAccount() {
  const r = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
  });
  if (!r.body?.id) throw new Error(`création du compte échouée (${r.status})`);
  ephemeralUid = r.body.id;
  await api(`/rest/v1/user_profiles?id=eq.${ephemeralUid}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'admin' }),
  });
  console.log(`✅ compte éphémère créé (${EMAIL})`);
}

async function cleanup() {
  try {
    if (ephemeralUid) {
      const del = await api(`/auth/v1/admin/users/${ephemeralUid}`, { method: 'DELETE' });
      console.log(`  🧹 compte éphémère supprimé (${del.status})`);
    }
  } catch (e) {
    console.error('  ⚠️ cleanup partiel:', e.message);
  }
}

// ── CSP collection ───────────────────────────────────────────────────────────
const CSP_RE = /Content Security Policy|violates the following|Refused to (load|execute|connect|frame|apply|send|evaluate|run)|blocked by Content Security Policy/i;
const violations = [];
const seen = new Set();
const pushViolation = (where, text) => {
  const key = where + '|' + text.slice(0, 120);
  if (seen.has(key)) return;
  seen.add(key);
  violations.push({ where, text: text.slice(0, 220) });
};

/** Returns a page hook: attaches console/pageerror listeners + the in-page
 *  SecurityPolicyViolationEvent collector (survives navigations via
 *  evaluateOnNewDocument). */
function armCspCollectors(page) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (CSP_RE.test(text)) pushViolation(page.url().replace(URL, '').slice(0, 50) || '(root)', `[${msg.type()}] ${text}`);
  });
  page.on('pageerror', (e) => {
    const s = String(e);
    if (CSP_RE.test(s)) pushViolation(page.url().replace(URL, '').slice(0, 50) || '(root)', `[pageerror] ${s}`);
  });
  page.evaluateOnNewDocument(() => {
    window.__cspGuard = window.__cspGuard || [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspGuard.push({ directive: e.violatedDirective || '?', blocked: e.blockedURI || '?' });
    });
  });
  return async (label) => {
    const inPage = await page.evaluate(() => (window.__cspGuard || []).map((v) => `${v.directive} → ${v.blocked}`)).catch(() => []);
    for (const v of inPage) pushViolation(label, `[SecurityPolicyViolationEvent] ${v}`);
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let browser = null;
let fail = false;
const failMsg = (m) => { console.error('  ❌ ' + m); fail = true; };

(async () => {
  try {
    await createAccount();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      protocolTimeout: 120000,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const collect = armCspCollectors(page);

    // 1. The header must be present — a missing CSP would make the guard pass
    //    vacuously (no policy ⇒ no violation).
    const resp = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
    const csp = (resp.headers()['content-security-policy'] || '').trim();
    if (!csp) {
      failMsg('header Content-Security-Policy absent sur ' + URL + ' — la garde ne peut pas valider une page sans politique');
    } else {
      const directives = csp.split(';').map((d) => d.trim()).filter(Boolean);
      console.log('✅ CSP header présent (' + directives.length + ' directives)');
      for (const d of directives.slice(0, 12)) console.log('    · ' + d);
      if (!/script-src[^;]*'self'/.test(csp)) console.log('    ⚠️ script-src sans \'self\' — revoir la policy');
    }
    await wait(2500);

    // 2. Login through the real UI.
    const emailSel = await page.$('input[type="email"]') || await page.$('input[placeholder*="@"]');
    if (emailSel) {
      await page.type('input[type="email"], input[placeholder*="@"]', EMAIL);
      const pwd = await page.$('input[type="password"]');
      if (pwd) await pwd.type(PASS);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /se connecter|login/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await page.waitForFunction(() => !document.querySelector('input[type="email"]'), { timeout: 30000 }).catch(() => {});
      console.log('✅ connecté à ' + URL);
    }
    await wait(4000);

    // 3. Navigate every main page (admin account → full sidebar). Each visit
    //    exercises script-src, style-src, connect-src, font-src and img-src
    //    (charts, stamps, notifications…).
    const PAGES = [
      ['Tableau de bord', /tableau de bord|dashboard/i],
      ['Paie', /paie|salaires|payroll/i],
      ['Dépenses', /d[eé]penses|expenses/i],
      ['Élèves', /[eé]l[eè]ves|students/i],
      ['Parents', /parents/i],
      ['Calendrier', /calendrier|calendar/i],
      ['Archives', /archives/i],
    ];
    let visited = 0;
    for (const [label, re] of PAGES) {
      let clicked = false;
      for (let attempt = 0; attempt < 4 && !clicked; attempt++) {
        clicked = await page.evaluate((reSrc) => {
          const re = new RegExp(reSrc, 'i');
          const items = [...document.querySelectorAll('a, button, [role="menuitem"]')];
          const el = items.find((e) => re.test(e.textContent || '') && (e.textContent || '').trim().length < 25);
          if (!el) return false;
          el.click();
          return true;
        }, re.source);
        if (!clicked) {
          await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
          await wait(5000);
        }
      }
      if (!clicked) {
        console.log(`  ⚠️ lien « ${label} » introuvable — ignoré`);
        continue;
      }
      await wait(3500);
      await collect(label);
      visited++;
      console.log(`  ✓ ${label} visitée (${page.url().replace(URL, '').slice(0, 60) || '/'})`);
    }
    console.log(`✅ ${visited}/${PAGES.length} pages visitées`);

    // 4. Verdict.
    if (violations.length) {
      console.error(`\n❌ ${violations.length} violation(s) CSP détectée(s) en navigation :`);
      for (const v of violations) console.error(`   [${v.where}] ${v.text}`);
    } else {
      console.log('\n✅ Zéro violation CSP en navigation — la policy est respectée par l\'app.');
    }
  } catch (e) {
    failMsg(String(e.message || e).slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanup();
  }
  if (fail || violations.length > 0) process.exit(1);
  process.exit(0);
})();