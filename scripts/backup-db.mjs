#!/usr/bin/env node
/**
 * ─── Une sauvegarde de la base, qui dit ce qu'elle contient ──────────────────
 *
 *   npm run backup:db                                  (lit .env en local)
 *   npm run backup:db -- --encrypt --require-encryption (CI : chiffré et obligatoire)
 *   npm run backup:verify -- --from .backup/current    (relit et vérifie, sans base)
 *
 * Pourquoi ce script existe : jusqu'au 2026-09-13, ce dépôt n'avait **aucun**
 * moyen de sauvegarder la base. Une erreur de manipulation était donc défini-
 * tive, et la seule copie des données d'école vivait dans un projet Supabase
 * dont personne ne relisait l'état.
 *
 * Ce qu'il fait, et rien d'autre :
 *   • lit les tables déclarées dans `scripts/lib/db-tables.mjs` avec le rôle
 *     service (jamais avec un mot de passe de poste) ;
 *   • écrit un contenu JSON + un **manifeste** (lignes par table, empreinte du
 *     contenu par table, empreinte du fichier, projet, date) ;
 *   • **chiffre** sur demande, et **REFUSE** d'écrire en clair quand l'environ-
 *     nement l'exige (`--require-encryption`, posé par la CI) : dans un dépôt
 *     public, un dump lisible qui remonte en artefact est exactement la fuite
 *     que la veille des secrets existe pour empêcher ;
 *   • nomme ce qu'il n'a PAS pu lire : une table en échec fait échouer la
 *     sauvegarde (exit 1) — une sauvegarde partielle qui a l'air complète est
 *     pire qu'aucune sauvegarde.
 *
 * Codes de sortie : 0 OK · 1 table illisible (sauvegarde incomplète) · 2
 * indécis (credentials absents — on ne prétend pas avoir sauvegardé).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { BACKUP_TABLES, BUSINESS_TABLES, tablesAreSound } from './lib/db-tables.mjs';
import { buildManifest, contentFingerprint, encryptPayload, payloadFingerprint } from './lib/backup-manifest.mjs';
import { publishEvidence } from './lib/evidence-publisher.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const OUT_DIR = resolve(valueOf('--out', '.backup/current'));
const ENCRYPT = flag('--encrypt');
const REQUIRE_ENCRYPTION = flag('--require-encryption');
const CHUNK = 500;

/** Lit .env sans écraser une variable déjà posée (même convention que les autres scripts). */
function readEnvFile(pathname) {
  const out = {};
  if (!existsSync(pathname)) return out;
  for (const line of readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = { ...readEnvFile(join(dirname(import.meta.dirname), '.env')), ...process.env };
const pick = (...names) => names.map((n) => env[n]).find((v) => v && String(v).trim()) ?? '';
const BASE = pick('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
const SERVICE = pick('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
const PASSPHRASE = pick('BACKUP_PASSPHRASE');

if (!tablesAreSound()) {
  console.error('❌ liste de tables absente ou incohérente — une sauvegarde sans liste ne sauvegarde rien.');
  process.exit(2);
}
if (!BASE || !SERVICE) {
  console.error('⚠️  credentials absents (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — RIEN n’a été sauvegardé.');
  process.exit(2);
}
if (REQUIRE_ENCRYPTION && (!ENCRYPT || !PASSPHRASE)) {
  console.error(
    '❌ chiffrement exigé par l’environnement mais `--encrypt`/BACKUP_PASSPHRASE manquant — ' +
      'rien n’a été écrit : un dump en clair dans un dépôt public serait une fuite.',
  );
  process.exit(2);
}

const HDR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Accept: 'application/json' };

/** Le nombre de lignes annoncé par PostgREST, et les lignes elles-mêmes. */
async function readTable({ name, pk }) {
  const rows = [];
  let total = null;
  for (let from = 0; ; from += CHUNK) {
    const res = await fetch(`${BASE}/rest/v1/${name}?select=*&order=${pk}.asc`, {
      headers: { ...HDR, Range: `${from}-${from + CHUNK - 1}`, Prefer: 'count=exact' },
    });
    if (!res.ok) {
      throw new Error(`${name} : HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    }
    const declared = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    if (Number.isFinite(declared)) total = declared;
    const page = await res.json();
    rows.push(...page);
    if (page.length < CHUNK) break;
  }
  return { rows, total: total ?? rows.length };
}

const tables = {};
const manifestTables = [];
let failed = null;
for (const table of BACKUP_TABLES) {
  try {
    const { rows, total } = await readTable(table);
    tables[table.name] = rows;
    // `rows.length`, pas `rows` : le manifeste compte des LIGNES. Passer le
    // tableau donnait « 0 ligne » partout — mesuré au premier essai réel, et
    // refusé par la vérification, qui a donc bien fait son travail.
    manifestTables.push({ name: table.name, pk: table.pk, rows: rows.length, sha256: contentFingerprint(rows) });
    const empty = total === 0 ? ' (vide)' : '';
    console.log(`   ✅ ${table.name.padEnd(16)} ${String(rows.length).padStart(6)} ligne(s)${empty}`);
  } catch (error) {
    failed = `${table.name} : ${error.message}`;
    break;
  }
}

if (failed) {
  console.error(`\n❌ sauvegarde INCOMPLÈTE — ${failed}`);
  console.error('   Aucun fichier n’a été écrit : une sauvegarde partielle qui a l’air complète est un piège.');
  process.exit(1);
}

const payload = Buffer.from(JSON.stringify({ format: 1, project: BASE, tables }, null, 0), 'utf8');
const payloadSha256 = payloadFingerprint(payload);
const manifest = buildManifest({
  project: BASE,
  takenAt: new Date().toISOString(),
  tables: manifestTables,
  encrypted: ENCRYPT,
  payloadSha256,
});

mkdirSync(OUT_DIR, { recursive: true });
const payloadName = ENCRYPT ? 'payload.json.enc' : 'payload.json';
const payloadPath = join(OUT_DIR, payloadName);
writeFileSync(payloadPath, ENCRYPT ? encryptPayload(payload, PASSPHRASE) : payload);
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const businessEmpty = BUSINESS_TABLES.filter((t) => (tables[t.name] ?? []).length === 0).map((t) => t.name);
console.log(
  `\n💾 ${manifest.totalRows} ligne(s) dans ${manifestTables.length} table(s) → ${payloadPath} ` +
    `(${(readFileSync(payloadPath).length / 1024).toFixed(1)} Ko${ENCRYPT ? ', chiffré' : ', EN CLAIR'})`,
);
if (businessEmpty.length) {
  console.log(
    `   ⚠️  aucune ligne métier : ${businessEmpty.join(', ')} — la sauvegarde est valide, mais elle ne ` +
      'protège pas des données qui ne sont pas là (voir docs/BACKUP.md, « ce que la base contient »)',
  );
}

publishEvidence({
  acted: true,
  count: manifest.totalRows,
  reason:
    `sauvegarde de la base lue et écrite : ${manifest.totalRows} ligne(s) dans ${manifestTables.length} table(s), ` +
    `manifeste à empreinte vérifiable${ENCRYPT ? ', contenu chiffré' : ''}` +
    (businessEmpty.length ? `, tables métier vides : ${businessEmpty.join(', ')}` : ''),
});
