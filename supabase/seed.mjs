/**
 * Seed script - Populates the Supabase database with demo/test data.
 * This is designed for STAGING/DEVELOPMENT use only.
 * For production, use seed-production.mjs instead.
 * 
 * Run with: node --env-file=.env supabase/seed.mjs
 * Clean:    node --env-file=.env supabase/seed.mjs --clean
 * 
 * Flags:
 *   --clean   Delete all existing data before seeding (with confirmation)
 *   --force   Skip the confirmation prompt for --clean
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const API = `${SUPABASE_URL}/rest/v1`;
const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const args = process.argv.slice(2);
const shouldClean = args.includes('--clean');
const forceClean = args.includes('--force');

async function post(table, rows) {
  const res = await fetch(`${API}/${table}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /${table} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function deleteAll(table) {
  // Delete all rows by matching all (created_at is not null)
  const res = await fetch(`${API}/${table}?created_at=not.is.null`, {
    method: 'DELETE',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE /${table} failed (${res.status}): ${text}`);
  }
}

async function confirmClean() {
  if (forceClean) return true;
  
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  return new Promise((resolve) => {
    rl.question('\n⚠️  WARNING: --clean will DELETE ALL data in the database.\n   Type "yes" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  console.log('🌱 MAMA THERA — Staging/Dev Database Seeder\n');

  // Handle --clean flag
  if (shouldClean) {
    const confirmed = await confirmClean();
    if (!confirmed) {
      console.log('❌ Clean cancelled. No changes made.');
      process.exit(0);
    }
    
    console.log('🧹 Cleaning database...');
    // Delete in reverse dependency order
    const tables = ['todos', 'vendor_expenses', 'expenses', 'salary_payments', 'payments', 'students', 'staff', 'parents'];
    for (const table of tables) {
      await deleteAll(table);
      console.log(`    ✅ ${table} cleared`);
    }
    console.log('');
  }

  console.log('Seeding database...\n');

  // 1. Parents
  console.log('  → Parents...');
  const parents = await post('parents', [
    { full_name: 'Robert Johnson', phones: ['+1 (555) 123-4567', '+223 76 11 22 33'], email: 'robert.j@example.com', address: 'Avenue de la Nation, Hippodrome, Bamako', occupation: 'Civil Engineer (BTP)', relationship: 'Father', notes: 'Primary family contact for Alice Johnson.' },
    { full_name: 'Mary Smith', phones: ['+1 (555) 234-5678', '+223 65 44 33 22'], email: 'mary.smith@example.com', address: 'Rue 14, ACI 2000, Bamako', occupation: 'Chief Pharmacist', relationship: 'Mother', notes: 'Mother of Bob Smith & David Smith.' },
    { full_name: 'Lucy Brown', phones: ['+1 (555) 345-6789'], email: 'lucy.b@example.com', address: 'Sébénikoro, Bamako', occupation: 'Senior Architect', relationship: 'Mother', notes: 'Prefers WhatsApp notifications.' },
    { full_name: 'Hippolyta Prince', phones: ['+1 (555) 456-7890', '+223 70 99 88 77'], email: 'queen.h@example.com', address: 'Cité du Niger, Badalabougou, Bamako', occupation: 'Diplomat', relationship: 'Guardian', notes: 'Legal guardian for Diana Prince.' },
    { full_name: 'Sarah Peters', phones: ['+1 (555) 567-8901'], email: 'sarah.p@example.com', address: 'Baco Djicoroni, Bamako', occupation: 'Bank Executive', relationship: 'Mother', notes: 'Requested receipt copies sent via email.' },
    { full_name: 'Frank Gallagher', phones: ['+1 (555) 678-9012'], email: 'frank.g@example.com', address: 'Kalaban Coura, Bamako', occupation: 'Entrepreneur', relationship: 'Father', notes: 'Follow-up needed for fee installments.' },
  ]);
  console.log(`    ✅ ${parents.length} parents created`);

  // Map parent names to IDs for student linking
  const parentMap = {};
  parents.forEach(p => { parentMap[p.full_name] = p.id; });

  // 2. Students
  console.log('  → Students...');
  const studentsData = [
    { student_id: 'STU-2024-001', parent_id: parentMap['Robert Johnson'], name: 'Alice Johnson', parent_name: 'Robert Johnson', parent_email: 'robert.j@example.com', parent_phone: '+1 (555) 123-4567', total_due: 500000, amount_paid: 500000, due_date: '2024-01-15', last_payment_date: '2024-03-05', notes: '', grade: '4A' },
    { student_id: 'STU-2024-002', parent_id: parentMap['Mary Smith'], name: 'Bob Smith', parent_name: 'Mary Smith', parent_email: 'mary.smith@example.com', parent_phone: '+1 (555) 234-5678', total_due: 500000, amount_paid: 250000, due_date: '2024-02-10', last_payment_date: '2024-03-02', notes: 'Promised to pay the rest by next week.', grade: '5A' },
    { student_id: 'STU-2024-007', parent_id: parentMap['Mary Smith'], name: 'David Smith', parent_name: 'Mary Smith', parent_email: 'mary.smith@example.com', parent_phone: '+1 (555) 234-5678', total_due: 500000, amount_paid: 500000, due_date: '2024-01-20', last_payment_date: '2024-02-01', notes: 'Brother of Bob Smith.', grade: '2A' },
    { student_id: 'STU-2024-003', parent_id: parentMap['Lucy Brown'], name: 'Charlie Brown', parent_name: 'Lucy Brown', parent_email: 'lucy.b@example.com', parent_phone: '+1 (555) 345-6789', total_due: 500000, amount_paid: 100000, due_date: '2024-03-01', last_payment_date: '2024-02-15', notes: '', grade: '3A' },
    { student_id: 'STU-2024-004', parent_id: parentMap['Hippolyta Prince'], name: 'Diana Prince', parent_name: 'Hippolyta Prince', parent_email: 'queen.h@example.com', parent_phone: '+1 (555) 456-7890', total_due: 500000, amount_paid: 0, due_date: '2024-03-10', last_payment_date: null, notes: '', grade: '6A' },
    { student_id: 'STU-2024-005', parent_id: parentMap['Sarah Peters'], name: 'Evan Peters', parent_name: 'Sarah Peters', parent_email: 'sarah.p@example.com', parent_phone: '+1 (555) 567-8901', total_due: 500000, amount_paid: 500000, due_date: '2024-01-20', last_payment_date: '2024-03-12', notes: '', grade: '4A' },
    { student_id: 'STU-2024-006', parent_id: parentMap['Frank Gallagher'], name: 'Fiona Gallagher', parent_name: 'Frank Gallagher', parent_email: 'frank.g@example.com', parent_phone: '+1 (555) 678-9012', total_due: 500000, amount_paid: 450000, due_date: '2024-03-05', last_payment_date: '2024-03-10', notes: '', grade: '5A' },
  ];
  const students = await post('students', studentsData);
  console.log(`    ✅ ${students.length} students created`);

  // Map student names to IDs for payment linking
  const studentMap = {};
  students.forEach(s => { studentMap[s.student_id || s.name] = s.id; });

  // 3. Payments
  console.log('  → Payments...');
  const paymentsData = [
    { student_id: studentMap['STU-2024-001'], date: '2024-03-05', amount: 500000, receipt_number: 'REC-2024-001' },
    { student_id: studentMap['STU-2024-002'], date: '2024-03-02', amount: 250000, receipt_number: 'REC-2024-002' },
    { student_id: studentMap['STU-2024-007'], date: '2024-02-01', amount: 500000, receipt_number: 'REC-2024-007' },
    { student_id: studentMap['STU-2024-003'], date: '2024-02-15', amount: 100000, receipt_number: 'REC-2024-003' },
    { student_id: studentMap['STU-2024-005'], date: '2024-03-12', amount: 500000, receipt_number: 'REC-2024-005' },
    { student_id: studentMap['STU-2024-006'], date: '2024-03-10', amount: 450000, receipt_number: 'REC-2024-006' },
  ];
  const payments = await post('payments', paymentsData);
  console.log(`    ✅ ${payments.length} payments created`);

  // 4. Staff
  console.log('  → Staff...');
  const staffData = [
    { name: 'Jean Dupont', position: 'Principal', salary: 450000, email: 'j.dupont@school.com', phone: '+223 70 00 00 01', bank_details: 'RIB: ML01 00001 00000000001 01', emergency_contact: 'Wife: +223 60 00 00 01' },
    { name: 'Marie Koné', position: 'Teacher', salary: 250000, email: 'm.kone@school.com', phone: '+223 70 00 00 02', bank_details: 'RIB: ML01 00001 00000000002 02', emergency_contact: 'Brother: +223 60 00 00 02' },
    { name: 'Oumar Traoré', position: 'Accountant', salary: 300000, email: 'o.traore@school.com', phone: '+223 70 00 00 03', bank_details: 'RIB: ML01 00001 00000000003 03', emergency_contact: 'Sister: +223 60 00 00 03' },
  ];
  const staffRows = await post('staff', staffData);
  console.log(`    ✅ ${staffRows.length} staff created`);

  const staffMap = {};
  staffRows.forEach(s => { staffMap[s.name] = s.id; });

  // 5. Salary Payments
  console.log('  → Salary payments...');
  const year = new Date().getFullYear();
  const salaryData = [
    { staff_id: staffMap['Jean Dupont'], amount: 450000, date: `${year}-01-28`, academic_year: '2025-2026' },
    { staff_id: staffMap['Marie Koné'], amount: 250000, date: `${year}-01-28`, academic_year: '2025-2026' },
    { staff_id: staffMap['Oumar Traoré'], amount: 300000, date: `${year}-01-28`, academic_year: '2025-2026' },
    { staff_id: staffMap['Jean Dupont'], amount: 450000, date: `${year}-02-27`, academic_year: '2025-2026' },
    { staff_id: staffMap['Marie Koné'], amount: 250000, date: `${year}-02-27`, academic_year: '2025-2026' },
    { staff_id: staffMap['Oumar Traoré'], amount: 300000, date: `${year}-02-27`, academic_year: '2025-2026' },
  ];
  const salaries = await post('salary_payments', salaryData);
  console.log(`    ✅ ${salaries.length} salary payments created`);

  // 6. Expenses
  console.log('  → Expenses...');
  const expData = [
    { category: 'Utilities', description: 'Electricity Bill', amount: 45000, date: '2024-03-01' },
    { category: 'Supplies', description: 'Whiteboard Markers', amount: 12000, date: '2024-03-05' },
  ];
  const expRows = await post('expenses', expData);
  console.log(`    ✅ ${expRows.length} expenses created`);

  // 7. Vendor Expenses
  console.log('  → Vendor expenses...');
  const vendorData = [
    { vendor_name: 'SENELEC', category: 'electricity', amount: 85000, due_date: '2026-07-20', payment_status: 'unpaid', amount_paid: 0, description: 'Electric bill July', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: 'SONES / SDE', category: 'water', amount: 24000, due_date: '2026-07-10', payment_status: 'unpaid', amount_paid: 0, description: 'Water bill July (Overdue)', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: 'Orange Mali', category: 'internet', amount: 55000, due_date: '2026-07-15', payment_status: 'partial', amount_paid: 25000, description: 'Monthly Fibre Internet', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: 'Papeterie Dakar', category: 'stationery', amount: 120000, due_date: '2026-07-05', payment_status: 'paid', amount_paid: 120000, description: 'Classroom notebooks and pens', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: 'Mobilier Design', category: 'furniture', amount: 450000, due_date: '2026-07-25', payment_status: 'unpaid', amount_paid: 0, description: 'New teacher desks', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: 'ProNet Nettoyage', category: 'cleaning', amount: 60000, due_date: '2026-07-12', payment_status: 'paid', amount_paid: 60000, description: 'Weekly campus disinfection', aid_type: null, beneficiary_student_name: null, beneficiary_student_grade: null },
    { vendor_name: "L'Enseignement Solidaire Mali", category: 'social_cases', amount: 150000, due_date: '2026-07-14', payment_status: 'paid', amount_paid: 150000, description: 'Prise en charge de scolarité pour cas social urgent', aid_type: 'prise_en_charge', beneficiary_student_name: 'Fatoumata Diallo', beneficiary_student_grade: '6A' },
  ];
  const vendorRows = await post('vendor_expenses', vendorData);
  console.log(`    ✅ ${vendorRows.length} vendor expenses created`);

  // 8. Todos
  console.log('  → Todos...');
  const todoData = [
    { text: 'Call Robert Johnson about balance', completed: false },
    { text: 'Update tuition for Diana Prince', completed: true },
  ];
  const todoRows = await post('todos', todoData);
  console.log(`    ✅ ${todoRows.length} todos created`);

  console.log('\n🎉 Database seeded successfully!');
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
