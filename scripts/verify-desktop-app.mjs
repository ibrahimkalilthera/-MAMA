// One-off E2E proof of the packaged Electron app (release/ portable exe).
// 1. Creates an ephemeral admin + one temporary staff row (service-role).
// 2. Launches the packaged exe with --remote-debugging-port + ELECTRON_DL_DIR.
// 3. Drives it over CDP with puppeteer-core: login, Paie/Salaires, click the
//    employee "Reçu PDF" button, verify the PDF lands in the download dir.
// 4. Cleans up: kills the app, deletes the staff row + the ephemeral account.
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { ephemeralEmail } from '../scripts/lib/ephemeral-accounts.mjs';
import { sweepOrphanElectron } from './lib/orphan-chrome.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { replayableWrite, withTransientRetry } from './lib/transient-http.mjs';

const envFile = readFileSync('.env', 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.replace(/^["']|["']$/g, '');
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const BASE = (get('VITE_SUPABASE_URL') || '').replace(/\/$/, '');
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

// Default: the packaged portable exe. Override with DESKTOP_EXE to prove the
// same flow on the NSIS-INSTALLED app (installer smoke test) or any build.
const EXE = process.env.DESKTOP_EXE || join(process.cwd(), 'release', 'MamaTheraFinance-1.0.0-portable.exe');
const DL_DIR = join(tmpdir(), `electron-proof-dl-${Date.now()}`);
// Electron userData dir (portable = same Roaming dir as the installed app) —
// wiped before launch so every run proves the login from a clean state, and
// wiped again after so no session of the ephemeral account lingers.
// Per-run isolated Electron profile (Chromium --user-data-dir): guarantees a
// clean session for every run without fighting locks on the Roaming profile.
const USER_DATA = join(tmpdir(), `electron-proof-ud-${Date.now()}`);
const PORT = 9400 + Math.floor(Math.random() * 400); // unique per run — no stale-instance confusion
const PASS = 'Audit-Pass-2026!';
const staffName = `PreuveBureau ${Date.now().toString().slice(-5)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Une réponse sous la forme `{ status, body }` — celle que le rejeu sain exige.
 *
 * Les écritures ci-dessous passent par `replayableWrite` : une coupure de
 * passerelle est retentée, mais la reprise commence par une SONDE, sinon un
 * POST déjà appliqué doublerait sa ligne. Une ligne de démo non retrouvée est
 * une ligne qui reste en base : le nom de l'employé porte son run, l'email du
 * compte est unique, et ce sont les deux clés que les sondes interrogent.
 */
const raw = async (path, init = {}) => {
  const r = await fetch(`${BASE}${path}`, { headers: HDR, ...init });
  const text = await r.text();
  try {
    return { status: r.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: r.status, body: null };
  }
};
const wipeUserData = () => {
  for (let i = 0; i < 5; i++) {
    try { rmSync(USER_DATA, { recursive: true, force: true }); return; } catch { /* verrou transitoire */ }
    wait(800);
  }
};

/**
 * Une suppression IDEMPOTENTE, retentée : un 404 veut dire « déjà parti », ce que
 * ce nettoyage demande exactement — et une coupure de passerelle ne doit pas
 * laisser une ligne de démo en base (c'est le résidu découvert au run suivant).
 * Les deux suppressions ci-dessous portaient un `catch(() => {})` : l'échec était
 * donc avalé, sans trace et sans preuve que la ligne est partie.
 */
const deleteOrGone = async (path, label) => {
  const result = await withTransientRetry(async () => {
    const r = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: HDR });
    return { status: r.status };
  }, { label, log: (m) => console.log(`  ↻ ${m}`) });
  const gone = result.status === 204 || result.status === 200 || result.status === 404;
  console.log(`${gone ? '🧹' : '⚠️'} ${label} (HTTP ${result.status}${result.status === 404 ? ' — déjà absent' : ''})`);
  return gone;
};

let uid = null;
let staffId = null;
let app = null;
let browser = null;

try {
  // ── 0. purge any leftover staff rows from crashed previous runs (same
  //        naming pattern as this script) so the payroll table never
  //        accumulates test data that pollutes the school's Paie view.
  const leftovers = await (async () => {
    const lr = await fetch(`${BASE}/rest/v1/staff?select=id&name=like.*PreuveBureau*`, { headers: HDR });
    return lr.ok ? (await lr.json()).map((r) => r.id) : [];
  })();
  for (const id of leftovers) {
    // Retentée et NOMMÉE : un `catch(() => {})` avalait l'échec, donc une ligne
    // résiduelle pouvait survivre à ce que le script croyait avoir purgé.
    await deleteOrGone(`/rest/v1/staff?id=eq.${id}`, `résidu PreuveBureau purgé (${id.slice(0, 8)}…)`).catch(() => {});
  }
  if (leftovers.length) console.log(`🧹 ${leftovers.length} employé(s) résiduel(s) PreuveBureau purgé(s)`);

  // ── 1. ephemeral admin account + profile → admin ────────────────────────
  const email = ephemeralEmail('verify-desktop');
  const created = await replayableWrite(
    () => raw('/auth/v1/admin/users', {
      method: 'POST', body: JSON.stringify({ email, password: PASS, email_confirm: true }),
    }),
    async () => {
      const probe = await raw(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
      const found = Array.isArray(probe.body?.users) ? probe.body.users[0] : null;
      return found?.id ? { status: 200, body: { id: found.id } } : null;
    },
    { label: 'POST /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
  );
  if (!created.body?.id) throw new Error(`création compte: ${created.body?.msg || created.status}`);
  uid = created.body.id;
  console.log('✅ compte éphémère', email);
  await wait(2500);
  const up = await fetch(`${BASE}/rest/v1/user_profiles?id=eq.${uid}`, {
    method: 'PATCH', headers: HDR, body: JSON.stringify({ role: 'admin' }),
  });
  console.log(up.status < 300 ? '✅ profil promu admin' : `⚠️ promotion profil HTTP ${up.status}`);

  // ── 2. one temporary staff row (for the fiche PDF) ──────────────────────
  const sr = await replayableWrite(
    () => raw('/rest/v1/staff', {
      method: 'POST', headers: { ...HDR, Prefer: 'return=representation' },
      body: JSON.stringify({ name: staffName, position: 'Enseignant', salary: 150000, email: 'preuve@mamathera.org' }),
    }),
    async () => {
      const probe = await raw(`/rest/v1/staff?select=*&name=eq.${encodeURIComponent(staffName)}&limit=1`);
      const row = Array.isArray(probe.body) ? probe.body[0] : null;
      if (row?.id) console.log('  ↻ employé temporaire : la ligne était déjà là — réutilisée');
      return row?.id ? { status: 201, body: [row] } : null;
    },
    { label: 'POST /rest/v1/staff — ', log: (m) => console.log(`  ↻ ${m}`) },
  );
  if (!sr.body?.[0]?.id) throw new Error(`insert staff: ${sr.status} ${JSON.stringify(sr.body ?? null).slice(0, 120)}`);
  staffId = sr.body[0].id;
  console.log('✅ employé temporaire', staffName, staffId);

  // ── 3. launch the packaged exe with CDP + auto download dir ─────────────
  console.log('🚀 lancement du portable (session vierge, profil isolé)…');
  // Startup sweep: kill orphaned MamaTheraFinance.exe from interrupted runs
  // (our electron-proof-ud marker, or past the minimum age window). Replaces
  // the blunt image-name taskkill that also killed a legitimately open app.
  const sweptE = await sweepOrphanElectron();
  if (sweptE) console.log(`🧹 ${sweptE} processus Electron orphelin(s) purgé(s)`);
  app = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`], { env: { ...process.env, ELECTRON_DL_DIR: DL_DIR }, stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      ws = j.webSocketDebuggerUrl;
    } catch { /* pas encore prêt */ }
    if (!ws) await wait(1000);
  }
  if (!ws) throw new Error('CDP injoignable — le portable n’a pas démarré');
  console.log('✅ CDP connecté');

  browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  const targets = await browser.pages();
  console.log('cibles CDP:', targets.map((p) => p.url().slice(0, 55)).join(' | '));
  let page = targets.find((p) => p.url().startsWith('file://')) || targets[0];
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
  page.on('console', (m) => console.log(`  [console.${m.type()}]`, m.text().slice(0, 200)));

  console.log('URL fenêtre:', (await page.url()).slice(0, 60));

  // ── 4. login (wait for the form — cold start can be slow) ───────────────
  let emailSel = null;
  for (let i = 0; i < 30 && !emailSel; i++) {
    emailSel = (await page.$('input[type="email"]')) || (await page.$('input[placeholder*="@"]'));
    if (!emailSel) { await wait(1000); }
  }
  if (!emailSel) {
    // Maybe the attached target isn't the main window — scan every target.
    for (const t of targets) {
      const sel = (await t.$('input[type="email"]')) || (await t.$('input[placeholder*="@"]'));
      if (sel) { page = t; emailSel = sel; break; }
    }
  }
  if (!emailSel) {
    const diag = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      lsKeys: Object.keys(localStorage).filter((k) => /auth|sb-|token/i.test(k)),
      body: document.body ? document.body.innerText.slice(0, 250) : '(pas de body)',
    }));
    console.log('DIAGNOSTIC:', JSON.stringify(diag));
    throw new Error('écran de login introuvable (CORS/origine ?)');
  }
  await page.type('input[type="email"], input[placeholder*="@"]', email);
  const pwd = await page.$('input[type="password"]');
  if (pwd) await pwd.type(PASS);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /se connecter|login/i.test(x.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForFunction(() => !document.querySelector('input[type="email"]'), { timeout: 40000 }).catch(() => {});
  await wait(4000);
  const loggedIn = await page.evaluate(() => document.body.innerText.includes('Tableau de bord') || document.body.innerText.includes('Résumé Exécutif'));
  console.log(loggedIn ? '✅ LOGIN OK (CORS file:// accepté)' : '❌ login échoué');
  if (!loggedIn) throw new Error('login échoué');

  // ── 5. navigate Paie/Salaires, retry on transient JWT clock skew ───────
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('a, button, [role="menuitem"]')];
    const t = items.find((el) => /paie|salaires|payroll/i.test(el.textContent || '') && (el.textContent || '').trim().length < 25);
    if (t) t.click();
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    const broken = await page.evaluate(() => document.body.innerText.includes('Problème de connexion'));
    if (!broken) break;
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => /réessayer|retry/i.test(x.textContent || ''));
      if (btn) btn.click();
    });
    console.log(`↻ retry ${attempt + 1} (JWT clock skew)`);
    await wait(3500);
  }
  await wait(2500);
  const state = await page.evaluate((name) => {
    const body = document.body ? document.body.innerText : '';
    return {
      hasStaff: body.includes(name),
      snippet: body.slice(0, 400),
      buttons: [...document.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => (x.textContent || '').trim().slice(0, 30)).filter(Boolean).slice(0, 20),
    };
  }, staffName);
  console.log('PAGE:', JSON.stringify({ hasStaff: state.hasStaff, snippet: state.snippet }));
  console.log('boutons visibles:', JSON.stringify(state.buttons));
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((x) => /reçu|pdf|télécharger|bulletin/i.test(x.textContent || ''))
      .map((x) => ({ text: (x.textContent || '').trim().slice(0, 40), vis: !!(x.offsetParent) }))
      .slice(0, 15),
  );
  console.log('boutons reçu/pdf:', JSON.stringify(btns));
  const clicked = await page.evaluate(() => {
    // The per-employee PDF button is an icon-only <button title="Télécharger Reçu PDF">.
    const btn = [...document.querySelectorAll('button')].find(
      (x) => x.offsetParent && /reçu|receipt/i.test(x.getAttribute('title') || ''),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log(clicked ? '🎯 bouton « Télécharger Reçu PDF » (icône) cliqué' : '⚠️ bouton non trouvé');

  // ── 6. wait for the PDF in the download dir ─────────────────────────────
  let pdfPath = null;
  for (let i = 0; i < 40 && !pdfPath; i++) {
    await wait(1000);
    if (existsSync(DL_DIR)) {
      pdfPath = readdirSync(DL_DIR).find((f) => f.toLowerCase().endsWith('.pdf'));
    }
  }
  if (!pdfPath) throw new Error('aucun PDF reçu dans ' + DL_DIR);
  const full = join(DL_DIR, pdfPath);
  const head = Buffer.from(readFileSync(full)).subarray(0, 5).toString();
  const ok = head === '%PDF-';
  console.log(ok ? `✅ PDF TÉLÉCHARGÉ: ${pdfPath} (${statSync(full).size} octets, signature ${head})` : `❌ fichier non-PDF: ${head}`);

  // ── cleanup ─────────────────────────────────────────────────────────────
  // Graceful close over CDP (terminates the app for real — disconnect() only
  // detaches and left orphan processes; the portable stub also survives a bare
  // app.kill()). Our app is killed by PID above; the age-windowed sweep then
  // clears any orphan (our electron-proof-ud marker → killed regardless of
  // age; a legitimately open fresh app is never touched).
  await Promise.race([browser.close().catch(() => {}), wait(5000)]);
  app.kill();
  await sweepOrphanElectron();
  const cleaned =
    (await deleteOrGone(`/rest/v1/staff?id=eq.${staffId}`, 'employé temporaire supprimé')) &&
    (await deleteOrGone(`/auth/v1/admin/users/${uid}`, 'compte éphémère supprimé'));
  rmSync(DL_DIR, { recursive: true, force: true });
  wipeUserData();
  if (ok && cleaned) {
    // La preuve vient d'ici, pas d'une phrase du workflow : ce que cette preuve a
    // RÉELLEMENT mesuré, c'est le PDF téléchargé par l'application EMPAQUETÉE (sa
    // taille et sa signature), et le fait que les deux lignes de démo ont bien
    // quitté la base. Le mandat est posé par l'étape qui l'exécute
    // (`AUTOMATION_EVIDENCE: '1'`) ; hors mandat, il se tait.
    publishEvidence({
      acted: true,
      count: 2,
      reason: `preuve bureau : PDF reçu de l'app empaquetée (${pdfPath}, ${statSync(full).size} octets, signature ${head}) et les 2 lignes de démo (employé + compte) supprimées`,
    });
  }
  console.log(ok ? '\nPROOF_OK' : '\nPROOF_FAIL');
  process.exit(ok && cleaned ? 0 : 1);
} catch (e) {
  console.error('❌', e.message);
  // Same hygiene as the success path: close the CDP browser and kill our app
  // by PID, then the age-windowed sweep clears any orphan (the missing sweep
  // here left 8 orphans on a CDP attach failure), then clean the DB rows.
  try { browser && await Promise.race([browser.close().catch(() => {}), wait(5000)]); } catch { /* ignore */ }
  try { app && app.kill(); } catch { /* ignore */ }
  await sweepOrphanElectron();
  try {
    if (staffId) await deleteOrGone(`/rest/v1/staff?id=eq.${staffId}`, 'employé temporaire supprimé (après échec)');
    if (uid) await deleteOrGone(`/auth/v1/admin/users/${uid}`, 'compte éphémère supprimé (après échec)');
  } catch (cleanupError) {
    // Le nettoyage ne doit pas masquer la panne d'origine : on la nomme, et le
    // run reste rouge de toute façon.
    console.error('⚠️ nettoyage partiel :', cleanupError.message);
  }
  rmSync(DL_DIR, { recursive: true, force: true });
  wipeUserData();
  process.exit(1);
}