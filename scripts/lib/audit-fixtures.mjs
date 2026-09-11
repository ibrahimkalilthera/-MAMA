// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/audit-fixtures.mjs — hermetic fixture backend for the theme
// contrast audit.
//
// Why this exists: the audit used to need a real account. Locally it created an
// ephemeral admin with the SERVICE-ROLE key and deleted it afterwards; in CI it
// read AUDIT_EMAIL/AUDIT_PASSWORD. A run triggered by Dependabot — like a fork
// PR — receives no repository secret at all, so the account could not be
// created and the gate aborted at startup with a red that said nothing about
// contrast, precisely on the PRs most likely to break it (icon/Tailwind bumps).
//
// This module removes the requirement instead of working around it. Puppeteer
// intercepts every request aimed at FIXTURE_URL and answers it here, including
// the password grant: the audit types the fixture credentials into the real
// login form, supabase-js posts them, gets a session back and stores it itself.
// So the login path is genuinely exercised, no secret is read, Supabase is
// never contacted, and the data is byte-identical on every run.
//
// Determinism is the point, not a side effect: a colour gate must not change
// its coverage because someone happened to add a student that morning.
//
// Interception is deliberately LOUD: any request to the fixture host this
// module does not know about is answered with a 501 AND recorded, so the audit
// fails at the end listing it. A new table added to the app can therefore never
// silently render as "empty data, fewer texts scanned, still green".
// ─────────────────────────────────────────────────────────────────────────────

/** Host the audited build is pointed at. NOT a real domain — and it must stay
 *  that way: an un-intercepted request can only ever fail, never reach prod. */
export const FIXTURE_URL = 'https://audit-fixtures.invalid';
/** Public-by-design placeholder key; the fixture host validates nothing. */
export const FIXTURE_ANON_KEY = 'audit-fixtures-anon-key';
/** Reserved mailbox domain (RFC 2606-style) — no real account can own it. */
export const FIXTURE_EMAIL = 'contrast-audit@audit.local';
export const FIXTURE_PASSWORD = 'Contrast-Fixture-2026';

const USER_ID = 'f1c7b000-0000-4000-8000-00000000a001';
const PARENT_ID_A = 'f1c7b000-0000-4000-8000-00000000b001';
const PARENT_ID_B = 'f1c7b000-0000-4000-8000-00000000b002';

/** The account the audit logs in as (admin: the shell renders every nav item). */
export const FIXTURE_USER = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: FIXTURE_EMAIL,
  email_confirmed_at: '2026-01-05T08:00:00Z',
  phone: '',
  confirmed_at: '2026-01-05T08:00:00Z',
  last_sign_in_at: '2026-09-11T07:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Audit Contraste', role: 'admin' },
  identities: [],
  created_at: '2026-01-05T08:00:00Z',
  updated_at: '2026-09-11T07:00:00Z',
};

/** Row of `user_profiles` — the role gate for every admin surface. */
export const FIXTURE_PROFILE = {
  id: USER_ID,
  email: FIXTURE_EMAIL,
  full_name: 'Audit Contraste',
  role: 'admin',
  created_at: '2026-01-05T08:00:00Z',
};

/** A session as GoTrue would mint it (expiry far enough that no refresh runs). */
export const fixtureSession = (now = Date.now()) => ({
  access_token: 'fixture-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(now / 1000) + 3600,
  refresh_token: 'fixture-refresh-token',
  user: FIXTURE_USER,
});

// Fixed dates: the audit compares colours, and a due date in the past keeps the
// "relance parent" surface (overdue balance) reachable on any future run.
const DUE_PAST = '2026-02-10';

// ── Tables ───────────────────────────────────────────────────────────────────
// Shaped from the row mappers in src/lib/rowMappers.ts and the Row types in
// src/lib/database.types.ts. Volumes are chosen so every audited surface has
// real content: rows in Élèves/Parents/Paie/Dépenses, an overdue student (the
// relance trigger), a staff member (the three Paie CTAs), audit log entries and
// a calendar note.

/** @type {Record<string, Array<Record<string, unknown>>>} */
export const FIXTURE_TABLES = {
  parents: [
    {
      id: PARENT_ID_A,
      full_name: 'Aïssata Traoré',
      phones: ['+223 70 00 00 01'],
      email: 'aissata.traore@example.test',
      address: 'Badalabougou, Bamako',
      occupation: 'Commerçante',
      relationship: 'Mère',
      notes: 'Paie en deux fois.',
    },
    {
      id: PARENT_ID_B,
      full_name: 'Moussa Keïta',
      phones: ['+223 70 00 00 02'],
      email: 'moussa.keita@example.test',
      address: 'Hamdallaye, Bamako',
      occupation: 'Enseignant',
      relationship: 'Père',
      notes: '',
    },
  ],
  students: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000c001',
      student_id: 'MT-2026-0001',
      parent_id: PARENT_ID_A,
      name: 'Fatoumata Traoré',
      parent_name: 'Aïssata Traoré',
      parent_email: 'aissata.traore@example.test',
      parent_phone: '+223 70 00 00 01',
      total_due: 450000,
      amount_paid: 150000,
      scholarship_discount: 0,
      due_date: DUE_PAST,
      last_payment_date: '2026-01-20',
      notes: 'Doit régler le solde avant les compositions.',
      last_note_date: '2026-02-01',
      note_entries: [
        { date: '2026-02-01', text: 'Rappel envoyé à la mère.', author: 'Audit Contraste' },
      ],
      flagged: false,
      academic_year: '2025-2026',
      grade: '10ème Année',
      photo: null,
      emergency_contact_name: 'Moussa Keïta',
      emergency_contact_relation: 'Oncle',
      emergency_contact_phone: '+223 70 00 00 02',
      medical_notes: '',
      enrollment_date: '2025-09-15',
      previous_school: 'École Les Palmiers',
      status: 'Active',
      created_at: '2025-09-15T08:00:00Z',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000c002',
      student_id: 'MT-2026-0002',
      parent_id: PARENT_ID_B,
      name: 'Ibrahim Keïta',
      parent_name: 'Moussa Keïta',
      parent_email: 'moussa.keita@example.test',
      parent_phone: '+223 70 00 00 02',
      total_due: 300000,
      amount_paid: 300000,
      scholarship_discount: 0,
      due_date: '2026-10-10',
      last_payment_date: '2026-09-01',
      notes: '',
      last_note_date: null,
      note_entries: [],
      flagged: true,
      academic_year: '2025-2026',
      grade: '9ème Année',
      photo: null,
      emergency_contact_name: 'Aïssata Traoré',
      emergency_contact_relation: 'Tante',
      emergency_contact_phone: '+223 70 00 00 01',
      medical_notes: '',
      enrollment_date: '2025-09-16',
      previous_school: '',
      status: 'Active',
      created_at: '2025-09-16T08:00:00Z',
    },
  ],
  payments: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000d001',
      student_id: 'f1c7b000-0000-4000-8000-00000000c001',
      date: '2026-01-20',
      amount: 150000,
      academic_year: '2025-2026',
      receipt_number: 'REC-2026-0001',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000d002',
      student_id: 'f1c7b000-0000-4000-8000-00000000c002',
      date: '2026-09-01',
      amount: 300000,
      academic_year: '2025-2026',
      receipt_number: 'REC-2026-0002',
    },
  ],
  staff: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000e001',
      name: 'Oumar Diallo',
      position: 'Centre Technique',
      salary: 185000,
      email: 'oumar.diallo@example.test',
      phone: '+223 76 00 00 01',
      bank_details: 'BOA ML-0001',
      emergency_contact: 'Fatoumata Diallo +223 76 00 00 02',
      academic_year: '2025-2026',
      inps_number: 'INPS-0001',
      hire_date: '2021-10-01',
      family_status: 'married',
      children_count: 3,
      travel_allowance: 15000,
      communication_allowance: 10000,
      housing_allowance: 25000,
      created_at: '2021-10-01T08:00:00Z',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000e002',
      name: 'Kadiatou Sylla',
      position: 'Enseignante',
      salary: 165000,
      email: 'kadiatou.sylla@example.test',
      phone: '+223 76 00 00 03',
      bank_details: 'BDM ML-0002',
      emergency_contact: 'Seydou Sylla +223 76 00 00 04',
      academic_year: '2025-2026',
      inps_number: 'INPS-0002',
      hire_date: '2022-09-01',
      family_status: 'single',
      children_count: 0,
      travel_allowance: 15000,
      communication_allowance: 10000,
      housing_allowance: 0,
      created_at: '2022-09-01T08:00:00Z',
    },
  ],
  salary_payments: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000f001',
      staff_id: 'f1c7b000-0000-4000-8000-00000000e001',
      amount: 235000,
      date: '2026-08-28',
      academic_year: '2025-2026',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000f002',
      staff_id: 'f1c7b000-0000-4000-8000-00000000e002',
      amount: 190000,
      date: '2026-08-28',
      academic_year: '2025-2026',
    },
  ],
  expenses: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a101',
      category: 'Fournitures',
      description: 'Craies et cahiers — 1er trimestre',
      amount: 85000,
      date: '2026-08-30',
      academic_year: '2025-2026',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000a102',
      category: 'Entretien',
      description: 'Réparation du portail',
      amount: 120000,
      date: '2026-09-02',
      academic_year: '2025-2026',
    },
  ],
  vendor_expenses: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a201',
      vendor_name: 'Librairie du Fleuve',
      category: 'Fournitures',
      amount: 240000,
      due_date: '2026-09-20',
      payment_status: 'pending',
      amount_paid: 0,
      description: 'Manuels de mathématiques',
      academic_year: '2025-2026',
      aid_type: null,
      beneficiary_student_name: null,
      beneficiary_student_grade: null,
      created_at: '2026-09-02T08:00:00Z',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000a202',
      vendor_name: 'Bamako Électricité',
      category: 'Travaux',
      amount: 310000,
      due_date: '2026-09-05',
      payment_status: 'paid',
      amount_paid: 310000,
      description: 'Mise aux normes du tableau',
      academic_year: '2025-2026',
      aid_type: 'scholarship',
      beneficiary_student_name: 'Fatoumata Traoré',
      beneficiary_student_grade: '10ème Année',
      created_at: '2026-08-20T08:00:00Z',
    },
  ],
  todos: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a301',
      text: 'Relancer les parents en retard de paiement',
      completed: false,
      student_id: null,
      due_date: '2026-09-15',
      created_at: '2026-09-01T08:00:00Z',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000a302',
      text: 'Valider la paie de septembre',
      completed: true,
      student_id: null,
      due_date: '2026-09-05',
      created_at: '2026-08-28T08:00:00Z',
    },
  ],
  custom_classes: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a401',
      code: 'CM2-B',
      cycle: 'cycle2',
      year: '2025-2026',
      section: 'B',
      name_fr: 'CM2 B',
      name_en: 'CM2 B',
      created_at: '2025-09-01T08:00:00Z',
    },
  ],
  user_profiles: [FIXTURE_PROFILE],
  audit_logs: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a501',
      user_id: USER_ID,
      user_email: FIXTURE_EMAIL,
      user_name: 'Audit Contraste',
      user_role: 'admin',
      action: 'update',
      target_type: 'students',
      target_id: 'f1c7b000-0000-4000-8000-00000000c001',
      details: 'Solde mis à jour',
      created_at: '2026-09-10T09:12:00Z',
    },
    {
      id: 'f1c7b000-0000-4000-8000-00000000a502',
      user_id: USER_ID,
      user_email: FIXTURE_EMAIL,
      user_name: 'Audit Contraste',
      user_role: 'admin',
      action: 'create',
      target_type: 'payments',
      target_id: 'f1c7b000-0000-4000-8000-00000000d002',
      details: 'Encaissement de scolarité',
      created_at: '2026-09-01T08:30:00Z',
    },
  ],
  calendar_notes: [
    {
      id: 'f1c7b000-0000-4000-8000-00000000a601',
      note_date: '2026-09-15',
      text: 'Conseil de classe — 15 h',
      created_by: USER_ID,
      created_at: '2026-09-05T08:00:00Z',
    },
  ],
  app_settings: [
    {
      key: 'inactivity_logout_minutes',
      value: 30,
      updated_by: USER_ID,
      updated_at: '2026-09-01T08:00:00Z',
    },
  ],
};

/** Every table the fixture backend can serve (used by the coverage test). */
export const FIXTURE_TABLE_NAMES = Object.keys(FIXTURE_TABLES);

// ── Routing ──────────────────────────────────────────────────────────────────

const json = (status, body) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body ?? null),
});

/**
 * Answer one intercepted request aimed at the fixture host. Pure on purpose:
 * the audit's request handler stays a thin wrapper, so the whole backend is
 * unit-testable without a browser.
 *
 * @param {{ method?: string, pathname: string, search?: string, accept?: string }} req
 * @returns {{ status: number, contentType: string, body: string }}
 */
export function fixtureRoute(req) {
  const method = (req.method || 'GET').toUpperCase();
  const path = req.pathname || '/';
  const accept = req.accept || '';
  // PostgREST returns a bare object (not an array) for `.single()` — the client
  // asks for it through this Accept value and errors on any other shape.
  const wantsObject = accept.includes('application/vnd.pgrst.object+json');

  if (path.startsWith('/auth/v1/token')) {
    // The grant is read from the body for refresh, but both grants mint the
    // same fixture session: the audit never needs a refresh (expiry is +1 h).
    return json(200, fixtureSession());
  }
  if (path.startsWith('/auth/v1/user')) return json(200, FIXTURE_USER);
  if (path.startsWith('/auth/v1/logout')) return json(204, null);
  if (path.startsWith('/auth/v1/')) return json(200, {});
  if (path.startsWith('/rest/v1/rpc/')) return json(200, true);
  if (path.startsWith('/rest/v1/')) {
    const table = decodeURIComponent(path.slice('/rest/v1/'.length).split('/')[0]);
    const rows = FIXTURE_TABLES[table];
    if (!rows) return json(501, { fixture: 'unknown-table', table });
    if (method === 'GET' || method === 'HEAD') {
      // Filters and ordering are intentionally ignored: the dataset is tiny and
      // already ordered the way each view expects (ascending by created_at /
      // date), so honoring them would add parsing for no fidelity gain.
      if (wantsObject) return json(rows.length ? 200 : 406, rows[0] ?? null);
      return json(200, rows);
    }
    // Writes: acknowledged, never persisted (the audit only reads; a stray
    // click must not derail coverage with a network error).
    if (method === 'POST') return json(201, wantsObject ? rows[0] : rows.slice(0, 1));
    return json(204, null);
  }
  return json(501, { fixture: 'unrouted', path, method });
}

/**
 * True when the URL belongs to the fixture backend. Kept next to the router so
 * the audit never has to re-derive the host rule.
 * @param {string} url
 */
export const isFixtureUrl = (url) => {
  try {
    return new URL(url).hostname === new URL(FIXTURE_URL).hostname;
  } catch {
    return false;
  }
};
