#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// E2E business-flow test for the MAMA THERA Finance Suite.
//
// Drives the real deployed app through its full business cycles and verifies
// persistence + totals directly in the Supabase database:
//   A. Student cycle:  create a class → create a student → record a payment
//      → confirm amount_paid is updated in the DB.
//   B. Money cycle:   create a parent · create a staff member · record their
//      salary · record a vendor expense → confirm each row + its totals.
//
// SAFETY: every row uses unique, obviously-test identifiers that match a known
// prefix, so nothing real can ever be matched. A cleanup phase runs at the end
// and is also attempted at the start. Use against STAGING by default; pass
// `--prod` only to exercise the production URL/database.
//
// Usage:
//   node scripts/e2e-business.mjs [--prod]      (cleanup is always run)
//   node scripts/e2e-business.mjs --cleanup-only   (delete leftover test rows only)
//
// Secrets are NOT stored here; Supabase service-role keys are read from
// .env (prod) / .env.staging, and the account credentials are generated
// per-run and always deleted.
//
// Exit code 0 = every check passed on a virgin database afterwards.
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const FLAG_PROD = process.argv.includes('--prod');
const FLAG_CLEANUP_ONLY = process.argv.includes('--cleanup-only');

const parseEnv = (p) => {
  const o = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const envFile = join(root, FLAG_PROD ? '.env' : '.env.staging');
if (!existsSync(envFile)) {
  console.error(`Introuvable: ${envFile} (chiffres service-role requis).`);
  process.exit(1);
}
const env = parseEnv(envFile);
const URL = FLAG_PROD
  ? 'https://mama-thera-finance.vercel.app/'
  : 'https://mama-thera-staging.vercel.app/';
const base = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const sr = env.SUPABASE_SERVICE_ROLE_KEY;
const HDR = { apikey: sr, Authorization: 'Bearer ' + sr, 'Content-Type': 'application/json' };

const api = async (path, opts = {}) => {
  const r = await fetch(`${base}/rest/v1${path}`, { headers: HDR, ...opts });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── Test-data markers (safe, unique, cleanable by prefix) ───────────────────
const TS = Date.now().toString().slice(-6);
const EMAIL = `e2e-${TS}@mamathera.org`;
const PASS = 'E2e-2026!Xy';
const STUDENT_ID = `MT-TEST-${TS}`;
const STUDENT_NAME = `BizTest ${TS}`;
const CLASS_NAME = `E2E-CLASS-${TS}`;
const PARENT_NAME = `Parent E2E ${TS}`;
const STAFF_NAME = `Staff E2E ${TS}`;
const VENDOR_NAME = `Vendor E2E ${TS}`;
const TOTAL_DUE = '150000';
const PAYMENT = '50000';
const STAFF_SALARY = '120000';
const VENDOR_AMOUNT = '45000';
const PROFILE = join(
  'C:/Users/user/AppData/Local/Temp',
  `e2e-${FLAG_PROD ? 'prod' : 'stag'}-${TS}-profile`
);

// Cleanup by test prefix (idempotent; safe because prefixes are synthetic)
const cleanup = async (uidToDelete) => {
  try {
    const tasks = [
      api(`/students?select=id&student_id=like.${STUDENT_ID}`).then((r) => r.body || []),
      api(`/parents?select=id&full_name=like.${encodeURIComponent('Parent E2E %')}`).then((r) => r.body || []),
      api(`/staff?select=id&name=like.${encodeURIComponent('Staff E2E %')}`).then((r) => r.body || []),
      api(`/vendor_expenses?select=id&vendor_name=like.${encodeURIComponent('Vendor E2E %')}`).then((r) => r.body || []),
    ];
    const [studs, par, staffRows, vendors] = await Promise.all(tasks);
    for (const s of studs) {
      await api(`/payments?student_id=eq.${s.id}`, { method: 'DELETE' });
      await api(`/students?id=eq.${s.id}`, { method: 'DELETE' });
    }
    for (const s of staffRows) {
      await api(`/salary_payments?staff_id=eq.${s.id}`, { method: 'DELETE' });
      await api(`/staff?id=eq.${s.id}`, { method: 'DELETE' });
    }
    for (const x of par) await api(`/parents?id=eq.${x.id}`, { method: 'DELETE' });
    for (const v of vendors) await api(`/vendor_expenses?id=eq.${v.id}`, { method: 'DELETE' });
    await api(`/custom_classes?code=eq.${CLASS_NAME}`, { method: 'DELETE' });
    if (uidToDelete) {
      await fetch(`${base}/auth/v1/admin/users/${uidToDelete}`, { method: 'DELETE', headers: HDR });
    }
  } catch (e) {
    console.log('cleanup:', e.message);
  }
};

if (FLAG_CLEANUP_ONLY) {
  await cleanup();
  console.log('Cleanup-only terminé.');
  process.exit(0);
}

// Clear any leftover test rows from a previous interrupted run.
await cleanup();

// ── 1. Create jetable user; elevate to admin so vendor expense / isPromoter ─
let uid = null;
{
  const r = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST', headers: HDR, body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
  });
  const b = await r.json();
  if (r.ok) { uid = b.id; check('Compte jetable créé', true); }
  else if (b.code === 'user_already_exists') {
    const list = await (await fetch(`${base}/auth/v1/admin/users?email=${EMAIL}`, { headers: HDR })).json();
    uid = list.users?.[0]?.id;
    check('Compte jetable déjà existant (réutilisé)', true);
  } else check('Compte jetable créé', false, b.msg || r.status);
  await new Promise((res) => setTimeout(res, 2000)); // wait for profile trigger
  const up = await api(`/user_profiles?id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
  check('Profil promu admin (isPromoter / dépense fournisseur)', up.status === 204 || up.status === 200, `status ${up.status}`);
}

// ── 2. Launch browser & login ──
rmSync(PROFILE, { recursive: true, force: true });
if (!existsSync(CHROME)) { console.error('Chrome introuvable:', CHROME); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: PROFILE, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const reqs = [];
const logs = [];
page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('supabase.co')) reqs.push(`${r.method()} ${r.url().replace(base, '').split('?')[0]}`); });
page.on('console', (m) => { const t = m.text(); if (/error/i.test(t)) logs.push(`CONSOLE: ${t.slice(0, 200)}`); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e).slice(0, 200)));

const clickNav = async (text) => {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, a, .nav-item')].find((e) => {
      const s = (e.textContent || '').trim().toLowerCase();
      return s.indexOf(t.toLowerCase()) === 0;
    });
    if (el) el.click();
  }, text);
  await new Promise((r) => setTimeout(r, 1500));
};
const clickBtn = async (text) => {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().toLowerCase() === t.toLowerCase());
    if (b) { b.click(); return true; }
    return false;
  }, text);
  await new Promise((r) => setTimeout(r, 1200));
  return ok;
};
const setInput = async (placeholder, value) => {
  await page.waitForSelector(`input[placeholder="${placeholder}"]`, { timeout: 8000 });
  await page.click(`input[placeholder="${placeholder}"]`, { clickCount: 3 });
  await page.type(`input[placeholder="${placeholder}"]`, value);
};
const setValue = async (placeholder, value) => {
  await page.waitForSelector(`input[placeholder="${placeholder}"]`, { timeout: 8000 });
  await page.evaluate(([ph, v]) => {
    const i = [...document.querySelectorAll('input')].find((x) => x.placeholder === ph);
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, v);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, [placeholder, value]);
};
const submitForm = async (anchorPlaceholder) => {
  await page.evaluate((ph) => {
    const anchor = [...document.querySelectorAll('input')].find((i) => i.placeholder === ph);
    const form = anchor.closest('form');
    const btn = [...form.querySelectorAll('button')].find((b) => b.type === 'submit');
    btn.click();
  }, anchorPlaceholder);
  await new Promise((r) => setTimeout(r, 3000));
};

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
try {
  await page.waitForSelector('input[placeholder="name@mamathera.org"]', { timeout: 15000 });
  await page.type('input[placeholder="name@mamathera.org"]', EMAIL);
  await page.type('input[type="password"]', PASS);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').toLowerCase().includes('se connecter')); b && b.click(); });
  await page.waitForFunction(() => document.body.innerText.includes('Gestion des Élèves') || document.body.innerText.includes('Tableau de bord') || document.body.innerText.includes('Résumé Exécutif'), { timeout: 30000 });
  check('Login OK (shell app affiché)', true);
} catch (e) {
  check('Login OK', false, String(e).slice(0, 120));
}

// ══ CYCLE A — STUDENT: class → student → payment → balance ══════════════════
{
  console.log('\n── Cycle A · Élève ──');
  try {
    // open student modal → add a custom class (cycle 'other', unique name)
    await clickBtn('Ajouter un Élève');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Nouvelle Classe')), { timeout: 10000 });
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Nouvelle Classe')); b && b.click(); });
    await page.waitForFunction(() => [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.value === 'other')), { timeout: 10000 });
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'other'));
      sel.value = 'other';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await setValue('ex. 1ère D ou Garderie', CLASS_NAME);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Créer la classe')); b && b.click(); });
    await new Promise((r) => setTimeout(r, 2500));
    const cls = await api(`/custom_classes?select=code,name_fr&code=eq.${CLASS_NAME}`);
    check('Classe persistée en base', (cls.body || []).some((c) => c.code === CLASS_NAME), JSON.stringify(cls.body).slice(0, 80));

    await setInput('Ibrahim', STUDENT_NAME);
    await setInput('MT-2026-001 (Optional)', STUDENT_ID);
    await setInput('Djeneba', PARENT_NAME);
    await setInput('+223 70 00 00 00', '+223 70 00 01 01');
    await setValue('120000', TOTAL_DUE);
    const selOk = await page.evaluate((n) => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text === n));
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.text === n);
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, CLASS_NAME);
    check('Classe sélectionnée dans le formulaire élève', selOk);

    reqs.length = 0;
    await submitForm('Ibrahim');
    check('Requête POST /students émise', reqs.some((r) => r.includes('POST /rest/v1/students')), reqs.join(', ').slice(0, 100) || 'aucune');
    const st = await api(`/students?select=id,name,student_id,total_due,amount_paid&student_id=eq.${STUDENT_ID}`);
    const srow = (st.body || [])[0];
    check('Élève persisté en base', !!srow, srow ? `total_due=${srow.total_due} | amount_paid=${srow.amount_paid}` : 'absent');

    // record payment
    if (srow) {
      await clickBtn('Enregistrer le Paiement');
      await new Promise((r) => setTimeout(r, 800));
      const pSel = await page.evaluate((n) => {
        const sel = [...document.querySelectorAll('select')].find((s) => s.closest('form') && [...s.options].some((o) => o.text.includes(n)));
        if (!sel) return false;
        const opt = [...sel.options].find((o) => o.text.includes(n));
        sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, STUDENT_NAME);
      check('Élève sélectionné dans le formulaire de paiement', pSel);
      await setValue('10 000', PAYMENT);
      reqs.length = 0;
      await submitForm('10 000');
      check('Requête paiement émise (payments / students)', reqs.some((r) => /POST \/rest\/v1\/payments|PATCH \/rest\/v1\/students/.test(r)), reqs.join(', ').slice(0, 100) || 'aucune');
      const upd = await api(`/students?select=amount_paid,total_due&id=eq.${srow.id}`);
      const u = (upd.body || [])[0];
      check('Solde mis à jour : amount_paid = 50000', u?.amount_paid === 50000, u ? `amount_paid=${u.amount_paid} / total_due=${u.total_due}` : 'élève introuvable');
    }
  } catch (e) {
    check('Cycle A (élève → paiement)', false, String(e).slice(0, 150));
  }
}

// ══ CYCLE B — parent · staff · salary · vendor expense ══════════════════════
{
  console.log('\n── Cycle B · Parent / Salaire / Dépense ──');
  try {
    // PARENT
    await clickNav('Parents');
    await page.waitForFunction(() => document.body.innerText.includes('Annuaire des Parents'), { timeout: 10000 });
    await clickBtn('Ajouter Parent/Tuteur');
    await setInput('e.g. Mamadou Traoré', PARENT_NAME);
    await setInput('+223 70 00 00 00', '+223 70 00 01 02');
    await setInput('e.g. Civil Engineer, Banker, Merchant...', 'Commerçant');
    await setInput('e.g. Quartier Hippodrome, Bamako', 'Bamako');
    await submitForm('e.g. Mamadou Traoré');
    const par = await api(`/parents?select=full_name,phones,relationship&full_name=eq.${encodeURIComponent(PARENT_NAME)}`);
    const p = (par.body || [])[0];
    check('Parent persisté en base', !!p, p ? `${p.full_name} | ${p.phones[0]} | ${p.relationship}` : 'absent');

    // STAFF
    await clickNav('Paie/Salaires');
    await page.waitForFunction(() => document.body.innerText.includes('Paie/Salaires'), { timeout: 10000 });
    await clickBtn('Ajouter un Employé');
    await setInput('Jane Doe', STAFF_NAME);
    await setInput('Teacher', 'Enseignant');
    await setInput('+223 70 00 00 00', '+223 70 00 01 03');
    await setInput('jane.doe@school.com', `staff${TS}@e2e.org`);
    await setValue('150 000', STAFF_SALARY);
    await submitForm('Jane Doe');
    const stf = await api(`/staff?select=id,name,position,salary&name=eq.${encodeURIComponent(STAFF_NAME)}`);
    const srow = (stf.body || [])[0];
    check('Employé persisté en base', !!srow, srow ? `${srow.name} | ${srow.position} | salary=${srow.salary}` : 'absent');

    // SALARY — staff pre-fills the balance; submit directly
    if (srow) {
      await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, STAFF_NAME);
      const opened = await clickBtn('Enregistrer Salaire');
      check('Modal salaire ouvert', opened);
      reqs.length = 0;
      await page.evaluate(() => {
        const sel = [...document.querySelectorAll('select')].find((s) => s.closest('form') && s.value !== '');
        const form = sel ? sel.closest('form') : null;
        const btn = form ? [...form.querySelectorAll('button')].find((b) => b.type === 'submit') : null;
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 3000));
      const sal = await api(`/salary_payments?select=staff_id,amount,date&staff_id=eq.${srow.id}`);
      const salRow = (sal.body || [])[0];
      check('Salaire persisté en base (salary_payments)', !!salRow, salRow ? `amount=${salRow.amount} | date=${salRow.date}` : 'absent');
      if (salRow) check('Montant salaire = 120000', salRow.amount === 120000, String(salRow.amount));
    }

    // VENDOR EXPENSE (dépense fournisseur — promotrice uniquement)
    await clickNav('Dépenses');
    await page.waitForFunction(() => document.body.innerText.includes('Dépenses'), { timeout: 10000 });
    const vOpen = await clickBtn('Ajouter une Dépense');
    check('Modal dépense fournisseur ouvert', vOpen);
    await setInput('ex. SENELEC', VENDOR_NAME);
    await setValue('50000', VENDOR_AMOUNT);
    await submitForm('ex. SENELEC');
    const ve = await api(`/vendor_expenses?select=vendor_name,amount,payment_status&vendor_name=eq.${encodeURIComponent(VENDOR_NAME)}`);
    const vrow = (ve.body || [])[0];
    check('Dépense fournisseur persistée en base', !!vrow, vrow ? `amount=${vrow.amount} | ${vrow.payment_status}` : 'absent');
    if (vrow) check('Montant dépense = 45000', vrow.amount === 45000, String(vrow.amount));
  } catch (e) {
    check('Cycle B (parent / salaire / dépense)', false, String(e).slice(0, 150));
  }
}

// ── Cleanup (mandatory) ─────────────────────────────────────────────────────
console.log('\n── Nettoyage ──');
await cleanup(uid);
// verify the base is back to virgin
const t = ['students', 'payments', 'parents', 'staff', 'salary_payments', 'vendor_expenses', 'custom_classes'];
const counts = {};
for (const table of t) {
  const r = await api(`/${table}?select=id&limit=1000`);
  counts[table] = Array.isArray(r.body) ? r.body.length : -1;
}
const virgin = Object.values(counts).every((n) => n === 0);
check('Base revenue à l\'état vierge après cleanup', virgin, JSON.stringify(counts));

console.log('\n=== ERREURS CONSOLE / PAGE ===');
console.log(logs.length ? logs.join('\n') : 'aucune');
await browser.close();
rmSync(PROFILE, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n=== RÉSULTAT : ${results.length - failed.length}/${results.length} OK ===`);
process.exit(failed.length ? 1 : 0);