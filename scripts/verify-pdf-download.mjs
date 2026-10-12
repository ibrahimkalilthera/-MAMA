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
//                filled with the pupil name, the SCHOOL's fixed number on the
//                « Tél. : » dotted line, the amount in words, the figures in
//                the BPF pill, the N° box, month/class/motif and the date; a
//                demo student+payment is created via the API when the base
//                holds no payment)
//   • recu-mois   (le GESTE du guichet : la saisie ouverte par son bouton, un
//                élève choisi, date et montant frappés, des mois cochés — puis
//                le reçu du moment ET sa RÉIMPRESSION depuis la ligne relue en
//                base. Les mois sont lus SUR LE PAPIER : nommés un par un,
//                comptés, et le mois de la date ABSENT — un reçu qui aurait
//                perdu les mois cochés écrirait précisément ce mois-là)
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
//   node scripts/verify-pdf-download.mjs --mode recu-mois
//   node scripts/verify-pdf-download.mjs --target "Madi"
//   node scripts/verify-pdf-download.mjs --url http://127.0.0.1:4000/ --keep
//
// Flags:
//   --target <name>  staff member to download (default: first of the mode)
//   --mode <auto|fiche|bulletin|technique|recu-parent|recu-mois>  which PDF to
//                    expect (default auto, decided from the member's position —
//                    admin positions → bulletin, TECH_POSITIONS → technique,
//                    else fiche; recu-parent and recu-mois are explicit: the
//                    parent payment receipt is a different flow, the Élèves page
//                    for the first, the payment form's gesture for the second)
//   --url <url>      app URL (default https://mama-thera-finance.vercel.app/)
//   --keep           keep the downloaded PDF + pixel report in ./.verify-pdf/
//   --cleanup-only   only delete any leftovers (ephemeral account, demo admin,
//                    technique member, temp files) and exit
//
// Requires (devDependencies): puppeteer-core, pdfjs-dist, @napi-rs/canvas.
// Service-role credentials come from the ENVIRONMENT first (SUPABASE_URL /
// VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — the job that mounts its own
// stack exports ephemeral keys and has no `.env`), then from `.env` for a manual
// run. Never stored here.
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
import { assertEphemeralTarget, ephemeralEmail, pickEphemeralUser } from './lib/ephemeral-accounts.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';
import { firstRow, readUntil } from './lib/read-after-submit.mjs';
import { replayableWrite, withTransientRetry } from './lib/transient-http.mjs';
import { sweepOrphanPuppeteer } from './lib/orphan-chrome.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
// Les DEUX écritures, `--url <valeur>` et `--url=<valeur>`. Mesuré le 2026-10-12
// sur la garde CSP voisine : la seconde était ignorée en silence et le contrôle
// jugeait l'adresse par défaut — c'est-à-dire la production — en croyant juger
// celle qu'on venait de lui donner. Ici le défaut vise la prod : l'ignorer ferait
// écrire un compte éphémère dans la base de l'école.
const flag = (name, def = undefined) => {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
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
const env = existsSync(envFile) ? parseEnv(envFile) : {};
// L'ENVIRONNEMENT d'abord : le run qui juge les reçus monte sa propre pile de
// recette et exporte ses clés éphémères — sur un runner, `.env` n'existe pas.
// Le fichier ne sert qu'à un lancement à la main, et il vient APRÈS : un `.env`
// périmé ne doit pas décider de la base jugée.
const supabaseBase = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseBase || !SERVICE_KEY) {
  console.error(
    '❌ base ou clé service introuvable : ni SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ' +
      `dans l’environnement, ni de valeurs dans ${envFile} (${existsSync(envFile) ? 'présent mais incomplet' : 'absent'}).`,
  );
  process.exit(1);
}
const HDR = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// ── Le flux « mois cochés » (mode recu-mois) ─────────────────────────────────
// Ce que ce mode prouve, dans l'ordre de la chaîne : le caissier coche des mois
// dans le formulaire RÉEL, l'application les écrit en base, et le reçu — celui du
// geste PUIS celui réimprimé à partir de la ligne relue — les porte tels quels.
//
// Trois mois TROUÉS, choisis exprès : c'est la forme que le reçu doit écrire en
// NOMMANT les mois (une plage continue se dirait « Septembre à Novembre » sans
// prouver que chaque borne vient du geste). Octobre — le mois de la date — reste
// dehors : il ne doit donc PAS apparaître sur la ligne, ce qui est exactement ce
// qu'un reçu qui aurait perdu les mois cochés écrirait à la place.
const MONTHS_DATE = '2026-10-04';
const MONTHS_AMOUNT = 30000;
const MONTHS_TICKED = ['2026-09', '2026-11', '2026-12'];
// Les mots du reçu, en français : ils viennent de la règle du module pur
// (src/lib/paymentMonths.ts), que tests/payment-months.test.ts verrouille de son
// côté. Ici, l'attendu est écrit en toutes lettres — un contrôle qui calculerait
// son attendu avec le code jugé ne prouverait rien.
const MONTHS_EXPECTED = '3 mois : Septembre, Novembre, Décembre';

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

/**
 * Les reprises de transport du run, DITES à la fin.
 *
 * Un run vert après trois reprises ne raconte pas la même chose qu'un run vert
 * du premier essai : la règle du dépôt est qu'une reprise doit se voir, sinon
 * « vert » ne distingue plus « tout allait bien » de « ça a fini par passer ».
 */
const transients = [];
const noteTransient = (what) => { transients.push(what); };

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
      // `?email=` est ignoré par cette version de GoTrue (mesuré le 2026-09-13) :
      // on liste, puis on compare l'email exactement côté client.
      const probe = await rawApi('/auth/v1/admin/users?per_page=1000');
      const found = pickEphemeralUser(probe.body?.users, EMAIL);
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
  assertEphemeralTarget(EMAIL); // jamais un compte réel, même si la sonde se trompait
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
  if (MODE === 'recu-mois') {
    // Aucun paiement à trouver : c'est le GESTE qui l'écrit, par le formulaire.
    // L'élève de démo ne porte pas d'année scolaire (`academic_year` NULL), donc
    // le filtre d'année de l'application l'affiche dans TOUTES les années — sans
    // quoi le sélecteur du guichet pourrait être vide selon l'année active.
    const demo = {
      name: `E2E Mois ${TS}`,
      parent_name: 'Parent E2E',
      parent_phone: '+223 70 00 00 00',
      grade: '9eme A',
      total_due: 150000,
      amount_paid: 0,
      status: 'Active',
    };
    const ins = await insertOnce('students', demo, `name=eq.${encodeURIComponent(demo.name)}`);
    if (!ins.body?.[0]?.id) throw new Error(`insertion élève de démo échouée (${ins.status})`);
    demoStudentId = ins.body[0].id;
    console.log(`  ℹ️ élève de démo créé pour le geste des mois (${demo.name}) — supprimé au nettoyage`);
    return { member: null, student: { id: demoStudentId, name: demo.name }, mode: 'recu-mois' };
  }
  if (MODE === 'recu-parent') {
    // Find a student that already has ≥1 payment; else create a demo pair via
    // the API (payments cascade on student delete — cleanup deletes the student).
    const { status, body } = await api('/rest/v1/payments?select=id,student_id,date,amount,receipt_number&limit=1000');
    if (status !== 200) throw new Error(`lecture payments échouée (${status})`);
    const pay = Array.isArray(body) ? body : [];
    const studentId = pay[0]?.student_id;
    if (studentId) {
      const stu = await api(`/rest/v1/students?select=id,name,parent_name,grade&id=eq.${studentId}`);
      // A real payment in the base is the best target. (Until 2026-10-05 this
      // also required the student to HAVE A PHONE, because the « Tél. : » line
      // printed it; that line now carries the school's fixed number, so the
      // student no longer needs one for the zone to be filled.)
      if (Array.isArray(stu.body) && stu.body[0]) {
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

  // Resolve the created member id via the API (for cleanup) — on ATTEND que
  // l'insertion de l'application soit visible, au lieu de dormir PUIS de lire en
  // boucle : la brique partagée (`scripts/lib/read-after-submit.mjs`) fait la
  // première lecture TOUT DE SUITE (le cas courant, l'insertion est déjà là) et
  // n'attend que si elle manque. L'`id` sert au NETTOYAGE : un membre de démo
  // sans identifiant ne serait jamais supprimé, donc ce n'est pas un détail.
  const found = await readUntil({
    read: () => api(`/rest/v1/staff?select=id&email=eq.${email}`),
    isReady: (r) => firstRow(r?.body)?.id ?? null,
    attempts: 20,
    intervalMs: 500,
    sleep: wait,
  });
  if (!found.value) {
    throw new Error(`membre technique créé mais id introuvable via l’API après ${found.reads} lecture(s)`);
  }
  if (found.reads > 1) console.log(`  ↻ membre technique retrouvé en ${found.reads} lecture(s)`);
  techniqueMemberId = found.value;
  return { id: found.value, name, email, position: 'Membre du Centre Technique', salary };
}

/**
 * Naviguer vers la prod en distinguant un HOQUET d'un VERDICT.
 *
 * Mesuré : un 504 du gateway Supabase et un délai de navigation ne disent rien
 * de l'application, alors que le run, lui, tombait en rouge et paraissait dire
 * quelque chose sur elle. Une navigation reprise est donc journalisée, une
 * navigation qui échoue pour de bon est nommée comme ce qu'elle est (la
 * plateforme n'a pas servi la page), et un échec qui n'a PAS la forme d'un
 * transport n'est jamais retenté : il remonte tel quel.
 */
async function gotoWithRetry(page, target, { attempts = 3 } = {}) {
  let reason = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await page.goto(target, { waitUntil: 'networkidle2', timeout: 90000 });
      const status = res ? res.status() : null;
      if (status === null || status < 500) return { status, attempts: attempt };
      reason = `HTTP ${status} servi par la plateforme`;
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 140);
      // Ni un délai de navigation ni une panne de socket ne parlent de l'app.
      if (!/timeout|timed out|net::ERR|ECONNRESET|ECONNREFUSED|ERR_CONNECTION|socket hang up|Navigation failed/i.test(msg)) throw e;
      reason = msg;
    }
    if (attempt < attempts) {
      console.log(`  ↻ navigation : ${reason} — coupure passagère, tentative ${attempt + 1}/${attempts}`);
      noteTransient(`navigation (${reason})`);
      await wait(3000 * attempt);
    }
  }
  throw new Error(
    `la prod n’a pas servi la page après ${attempts} tentatives (${reason}) — ` +
      'c’est la PLATEFORME (ou le réseau du runner) qui n’a pas répondu, pas une régression de l’application',
  );
}

/**
 * La navigation d'une fiche élève, en TROIS gestes nommés : ouvrir la page
 * Élèves, ouvrir la ligne de l'élève, puis télécharger son reçu par son aperçu.
 *
 * UNE brique, parce que DEUX flux du script en ont besoin : le reçu des parents
 * (mode recu-parent) et la RÉIMPRESSION après le geste des mois (mode recu-mois,
 * où le reçu est reconstruit à partir de la ligne RELUE en base). Recopier ces
 * clics aurait produit deux chemins qui divergent : le jour où l'aperçu change de
 * libellé, l'un des deux continuerait à cliquer dans le vide — et un pixel-check
 * qui ne trouve plus son bouton accuse l'application d'une régression qu'elle
 * n'a pas.
 */
async function goToStudents(page) {
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
}

/**
 * Ouvre la fiche de l'élève en cliquant sa LIGNE (le nom peut être répété), et
 * VÉRIFIE que la fiche est ouverte.
 *
 * « J'ai cliqué » n'est pas « c'est ouvert », et c'est la leçon du 2026-10-12 :
 * le mode recu-mois cherchait le bouton « Reçu » de la fiche d'un élève sans
 * jamais avoir ouvert cette fiche. L'aide rendait la main dès qu'un clic était
 * PARTI, donc un clic qui n'ouvre rien passait pour un clic qui a ouvert — et le
 * run accusait plus loin un bouton absent d'un écran qui n'existait pas.
 *
 * Le clic reste SYNTHÉTIQUE (`anc.click()`), comme partout dans cette chaîne :
 * React répond aux deux, souris comprise. Ce qui change ici, c'est que
 * l'ouverture est VÉRIFIÉE (`role="dialog"`, l'enveloppe de toutes les modales)
 * puis TENUE — la fiche doit être encore là après un temps de rendu — et qu'un
 * essai qui n'ouvre rien se DIT et se reprend, rechargement compris, parce qu'une
 * liste peut être cliquée avant d'avoir reçu ses données.
 */
async function openStudentFile(page, studentName) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const clicked = await page.evaluate((name) => {
      const nameEls = [...document.querySelectorAll('*')].filter((el) =>
        el.children.length === 0 && (el.textContent || '').trim() === name);
      for (const n of nameEls) {
        let anc = n;
        for (let i = 0; i < 8 && anc; i++) {
          anc = anc.parentElement;
          if (!anc) break;
          const cls = anc.getAttribute('class') || '';
          if (anc.onclick || anc.getAttribute('role') === 'button' || anc.tagName === 'TR' || /cursor/.test(cls)) {
            anc.click();
            return true;
          }
        }
      }
      return false;
    }, studentName);
    if (clicked) {
      const opened = await page.waitForSelector('[role="dialog"]', { timeout: 6000 })
        .then(() => true).catch(() => false);
      if (opened) {
        await wait(1500);
        if (await page.$('[role="dialog"]')) return;
        console.log(`  ⚠️ ligne « ${studentName} » : fiche ouverte PUIS refermée (essai ${attempt + 1})`);
      } else {
        console.log(`  ⚠️ ligne « ${studentName} » cliquée (essai ${attempt + 1}) — la fiche ne s'est pas ouverte`);
      }
    } else {
      console.log(`  ⚠️ ligne « ${studentName} » absente de la liste (essai ${attempt + 1})`);
    }
    if (attempt < 2) {
      await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
      await wait(5000);
      await goToStudents(page);
    }
  }
  throw new Error(`la fiche de « ${studentName} » ne s'est jamais ouverte (3 essais)`);
}

/**
 * L'APERÇU du reçu, puis le SECOND clic — celui qui télécharge vraiment.
 *
 * Depuis la 1.0.23, aucun chemin ne télécharge au premier geste : la fiche d'un
 * élève comme le formulaire de saisie (dont l'envoi enchaîne sur
 * `generatePaymentReceiptPdf` → `showReceiptPreview`) ouvrent un APERÇU, et le
 * fichier ne part qu'ici, au clic sur « Télécharger le reçu »
 * (ReceiptPreviewModal). Sauter ce clic, c'est attendre un fichier qu'aucun geste
 * ne déclenche — et accuser l'application d'un téléchargement qu'elle n'a jamais
 * promis. Une seule brique, parce que DEUX flux du script en dépendent : le reçu
 * des parents et celui du GESTE des mois (mode recu-mois).
 */
async function confirmReceiptPreview(page, label) {
  const previewReady = await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some((b) =>
      /télécharger le reçu|download receipt/i.test(b.textContent || '')),
    { timeout: 30000 }).then(() => true).catch(() => false);
  if (!previewReady) {
    throw new Error(`aperçu du reçu (${label}) non affiché — bouton « Télécharger le reçu » introuvable`);
  }
  const confirmed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /télécharger le reçu|download receipt/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!confirmed) throw new Error(`bouton « Télécharger le reçu » de l’aperçu (${label}) introuvable`);
  console.log(`✅ aperçu du reçu (${label}) confirmé — téléchargement déclenché`);
}

/**
 * « Télécharger Reçu PDF » depuis la fiche d'un élève, puis l'aperçu — le
 * parcours RÉEL de l'utilisateur pour un paiement DÉJÀ en base.
 */
async function downloadReceiptFromPreview(page, studentName) {
  let clicked = false;
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
  console.log(`✅ clic sur « Télécharger Reçu PDF » de ${studentName}`);
  await confirmReceiptPreview(page, studentName);
}

/** Le PDF que le navigateur vient d'écrire dans le dossier de téléchargement. */
async function captureDownloadedPdf(label) {
  for (let i = 0; i < 120; i++) {
    await wait(500);
    const files = readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf'));
    if (files.length) {
      const path = join(DL_DIR, files[0]);
      const size = statSync(path).size;
      console.log(`✅ PDF capturé (${label}) : ${files[0]} (${size} octets)`);
      // Les octets sont lus TOUT DE SUITE : l'antivirus de ce poste peut mettre
      // en quarantaine un téléchargement frais, et une relecture plus tard
      // mesurerait autre chose que ce que le navigateur a reçu.
      return { path, bytes: new Uint8Array(readFileSync(path)) };
    }
  }
  throw new Error(`aucun PDF téléchargé (${label})`);
}

/**
 * Le GESTE des mois, joué par l'interface RÉELLE — mode recu-mois.
 *
 * Le bouton de l'en-tête ouvre la saisie, l'élève est choisi dans sa liste, la
 * date et le montant sont frappés, les pastilles sont cochées par leur attribut
 * `data-month` (jamais par leur libellé : « Septembre » se traduit, `2026-09`
 * non), puis l'envoi écrit en base ET produit le reçu.
 *
 * Deux soins qui font la différence entre un contrôle et une mise en scène :
 *   • le mois proposé d'avance (celui de la date) est DÉCOCHÉ — le reçu doit
 *     porter le choix du caissier, pas ce que l'écran cochant par défaut ;
 *   • les clics sont espacés, UN par rendu : plusieurs clics dans le même tick
 *     partageraient l'état d'avant (React regroupe les mises à jour), et la
 *     pastille du mois de la date se recocherait toute seule.
 *
 * Rend la ligne que l'écran ANNONCE sous les pastilles — la promesse de
 * l'application (« le reçu écrira exactement ceci »), que le run confronte au
 * papier.
 */
async function drivePaymentMonths(page, target) {
  const readPressed = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="payment-months"] button[data-month]')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.getAttribute('data-month')));
  const clickMonth = async (month) => {
    const found = await page.evaluate((m) => {
      const btn = document.querySelector(`[data-slot="payment-months"] button[data-month="${m}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }, month);
    if (!found) throw new Error(`pastille du mois ${month} introuvable — les mois offerts ont changé ?`);
    await wait(300);
  };

  // Le bouton du guichet vit dans la barre latérale, qui n'existe qu'à partir de
  // `lg` (1024 px) : au gabarit par défaut du navigateur (800×600), il n'y a pas
  // d'élément à cliquer, et le run accuserait l'application d'un bouton absent
  // alors qu'il est simplement hors de la fenêtre. Même gabarit que
  // scripts/e2e-business.mjs.
  await page.setViewport({ width: 1280, height: 900 });
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a')]
      .find((b) => /enregistrer le paiement|record payment/i.test(`${b.textContent || ''} ${b.title || ''}`));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) throw new Error('bouton « Enregistrer le Paiement » introuvable dans l’en-tête');
  await page.waitForSelector('#payment-student', { timeout: 30000 });
  await page.select('#payment-student', target.student.id);
  await page.type('form input[type="number"]', String(MONTHS_AMOUNT));
  // La date passe par le DESCRIPTEUR natif : React garde trace de la dernière
  // valeur qu'il a écrite, et une affectation directe peut être absorbée comme
  // « pas de changement » — la date resterait celle du jour et les pastilles
  // porteraient le mauvais mois.
  await page.$eval('form input[type="date"]', (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, MONTHS_DATE);
  await wait(500);
  if (!(await readPressed()).length) {
    throw new Error(`aucune pastille de mois affichée pour la date ${MONTHS_DATE} — année scolaire illisible ?`);
  }

  for (const month of await readPressed()) if (!MONTHS_TICKED.includes(month)) await clickMonth(month);
  for (const month of MONTHS_TICKED) if (!(await readPressed()).includes(month)) await clickMonth(month);
  const pressed = await readPressed();
  if (pressed.join(',') !== MONTHS_TICKED.join(',')) {
    console.error(`  ⚠️ pastilles cochées : ${pressed.join(', ') || '(aucune)'}`);
    throw new Error('les pastilles ne portent pas les mois demandés');
  }

  const screenLine = await page.$eval('[data-slot="payment-months"] p:last-of-type', (el) => (el.textContent || '').trim());
  const submitted = await page.evaluate(() => {
    const btn = document.querySelector('form button[type="submit"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!submitted) throw new Error('le bouton de validation de la saisie est introuvable ou fermé (aucun mois coché ?)');
  console.log(`✅ geste saisi — l’écran annonce : « ${screenLine} »`);
  return screenLine;
}

/**
 * La MOITIÉ RETOUR, prouvée par le chemin réel : la ligne est relue en base (par
 * l'API de service — la seule qui voie les lignes de n'importe quel compte), puis
 * le reçu est RÉIMPRIMÉ depuis la fiche de l'élève, où l'application le construit
 * à partir de la ligne qu'elle vient de relire.
 *
 * C'est ce qui manquait : un reçu du moment peut très bien porter les mois sans
 * qu'ils aient jamais été écrits (l'écran les connaît en mémoire). Un reçu
 * réimprimé, lui, ne peut pas mentir sur ce que la base contient.
 */
async function proveMonthsChain(page, screenLine, studentName) {
  // `api` rend l'enveloppe `{ status, body }` : c'est `firstRow` qui ouvre le
  // corps, comme partout ailleurs dans cette chaîne. Lire l'enveloppe comme si
  // c'était la ligne ferait échouer TOUTES les lectures — et un contrôle qui
  // attend dix fois ce qu'il tient déjà est un contrôle faux, pas une base lente.
  const settled = await readUntil({
    read: () => api(`/rest/v1/payments?select=id,receipt_number,date,amount,months&student_id=eq.${demoStudentId}`),
    isReady: (r) => firstRow(r?.body),
    attempts: 20,
    intervalMs: 500,
    sleep: wait,
  });
  if (!settled.value) {
    throw new Error(`aucun paiement écrit en base pour l’élève de démo après ${settled.reads} lecture(s) — le geste n’est pas arrivé`);
  }
  console.log(`  ℹ️ ligne lue en base après ${settled.reads} lecture(s) — months=${JSON.stringify(settled.value.months)}`);

  // Le dossier de téléchargement est VIDÉ avant la réimpression : la capture
  // suivante doit être celle de la réimpression, jamais le fichier d'avant.
  for (const f of readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf'))) rmSync(join(DL_DIR, f), { force: true });
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
  await wait(4000);
  await goToStudents(page);
  await openStudentFile(page, studentName);
  await downloadReceiptFromPreview(page, studentName);
  const reprint = await captureDownloadedPdf('réimpression');

  return { ticked: MONTHS_TICKED, screenLine, stored: settled.value.months, reads: settled.reads, reprint };
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
    // Le service worker est NEUTRALISÉ pour tout le run, et c'est une condition du
    // contournement des modèles : `Fetch.enable` n'intercepte que les requêtes du
    // TARGET de cette session. Une page contrôlée par le service worker laisse
    // celui-ci émettre le `fetch()` du modèle, donc hors de notre interception : le
    // modèle repart par le réseau, où le filtre antivirus de ce poste le vide — le
    // reçu n'est plus alors qu'une page sans en-tête PDF. Mesuré le 2026-10-12 (mode
    // recu-mois, le SEUL qui recharge la page en cours de route) : premier
    // téléchargement 200 avec les bons octets, second 204 vide et « No PDF header
    // found ». Les octets servis viennent donc TOUJOURS d'ici.
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
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
    // Les erreurs de console sont IMPRIMÉES, et pas seulement les exceptions non
    // rattrapées : une génération de reçu qui échoue est avalée par
    // l'application — le paiement est écrit AVANT, exprès — donc le seul signe
    // est un `console.error`. Sans lui, un run qui n'obtient aucun PDF se
    // contente de dire « aucun PDF téléchargé », et envoie chercher la panne
    // dans le clic au lieu du document.
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('  [console:error]', msg.text().slice(0, 300));
    });

    await gotoWithRetry(page, URL);
    await wait(2500);
    /** Le formulaire de connexion est-il encore là ? (le seul signe honnête.) */
    const stillOnLogin = () =>
      page.evaluate(() => !!document.querySelector('input[type="email"]')).catch(() => true);
    const loginForm = await stillOnLogin();
    if (loginForm) {
      let loggedIn = false;
      // DEUX tentatives, et la seconde recharge la page : le formulaire a déjà
      // été rempli, donc taper à nouveau empilerait les caractères au lieu de
      // refaire la saisie.
      for (let attempt = 1; attempt <= 2 && !loggedIn; attempt += 1) {
        if (attempt > 1) {
          console.log('  ↻ connexion : le formulaire est resté — nouvelle tentative 2/2');
          noteTransient('connexion (formulaire resté affiché)');
          await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
          await wait(2500);
        }
        await page.type('input[type="email"], input[placeholder*="@"]', EMAIL);
        const pwd = await page.$('input[type="password"]');
        if (pwd) await pwd.type(PASS);
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => /se connecter|login/i.test(b.textContent || ''));
          if (btn) btn.click();
        });
        // `waitForFunction` qui échoue ne doit plus être AVALÉ : la version
        // précédente imprimait « connecté » même quand le formulaire restait
        // affiché, et le run mourait plus loin sur un « bouton introuvable » —
        // un rouge qui accusait l'application d'un problème de transport.
        loggedIn = await page
          .waitForFunction(() => !document.querySelector('input[type="email"]'), { timeout: 30000 })
          .then(() => true)
          .catch(() => false);
      }
      if (!loggedIn) {
        throw new Error(
          'la connexion n’a pas abouti : le formulaire est resté affiché après 2 tentatives — ' +
            'l’application n’a pas rendu de session (Supabase joignable ?), ce n’est pas une régression du rendu',
        );
      }
      console.log('✅ connecté à', URL);
    }
    await wait(4000);

    // open Paie (retry on transient JWT clock skew)
    // Le mode recu-mois n'y passe pas : le bouton du guichet vit dans l'en-tête,
    // disponible depuis n'importe quelle page — et sauter cette navigation, c'est
    // une étape de moins qui peut échouer pour une raison qui ne regarde pas le
    // geste jugé.
    for (let attempt = 0; target.mode !== 'recu-mois' && attempt < 4; attempt++) {
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

    let clicked = false;
    let monthsScreenLine = '';
    if (target.mode === 'recu-parent') {
      // ── recu-parent : la fiche d'un élève qui a DÉJÀ un paiement → son reçu
      await goToStudents(page);
      await openStudentFile(page, target.student.name);
      await downloadReceiptFromPreview(page, target.student.name);
    } else if (target.mode === 'recu-mois') {
      // ── recu-mois : le GESTE du guichet, par le vrai formulaire. L'envoi ouvre
      // l'APERÇU du reçu (aucun chemin ne télécharge au premier geste) : c'est le
      // second clic qui écrit le fichier, et il fait partie du geste jugé.
      monthsScreenLine = await drivePaymentMonths(page, target);
      await confirmReceiptPreview(page, 'reçu du geste');
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

    const receipt = await captureDownloadedPdf('reçu du geste');
    // ── recu-mois : la base relue, puis la RÉIMPRESSION par le chemin réel ────
    if (target.mode === 'recu-mois') {
      const months = await proveMonthsChain(page, monthsScreenLine, target.student.name);
      return { ...receipt, months };
    }
    return receipt;
  } finally {
    await browser.close();
  }
}

// ── 5. Pixel check ───────────────────────────────────────────────────────────
const PX = 12 * 72 / 25.4; // 34.02 px/mm at viewport scale 12
const mm = (px) => px / PX;

async function raster(file) {
  // Copie : `pdfjs` s'approprie le tampon qu'on lui passe (il le transfère au
  // worker), et deux mesures successives sur le MÊME tampon liraient un tampon
  // vidé au lieu du document.
  const bytes = file instanceof Uint8Array ? file.slice() : new Uint8Array(readFileSync(file));
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
  // recu-mois tombe sur le MÊME papier que recu-parent : c'est le reçu des
  // parents, rempli par le geste du guichet au lieu d'un paiement déjà en base.
  const tplFile = mode === 'bulletin' ? TPL_BULLETIN
    : mode === 'technique' ? TPL_TECHNIQUE
    : (mode === 'recu-parent' || mode === 'recu-mois') ? TPL_RECU : TPL_FICHE;
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
  } else if (mode === 'recu-parent' || mode === 'recu-mois') {
    // Parent payment receipt — the school's paper form (201.1 × 155.8 mm):
    // every field must land on its printed zone. Zones calibrated at
    // 34 px/mm against the raster (see the geometry comment in
    // src/lib/pdfReceipt.ts). Threshold 500 px of overlay ink per zone
    // (measured 6k–25k px per zone on a real fill).
    const zones = [
      ['nom (M)', 20.5, 190, 79.5, 85.5],
      ['numéro école (Tél.)', 93, 175, 44, 50.5],
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

// ── 6. Les mois cochés, lus SUR LE PAPIER ────────────────────────────────────
/**
 * Le texte d'un PDF, sans espaces : les mots d'une même ligne peuvent sortir en
 * plusieurs morceaux selon la façon dont pdf-lib les écrit, et une comparaison
 * qui exigerait un seul tenant jugerait la découpe plutôt que le texte.
 *
 * Les octets arrivent en COPIE (`slice`) : `pdfjs` prend possession du tampon
 * qu'on lui donne, donc la mesure suivante (le pixel-check) doit pouvoir relire
 * les mêmes octets sans trouver un tampon vidé.
 */
async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ce que le reçu ÉCRIT des mois — la moitié « papier » de la chaîne.
 *
 * Trois faits, et chacun accuse une panne différente :
 *   • les trois mois cochés sont NOMMÉS — la ligne porte le choix du caissier ;
 *   • le compte « 3 mois » est là — la forme est une LISTE trouée, pas une plage
 *     ni un mois nu ;
 *   • Octobre est ABSENT — c'est le mois de la date, celui que le reçu écrirait
 *     si les mois avaient été perdus en route. Son absence est donc la preuve
 *     que la ligne vient du geste, pas de la date.
 */
const monthsOnPaper = (text) => {
  const flat = text.replace(/\s+/g, '');
  const names = ['Septembre', 'Novembre', 'Décembre'];
  return {
    names: names.filter((n) => flat.includes(n)),
    count: flat.includes('3mois'),
    october: flat.includes('Octobre'),
  };
};

/**
 * Le geste du guichet jugé sur le PAPIER, dans l'ordre de la chaîne : ce que la
 * base a gardé, ce que l'écran promettait, ce que le reçu du moment a écrit, et
 * ce que la RÉIMPRESSION écrit — celle-ci ne pouvant rien porter que la base ne
 * lui ait rendu.
 */
async function checkMonthsPaper(pdf) {
  console.log('\n— Mois cochés : la base, l’écran, le papier —');
  const months = pdf.months;

  check('la base garde les mois cochés, dans l’ordre du calendrier',
    Array.isArray(months.stored) && months.stored.join(',') === MONTHS_TICKED.join(','),
    `months=${JSON.stringify(months.stored)}`);

  check('l’écran annonce la ligne du reçu', months.screenLine === MONTHS_EXPECTED,
    `« ${months.screenLine} »`);

  const gesture = monthsOnPaper(await pdfText(pdf.bytes.slice()));
  check('le reçu du geste NOMME les trois mois cochés', gesture.names.length === 3,
    gesture.names.join(', ') || 'aucun mois nommé');
  check('le reçu du geste écrit le compte (liste, pas plage)', gesture.count, gesture.count ? '« 3 mois »' : 'absent');
  check('le reçu du geste ne retombe PAS sur le mois de la date', !gesture.october,
    gesture.october ? 'Octobre imprimé — les mois ont été perdus' : 'aucun « Octobre »');

  const reprint = monthsOnPaper(await pdfText(months.reprint.bytes.slice()));
  check('la RÉIMPRESSION porte les mêmes mois', reprint.names.length === 3 && reprint.count,
    reprint.names.join(', ') || 'aucun mois nommé');
  check('la RÉIMPRESSION ne retombe pas sur le mois de la date', !reprint.october,
    reprint.october ? 'Octobre imprimé — la colonne n’est pas relue' : 'aucun « Octobre »');
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
  // Les mois se jugent AVANT le pixel-check : `pdfjs` prend possession du tampon
  // d'octets qu'on lui donne, donc celui qui lit le texte en premier est celui
  // qui aura les octets vivants — les suivants reçoivent des copies.
  if (pdf.months) await checkMonthsPaper(pdf);
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
// Les reprises se disent AVANT le verdict : un vert obtenu au troisième essai
// ne doit pas se lire comme un vert du premier.
if (transients.length) {
  console.log(`\n↻ ${transients.length} reprise(s) de transport pendant ce run :`);
  for (const t of transients) console.log(`   - ${t}`);
}
console.log(`\n${failed.length === 0 ? '✅' : '❌'} ${checks.length - failed.length}/${checks.length} vérifications OK`);
if (failed.length === 0) {
  // La preuve vient d'ici, pas d'une phrase du workflow : ce que ce pixel-check a
  // RÉELLEMENT mesuré, c'est le nombre de vérifications passées sur le mode
  // demandé (page rasterisée, zones de données, centrages). Deux invocations de
  // ce script tournent dans le même job — chacune publie SA mesure, et le mandat
  // est posé par l'étape qui l'exécute (`AUTOMATION_EVIDENCE: '1'`).
  publishEvidence({
    acted: true,
    count: checks.length,
    reason: `pixel-check PDF « ${MODE} » : ${checks.length} vérification(s) passée(s) sur le document produit (${URL})`,
  });
}
process.exit(failed.length === 0 ? 0 : 1);