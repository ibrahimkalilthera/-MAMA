// Suite for scripts/lib/backup-manifest.mjs, scripts/lib/db-tables.mjs and the
// `--verify-only` path of scripts/restore-db.mjs.
//
// What it locks, and why each assertion exists (there was NO backup at all
// before 2026-09-13 — an error of manipulation was final):
//   • a manifest DESCRIBES its content: rows per table, content fingerprints,
//     payload fingerprint. A "backup OK" without numbers is indistinguishable
//     from an empty export, and an empty school base is a legitimate case that
//     must be READ, never assumed;
//   • verification refuses a truncated file, a manifest that doesn't describe
//     its own bytes, a missing table, an undeclared extra table;
//   • the encrypted container fails loudly on a wrong passphrase or a modified
//     byte (AES-GCM), and refuses a too-short passphrase;
//   • the table list keeps the DEPENDENCY order, because restoring out of order
//     writes rows the database rejects (students.parent_id → parents,
//     payments.student_id → students, salary_payments.staff_id → staff);
//   • `--verify-only` really touches no database: a fabricated backup directory
//     is read, judged, and a tampered one is refused BY NAME.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BACKUP_FORMAT,
  buildManifest,
  contentFingerprint,
  decryptPayload,
  encryptPayload,
  manifestHashMatches,
  payloadFingerprint,
  verifyManifest,
} from '../scripts/lib/backup-manifest.mjs';
import { BACKUP_TABLES, BUSINESS_TABLES, tablesAreSound } from '../scripts/lib/db-tables.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Un petit jeu de tables réaliste, avec des empreintes calculées comme en vrai. */
const sampleTables = () => {
  const data: Record<string, Record<string, unknown>[]> = {
    academic_years: [{ id: 'y1', year_name: '2025-2026' }],
    parents: [{ id: 'p1', full_name: 'Parent Un' }],
    students: [{ id: 's1', full_name: 'Élève Un', parent_id: 'p1' }],
  };
  return Object.entries(data).map(([name, rows]) => ({
    name,
    pk: 'id',
    rows: rows.length,
    sha256: contentFingerprint(rows),
    raw: rows,
  }));
};

const writeBackup = (dir: string, tables: ReturnType<typeof sampleTables>, { encrypt = false, passphrase = 'phrase-de-test-1234' } = {}) => {
  const payload = Buffer.from(
    JSON.stringify({ format: 1, project: 'https://example.supabase.co', tables: Object.fromEntries(tables.map((t) => [t.name, t.raw])) }),
    'utf8',
  );
  const manifest = buildManifest({
    project: 'https://example.supabase.co',
    takenAt: '2026-09-13T00:00:00.000Z',
    tables: tables.map(({ raw, ...rest }) => rest),
    encrypted: encrypt,
    payloadSha256: payloadFingerprint(payload),
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, encrypt ? 'payload.json.enc' : 'payload.json'), encrypt ? encryptPayload(payload, passphrase) : payload);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
};

describe('le manifeste décrit ce qu’il contient', () => {
  it('compte les lignes et les empreintes, table par table', () => {
    const tables = sampleTables();
    const manifest = buildManifest({ project: 'p', tables: tables.map(({ raw, ...rest }) => rest) });
    assert.equal(manifest.format, BACKUP_FORMAT);
    assert.equal(manifest.totalRows, 3);
    assert.deepEqual(manifest.tables.map((t) => t.name), ['academic_years', 'parents', 'students']);
    assert.ok(manifest.tables.every((t) => typeof t.sha256 === 'string' && t.sha256.length === 64));
    assert.ok(manifestHashMatches(manifest), 'le manifeste porte sa propre empreinte');
  });

  it('refuse un manifeste sans aucune table', () => {
    assert.throws(() => buildManifest({ tables: [] }), /aucune table/);
  });

  it('l’empreinte d’une table est stable et sensible au contenu', () => {
    const a = contentFingerprint([{ id: '1' }, { id: '2' }]);
    const b = contentFingerprint([{ id: '2' }, { id: '1' }]);
    assert.equal(contentFingerprint([{ id: '1' }, { id: '2' }]), a, 'même contenu, même empreinte');
    assert.notEqual(a, b, 'l’ORDRE des lignes compte : un réordonnancement est un autre instantané');
  });

  it('une retouche du manifeste se voit', () => {
    const manifest = buildManifest({ project: 'p', tables: sampleTables().map(({ raw, ...rest }) => rest) });
    assert.equal(manifestHashMatches({ ...manifest, totalRows: 999 }), false);
  });
});

describe('la vérification refuse ce qui ne concorde pas', () => {
  it('accepte une sauvegarde qui décrit ses propres octets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-backup-ok-'));
    try {
      const manifest = writeBackup(dir, sampleTables());
      const actual = manifest.tables.map((t) => ({ name: t.name, rows: t.rows, sha256: t.sha256 }));
      assert.deepEqual(verifyManifest(manifest, { payloadSha256: manifest.payloadSha256, tables: actual }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('signale un contenu qui ne correspond plus à son empreinte (fichier tronqué)', () => {
    const manifest = buildManifest({
      project: 'p',
      tables: sampleTables().map(({ raw, ...rest }) => rest),
      payloadSha256: payloadFingerprint(Buffer.from('les octets réellement écrits')),
    });
    const problems = verifyManifest(manifest, {
      payloadSha256: payloadFingerprint(Buffer.from('d’autres octets, plus courts')),
      tables: manifest.tables.map((t) => ({ name: t.name, rows: t.rows, sha256: t.sha256 })),
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /fichier modifié ou tronqué/);
  });

  it('signale une table annoncée mais absente, et une table non déclarée', () => {
    const manifest = buildManifest({ project: 'p', tables: sampleTables().map(({ raw, ...rest }) => rest) });
    const missing = verifyManifest(manifest, { tables: manifest.tables.slice(1) });
    assert.ok(missing.some((p) => /absente du contenu/.test(p)));
    const extra = verifyManifest(manifest, {
      tables: [...manifest.tables, { name: 'table_inconnue', rows: 1, sha256: 'x' }],
    });
    assert.ok(extra.some((p) => /non déclarée/.test(p)));
  });

  it('signale un décompte de lignes qui a changé', () => {
    const manifest = buildManifest({ project: 'p', tables: sampleTables().map(({ raw, ...rest }) => rest) });
    const problems = verifyManifest(manifest, {
      tables: manifest.tables.map((t, i) => ({ name: t.name, rows: i === 0 ? t.rows + 5 : t.rows, sha256: t.sha256 })),
    });
    assert.ok(problems.some((p) => /ligne\(s\) au lieu de/.test(p)));
  });

  it('refuse un format inconnu et un manifeste illisible', () => {
    assert.ok(verifyManifest({ format: 99, tables: [] }, {}).some((p) => /format/.test(p)));
    assert.deepEqual(verifyManifest(null, {}), ['manifeste absent ou illisible']);
  });
});

describe('le chiffrement', () => {
  it('fait l’aller-retour', () => {
    const payload = Buffer.from('{"tables":{"students":[{"id":"s1"}]}}', 'utf8');
    const sealed = encryptPayload(payload, 'phrase-de-test-1234');
    assert.equal(sealed.subarray(0, 5).toString('utf8'), 'MTFB1');
    assert.notDeepEqual(sealed, payload);
    assert.equal(decryptPayload(sealed, 'phrase-de-test-1234').toString('utf8'), payload.toString('utf8'));
  });

  it('échoue bruyamment sur un mauvais mot de passe', () => {
    const sealed = encryptPayload(Buffer.from('secret'), 'phrase-de-test-1234');
    assert.throws(() => decryptPayload(sealed, 'mauvais-mot-de-passe'), /unable to authenticate|bad decrypt|authenticate/i);
  });

  it('échoue bruyamment sur un octet modifié', () => {
    const sealed = encryptPayload(Buffer.from('secret a proteger'), 'phrase-de-test-1234');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    assert.throws(() => decryptPayload(tampered, 'phrase-de-test-1234'));
  });

  it('refuse un mot de passe trop court, et un fichier qui n’est pas une sauvegarde chiffrée', () => {
    assert.throws(() => encryptPayload(Buffer.from('x'), 'court'), /trop court/);
    assert.throws(() => decryptPayload(Buffer.from('{"tables":{}}'), 'phrase-de-test-1234'), /en-tête/);
  });
});

describe('l’inventaire des tables garde l’ordre des dépendances', () => {
  const indexOf = (name: string) => BACKUP_TABLES.findIndex((t) => t.name === name);

  it('est sain : non vide, sans doublon, chaque table a sa clé', () => {
    assert.equal(tablesAreSound(), true);
    assert.equal(tablesAreSound([]), false);
    assert.equal(tablesAreSound([{ name: 'a', pk: 'id' }, { name: 'a', pk: 'id' }]), false);
    assert.equal(tablesAreSound([{ name: 'a', pk: '' }]), false);
  });

  it('écrit les parents avant les élèves, et les élèves avant les paiements', () => {
    assert.ok(indexOf('parents') < indexOf('students'), 'students.parent_id référence parents');
    assert.ok(indexOf('students') < indexOf('payments'), 'payments.student_id référence students');
    assert.ok(indexOf('students') < indexOf('todos'), 'todos.student_id référence students');
    assert.ok(indexOf('staff') < indexOf('salary_payments'), 'salary_payments.staff_id référence staff');
  });

  it('garde les profils (dépendants d’auth.users) après les données', () => {
    assert.ok(indexOf('user_profiles') > indexOf('students'));
    assert.equal(BACKUP_TABLES.filter((t) => t.authRef).length >= 3, true, 'les tables liées à auth sont déclarées');
  });

  it('déclare la clé `key` des réglages (pas `id`)', () => {
    assert.equal(BACKUP_TABLES.find((t) => t.name === 'app_settings')?.pk, 'key');
  });

  it('liste les tables MÉTIER de l’école, celles dont une case vide est une information', () => {
    const names = BUSINESS_TABLES.map((t) => t.name);
    for (const expected of ['students', 'parents', 'staff', 'payments', 'expenses']) {
      assert.ok(names.includes(expected), `${expected} doit être suivie comme table métier`);
    }
  });
});

describe('--verify-only : on juge une sauvegarde sans toucher à aucune base', () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync(process.execPath, ['scripts/restore-db.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', VITE_SUPABASE_URL: '', ...env },
    });

  it('accepte une sauvegarde conforme (et n’a besoin d’aucun credential)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-verify-ok-'));
    try {
      writeBackup(dir, sampleTables());
      const out = run(['--from', dir, '--verify-only']);
      assert.match(out, /sauvegarde vérifiée : 3 ligne\(s\)/);
      assert.match(out, /aucune base n’a été touchée/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un contenu retouché, en nommant la table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-verify-tampered-'));
    try {
      const tables = sampleTables();
      writeBackup(dir, tables);
      // On modifie UNE ligne du contenu sans retoucher le manifeste.
      const payload = JSON.parse(readFileSync(join(dir, 'payload.json'), 'utf8'));
      payload.tables.students[0].full_name = 'Élève Modifié';
      writeFileSync(join(dir, 'payload.json'), JSON.stringify(payload));
      let failed: { status?: number; stdout?: string; stderr?: string } | null = null;
      try {
        run(['--from', dir, '--verify-only']);
      } catch (error) {
        failed = error as { status?: number; stdout?: string; stderr?: string };
      }
      assert.ok(failed, 'un contenu altéré doit faire échouer la vérification');
      assert.equal(failed?.status, 1);
      assert.match(`${failed?.stdout ?? ''}${failed?.stderr ?? ''}`, /students/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un dossier sans manifeste : un contenu qui ne dit rien ne se restaure pas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-verify-nomanifest-'));
    try {
      writeFileSync(join(dir, 'payload.json'), JSON.stringify({ tables: {} }));
      assert.throws(() => run(['--from', dir, '--verify-only']), /manifest\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--empty-first REFUSE la base partagée : aucun geste ne doit pouvoir vider l’école', () => {
    // C'est le seul drapeau de toute cette chaîne qui SUPPRIME des lignes sans
    // savoir lesquelles. Le ref de la cible est donc vérifié avant la première
    // requête : une variable d'environnement mal copiée ne peut pas transformer
    // une préparation de bac à sable en effacement de production.
    const dir = mkdtempSync(join(tmpdir(), 'mama-empty-shared-'));
    try {
      writeBackup(dir, sampleTables());
      let failed: { status?: number; stdout?: string; stderr?: string } | null = null;
      try {
        // `--allow-project-mismatch` est posé aussi : sans lui, le refus de
        // divergence (cible ≠ sauvegarde) tomberait avant l'interlock, et le test
        // prouverait autre chose que ce qu'il annonce.
        run(['--from', dir, '--empty-first', '--allow-project-mismatch'], {
          SUPABASE_URL: 'https://rpcjdohfxwukbqngbprw.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'cle-de-test',
        });
      } catch (error) {
        failed = error as { status?: number; stdout?: string; stderr?: string };
      }
      assert.equal(failed?.status, 1);
      assert.match(`${failed?.stdout ?? ''}${failed?.stderr ?? ''}`, /--empty-first refusé/);
      assert.match(`${failed?.stdout ?? ''}${failed?.stderr ?? ''}`, /rpcjdohfxwukbqngbprw/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuse un contenu chiffré sans mot de passe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mama-verify-enc-'));
    try {
      writeBackup(dir, sampleTables(), { encrypt: true });
      let failed: { status?: number; stderr?: string; stdout?: string } | null = null;
      try {
        run(['--from', dir, '--verify-only'], { BACKUP_PASSPHRASE: '' });
      } catch (error) {
        failed = error as { status?: number; stderr?: string; stdout?: string };
      }
      assert.equal(failed?.status, 1);
      assert.match(`${failed?.stdout ?? ''}${failed?.stderr ?? ''}`, /déchiffrement impossible/);
      // Et avec le bon mot de passe, le même dossier passe.
      const out = run(['--from', dir, '--verify-only'], { BACKUP_PASSPHRASE: 'phrase-de-test-1234' });
      assert.match(out, /sauvegarde vérifiée/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
