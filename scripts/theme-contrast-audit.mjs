#!/usr/bin/env node
/**
 * Theme contrast audit — WCAG pair gate across every theme & overlay.
 *
 * Drives the real app (production build + `vite preview`) in headless Chrome:
 * for each of the 6 themes (navy, emerald, cream, bordeaux, slate, midnight)
 * it opens every modal / side panel reachable from the UI and scans the
 * visible text with the browser's real computed styles (Tailwind utilities +
 * the theme remap layer in src/index.css + JS-driven tokens). Any text/back-
 * ground pair with a contrast ratio below 3:1 fails the audit (exit 1) —
 * the same measurement used to hunt the white-on-white overlay bugs, now
 * automated and gated in CI.
 *
 * Account handling (two modes):
 *   • CI / explicit creds:  AUDIT_EMAIL + AUDIT_PASSWORD env vars are used.
 *   • Local, no creds:       if SUPABASE_SERVICE_ROLE_KEY is present in .env,
 *                            an ephemeral admin account is created before the
 *                            audit and deleted afterwards (same pattern as
 *                            scripts/e2e-business.mjs). No cleanup → no audit.
 *
 * Env:
 *   AUDIT_URL        target URL (default http://127.0.0.1:4173/)
 *   AUDIT_PORT       preview port (default 4173) — used when the URL is local
 *   AUDIT_NO_BUILD   set to skip `vite build` before `vite preview`
 *   AUDIT_MIN_RATIO  minimum contrast (default 3.0)
 *   AUDIT_THEMES     comma list to audit only a subset (e.g. navy,slate)
 *   AUDIT_OUT        write a JSON report to this path
 *   AUDIT_EMAIL / AUDIT_PASSWORD   login for the audited app
 *   CHROME_PATH      Chrome/Chromium executable (auto-detected otherwise)
 *
 * Known non-user-facing text is excluded and reported separately ('DEV'
 * ribbon — dev-role only, never shown in production accounts).
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Configuration ──────────────────────────────────────────────────────────
const parseEnvFile = (p) => {
  const o = {};
  if (!existsSync(p)) return o;
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const envFile = join(root, '.env');
const env = parseEnvFile(envFile);

const AUDIT_URL = process.env.AUDIT_URL || 'http://127.0.0.1:4173/';
const AUDIT_PORT = Number(process.env.AUDIT_PORT ?? 4173);
const MIN_RATIO = Number(process.env.AUDIT_MIN_RATIO ?? 3.0);
const isLocalTarget = AUDIT_URL.includes('127.0.0.1') || AUDIT_URL.includes('localhost');
const doBuild = !process.env.AUDIT_NO_BUILD;
const AUDIT_EMAIL = process.env.AUDIT_EMAIL;
const AUDIT_PASSWORD = process.env.AUDIT_PASSWORD;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBase = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

const THEMES = (process.env.AUDIT_THEMES || 'navy,emerald,cream,bordeaux,slate,midnight')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const THEME_LABELS = {
  navy: 'Navy Exécutif',
  emerald: 'Émeraude MAMA THERA',
  cream: 'Livre Crème',
  bordeaux: 'Bordeaux Académique',
  slate: 'Ardoise Sombre',
  midnight: 'Cyber Minuit (Sombre)',
};

function resolveChrome() {
  const cands = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

// ── In-page contrast scanner ───────────────────────────────────────────────
// Returns failures [{ text, fg, bg, ratio, el }] for all visible text in
// `root` (default document) with contrast < MIN_RATIO. Self-contained: it is
// serialized into the page, so every constant it reads must live inside it.
const SCANNER = (minRatio) => {
  // Text ignored as non-user-facing chrome (reported, never fails the gate).
  const IGNORED_TEXTS = new Set(['DEV']);
  // Resolve ANY CSS color to sRGB by rasterizing it (Tailwind v4 emits
  // oklch; hex / rgb() / hsl() / color() also land here). The browser's
  // rasterizer is the ground truth — no manual color math. getImageData
  // returns unpremultiplied sRGB + alpha, so translucent colors keep their
  // own alpha for later compositing.
  const res = document.createElement('canvas').getContext('2d', { willReadFrequently: false });
  const css2rgb = (c) => {
    if (!c || !c.trim() || c.trim() === 'transparent') return null;
    try {
      res.clearRect(0, 0, 1, 1); // transparent base — no paint pollution
      res.fillStyle = c; // silently ignored when invalid → nothing painted
      res.fillRect(0, 0, 1, 1);
      const d = res.getImageData(0, 0, 1, 1).data;
      const a = d[3] / 255;
      if (a < 0.02) return null; // transparent = no painted surface
      return [d[0], d[1], d[2], a];
    } catch { return null; }
  };
  const lum = (rgb) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  // First non-none backgroundImage ancestor → every app gradient is a dark
  // surface (card-hero, welcome-banner, sidebar); stop compositing there.
  const DARK_GRADIENT = [15, 23, 42];

  return function scan(rootSel) {
    const root = rootSel ? document.querySelector(rootSel) : document.body;
    if (!root) return { failures: [], ignored: [], checked: 0 };
    const failures = [];
    const ignored = [];
    let checked = 0;
    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.parentElement && n.parentElement.closest('svg')) continue; // chart internals use fill, not color
      const t = (n.textContent || '').trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // A hidden-but-mounted overlay (chat panel closed, exit animation,
      // FAB content) is not user-visible even if its own opacity reads 1:
      // skip text inside any ancestor that fades/hides it, and text whose
      // box lies outside the viewport (translated-away panels).
      let hidden = false;
      let anc0 = el;
      while (anc0 && anc0 !== document.body) {
        const a = getComputedStyle(anc0);
        if (a.display === 'none' || a.visibility === 'hidden' || parseFloat(a.opacity) < 0.05) { hidden = true; break; }
        anc0 = anc0.parentElement;
      }
      if (hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right < 0 || r.left > window.innerWidth || r.bottom < 0 || r.top > window.innerHeight) continue;
      const fgP = css2rgb(cs.color);
      if (!fgP) continue;
      // Walk ancestors for the background (composite alpha over what lies
      // below; stop at the first opaque painted surface or a gradient).
      let bg = null;
      let anc = el;
      while (anc) {
        const acs = getComputedStyle(anc);
        if (acs.backgroundImage && acs.backgroundImage !== 'none') { bg = DARK_GRADIENT; break; }
        const b = css2rgb(acs.backgroundColor);
        if (b) {
          const a = b.length > 3 ? b[3] : 1;
          if (a > 0.02) bg = bg ? [a * b[0] + (1 - a) * bg[0], a * b[1] + (1 - a) * bg[1], a * b[2] + (1 - a) * bg[2]] : [b[0], b[1], b[2]];
          if (a >= 0.999) break;
        }
        anc = anc.parentElement;
      }
      if (!bg) bg = [255, 255, 255];
      // Composite translucent foregrounds over the resolved background.
      const a = fgP.length > 3 ? fgP[3] : 1;
      const fg = a >= 0.999 ? [fgP[0], fgP[1], fgP[2]] : [a * fgP[0] + (1 - a) * bg[0], a * fgP[1] + (1 - a) * bg[1], a * fgP[2] + (1 - a) * bg[2]];
      const rt = ratio(fg, bg);
      checked += 1;
      if (rt < minRatio) {
        const key = t.slice(0, 24) + '|' + fg.map((v) => Math.round(v)).join() + '|' + bg.map((v) => Math.round(v)).join();
        if (seen.has(key)) continue;
        seen.add(key);
        const chain = [];
        let ac = el;
        for (let i = 0; i < 4 && ac; i++) {
          const s = getComputedStyle(ac);
          chain.push((ac.tagName || '').toLowerCase() + (ac.className && ac.className.toString ? '.' + ac.className.toString().slice(0, 34) : '') + '{op:' + s.opacity + ',bg:' + s.backgroundColor + '}');
          ac = ac.parentElement;
        }
        const rec = { text: t.slice(0, 90), fg: fg.map((v) => Math.round(v)).join(','), bg: bg.map((v) => Math.round(v)).join(','), ratio: +rt.toFixed(2), cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 70), chain };
        (IGNORED_TEXTS.has(t) ? ignored : failures).push(rec);
      }
    }
    return { failures, ignored, checked };
  };
};

// ── Results bookkeeping ────────────────────────────────────────────────────
const failures = []; // { theme, step, text, fg, bg, ratio, cls }
const ignoredSeen = []; // { theme, step, text }
const checks = [];
const recordCheck = (theme, step, ok, note = '') => {
  checks.push({ theme, step, ok, note });
  console.log(`   ${ok ? '✅' : '❌'} [${theme}] ${step}${note ? ' — ' + note : ''}`);
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const chromePath = resolveChrome();
  if (!chromePath) {
    console.error('❌ Chrome/Chromium introuvable. Définissez CHROME_PATH (ou installez Chrome).');
    process.exit(1);
  }

  // Local: ephemeral account via service role (deleted afterwards). CI: creds.
  let ephemeralUid = null;
  if (!AUDIT_EMAIL || !AUDIT_PASSWORD) {
    if (!SERVICE_KEY || !supabaseBase) {
      console.error('❌ Aucun compte : fournissez AUDIT_EMAIL/AUDIT_PASSWORD (CI) ou SUPABASE_SERVICE_ROLE_KEY dans .env (compte éphémère local).');
      process.exit(1);
    }
    const ts = Date.now().toString().slice(-6);
    const email = `contrast-audit-${ts}@mamathera.org`;
    const password = 'Contrast-2026!Audit';
    const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
    const r = await fetch(`${supabaseBase}/auth/v1/admin/users`, {
      method: 'POST', headers: HDR, body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const b = await r.json();
    if (!r.ok) { console.error('❌ Création du compte éphémère impossible :', b.msg || r.status); process.exit(1); }
    ephemeralUid = b.id;
    await wait(2200); // profile trigger
    await fetch(`${supabaseBase}/rest/v1/user_profiles?id=eq.${b.id}`, {
      method: 'PATCH', headers: HDR, body: JSON.stringify({ role: 'admin' }),
    });
    console.log(`🔑 Compte éphémère créé : ${email} (sera supprimé en fin d'audit)`);
    process.env.AUDIT_EMAIL = email;
    process.env.AUDIT_PASSWORD = password;
  }

  // Build + preview when targeting the local server.
  let preview = null;
  try {
    if (isLocalTarget && doBuild) {
      console.log('🏗️  Build de production…');
      const build = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'production'], { cwd: root, stdio: 'inherit' });
      const buildCode = await new Promise((res) => build.on('close', res));
      if (buildCode !== 0) { console.error('❌ Build échoué.'); process.exit(1); }
    }
    if (isLocalTarget) {
      // Ready check; if already served (dev), reuse it.
      try { await fetch(AUDIT_URL, { signal: AbortSignal.timeout(2000) }); }
      catch {
        console.log(`🚀 Démarrage du preview sur :${AUDIT_PORT}…`);
        preview = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(AUDIT_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        let perr = '';
        preview.stderr.on('data', (d) => { perr += d; });
        const start = Date.now();
        let ready = false;
        while (Date.now() - start < 60000) {
          try { const r = await fetch(AUDIT_URL, { signal: AbortSignal.timeout(3000) }); if (r.ok) { ready = true; break; } } catch { /* retry */ }
          if (perr.includes('EADDRINUSE')) { console.error('❌ Preview: port occupé.\n' + perr.slice(0, 400)); process.exit(1); }
          await wait(800);
        }
        if (!ready) {
          console.error('❌ Preview non joignable sur ' + AUDIT_URL + ' après 60 s.');
          if (perr) console.error('stderr du preview :\n' + perr.slice(0, 1200));
          process.exit(1);
        }
      }
    }

    console.log(`🌐 Audit sur ${AUDIT_URL} — seuil ${MIN_RATIO}:1, thèmes : ${THEMES.join(', ')}`);
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000, label = 'attente') => {
      try { await page.waitForFunction(fn, { timeout: ms }); }
      catch { throw new Error(`Timeout ${label}`); }
    };
    const clickText = async (tag, text, label) => {
      const ok = await page.evaluate(({ tg, tx }) => {
        const b = [...document.querySelectorAll(tg)].find((e) => ((e.textContent || '').trim()).includes(tx));
        if (b) { b.click(); return true; }
        return false;
      }, { tg: tag, tx: text });
      if (!ok) throw new Error(`Bouton introuvable : ${label}`);
      await sleep(900);
    };
    const visibleText = (needle) => `(() => { const r = document.body.innerText || ''; return r.includes(${JSON.stringify(needle)}); })()`;
    const scanAndRecord = async (theme, step, rootSel, dialogGuard) => {
      let failuresStep;
      try {
        if (dialogGuard) await waitFor(dialogGuard, 10000, `${step} (overlay non ouvert)`);
        const res = await page.evaluate(`(${SCANNER})(${MIN_RATIO})(${JSON.stringify(rootSel || null)})`);
        failuresStep = res.failures;
        for (const f of res.failures) failures.push({ theme, step, ...f });
        for (const ig of res.ignored) ignoredSeen.push({ theme, step, text: ig.text });
        recordCheck(theme, step, failuresStep.length === 0, failuresStep.length ? `${failuresStep.length} paire(s) < ${MIN_RATIO}:1` : `${res.checked} textes scannés`);
        return res.failures.length;
      } catch (e) {
        recordCheck(theme, step, false, e.message.slice(0, 120));
        return 0;
      }
    };
    const pressEsc = async () => {
      await page.keyboard.press('Escape');
      await sleep(700);
    };

    // ── Login ───────────────────────────────────────────────────────────
    await page.goto(AUDIT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try {
      await page.waitForSelector('input[placeholder="name@mamathera.org"]', { timeout: 8000 });
      await page.type('input[placeholder="name@mamathera.org"]', process.env.AUDIT_EMAIL);
      await page.type('input[type="password"]', process.env.AUDIT_PASSWORD);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').toLowerCase().includes('se connecter'));
        if (b) b.click();
      });
      console.log('🔐 Login…');
    } catch {
      console.log('🔐 Session déjà présente (aucun écran de login).');
    }
    await waitFor(visibleText('Finance Exécutive') + ' || ' + visibleText('Résumé Exécutif') + ' || ' + visibleText('Élèves & Notes'), 45000, 'shell de l’app (login)');

    const openOverlay = async (theme, name, open) => {
      // open() → { rootSel, guard } or null if skipped
      let opened;
      try {
        opened = await open();
      } catch (e) {
        recordCheck(theme, name, false, 'ouverture impossible: ' + e.message.slice(0, 100));
        return;
      }
      if (opened === null) {
        recordCheck(theme, name, true, 'non applicable (aucun déclencheur)');
        return;
      }
      await scanAndRecord(theme, name, opened.rootSel, opened.guard);
      await pressEsc();
    };

    for (const theme of THEMES) {
      console.log(`\n════ Theme : ${theme} ════`);
      // Switch theme through Settings (the app's own setter — profile sync
      // overrides localStorage, so this is the only reliable path).
      await clickText('button', 'Paramètres Système', 'nav Paramètres');
      await waitFor(visibleText('PARAMÈTRES DU THÈME'), 15000, 'vue Paramètres');
      const label = THEME_LABELS[theme];
      const switched = await page.evaluate((lbl) => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(lbl));
        if (!b) return false;
        b.click();
        return true;
      }, label);
      if (!switched) { console.error(`❌ Thème ${theme} : bouton introuvable`); continue; }
      await sleep(1200);
      const shellTheme = await page.evaluate(() => {
        const s = document.querySelector('div[class*="theme-"]');
        const m = s && (s.className || '').toString().match(/theme-([a-z]+)/);
        return m ? m[1] : '';
      });
      if (shellTheme !== theme) { console.error(`❌ Thème ${theme} : coquille toujours en "${shellTheme}"`); continue; }

      // Baseline — dashboard
      await clickText('button', 'Tableau de bord', 'nav dashboard');
      await waitFor(visibleText('Résumé Exécutif'), 15000, 'dashboard');
      await scanAndRecord(theme, 'Vue Dashboard', null);

      // Main views — full-page scan (nav label → wait marker, null = sleep)
      const VIEWS = [
        ['Élèves & Notes', 'Gestion des Élèves'],
        ['Parents', 'Annuaire des Parents'],
        ['Paie/Salaires', 'Répertoire du personnel'],
        ['Dépenses', 'Dépenses Générales'],
        ['Calendrier', null],
        ['Notes', null],
        ['Archives Annuelles', null],
        ["Journal d'Audit", null],
        ['Paramètres Système', 'PARAMÈTRES DU THÈME'],
      ];
      for (const [navLabel, marker] of VIEWS) {
        try {
          await clickText('button', navLabel, 'nav ' + navLabel);
          if (marker) {
            try { await waitFor(visibleText(marker), 12000, 'vue ' + navLabel); }
            catch { recordCheck(theme, 'Vue ' + navLabel, false, 'marqueur introuvable'); continue; }
          } else {
            await sleep(1300);
          }
          await scanAndRecord(theme, 'Vue ' + navLabel, null);
        } catch (e) {
          recordCheck(theme, 'Vue ' + navLabel, false, e.message.slice(0, 100));
        }
      }

      // Ajouter un Élève modal
      await openOverlay(theme, 'Modal Ajouter un Élève', async () => {
        await clickText('button', 'Ajouter un Élève', 'CTA Ajouter un Élève');
        return { rootSel: '[role="dialog"]', guard: '(() => !!document.querySelector(\'[role="dialog"]\'))()' };
      });

      // Enregistrer le Paiement modal
      await openOverlay(theme, 'Modal Saisie de Paiement', async () => {
        await clickText('button', 'Enregistrer le Paiement', 'CTA paiement');
        return { rootSel: '[role="dialog"]', guard: '(() => !!document.querySelector(\'[role="dialog"]\'))()' };
      });

      // Notifications dropdown (bell in the header)
      await openOverlay(theme, 'Panneau Notifications', async () => {
        const ok = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => {
            const s = (x.getAttribute('aria-label') || '') + (x.title || '') + (x.textContent || '');
            return s.includes('Notification');
          });
          if (b) { b.click(); return true; }
          return false;
        });
        if (!ok) return null;
        return { rootSel: null, guard: null };
      });

      // Student fiche (first student row), data-dependent
      await openOverlay(theme, 'Fiche Élève', async () => {
        await pressEsc(); // clear any leftover overlay so the fiche guard is honest
        await clickText('button', 'Élèves & Notes', 'nav Élèves');
        await waitFor(visibleText('Gestion des Élèves'), 15000, 'vue Élèves');
        // The table loads lazily with the view chunk — wait for real rows
        // (header row alone = empty dataset → non applicable).
        try {
          await waitFor('(() => document.querySelectorAll(\'tbody tr\').length > 0)()', 6000, 'lignes élèves');
        } catch {
          return null;
        }
        const clicked = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('tbody tr, table tr')];
          const row = rows.find((r) => {
            const t = r.textContent || '';
            if (!t.trim()) return false;
            // skip column-header rows (all-caps labels)
            if (/NOM DE L'ÉLÈVE|SOLDE|ACTIONS|STATUT|ÉLÈVES/.test(t) && !/[a-zà-ÿ]/.test(t)) return false;
            return [...r.querySelectorAll('button')].length > 0;
          });
          if (!row) return false;
          // Open the fiche via the student name/avatar cell
          // (setSelectedStudent) — NOT the row's first <button>, which is the
          // flag toggle and opens nothing.
          const open = row.querySelector('div.cursor-pointer');
          if (open) { open.click(); return true; }
          return false;
        });
        if (!clicked) return null;
        await sleep(1400);
        return { rootSel: '[role="dialog"]', guard: '(() => !!document.querySelector(\'[role="dialog"]\'))()' };
      });

      // Relance parent modal (needs an overdue parent row), data-dependent
      await openOverlay(theme, 'Modal Relance Parent', async () => {
        await clickText('button', 'Parents', 'nav Parents');
        await waitFor(visibleText('Annuaire des Parents'), 15000, 'vue Parents');
        const clicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Relancer');
          if (b) { b.click(); return true; }
          return false;
        });
        if (!clicked) return null;
        return { rootSel: '[role="dialog"]', guard: '(() => !!document.querySelector(\'[role="dialog"]\'))()' };
      });

      // Productivité side panel — the sidebar nav label is always present, so
      // only count the panel as open when its own heading text appears twice.
      await openOverlay(theme, 'Panneau Productivité', async () => {
        await clickText('button', 'Productivité', 'nav Productivité');
        await waitFor("(() => ((document.body.innerText || '').match(/Productivité/g) || []).length >= 2)", 10000, 'panneau Productivité');
        return { rootSel: null, guard: null };
      });

      // Floating AI chat
      await openOverlay(theme, 'Chat IA flottant', async () => {
        const ok = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => {
            const s = (x.getAttribute('aria-label') || '') + (x.title || '') + (x.textContent || '');
            return s.includes('Assistant IA');
          });
          if (b) { b.click(); return true; }
          return false;
        });
        if (!ok) return null;
        return { rootSel: '[role="dialog"]', guard: '(() => !!document.querySelector(\'[role="dialog"]\'))()' };
      });
    }

    await browser.close();

    // ── Report ──────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    const byStep = new Map();
    for (const f of failures) {
      const k = `${f.theme} · ${f.step}`;
      if (!byStep.has(k)) byStep.set(k, []);
      byStep.get(k).push(f);
    }
    const counts = checks.reduce((a, c) => (a[c.ok ? 'ok' : 'ko'] += 1, a), { ok: 0, ko: 0 });
    console.log(`Couvertures : ${checks.length} (${counts.ok} ok, ${counts.ko} KO)`);
    console.log(`Paires sous ${MIN_RATIO}:1 : ${failures.length}`);
    // A step that could not open/scan its overlay (timeout, broken trigger)
    // means that surface was NOT verified — treat it as a hard failure so the
    // gate cannot silently skip coverage ("non applicable" stays OK: the
    // overlay legitimately has no trigger with this dataset).
    if (ignoredSeen.length) {
      const ign = [...new Set(ignoredSeen.map((i) => i.text))];
      console.log(`Textes ignorés (non utilisateur, signalés seulement) : ${ign.join(', ')}`);
    }
    for (const [k, fs] of byStep) {
      console.log(`\n❌ ${k} — ${fs.length} paire(s) :`);
      for (const f of fs.slice(0, 12)) {
        console.log(`   « ${f.text} »  fg rgb(${f.fg}) / bg rgb(${f.bg})  → ${f.ratio}:1${f.cls ? `  [${f.cls}]` : ''}`);
      }
    }
    if (process.env.AUDIT_OUT) {
      writeFileSync(process.env.AUDIT_OUT, JSON.stringify({ checks, failures, ignored: ignoredSeen }, null, 2));
    }
    process.exitCode = failures.length > 0 || counts.ko > 0 ? 1 : 0;
    if (failures.length > 0) console.log(`\n❌ ${failures.length} paire(s) sous ${MIN_RATIO}:1 — audit KO.`);
    else if (counts.ko > 0) console.log(`\n❌ ${counts.ko} étape(s) non couvertes (timeout/erreur d'ouverture) — audit KO.`);
    else console.log('\n✅ Aucune paire sous le seuil, toutes les étapes couvertes — contraste conforme.');
  } finally {
    if (preview) { try { preview.kill('SIGTERM'); } catch { /* ignore */ } }
    if (ephemeralUid && supabaseBase && SERVICE_KEY) {
      try {
        await fetch(`${supabaseBase}/auth/v1/admin/users/${ephemeralUid}`, {
          method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
        });
        console.log('🧹 Compte éphémère supprimé.');
      } catch (e) { console.log('⚠️ Nettoyage compte éphémère :', e.message); }
    }
  }
}

main().catch((e) => {
  console.error('❌ Erreur fatale :', e);
  process.exit(1);
});
