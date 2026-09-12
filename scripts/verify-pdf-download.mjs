#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-pdf-download.mjs — one-command production E2E for the payroll PDFs.
//
// Drives the REAL deployed app (default: production Vercel) through the exact
// download the users use and pixel-checks the produced file against the
// school's paper template:
//   • employee  ("Ajouter un Employé"   → fiche   fiche-paiement-salaire.pdf)
//   • admin     ("Ajouter un Membre de l'administration" → bulletin
//                bulletin-paie-mensuelle.pdf)
//   • technique ("Ajouter un Membre du Centre Technique" → fiche technique
//                fiche-technique.pdf — the member is CREATED through the real
//                UI button when none exists, so the whole flow is exercised)
//   • recu-parent (Élèves → fiche d'un élève → bouton « Reçu » d'un paiement
//                → reçu-parent recu-parent.pdf — the parent payment receipt,
//                filled with the payer name, the phone on the « Tél. : »
//                dotted line, the amount in words, the amount in figures in
//                the BPF pill, the N° box, month/class/motif and the date; a
//                demo student+payment is created via the API when the base
//                holds no payment)
//
// Steps, in one run:
//   1. Create an ephemeral auth account via the service role (always deleted
//      at the end, even on failure) and promote it to admin.
//   2. Headless Chrome → log in through the app → open Paie/Salaires.
//   3. Target the requested staff card (or the first member of the requested
//      mode) and click its « Télécharger Reçu PDF » button — a REAL click on
//      the button the users click. In technique mode with no existing member,
//      the member is first created through the REAL « Ajouter un Membre du
//      Centre Technique » button + form (name, salary, allowances) + submit.
//   4. Capture the produced PDF (CDP download). Template fetches are fulfilled
//      with the exact committed template bytes via CDP Fetch (this machine's
//      AV filter intercepts /templates/*.pdf in Chrome; the app's code path
//      fetch → overlay → download is untouched).
//   5. Pixel-check the captured file against the template at 34 px/mm:
//      page size identical, row-1 amounts on the printed lower line
//      (fiche 98.0 / technique 97.65), date centered (fiche/technique), seal
//      centered on the printed L'EMPLOYEUR line (bulletin), data overlay
//      present.
//   6. Cleanup: delete the ephemeral account (+ any auto-created demo admin or
//      technique member), remove temp files. Exit 0 = all checks passed.
//
// Usage:
//   node scripts/verify-pdf-download.mjs
//   node scripts/verify-pdf-download.mjs --mode bulletin
//   node scripts/verify-pdf-download.mjs --mode technique
//   node scripts/verify-pdf-download.mjs --mode recu-parent
//   node scripts/verify-pdf-download.mjs --target "Madi"
//   node scripts/verify-pdf-download.mjs --url http://127.0.0.1:4000/ --keep
//
// Flags:
//   --target <name>  staff member to download (default: first of the mode)
//   --mode <auto|fiche|bulletin|technique|recu-parent>  which PDF to expect
//                    (default auto, decided from the member's position — admin
//                    positions → bulletin, TECH_POSITIONS → technique, else
//                    fiche; recu-parent is explicit: the parent payment
//                    receipt is a different flow, the Élèves page)
//   --url <url>      app URL (default https://mama-thera-finance.vercel.app/)
//   --keep           keep the downloaded PDF + pixel report in ./.verify-pdf/
//   --cleanup-only   only delete any leftovers (ephemeral account, demo admin,
//                    technique member, temp files) and exit
//
// Requires (devDependencies): puppeteer-core, pdfjs-dist, @napi-rs/canvas.
// Service-role credentials are read from .env (never stored here).
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import {
  readFileSync, rmSync, mkdirSync, existsSync,
  readdirSync, statSync, copyFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { ephemeralEmail } from './lib/ephemeral-accounts.mjs';
import { replayableWrite, withTransientRetry } from './lib/transient-http.mjs';
import { sweepOrphanPuppeteer } from './lib/orphan-chrome.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(name);
const TARGET = flag('--target');
const MODE = (flag('--mode', 'auto') || 'auto').toLowerCase();
const URL = (flag('--url') || 'https://mama-thera-finance.vercel.app/').replace(/\/$/, '') + '/';
const KEEP = has('--keep');
const CLEANUP_ONLY = has('--cleanup-only');

// ── Config ───────────────────────────────────────────────────────────────────
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
  console.error('Introuvable: .env (chiffres service-role requis).');
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

const TPL_FICHE = 'public/templates/fiche-paiement-salaire.pdf';
const TPL_BULLETIN = 'public/templates/bulletin-paie-mensuelle.pdf';
const TPL_TECHNIQUE = 'public/templates/fiche-technique.pdf';
const TPL_RECU = 'public/templates/recu-parent.pdf';
const TPL_FICHE_BYTES = readFileSync(join(root, TPL_FICHE));
const TPL_BULLETIN_BYTES = readFileSync(join(root, TPL_BULLETIN));
const TPL_TECHNIQUE_BYTES = readFileSync(join(root, TPL_TECHNIQUE));
const TPL_RECU_BYTES = readFileSync(join(root, TPL_RECU));

// Admin positions — keep in sync with src/lib/adminPositions.ts (both langs).
const ADMIN_POSITIONS = [
  'proviseur', 'censeur', 'surveillant général', 'secrétaire', 'économe',
  'directeur général', 'directeur des études', 'chef des travaux',
  'principal', 'discipline master', 'head supervisor', 'secretary',
  'bursar', 'general director', 'director of studies', 'head of works',
];
const isAdminPosition = (position) =>
  ADMIN_POSITIONS.includes(String(position || '').trim().toLowerCase());

// Technical-center positions — keep in sync with src/lib/adminPositions.ts
// TECH_POSITIONS (both langs).
const TECH_POSITIONS = [
  'membre du centre technique', 'technicien', 'technicienne',
  'agent technique', 'formateur technique', 'instructeur technique',
  'technical center member', 'technician', 'technical agent',
  'technical trainer', 'technical instructor',
];
const isTechniquePosition = (position) =>
  TECH_POSITIONS.includes(String(position || '').trim().toLowerCase());

// ── Bookkeeping ──────────────────────────────────────────────────────────────
const TS = Date.now().toString().slice(-6);
const EMAIL = ephemeralEmail('verify-pdf');
const PASS = 'Audit-Pass-2026!';
const WORK = join(tmpdir(), `verify-pdf-${TS}`);
const DL_DIR = join(WORK, 'dl');
let ephemeralUid = null;
let demoMemberId = null; // auto-created admin member (bulletin mode, none present)
let techniqueMemberId = null; // member created via the real UI button (technique mode)
let demoStudentId = null; // auto-created student (recu-parent mode, no payment in base)
let demoPaymentId = null; // its payment
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

/**
 * Le corps d'une réponse non-JSON (page HTML d'une passerelle, 504 en texte)
 * ne doit pas devenir une erreur de SYNTAXE : c'est le statut qui compte, et un
 * `JSON.parse` qui jette masquerait le 504 derrière un « Unexpected token ».
 */
const parseBody = (text) => {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { _nonJson: text.slice(0, 200) }; }
};

// Un 504 du gateway n'est PAS un verdict sur l'application (mesuré le
// 2026-09-12 : deux runs rouges pour un gateway lent, application intacte, et un
// compte éphémère resté en base parce que sa suppression avait pris le même
// 504). Les coupures passagères sont donc retentées — borné, journalisé — et un
// 4xx (refus, conflit) n'est jamais retenté : c'est une réponse, pas un hoquet.
//
// Sur une ÉCRITURE, une reprise n'est pas sûre par nature : un 504 tombe souvent
// APRÈS que la requête a été appliquée. Les deux écritures non idempotentes de ce
// script sondent donc avant de rejouer — `rawApi` est la brique sans reprise, et
// `insertOnce` la version qui ne double pas. Un aller-retour de sonde à chaque
// essai serait du gaspillage, donc le PREMIER essai ne sonde jamais.
const rawApi = async (path, opts = {}) => {
  const r = await fetch(`${supabaseBase}${path}`, { headers: HDR, ...opts });
  const t = await r.text();
  return { status: r.status, body: parseBody(t) };
};

const api = (path, opts = {}) => withTransientRetry(() => rawApi(path, opts), {
  label: `${opts.method || 'GET'} ${path} — `, log: (m) => console.log(`  ↻ ${m}`),
});

/**
 * Insertion de démo qui peut être REJOUÉE sans doubler la ligne.
 *
 * `public.staff` n'a AUCUNE contrainte sur `email`, et `public.students` n'a
 * d'unique que `student_id` (NULL sur ces lignes de démo) : un POST rejoué après
 * un 504 déjà appliqué créerait une deuxième ligne. Le nettoyage supprime par
 * l'id rendu par la tentative gagnante, donc la première resterait en base pour
 * toujours — un résidu de démo que la garde anti-résidus ne surveille pas, elle
 * qui ne connaît que les comptes éphémères.
 */
const insertOnce = (table, row, find) => replayableWrite(
  () => rawApi(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HDR, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  }),
  async () => {
    const probe = await rawApi(`/rest/v1/${table}?select=*&${find}&limit=1`);
    if (probe.status === 200 && Array.isArray(probe.body) && probe.body[0]) {
      console.log(`  ↻ ${table} : la ligne était déjà là — réutilisée, pas de doublon`);
      return { status: 201, body: probe.body };
    }
    return null;
  },
  { label: `POST /rest/v1/${table} — `, log: (m) => console.log(`  ↻ ${m}`) },
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  try {
    if (ephemeralUid) {
      const del = await api(`/auth/v1/admin/users/${ephemeralUid}`, { method: 'DELETE' });
      console.log(`  🧹 compte éphémère supprimé (${del.status})`);
    }
    if (demoMemberId) {
      const del = await api(`/rest/v1/staff?id=eq.${demoMemberId}`, { method: 'DELETE' });
      console.log(`  🧹 membre de démo supprimé (${del.status})`);
    }
    if (techniqueMemberId) {
      const del = await api(`/rest/v1/staff?id=eq.${techniqueMemberId}`, { method: 'DELETE' });
      console.log(`  🧹 membre du centre technique supprimé (${del.status})`);
    }
    if (demoStudentId) {
      // payments cascade on delete
      const del = await api(`/rest/v1/students?id=eq.${demoStudentId}`, { method: 'DELETE' });
      console.log(`  🧹 élève de démo + paiement supprimés (${del.status})`);
    }
    void demoPaymentId;
  } catch (e) {
    console.error('  ⚠️ cleanup partiel:', e.message);
  }
  if (!KEEP && existsSync(WORK)) {
    rmSync(WORK, { recursive: true, force: true });
    console.log('  🧹 fichiers temporaires supprimés');
  } else if (KEEP) {
    const out = join(root, '.verify-pdf');
    mkdirSync(out, { recursive: true });
    const files = existsSync(DL_DIR) ? readdirSync(DL_DIR) : [];
    for (const f of files) copyFileSync(join(DL_DIR, f), join(out, f));
    console.log(`  📂 captures conservées dans .verify-pdf/ (--keep)`);
  }
}

// ── 1. Account + data ────────────────────────────────────────────────────────
async function createAccount() {
  const r = await replayableWrite(
    () => rawApi('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }),
    }),
    async () => {
      // L'email du compte est UNIQUE : rejouer à l'aveugle rendrait un 422, le
      // run mourrait AVANT d'avoir l'uid — donc le nettoyage n'aurait aucun id à
      // supprimer, et le compte resterait en base. On réutilise celui qui est là.
      // (Même parade que scripts/e2e-business.mjs, qui gère déjà
      // `user_already_exists` en relisant le compte par son email.)
      const probe = await rawApi(`/auth/v1/admin/users?email=${encodeURIComponent(EMAIL)}`);
      const found = Array.isArray(probe.body?.users) ? probe.body.users[0] : null;
      if (found?.id) {
        console.log('  ↻ compte éphémère : déjà créé — réutilisé');
        return { status: 200, body: { id: found.id } };
      }
      return null;
    },
    { label: 'POST /auth/v1/admin/users — ', log: (m) => console.log(`  ↻ ${m}`) },
  );
  if (!r.body?.id) throw new Error(`création du compte échouée (${r.status})`);
  ephemeralUid = r.body.id;
  // promote to admin so Settings/nav are fully available (reliable navigation)
  await api(`/rest/v1/user_profiles?id=eq.${ephemeralUid}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'admin' }),
  });
  console.log(`✅ compte éphémère créé (${EMAIL})`);
}

async function resolveTarget() {
  const { status, body } = await api('/rest/v1/staff?select=id,name,position,email,salary,travel_allowance,communication_allowance,housing_allowance');
  if (status !== 200) throw new Error(`lecture staff échouée (${status})`);
  const staff = Array.isArray(body) ? body : [];
  if (TARGET) {
    const m = staff.find((s) => s.name === TARGET);
    if (!m) throw new Error(`membre « ${TARGET} » introuvable (présents: ${staff.map((s) => s.name).join(', ') || 'aucun'})`);
    return { member: m, mode: isAdminPosition(m.position) ? 'bulletin' : 'fiche' };
  }
  // A fiche employee must carry allowances: the row-1 amounts (salaire,
  // total indemnités, net) all sit on the printed 98.0 mm line — with zero
  // allowances the form prints « — » on the upper line instead, which the
  // pixel check (correctly) never mistakes for an amount. Prefer a real
  // member with allowances; if none exists (fresh DB, or leftover rows from
  // crashed proof runs), auto-create a demo employee with known allowances
  // so the check stays deterministic — deleted in cleanup.
  const pickFicheMember = async () => {
    const withAlloc = (s) =>
      !isAdminPosition(s.position) &&
      ((s.travel_allowance ?? 0) + (s.communication_allowance ?? 0) + (s.housing_allowance ?? 0)) > 0;
    const m = staff.find(withAlloc);
    if (m) return { member: m, mode: 'fiche' };
    console.log('  ℹ️ aucun employé non-admin avec indemnités — création d’un employé de démo');
    const demo = {
      name: `E2E Employé ${TS}`,
      position: 'Enseignant',
      salary: 150000,
      email: `e2e-employe-${TS}@audit.local`,
      phone: '90000000',
      bank_details: 'BOA 0000 1111 2222',
      emergency_contact: 'Awa Demo',
      academic_year: '2026-2027',
      inps_number: `INPS-E2E-${TS}`,
      hire_date: '2021-10-01',
      family_status: 'married',
      children_count: 2,
      travel_allowance: 25000,
      communication_allowance: 10000,
      housing_allowance: 0,
    };
    const ins = await insertOnce('staff', demo, `email=eq.${encodeURIComponent(demo.email)}`);
    if (!ins.body?.[0]?.id) throw new Error(`insertion employé de démo échouée (${ins.status})`);
    demoMemberId = ins.body[0].id;
    return { member: ins.body[0], mode: 'fiche' };
  };
  // auto: first member of the requested mode (or first overall in auto mode)
  if (MODE === 'fiche') {
    return pickFicheMember();
  }
  if (MODE === 'bulletin') {
    const m = staff.find((s) => isAdminPosition(s.position));
    if (m) return { member: m, mode: 'bulletin' };
    // none exists — auto-create a demo admin member so the flow is fully
    // exercisable; deleted in cleanup.
    console.log('  ℹ️ aucun membre admin en base — création d’un membre de démo');
    const demo = {
      name: `E2E Proviseur ${TS}`,
      position: 'Proviseur',
      salary: 200000,
      email: `e2e-proviseur-${TS}@audit.local`,
      phone: '90000000',
      bank_details: 'BOA 0000 1111 2222',
      emergency_contact: 'Awa Demo',
      academic_year: '2026-2027',
      inps_number: `INPS-E2E-${TS}`,
      hire_date: '2021-10-01',
      family_status: 'married',
      children_count: 3,
      travel_allowance: 25000,
      communication_allowance: 10000,
      housing_allowance: 0,
    };
    const ins = await insertOnce('staff', demo, `email=eq.${encodeURIComponent(demo.email)}`);
    if (!ins.body?.[0]?.id) throw new Error(`insertion membre de démo échouée (${ins.status})`);
    demoMemberId = ins.body[0].id;
    return { member: ins.body[0], mode: 'bulletin' };
  }
  if (MODE === 'recu-parent') {
    // Find a student that already has ≥1 payment; else create a demo pair via
    // the API (payments cascade on student delete — cleanup deletes the student).
    const { status, body } = await api('/rest/v1/payments?select=id,student_id,date,amount,receipt_number&limit=1000');
    if (status !== 200) throw new Error(`lecture payments échouée (${status})`);
    const pay = Array.isArray(body) ? body : [];
    const studentId = pay[0]?.student_id;
    if (studentId) {
      const stu = await api(`/rest/v1/students?select=id,name,parent_name,grade,parent_phone&id=eq.${studentId}`);
      // The Tél. line check needs the student to have a phone: prefer a real
      // payment only when its student carries one, else fall through to the
      // demo student (which is guaranteed to).
      if (Array.isArray(stu.body) && stu.body[0] && (stu.body[0].parent_phone || '').trim()) {
        console.log('  ℹ️ reçu vérifié sur un paiement réel en base');
        return {
          member: null,
          student: stu.body[0],
          payment: { date: pay[0].date, amount: Number(pay[0].amount), receiptNumber: pay[0].receipt_number || undefined },
          mode: 'recu-parent',
        };
      }
    }
    console.log('  ℹ️ aucun paiement en base — création d’un élève + paiement de démo');
    // academic_year is deliberately NULL so the app's year filter (which
    // keeps students without a year in EVERY year) always shows the row.
    const demo = {
      name: `E2E Élève ${TS}`,
      parent_name: 'Parent E2E',
      parent_phone: '+223 70 00 00 00',
      grade: '9eme A',
      total_due: 150000,
      amount_paid: 25000,
      status: 'Active',
    };
    const ins = await insertOnce('students', demo, `name=eq.${encodeURIComponent(demo.name)}`);
    if (!ins.body?.[0]?.id) throw new Error(`insertion élève de démo échouée (${ins.status})`);
    demoStudentId = ins.body[0].id;
    const p = {
      student_id: demoStudentId,
      date: '2026-09-02',
      amount: 25000,
      academic_year: '2026-2027',
      receipt_number: `REC-E2E-${TS}`,
    };
    const pin = await insertOnce('payments', p, `receipt_number=eq.${encodeURIComponent(p.receipt_number)}`);
    if (!pin.body?.[0]?.id) throw new Error(`insertion paiement de démo échouée (${pin.status})`);
    demoPaymentId = pin.body[0].id;
    return {
      member: null,
      student: ins.body[0],
      payment: { date: p.date, amount: p.amount, receiptNumber: p.receipt_number },
      mode: 'recu-parent',
    };
  }
  if (MODE === 'technique') {
    const m = staff.find((s) => isTechniquePosition(s.position));
    if (m) return { member: m, mode: 'technique' };
    // none exists — create one through the REAL UI button (the requested
    // end-to-end flow); the member is inserted by the app itself and deleted
    // in cleanup.
    console.log('  ℹ️ aucun membre du centre technique en base — création via le bouton réel');
    return {
      member: null,
      mode: 'technique',
      createViaUI: true,
      techniqueName: `E2E Technique ${TS}`,
      techniqueEmail: `e2e-technique-${TS}@audit.local`,
    };
  }
  // auto: default to the first member, route by position
  const m = staff[0];
  if (!m) {
    // Empty staff table (fresh DB, or wiped by the leftover purge) — auto-create
    // the demo employee (fiche) so the check stays deterministic.
    console.log('  ℹ️ aucun membre dans la base — création d’un employé de démo');
    return pickFicheMember();
  }
  const mode = isAdminPosition(m.position) ? 'bulletin' : isTechniquePosition(m.position) ? 'technique' : 'fiche';
  // A fiche-routed member must carry allowances — reuse the deterministic pick.
  if (mode === 'fiche') return pickFicheMember();
  return { member: m, mode };
}

// ── 2–4. Browser E2E ─────────────────────────────────────────────────────────
// Creates a technical-center member through the REAL app UI: clicks
// « Ajouter un Membre du Centre Technique », fills the employee form
// (name, phone, email, salary, allowances), submits, and returns the
// created member row (id resolved via the API for cleanup).
async function createTechniqueMember(page, name, email) {
  const btnClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /Centre T et P/i.test(b.textContent || '') && /Ajouter/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  });
  if (!btnClicked) throw new Error('bouton « Ajouter un Membre du Centre T et P » introuvable');
  console.log('✅ clic sur « Ajouter un Membre du Centre T et P »');

  await page.waitForFunction(() =>
    [...document.querySelectorAll('form')].some((f) => f.querySelector('input[placeholder="Jane Doe"]')),
    { timeout: 20000 });
  await wait(600);

  const salary = 120000, travel = 25000, comm = 10000;
  const filled = await page.evaluate(({ name, email, salary, travel, comm }) => {
    const setVal = (el, v) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    const q = (sel) => document.querySelector(sel);
    const nameEl = q('input[placeholder="Jane Doe"]');
    const phoneEl = q('input[placeholder="+223 70 00 00 00"]');
    const emailEl = q('input[type="email"]');
    const salaryEl = q('input[placeholder="150 000"]');
    if (!nameEl || !phoneEl || !emailEl || !salaryEl) return 'champs requis introuvables';
    setVal(nameEl, name);
    setVal(phoneEl, '+223 70 00 00 00');
    setVal(emailEl, email);
    setVal(salaryEl, String(salary));
    const zeros = [...document.querySelectorAll('form input[type="number"][placeholder="0"]')];
    if (zeros.length >= 4) {
      setVal(zeros[1], String(travel)); // travel allowance
      setVal(zeros[2], String(comm));   // communication allowance
    }
    const submit = [...document.querySelectorAll('form button[type="submit"]')].find((b) =>
      /Ajouter|Créer|Enregistrer|Soumettre|Submit|Save/i.test(b.textContent || ''));
    if (!submit) return 'bouton de soumission introuvable';
    submit.click();
    return 'ok';
  }, { name, email, salary, travel, comm });
  if (filled !== 'ok') throw new Error(`remplissage du formulaire: ${filled}`);
  console.log(`✅ formulaire technique rempli et soumis (${name}, ${salary} + ${travel + comm} indemnités)`);

  // Resolve the created member id via the API (for cleanup) — wait for the
  // app's insert to land.
  for (let i = 0; i < 20; i++) {
    await wait(500);
    const { body } = await api(`/rest/v1/staff?select=id&email=eq.${email}`);
    if (Array.isArray(body) && body[0]?.id) {
      techniqueMemberId = body[0].id;
      return { id: body[0].id, name, email, position: 'Membre du Centre Technique', salary };
    }
  }
  throw new Error('membre technique créé mais id introuvable via l\u2019API');
}

// target: { member (Staff row) | null, mode, createViaUI? }
async function runE2E(target) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    mkdirSync(DL_DIR, { recursive: true });
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });
    await cdp.send('Network.enable');
    // AV-filter workaround: fulfill template fetches with the committed bytes
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*templates/fiche-paiement-salaire.pdf*', requestStage: 'Request' },
        { urlPattern: '*templates/bulletin-paie-mensuelle.pdf*', requestStage: 'Request' },
        { urlPattern: '*templates/fiche-technique.pdf*', requestStage: 'Request' },
        { urlPattern: '*templates/recu-parent.pdf*', requestStage: 'Request' },
      ],
    });
    cdp.on('Fetch.requestPaused', async (e) => {
      const url = e.request.url;
      const body = url.includes('bulletin') ? TPL_BULLETIN_BYTES
        : url.includes('technique') ? TPL_TECHNIQUE_BYTES
        : url.includes('recu-parent') ? TPL_RECU_BYTES : TPL_FICHE_BYTES;
      try {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: e.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/pdf' }],
          body: body.toString('base64'),
        });
      } catch { /* request already handled */ }
    });
    cdp.on('Network.responseReceived', (e) => {
      if (e.response.url.includes('templates/')) console.log(`  [net] ${e.response.status} ${e.response.url.slice(-46)}`);
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 180)));

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await wait(2500);
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
      console.log('✅ connecté à', URL);
    }
    await wait(4000);

    // open Paie (retry on transient JWT clock skew)
    for (let attempt = 0; attempt < 4; attempt++) {
      const ok = await page.evaluate(() => {
        const items = [...document.querySelectorAll('a, button, [role="menuitem"]')];
        const target = items.find((el) => /paie|salaires|payroll/i.test(el.textContent || '') && (el.textContent || '').trim().length < 25);
        if (!target) return false;
        target.click();
        return true;
      });
      if (ok) break;
      await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
      await wait(5000);
    }
    await wait(3500);

    // ── recu-parent: Élèves → fiche de l'élève → bouton « Reçu » d'un paiement
    let clicked = false;
    if (target.mode === 'recu-parent') {
      for (let attempt = 0; attempt < 4; attempt++) {
        const ok = await page.evaluate(() => {
          const items = [...document.querySelectorAll('a, button, [role="menuitem"]')];
          const el = items.find((e) => /élèves|eleves|students/i.test(e.textContent || '') && (e.textContent || '').trim().length < 25);
          if (!el) return false;
          el.click();
          return true;
        });
        if (ok) break;
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        await wait(5000);
      }
      await wait(3500);
      const studentName = target.student.name;
      for (let attempt = 0; attempt < 3; attempt++) {
        const opened = await page.evaluate((name) => {
          const nameEls = [...document.querySelectorAll('*')].filter((el) =>
            el.children.length === 0 && (el.textContent || '').trim() === name);
          for (const n of nameEls) {
            let anc = n;
            for (let i = 0; i < 8 && anc; i++) {
              anc = anc.parentElement;
              if (!anc) continue;
              const cls = anc.getAttribute('class') || '';
              if (anc.onclick || anc.getAttribute('role') === 'button' || anc.tagName === 'TR' || /cursor/.test(cls)) {
                anc.click();
                return true;
              }
            }
          }
          return false;
        }, studentName);
        if (opened) break;
        console.log(`  ⚠️ ligne « ${studentName} » non ouverte (essai ${attempt + 1}) — rechargement`);
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        await wait(5000);
      }
      await wait(2500);
      for (let attempt = 0; attempt < 4; attempt++) {
        clicked = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button')].filter((b) =>
            /reçu|recu|receipt/i.test(b.title || '') || /reçu|recu/i.test(b.textContent || ''));
          if (!btns.length) return false;
          btns[0].click();
          return true;
        });
        if (clicked) break;
        await wait(2000);
      }
      if (!clicked) throw new Error(`bouton « Reçu » de « ${studentName} » introuvable dans la fiche`);
      console.log(`✅ clic sur « Télécharger Reçu PDF » (paiement) de ${studentName}`);
    } else {
      // technique mode with no existing member → create one through the REAL
      // « Ajouter un Membre du Centre Technique » button + form + submit.
      if (target.createViaUI) {
        const created = await createTechniqueMember(page, target.techniqueName, target.techniqueEmail);
        target.member = created;
      }
      const targetName = target.member.name;

      // wait for the target card to render
      for (let attempt = 0; attempt < 3; attempt++) {
        const ok = await page.waitForFunction((name) =>
          [...document.querySelectorAll('*')].some((el) => el.children.length === 0 && (el.textContent || '').trim() === name),
          { timeout: 20000 }, targetName).then(() => true).catch(() => false);
        if (ok) break;
        console.log(`  ⚠️ carte « ${targetName} » non rendue (essai ${attempt + 1}) — rechargement`);
        await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        await wait(5000);
      }

      // Click the member's Reçu PDF button. Walk up from the NAME leaf and stop
      // at the first ancestor that contains EXACTLY ONE Reçu button (the card);
      // walking from the button up is wrong with ≥2 cards (a shared container
      // holds every card's text, so the first button matches for every name).
      clicked = await page.evaluate((name) => {
        const isReçu = (b) => /reçu|recu|receipt/i.test(b.title || '') || /reçu|recu/i.test(b.textContent || '');
        const nameEls = [...document.querySelectorAll('*')].filter((el) =>
          el.children.length === 0 && el.textContent?.trim() === name);
        for (const nameEl of nameEls) {
          let anc = nameEl;
          for (let i = 0; i < 10 && anc; i++) {
            anc = anc.parentElement;
            if (!anc) break;
            const btns = [...anc.querySelectorAll('button')].filter(isReçu);
            if (btns.length === 1) { btns[0].click(); return true; }
            if (btns.length > 1) break; // shared container — not the card
          }
        }
        return false;
      }, targetName);
      if (!clicked) throw new Error(`bouton Reçu PDF de « ${targetName} » introuvable`);
      console.log(`✅ clic sur « Télécharger Reçu PDF » de ${targetName}`);
    }

    let file = null;
    for (let i = 0; i < 120; i++) {
      await wait(500);
      const files = readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf'));
      if (files.length) { file = files[0]; break; }
    }
    if (!file) throw new Error('aucun PDF téléchargé');
    const size = statSync(join(DL_DIR, file)).size;
    console.log(`✅ PDF capturé: ${file} (${size} octets)`);
    // read the bytes IMMEDIATELY (this machine's AV may quarantine the fresh
    // download shortly after it lands) — the pixel check works on the bytes
    return { path: join(DL_DIR, file), bytes: new Uint8Array(readFileSync(join(DL_DIR, file))) };
  } finally {
    await browser.close();
  }
}

// ── 5. Pixel check ───────────────────────────────────────────────────────────
const PX = 12 * 72 / 25.4; // 34.02 px/mm at viewport scale 12
const mm = (px) => px / PX;

async function raster(file) {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 12 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { w: canvas.width, h: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

function diffBBox(live, tpl, x0mm, x1mm, y0mm, y1mm) {
  const x0 = Math.floor(x0mm * PX), x1 = Math.ceil(x1mm * PX);
  const y0 = Math.floor(y0mm * PX), y1 = Math.ceil(y1mm * PX);
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
  for (let y = y0; y < y1 && y < live.h; y++) {
    for (let x = x0; x < x1 && x < live.w; x++) {
      const i = (y * live.w + x) * 4;
      const d = Math.abs(live.data[i] - tpl.data[i]) + Math.abs(live.data[i + 1] - tpl.data[i + 1]) + Math.abs(live.data[i + 2] - tpl.data[i + 2]);
      if (d > 60) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  return count ? { minX: mm(minX), maxX: mm(maxX), minY: mm(minY), maxY: mm(maxY), count } : null;
}

async function pixelCheck(pdfPath, mode) {
  console.log(`\n— Pixel check (${mode}, 34 px/mm) —`);
  const tplFile = mode === 'bulletin' ? TPL_BULLETIN
    : mode === 'technique' ? TPL_TECHNIQUE
    : mode === 'recu-parent' ? TPL_RECU : TPL_FICHE;
  const tpl = await raster(join(root, tplFile));
  const live = await raster(pdfPath.bytes || pdfPath);
  check('taille de page identique au modèle',
    Math.abs(mm(tpl.w) - mm(live.w)) < 0.5 && Math.abs(mm(tpl.h) - mm(live.h)) < 0.5,
    `${mm(live.w).toFixed(2)}×${mm(live.h).toFixed(2)} vs ${mm(tpl.w).toFixed(2)}×${mm(tpl.h).toFixed(2)} mm`);

  if (mode === 'technique') {
    // Technical-center fiche (5 columns): PÉRIODE box (83.75–150.25 × 62–69.6),
    // row 1 = 89.0→98.75 (lower line 98.75, amount baseline 97.65), date
    // underline x 23→119 @ y 181.3 (center x 71.0).
    const ROW1_BASELINE = 97.65;
    const period = diffBBox(live, tpl, 85, 149, 62.5, 69.2);
    check('période posée dans sa boîte', !!period && period.count > 100, period ? `${period.count} px` : 'absentes');
    const name = diffBBox(live, tpl, 7, 46, 89.5, 98.4);
    check('nom en ligne 1 (colonne 1)', !!name && name.count > 100, name ? `${name.count} px` : 'absents');
    const bands = [
      { name: 'salaire de base', x0: 50, x1: 84 },
      { name: 'indemnités', x0: 90, x1: 123 },
      { name: 'net payé', x0: 130, x1: 160 },
    ];
    const bottoms = [];
    for (const b of bands) {
      const d = diffBBox(live, tpl, b.x0, b.x1, 90, 98.75);
      if (!d) continue;
      bottoms.push(d.maxY);
      check(`${b.name} sur la ligne 97.65 mm`, Math.abs(ROW1_BASELINE - d.maxY) <= 0.5, `bas ${d.maxY.toFixed(2)} mm`);
    }
    if (bottoms.length === 3) {
      const spread = Math.max(...bottoms) - Math.min(...bottoms);
      check('3 montants sur UNE même ligne', spread <= 0.5, `écart ${spread.toFixed(2)} mm`);
    } else {
      check('3 montants détectés', false, `${bottoms.length}/3`);
    }
    const date = diffBBox(live, tpl, 25, 118, 176, 181.5);
    if (date) {
      const cx = (date.minX + date.maxX) / 2;
      check('date centrée sur son soulignement', Math.abs(cx - 71.0) <= 0.6, `centre ${cx.toFixed(2)} mm`);
    } else {
      check('date présente', false, 'non détectée');
    }
    // CACHET DE LA DIRECTION — the school cachet is stamped ON the printed
    // line (x 23→119 @ y 166.4, center (71.0, 166.4)): the diff ink center
    // must straddle the line symmetrically (bulletin-style centered-on-line).
    const cachet = diffBBox(live, tpl, 40, 103, 156, 177);
    if (cachet) {
      const ccx = (cachet.minX + cachet.maxX) / 2;
      const ccy = (cachet.minY + cachet.maxY) / 2;
      check('cachet centré sur la ligne CACHET',
        Math.abs(ccx - 71.0) <= 1.5 && Math.abs(ccy - 166.4) <= 1.5,
        `centre (${ccx.toFixed(2)}, ${ccy.toFixed(2)})`);
    } else {
      check('cachet présent', false, 'non détecté');
    }
    const zones = [
      ['période', 85, 149, 62.5, 69.2],
      ['nom', 7, 46, 89.5, 98.4],
      ['date', 25, 118, 176, 181.5],
      ['cachet', 40, 103, 156, 177],
    ];
    for (const [name, x0, x1, y0, y1] of zones) {
      const d = diffBBox(live, tpl, x0, x1, y0, y1);
      check(`données « ${name} » posées`, !!d && d.count > 100, d ? `${d.count} px` : 'absentes');
    }
  } else if (mode === 'recu-parent') {
    // Parent payment receipt — the school's paper form (201.1 × 155.8 mm):
    // every field must land on its printed zone. Zones calibrated at
    // 34 px/mm against the raster (see the geometry comment in
    // src/lib/pdfReceipt.ts). Threshold 500 px of overlay ink per zone
    // (measured 6k–25k px per zone on a real fill).
    const zones = [
      ['nom (M)', 20.5, 190, 79.5, 85.5],
      ['téléphone (Tél.)', 93, 175, 44, 50.5],
      ['somme en lettres', 54.5, 191, 89.5, 97],
      ['montant en chiffres (pilule BPF)', 158, 190.5, 36, 45.5],
      ['mois', 31, 100, 111.5, 117.5],
      ['classe', 150, 188, 110.5, 122.5],
      ['motif', 33, 190, 122, 129],
      ['date', 76, 141, 135, 147.5],
      ['numéro (boîte N°)', 154.3, 191.9, 132.5, 144.3],
    ];
    for (const [name, x0, x1, y0, y1] of zones) {
      const d = diffBBox(live, tpl, x0, x1, y0, y1);
      check(`données « ${name} » posées`, !!d && d.count > 500, d ? `${d.count} px` : 'absentes');
    }
    // centering guarantees: the amount in figures sits centered in the BPF
    // gradient pill (center x 174.25), the receipt number centered in the
    // N° box (center x 173.1).
    const pill = diffBBox(live, tpl, 158, 190.5, 36, 45.5);
    if (pill) {
      const cx = (pill.minX + pill.maxX) / 2;
      check('montant centré dans la pilule BPF', Math.abs(cx - 174.25) <= 1.5, `centre ${cx.toFixed(2)} mm`);
    } else {
      check('montant centré dans la pilule BPF', false, 'non détecté');
    }
    const nbox = diffBBox(live, tpl, 154.3, 191.9, 132.5, 144.3);
    if (nbox) {
      const cx = (nbox.minX + nbox.maxX) / 2;
      check('numéro centré dans la boîte N°', Math.abs(cx - 173.1) <= 1.5, `centre ${cx.toFixed(2)} mm`);
    } else {
      check('numéro centré dans la boîte N°', false, 'non détecté');
    }
  } else if (mode === 'fiche') {
    // Row-1 amounts (salaire c2, indemnités c3, net c4) all on the printed
    // 98.0 mm lower line — the symmetric-alignment guarantee.
    const bands = [
      { name: 'salaire base', x0: 43, x1: 74 },
      { name: 'indemnités', x0: 77, x1: 105 },
      { name: 'net payé', x0: 108, x1: 135 },
    ];
    const bottoms = [];
    for (const b of bands) {
      const d = diffBBox(live, tpl, b.x0, b.x1, 90, 99.0);
      if (!d) continue;
      bottoms.push(d.maxY);
      check(`${b.name} sur la ligne 98.0 mm`, Math.abs(98.0 - d.maxY) <= 0.35, `bas ${d.maxY.toFixed(2)} mm`);
    }
    if (bottoms.length === 3) {
      const spread = Math.max(...bottoms) - Math.min(...bottoms);
      check('3 montants sur UNE même ligne', spread <= 0.5, `écart ${spread.toFixed(2)} mm`);
    } else {
      check('3 montants détectés', false, `${bottoms.length}/3`);
    }
    // Date DE PAIEMENT centered on its underline (center x 86.85)
    const date = diffBBox(live, tpl, 50, 125, 176, 184);
    if (date) {
      const cx = (date.minX + date.maxX) / 2;
      check('date centrée sur son soulignement', Math.abs(cx - 86.85) <= 0.6, `centre ${cx.toFixed(2)} mm`);
    } else {
      check('date présente', false, 'non détectée');
    }
    // data overlay present (period box, name, date)
    const zones = [
      ['période', 85.5, 148.7, 62.3, 69.2],
      ['nom', 4.3, 41.8, 90.7, 99.1],
      ['date', 55, 125, 176, 184],
    ];
    for (const [name, x0, x1, y0, y1] of zones) {
      const d = diffBBox(live, tpl, x0, x1, y0, y1);
      // empty markers render ~72 px of ink; real data is ≥ 100 px
      check(`données « ${name} » posées`, !!d && d.count > 100, d ? `${d.count} px` : 'absentes');
    }
  } else {
    // Bulletin: seal ink centered on the printed L'EMPLOYEUR line
    // (172.19, 198.41) mm — pixel-calibrated constants (pdfPayrollBulletin.ts)
    const seal = diffBBox(live, tpl, 140, 205, 184, 207);
    if (seal) {
      const cx = (seal.minX + seal.maxX) / 2;
      const cy = (seal.minY + seal.maxY) / 2;
      check('cachet centré sur la ligne L’EMPLOYEUR',
        Math.abs(cx - 172.19) <= 0.5 && Math.abs(cy - 198.41) <= 0.5,
        `centre (${cx.toFixed(2)}, ${cy.toFixed(2)})`);
    } else {
      check('cachet présent', false, 'non détecté');
    }
    const zones = [
      ['période', 140, 200, 14, 34],
      ['identité', 10, 120, 30, 75],
      ['tableau', 10, 200, 83, 150],
      ['montant en lettres', 10, 200, 152, 162],
      ['paiement', 10, 120, 160, 176],
    ];
    for (const [name, x0, x1, y0, y1] of zones) {
      const d = diffBBox(live, tpl, x0, x1, y0, y1);
      // empty markers render ~72 px of ink; real data is ≥ 100 px
      check(`données « ${name} » posées`, !!d && d.count > 100, d ? `${d.count} px` : 'absentes');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
// Startup sweep: kill Chrome orphans left by interrupted runs (Windows only).
const swept = await sweepOrphanPuppeteer();
if (swept) console.log(`🧹 ${swept} orphelin(s) Chrome puppeteer purgé(s)`);

if (CLEANUP_ONLY) {
  await cleanup();
  console.log('Cleanup terminé.');
  process.exit(0);
}

try {
  await createAccount();
  const target = await resolveTarget();
  const { member, student, mode } = target;
  const label = member ? `${member.name} (${member.position})`
    : student ? `élève ${student.name}`
    : '(à créer via le bouton)';
  console.log(`🎯 cible: ${label} → ${mode}`);
  const pdf = await runE2E(target);
  await pixelCheck(pdf, mode);
  if (KEEP) {
    const report = checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n');
    mkdirSync(join(root, '.verify-pdf'), { recursive: true });
    writeFileSync(join(root, '.verify-pdf', 'report.txt'), `${new Date().toISOString()}\n${URL}\n${mode}\n\n${report}\n`);
  }
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  check('exécution complète', false, e.message);
} finally {
  await cleanup();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${failed.length === 0 ? '✅' : '❌'} ${checks.length - failed.length}/${checks.length} vérifications OK`);
process.exit(failed.length === 0 ? 0 : 1);