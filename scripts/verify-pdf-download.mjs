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
//                perdu les mois cochés écrirait précisément ce mois-là. La
//                FICHE de l'élève est jugée au passage : les mois que la base
//                garde y sont RÉGLÉS, tous les autres À RÉGLER)
//   • recu-muet   (le RATTRAPAGE, par la FICHE : le reçu visé est MUET —
//                antérieur à la colonne `payments.months`, il ne déclare donc
//                aucun mois, sa réimpression ne nomme que le mois de sa DATE et
//                la fiche le compte parmi les paiements « sans mois déclaré ».
//                L'école le complète depuis la fiche (bouton « Renseigner les
//                mois », pastilles cochées par leur CLÉ, enregistrement) — puis
//                la page est RECHARGÉE : la fiche doit alors marquer ces mois
//                RÉGLÉS, ne plus compter ce reçu comme muet et ne plus offrir de
//                le compléter. Le reçu est enfin RÉIMPRIMÉ : il NOMME les mois,
//                et le mois de sa DATE reste absent — c'est exactement tout ce
//                qu'un reçu muet écrivait)
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
//   node scripts/verify-pdf-download.mjs --mode recu-muet
//   node scripts/verify-pdf-download.mjs --target "Madi"
//   node scripts/verify-pdf-download.mjs --url http://127.0.0.1:4000/ --keep
//
// Flags:
//   --target <name>  staff member to download (default: first of the mode)
//   --mode <auto|fiche|bulletin|technique|recu-parent|recu-mois|recu-muet>
//                    which PDF to expect (default auto, decided from the member's position —
//                    admin positions → bulletin, TECH_POSITIONS → technique,
//                    else fiche; recu-parent and recu-mois are explicit: the
//                    parent payment receipt is a different flow, the Élèves page
//                    for the first, the payment form's gesture for the second,
//                    and the retro-fill of a mute receipt, driven from the
//                    Élèves fiche, for the third)
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
import { PREVIEW_DOWNLOAD_SELECTOR, RECEIPT_BUTTON_SELECTOR } from './lib/e2e-receipt.mjs';
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

/**
 * ─── Le flux « reçu muet rattrapé par la fiche » (mode recu-muet) ───────────
 *
 * Le reçu jugé ici est ANTÉRIEUR à la colonne `payments.months` (migration
 * `20261011000000_payments_months.sql`) : sa couverture est INCONNUE, donc sa
 * réimpression ne nomme que le mois de sa DATE, et la fiche le compte parmi les
 * paiements « sans mois déclaré ». L'école le complète depuis la fiche — et
 * c'est CETTE moitié que ce mode mesure, pas le geste du guichet (mode
 * recu-mois, qui part d'une saisie neuve et n'écrit jamais sur un reçu ancien).
 *
 * Sa date n'est pas décorative : le 2026-10-04 est ANTÉRIEUR à la migration qui
 * a créé la colonne, donc ce reçu est muet de plein droit — pas un reçu du
 * moment auquel il manquerait un champ. Son mois (octobre) est aussi celui du
 * geste du guichet, ce qui donne aux deux modes la même phrase de refus : un
 * reçu qui aurait perdu le choix du caissier écrirait précisément ce mois-là.
 *
 * Les mois cochés sont les MÊMES que ceux du geste (`MONTHS_TICKED`) : le
 * rattrapage doit écrire ce qu'un encaissement du moment aurait écrit, et c'est
 * le même littéral qui le dit — un contrôle qui recalculerait son attendu avec
 * le code jugé ne prouverait rien.
 */
const MUTE_RECEIPT_DATE = MONTHS_DATE;
const MUTE_RECEIPT_AMOUNT = 20000;

/**
 * Les modes dont le document MESURÉ est le reçu des parents (`recu-parent.pdf`).
 * Une seule liste, parce qu'elle décide de trois choses qui doivent rester
 * d'accord : le modèle auquel se compare le pixel-check, la branche de zones à
 * juger, et le fait que le flux passe (ou non) par la page Paie d'abord.
 */
const RECEIPT_MODES = ['recu-parent', 'recu-mois', 'recu-muet'];

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
  if (MODE === 'recu-muet') {
    // L'élève de démo ne porte pas d'année scolaire (`academic_year` NULL) : le
    // filtre d'année de l'application l'affiche dans TOUTES les années, donc sa
    // ligne est trouvable quel que soit l'écran. Le reçu est inséré SANS la clé
    // `months` — un tableau VIDE serait déjà une déclaration, et la fiche
    // n'aurait alors rien à proposer à l'école.
    const demo = {
      name: `E2E Muet ${TS}`,
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
    const rec = {
      student_id: demoStudentId,
      date: MUTE_RECEIPT_DATE,
      amount: MUTE_RECEIPT_AMOUNT,
      academic_year: '2026-2027',
      receipt_number: `REC-MUET-${TS}`,
    };
    const pin = await insertOnce('payments', rec, `receipt_number=eq.${encodeURIComponent(rec.receipt_number)}`);
    if (!pin.body?.[0]?.id) throw new Error(`insertion du reçu muet échouée (${pin.status})`);
    console.log(`  ℹ️ élève + reçu MUET créés (${demo.name}, ${rec.receipt_number}, ${MUTE_RECEIPT_DATE}, aucun mois déclaré)`);
    return {
      member: null,
      student: { id: demoStudentId, name: demo.name },
      muteReceipt: { id: pin.body[0].id, receiptNumber: rec.receipt_number, date: rec.date, amount: rec.amount },
      mode: 'recu-muet',
    };
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
 * La BANDE DES MOIS de la fiche élève, lue par ses CLÉS.
 *
 * Le pendant écran de ce que `checkMonthsPaper` juge sur le papier : la fiche
 * affirme, mois par mois, ce que les paiements de l'élève déclarent couvrir. La
 * lecture passe par `data-month` / `data-state`, jamais par les libellés — un
 * mois réglé se dit « Réglé » en français et « Paid » en anglais, `2026-09` non.
 *
 * Elle ATTEND la bande : les douze mois viennent de l'année scolaire active, que
 * l'application lit en base, donc parfois après le premier rendu de la fiche. Un
 * `null` est un CONSTAT, pas une exception — c'est au contrôle de le dire.
 */
async function readMonthsStrip(page) {
  const ready = await page.waitForFunction(
    () => document.querySelector('[data-slot="student-months"] [data-month]'),
    { timeout: 20000 },
  ).then(() => true).catch(() => false);
  if (!ready) return null;
  return page.evaluate(() => {
    const strip = document.querySelector('[data-slot="student-months"]');
    const chips = [...strip.querySelectorAll('[data-month]')];
    return {
      total: chips.length,
      months: chips.map((c) => ({ month: c.getAttribute('data-month'), state: c.getAttribute('data-state') })),
      // Le titre et le compte vivent dans des `<span>` ; les lignes des restants
      // et de la note, dans des `<p>`. Les deux sont relus, dans cet ordre.
      header: (strip.firstElementChild?.textContent || '').trim(),
      lines: [...strip.querySelectorAll('p')].map((p) => (p.textContent || '').trim()),
      // La phrase qui compte les reçus SANS mois déclaré, lue par son marqueur et
      // non par ses mots : elle dit, en une ligne, si la fiche croit encore
      // ignorer ce qu'un reçu couvre. Vide = plus aucun reçu muet.
      undeclaredNote: (strip.querySelector('[data-slot="student-months-undeclared"]')?.textContent || '').trim(),
    };
  });
}

/**
 * Le PARCOURS DE RATTRAPAGE de la fiche (`PaymentMonthsBackfill`), lu par ses
 * CLÉS — et son ABSENCE est une lecture, pas une erreur.
 *
 * La fiche offrait déjà de renseigner un reçu muet ligne par ligne ; ce que ce
 * parcours ajoute, c'est la LISTE de ce qui reste et l'ENCHAÎNEMENT (le suivant
 * s'ouvre après un enregistrement réussi). Ce mode le lit donc aux deux bouts :
 *
 *   • AVANT le geste — le parcours doit LISTER le reçu muet inséré pour ce run,
 *     par son identifiant : sans cette lecture, le contrôle ne prouverait pas
 *     que l'écran offrait le rattrapage, seulement qu'un bouton existait ;
 *   • APRÈS le rechargement — il ne doit plus être là. C'est la moitié écran de
 *     « la fiche ne compte PLUS ce reçu comme muet » : une phrase qui disparaît
 *     ne suffit pas si la liste, elle, restait offerte.
 *
 * Rien n'est ATTENDU ici (un `null` n'est pas une exception) : c'est au jugement
 * de dire ce que l'absence veut dire, à chaque bout.
 */
async function readBackfillPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-slot="payment-months-backfill"]');
    if (!panel) return { present: false, receipts: [], progress: '' };
    return {
      present: true,
      receipts: [...panel.querySelectorAll('[data-receipt]')].map((el) => el.getAttribute('data-receipt') || ''),
      // La progression est lue par son MARQUEUR, jamais par ses mots : « reçu 1
      // sur 2 » est une phrase traduite, et un contrôle qui la viserait casserait
      // à la première traduction.
      progress: (panel.querySelector('[data-slot="payment-months-backfill-progress"]')?.textContent || '').trim(),
    };
  });
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
  // L'attente et le clic visent le MARQUEUR du bouton de l'aperçu
  // (`data-slot="receipt-preview-download"`), jamais sa phrase : la même raison
  // que le premier clic (voir scripts/lib/e2e-receipt.mjs) — une phrase appartient
  // à l'écran entier, un marqueur appartient au geste.
  const previewReady = await page.waitForFunction((selector) =>
    Boolean(document.querySelector(selector)),
    { timeout: 30000 }, PREVIEW_DOWNLOAD_SELECTOR).then(() => true).catch(() => false);
  if (!previewReady) {
    throw new Error(`aperçu du reçu (${label}) non affiché — bouton « Télécharger le reçu » introuvable`);
  }
  const confirmed = await page.evaluate((selector) => {
    const btn = document.querySelector(selector);
    if (!btn) return false;
    btn.click();
    return true;
  }, PREVIEW_DOWNLOAD_SELECTOR);
  if (!confirmed) throw new Error(`bouton « Télécharger le reçu » de l’aperçu (${label}) introuvable`);
  console.log(`✅ aperçu du reçu (${label}) confirmé — téléchargement déclenché`);
}

/**
 * « Télécharger Reçu PDF » depuis la fiche d'un élève, puis l'aperçu — le
 * parcours RÉEL de l'utilisateur pour un paiement DÉJÀ en base.
 *
 * Le bouton est visé par son MARQUEUR (`data-slot^="payment-receipt"`), et non
 * plus par le mot « reçu » : ce contrôle-là avait été écrit au libellé, et le
 * 2026-10-14 la facture est tombée — l'onglet du rail « Reçus muets », rendu
 * AVANT les modales dans le DOM, matchait /reçu/i et recevait le clic. Le
 * contrôle sortait de la fiche, ne voyait aucun aperçu, et accusait
 * l'application d'un défaut qui n'existait pas (voir scripts/lib/e2e-receipt.mjs).
 * Un marqueur, lui, ne dépend pas du vocabulaire de l'écran.
 */
async function downloadReceiptFromPreview(page, studentName) {
  let clicked = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    clicked = await page.evaluate((selector) => {
      const btn = document.querySelector(selector);
      if (!btn) return false;
      btn.click();
      return true;
    }, RECEIPT_BUTTON_SELECTOR);
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
  // La FICHE d'abord, le papier ensuite : elle est ouverte ici, et c'est la même
  // vérité que le reçu doit porter. Le dossier de téléchargement se vide APRÈS,
  // pour que la capture reste celle de la réimpression.
  const strip = await readMonthsStrip(page);
  await downloadReceiptFromPreview(page, studentName);
  const reprint = await captureDownloadedPdf('réimpression');

  return { ticked: MONTHS_TICKED, screenLine, stored: settled.value.months, reads: settled.reads, reprint, strip };
}

/**
 * ─── Le RATTRAPAGE d'un reçu muet, par la fiche (mode recu-muet) ───────────
 *
 * Trois gestes, et aucun n'est décoratif :
 *
 *   • l'ÉDITEUR est ouvert depuis la ligne du reçu, et jugé AVANT d'écrire :
 *     douze mois offerts, AUCUN coché, l'enregistrement FERMÉ. Écrire un tableau
 *     vide ne déclarerait pas plus que le silence d'avant — la règle est celle de
 *     l'écran, et un contrôle qui la sauterait laisserait l'application décider à
 *     sa place ;
 *   • les mois se cochent par leur CLÉ (`data-month`), jamais par leur libellé :
 *     « Septembre » se traduit, `2026-09` non ;
 *   • l'écran ANNONCE la ligne que le reçu imprimera (le même module de calcul
 *     que le PDF), et c'est cette promesse que le papier devra tenir.
 *
 * Un clic par rendez-vous de rendu : plusieurs clics dans le même tick
 * partageraient l'état d'avant (React regroupe les mises à jour de l'état).
 */
async function fillMuteMonthsFromFile(page) {
  const offered = await page.$$eval('[data-slot="payment-months-fill"]', (els) => els.length);
  if (offered !== 1) {
    throw new Error(`la fiche offre ${offered} reçu(s) muet(s) à renseigner — attendu 1 (le reçu inséré sans mois)`);
  }
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[data-slot="payment-months-fill"]');
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  });
  if (!opened) throw new Error('le bouton « Renseigner les mois » de la fiche n’a pas pu être cliqué');
  const editor = await page.waitForSelector('[data-slot="payment-months-editor"]', { timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!editor) throw new Error('l’éditeur des mois ne s’est pas ouvert sur la fiche');

  const chips = await page.$$eval('[data-slot="payment-months-editor"] button[data-month]', (els) =>
    els.map((b) => ({ month: b.getAttribute('data-month'), pressed: b.getAttribute('aria-pressed') === 'true' })));
  if (chips.length !== 12) throw new Error(`l’éditeur offre ${chips.length} mois — attendu 12 (les douze de l’année scolaire)`);
  if (chips.some((c) => c.pressed)) throw new Error('l’éditeur pré-coche un mois : le reçu est muet, rien ne doit l’être');
  const saveClosed = await page.$eval('[data-slot="payment-months-save"]', (b) => b.disabled);
  if (!saveClosed) throw new Error('« Enregistrer » est ouvert alors qu’aucun mois n’est coché');

  for (const month of MONTHS_TICKED) {
    const hit = await page.evaluate((m) => {
      const btn = document.querySelector(`[data-slot="payment-months-editor"] button[data-month="${m}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }, month);
    if (!hit) throw new Error(`pastille du mois ${month} introuvable dans l’éditeur de la fiche`);
    await wait(300);
  }
  const pressed = await page.$$eval('[data-slot="payment-months-editor"] button[data-month][aria-pressed="true"]', (els) =>
    els.map((b) => b.getAttribute('data-month')));
  if (pressed.join(',') !== MONTHS_TICKED.join(',')) {
    throw new Error(`l’éditeur porte ${pressed.join(', ') || '(aucun mois)'} — les mois demandés ne sont pas cochés`);
  }
  const line = await page.$eval('[data-slot="payment-months-line"]', (el) => (el.textContent || '').trim());
  const submitted = await page.evaluate(() => {
    const btn = document.querySelector('[data-slot="payment-months-save"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!submitted) throw new Error('le bouton « Enregistrer » de l’éditeur est resté fermé après avoir coché les mois');
  console.log(`✅ fiche : reçu muet complété — l’écran annonce : « ${line} »`);
  return { line, editorMonths: chips.length, saveClosed };
}

/**
 * La moitié RETOUR du rattrapage : la base, le SOLDE, puis le RECHARGEMENT.
 *
 * Le rechargement est le cœur du mode, et pas une formalité : tant que la page
 * n'est pas rechargée, la fiche peut très bien porter les mois sans qu'ils aient
 * jamais quitté la mémoire de l'écran — ce que le mode recu-mois disait déjà de
 * son reçu du moment. On repart donc d'une page neuve, on rouvre la fiche, et
 * c'est CETTE fiche-là qui est jugée : ses pastilles, sa note des reçus muets,
 * son bouton.
 *
 * Le solde de l'élève est relu en base : des mois ne sont pas de l'argent, donc
 * `amount_paid` ne doit pas bouger d'un franc.
 */
async function proveMuteFilled(page, target, filled) {
  // `api` rend l'enveloppe `{ status, body }` : c'est `firstRow` qui ouvre le
  // corps. La première lecture a lieu TOUT DE SUITE (le cas courant, l'écriture
  // est déjà arrivée) et n'attend que si elle manque.
  //
  // Ce qui est ATTENDU, ce sont les MOIS, pas la ligne : la ligne existe depuis
  // l'insertion, et `payments.months` vaut `'{}'` par défaut — un prédicat qui
  // se contenterait de la lire rendrait la main AVANT l'écriture et mesurerait
  // l'état d'avant (mesuré le 2026-10-13 : `months=[]` annoncé comme un échec de
  // l'application, alors que seule la sonde était en avance).
  const settled = await readUntil({
    read: () => api(`/rest/v1/payments?select=id,months,date,amount,receipt_number&id=eq.${target.muteReceipt.id}`),
    isReady: (r) => {
      const row = firstRow(r?.body);
      return Array.isArray(row?.months) && row.months.length > 0 ? row : null;
    },
    attempts: 20,
    intervalMs: 500,
    sleep: wait,
  });
  if (!settled.value) {
    throw new Error(`le reçu muet n’est plus lisible en base après ${settled.reads} lecture(s)`);
  }
  console.log(`  ℹ️ reçu relu en base après ${settled.reads} lecture(s) — months=${JSON.stringify(settled.value.months)}`);
  const student = await api(`/rest/v1/students?select=id,amount_paid&id=eq.${target.student.id}`);

  // Le dossier de téléchargement est vidé avant la réimpression : la capture
  // suivante doit être celle du reçu réimprimé, jamais un fichier d'avant.
  for (const f of readdirSync(DL_DIR).filter((f) => f.endsWith('.pdf'))) rmSync(join(DL_DIR, f), { force: true });
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
  await wait(4000);
  await goToStudents(page);
  await openStudentFile(page, target.student.name);
  // La FICHE avant le papier : elle est ouverte ici, et c'est la même vérité que
  // le reçu doit porter. La bande est lue AVANT le téléchargement pour que la
  // capture des pastilles ne dépende pas de ce que la modale d'aperçu laisse
  // derrière elle.
  const strip = await readMonthsStrip(page);
  const fillButtons = await page.$$eval('[data-slot="payment-months-fill"]', (els) => els.length);
  // Et le PARCOURS, relu après le rechargement : plus rien à rattraper, donc plus
  // de liste. C'est la moitié écran de la même phrase que la note ci-dessus.
  const backfillAfter = await readBackfillPanel(page);
  await downloadReceiptFromPreview(page, target.student.name);
  const reprint = await captureDownloadedPdf('réimpression après rattrapage');

  return {
    ticked: MONTHS_TICKED,
    screenLine: filled.line,
    editorMonths: filled.editorMonths,
    saveClosed: filled.saveClosed,
    stored: settled.value.months,
    reads: settled.reads,
    amountPaid: Number(firstRow(student.body)?.amount_paid),
    strip,
    fillButtons,
    backfillAfter,
    reprint,
  };
}

/**
 * Le flux complet du mode recu-muet, dans l'ordre où l'école le vit : la fiche
 * AVANT (ce que l'application dit d'un reçu dont elle ne sait rien), le
 * rattrapage, puis la fiche APRÈS rechargement.
 *
 * L'état « avant » est CAPTURÉ, pas supposé : sans lui, un reçu qui aurait déjà
 * déclaré ses mois passerait le contrôle du rattrapage pour un simple affichage,
 * et le mode se féliciterait d'avoir complété ce qui était déjà complet.
 */
async function runMuteFillFlow(page, target) {
  await goToStudents(page);
  await openStudentFile(page, target.student.name);
  const before = await readMonthsStrip(page);
  const fillOffered = await page.$$eval('[data-slot="payment-months-fill"]', (els) => els.length);
  // Le PARCOURS, lu AVANT le geste : c'est lui qui LISTE ce qui reste. La bande
  // des mois est attendue juste avant, donc la fiche est rendue et une absence
  // de parcours ici serait un vrai constat, pas une course.
  const backfillBefore = await readBackfillPanel(page);
  const filled = await fillMuteMonthsFromFile(page);
  const mute = await proveMuteFilled(page, target, filled);
  return {
    ...mute.reprint,
    months: { ...mute, before, fillOffered, backfillBefore, muteReceiptId: target.muteReceipt.id },
  };
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
    // Les modes qui partent de la FICHE n'y passent pas : le bouton du guichet vit dans l'en-tête,
    // disponible depuis n'importe quelle page — et sauter cette navigation, c'est
    // une étape de moins qui peut échouer pour une raison qui ne regarde pas le
    // geste jugé.
    const needsPayrollPage = !RECEIPT_MODES.includes(target.mode);
    for (let attempt = 0; needsPayrollPage && attempt < 4; attempt++) {
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
    // ── recu-muet : le RATTRAPAGE d'un reçu muet, par la fiche. Le flux entier
    // vit de part et d'autre du rechargement, donc il est rendu ici — et rendu
    // SEUL, sans le « reçu du geste » que les autres modes capturent en commun.
    if (target.mode === 'recu-muet') return await runMuteFillFlow(page, target);

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
      // at the first ancestor that contains EXACTLY ONE receipt button (the
      // card); walking from the button up is wrong with ≥2 cards (a shared
      // container holds every card's text, so the first button matches for every
      // name). Le bouton est reconnu à son MARQUEUR, jamais au mot « reçu » — un
      // libellé traduit appartient à l'écran, pas au geste (voir
      // scripts/lib/e2e-receipt.mjs, et le rouge du 2026-10-14).
      clicked = await page.evaluate((name, selector) => {
        const isReceipt = (b) => b.matches(selector);
        const nameEls = [...document.querySelectorAll('*')].filter((el) =>
          el.children.length === 0 && el.textContent?.trim() === name);
        for (const nameEl of nameEls) {
          let anc = nameEl;
          for (let i = 0; i < 10 && anc; i++) {
            anc = anc.parentElement;
            if (!anc) break;
            const btns = [...anc.querySelectorAll('button')].filter(isReceipt);
            if (btns.length === 1) { btns[0].click(); return true; }
            if (btns.length > 1) break; // shared container — not the card
          }
        }
        return false;
      }, targetName, RECEIPT_BUTTON_SELECTOR);
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
    : RECEIPT_MODES.includes(mode) ? TPL_RECU : TPL_FICHE;
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
  } else if (RECEIPT_MODES.includes(mode)) {
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

  // ── La FICHE de l'élève, la même vérité dite à l'écran ────────────────────
  // Le reçu part dans les mains de la famille ; la fiche, c'est ce que l'école
  // regarde pour répondre « qu'est-ce qui reste à payer ? ». L'attendu ne se
  // CALCULE pas avec le code jugé : il vient de ce que la BASE garde
  // (`months.stored`, relu par l'API), croisé avec l'année que la fiche AFFICHE.
  // Un mois du geste qu'aucune pastille n'offrirait rendrait ce contrôle VIDE —
  // d'où le troisième contrôle, qui refuse un vert sans rien dedans.
  const strip = months.strip;
  const offered = strip ? strip.months.map((m) => m.month) : [];
  const paidOnStrip = strip ? strip.months.filter((m) => m.state === 'paid').map((m) => m.month) : [];
  const dueOnStrip = strip ? strip.months.filter((m) => m.state === 'due') : [];
  const heldInYear = (months.stored ?? []).filter((m) => offered.includes(m));

  check('la fiche offre les douze mois de l’année scolaire',
    !!strip && strip.total === 12,
    strip ? `${strip.total} pastille(s)` : 'aucune bande de mois sur la fiche');

  check('les mois du geste tombent dans l’année affichée par la fiche',
    heldInYear.length === MONTHS_TICKED.length,
    `${heldInYear.length}/${MONTHS_TICKED.length} — bande : ${offered[0] ?? 'aucun mois'} … ${offered[offered.length - 1] ?? ''}`);

  check('la fiche marque RÉGLÉS les mois que la base garde',
    !!strip && paidOnStrip.join(',') === heldInYear.join(','),
    `réglés : ${paidOnStrip.join(', ') || 'aucun'} | base : ${heldInYear.join(', ') || 'aucun'}`);

  check('la fiche laisse À RÉGLER tout le reste de l’année',
    !!strip && dueOnStrip.length === 12 - heldInYear.length
      && strip.months.every((m) => m.state === 'paid' || m.state === 'due'),
    `${dueOnStrip.length} mois à régler sur ${strip?.total ?? 0}`);

  check('la fiche écrit le compte de ses mois réglés',
    !!strip && strip.header.includes(`${heldInYear.length} mois réglés sur ${strip.total}`),
    strip ? strip.header : 'aucune bande de mois sur la fiche');

  // Octobre est le mois de la date du geste et n'a jamais été coché : la ligne
  // des restants doit donc COMMENCER par lui. C'est le pendant écran du
  // contrôle « Octobre absent du papier » ci-dessus.
  check('la fiche NOMME les mois restants, à partir du premier trou',
    !!strip && strip.lines.some((l) => l.startsWith('Reste à régler : Octobre')),
    strip ? (strip.lines[0] ?? 'aucune ligne de restants') : 'aucune bande de mois sur la fiche');
}

/**
 * Le rattrapage jugé bout à bout : ce que la fiche disait AVANT, ce que l'écran a
 * promis, ce que la base a gardé, et ce que la fiche dit APRÈS RECHARGEMENT.
 *
 * Chaque contrôle accuse une panne différente, et deux d'entre eux n'existent
 * que pour empêcher un vert VIDE :
 *
 *   • « AVANT : la fiche offrait de renseigner ce reçu » — sans ce bouton, le
 *     geste jugé n'a pas eu lieu, et tout ce qui suit porterait sur rien ;
 *   • « le mois de la DATE reste À RÉGLER » — c'est ce qui distingue les mois
 *     écrits par l'école de ceux qu'un reçu muet aurait déduits de sa date.
 */
async function checkMuteFilledPaper(pdf) {
  console.log('\n— Reçu muet : la fiche, le rattrapage, le rechargement —');
  const m = pdf.months;
  const before = m.before;
  const dateMonth = MUTE_RECEIPT_DATE.slice(0, 7); // le mois de la DATE du reçu

  // ── AVANT : la fiche disait VRAIMENT qu'elle ne savait rien de ce reçu ────
  check('AVANT : la fiche n’accordait aucun mois réglé à cet élève',
    !!before && before.total === 12 && before.months.every((c) => c.state === 'due'),
    before ? `${before.months.filter((c) => c.state === 'paid').length} réglé(s) sur ${before.total}` : 'aucune bande de mois avant le geste');
  check('AVANT : la fiche comptait ce reçu comme « sans mois déclaré »',
    !!before && before.undeclaredNote.length > 0,
    before ? (before.undeclaredNote || 'aucune note') : 'aucune bande de mois avant le geste');
  check('AVANT : la fiche offrait de renseigner ce reçu',
    m.fillOffered === 1, `${m.fillOffered} bouton(s) « Renseigner les mois »`);
  check('AVANT : le parcours de rattrapage LISTE ce reçu muet',
    !!m.backfillBefore?.present && m.backfillBefore.receipts.join(',') === m.muteReceiptId,
    m.backfillBefore?.present
      ? `reçus listés : ${m.backfillBefore.receipts.join(', ') || 'aucun'} (attendu ${m.muteReceiptId})`
      : 'aucun parcours de rattrapage sur la fiche');

  // ── LE GESTE ─────────────────────────────────────────────────────────────
  check('l’éditeur s’est ouvert sur les douze mois, l’enregistrement FERMÉ',
    m.editorMonths === 12 && m.saveClosed === true,
    `${m.editorMonths} mois, enregistrement ${m.saveClosed ? 'fermé' : 'OUVERT'}`);
  check('l’éditeur annonce la ligne que le reçu imprimera', m.screenLine === MONTHS_EXPECTED,
    `« ${m.screenLine} »`);
  check('la base garde les mois, dans l’ordre du calendrier',
    Array.isArray(m.stored) && m.stored.join(',') === MONTHS_TICKED.join(','),
    `months=${JSON.stringify(m.stored)}`);

  // ── APRÈS RECHARGEMENT : la même vérité, relue en base par l'application ─
  const strip = m.strip;
  const paid = strip ? strip.months.filter((c) => c.state === 'paid').map((c) => c.month) : [];
  const offered = strip ? strip.months.map((c) => c.month) : [];
  check('APRÈS RECHARGEMENT : la fiche marque RÉGLÉS exactement ces trois mois',
    paid.join(',') === MONTHS_TICKED.join(','),
    `réglés : ${paid.join(', ') || 'aucun'}`);
  check('APRÈS RECHARGEMENT : les mois tombent dans l’année que la fiche affiche',
    MONTHS_TICKED.every((x) => offered.includes(x)),
    `bande : ${offered[0] ?? 'aucun mois'} … ${offered[offered.length - 1] ?? ''}`);
  check(`APRÈS RECHARGEMENT : le mois de la DATE (${dateMonth}) reste À RÉGLER`,
    !!strip && strip.months.some((c) => c.month === dateMonth && c.state === 'due'),
    strip ? `${dateMonth} → ${strip.months.find((c) => c.month === dateMonth)?.state ?? 'absent'}` : 'aucune bande de mois');
  check('APRÈS RECHARGEMENT : la fiche ne compte PLUS ce reçu comme muet',
    !!strip && strip.undeclaredNote === '',
    strip ? (strip.undeclaredNote || 'aucune note « sans mois déclaré »') : 'aucune bande de mois');
  check('APRÈS RECHARGEMENT : la fiche n’offre PLUS de renseigner ce reçu',
    m.fillButtons === 0, `${m.fillButtons} bouton(s) « Renseigner les mois »`);
  check('APRÈS RECHARGEMENT : le parcours de rattrapage a DISPARU',
    !!m.backfillAfter && m.backfillAfter.present === false,
    m.backfillAfter?.present
      ? `il liste encore : ${m.backfillAfter.receipts.join(', ') || 'aucun reçu'}`
      : 'plus aucun reçu muet à rattraper');
  check('APRÈS RECHARGEMENT : la fiche écrit le compte de ses mois réglés',
    !!strip && strip.header.includes(`${MONTHS_TICKED.length} mois réglés sur ${strip.total}`),
    strip ? strip.header : 'aucune bande de mois');
  check('le solde de l’élève n’a pas bougé — des mois ne sont pas de l’argent',
    m.amountPaid === 0, `amount_paid=${m.amountPaid}`);

  // ── LE PAPIER : le reçu réimprimé, après le rechargement ─────────────────
  const reprint = monthsOnPaper(await pdfText(m.reprint.bytes.slice()));
  check('la réimpression NOMME les trois mois', reprint.names.length === 3,
    reprint.names.join(', ') || 'aucun mois nommé');
  check('la réimpression écrit le compte (liste, pas plage)', reprint.count,
    reprint.count ? '« 3 mois »' : 'absent');
  check('la réimpression ne retombe PAS sur le mois de la date', !reprint.october,
    reprint.october ? 'Octobre imprimé — les mois n’ont pas été relus' : 'aucun « Octobre »');
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
  if (mode === 'recu-muet') await checkMuteFilledPaper(pdf);
  else if (pdf.months) await checkMonthsPaper(pdf);
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