#!/usr/bin/env node
/**
 * ─── Restaurer une sauvegarde, ou seulement la RELIRE ────────────────────────
 *
 *   npm run backup:verify -- --from .backup/current        (ne touche à AUCUNE base)
 *   npm run restore:db -- --from .backup/current --dry-run (dit ce qu'il ferait)
 *   npm run restore:db -- --from .backup/current           (écrit, idempotent)
 *
 * Trois refus avant la première écriture, parce qu'une restauration est le
 * dernier endroit où l'on peut encore se tromper :
 *   1. **Le contenu ne correspond pas à son manifeste** → rien n'est écrit
 *      (fichier tronqué, retouché, mot de passe faux : le déchiffrement échoue
 *      déjà, l'empreinte tranche le reste).
 *   2. **La cible n'est pas vide** → rien n'est écrit, sauf `--force` explicite.
 *      Restaurer par-dessus une base vivante mélangerait deux états, et c'est
 *      exactement le genre de silence que ce dépôt refuse.
 *   3. **La sauvegarde vient d'un autre projet** → refus, sauf
 *      `--allow-project-mismatch` : verser la production dans un bac à sable
 *      est légitime, l'inverse doit être un geste conscient.
 *   4. **La cible n'est pas vide** → refus, sauf `--force` (lignes en conflit
 *      écrasées). Sur une cible de TRAVAIL, `--empty-first` la vide d'abord — et
 *      ce drapeau REFUSE la base partagée, par son ref : c'est le seul geste de
 *      cette chaîne qui pourrait effacer une école, donc il est verrouillé.
 *
 * L'écriture est **idempotente par construction** : insertion en
 * `resolution=merge-duplicates` sur la clé primaire, et sonde qui relit la ligne
 * par sa clé (`?<pk>=eq.<valeur>`) avant tout rejeu — un rejeu après une réponse
 * perdue ne duplique donc rien. Après restauration, les tables sont **recomptées**
 * et comparées au manifeste : une restauration qui n'a pas restauré est rouge.
 *
 * Ce que ce script ne fait PAS, et le dit : les comptes `auth.users` (mots de
 * passe bcrypt) ne sortent pas par l'API REST. Les profils dont le compte est
 * absent sont **nommés** comme non restaurés, jamais perdus en silence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { BACKUP_TABLES, restorableRows } from './lib/db-tables.mjs';
import { SHARED_PROJECT_REF, projectRefOf } from './lib/shared-project.mjs';
import { contentFingerprint, decryptPayload, payloadFingerprint, verifyManifest } from './lib/backup-manifest.mjs';
import { replayableWrite } from './lib/transient-http.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const FROM = valueOf('--from');
const VERIFY_ONLY = flag('--verify-only');
const DRY_RUN = flag('--dry-run');
const FORCE = flag('--force');
const EMPTY_FIRST = flag('--empty-first');
const ALLOW_MISMATCH = flag('--allow-project-mismatch');
const CHUNK = 500;

if (!FROM) {
  console.error('❌ --from <dossier de sauvegarde> requis (celui écrit par `npm run backup:db`).');
  process.exit(2);
}
const dir = resolve(FROM);
const manifestPath = join(dir, 'manifest.json');
const encryptedPath = join(dir, 'payload.json.enc');
const plaintextPath = join(dir, 'payload.json');
if (!existsSync(manifestPath)) {
  console.error(`❌ ${manifestPath} introuvable — un contenu sans manifeste ne dit pas ce qu'il contient.`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sourcePath = existsSync(encryptedPath) ? encryptedPath : plaintextPath;
if (!existsSync(sourcePath)) {
  console.error(`❌ ni payload.json.enc ni payload.json dans ${dir} — rien à restaurer.`);
  process.exit(2);
}

// ── 1. Déchiffrer (si nécessaire) et vérifier le manifeste ───────────────────
const raw = readFileSync(sourcePath);
let payload;
try {
  payload = encryptedPath === sourcePath ? decryptPayload(raw, process.env.BACKUP_PASSPHRASE ?? '') : raw;
} catch (error) {
  console.error(`❌ déchiffrement impossible : ${error.message}`);
  process.exit(1);
}
const payloadSha256 = payloadFingerprint(payload);
let parsed;
try {
  parsed = JSON.parse(payload.toString('utf8'));
} catch (error) {
  console.error(`❌ contenu illisible : ${error.message}`);
  process.exit(1);
}
// On juge les tables que le CONTENU déclare, pas celles du roster actuel : une
// sauvegarde d'hier doit rester vérifiable par le code d'aujourd'hui, même si
// l'inventaire a grandi depuis. Le roster ne sert qu'à l'ORDRE d'écriture.
const actualTables = Object.entries(parsed?.tables ?? {}).map(([name, rows]) => ({
  name,
  rows: Array.isArray(rows) ? rows.length : 0,
  sha256: contentFingerprint(Array.isArray(rows) ? rows : []),
}));
const problems = verifyManifest(manifest, { payloadSha256, tables: actualTables });
if (problems.length) {
  console.error(`\n❌ la sauvegarde ne correspond pas à son manifeste (${problems.length} problème(s)) :`);
  for (const p of problems) console.error(`   • ${p}`);
  console.error('\n   Rien n’a été écrit.');
  process.exit(1);
}
console.log(
  `✅ sauvegarde vérifiée : ${manifest.totalRows} ligne(s), ${manifest.tables.length} table(s), ` +
    `prise le ${manifest.takenAt} depuis ${manifest.project}`,
);

if (VERIFY_ONLY) {
  console.log('ℹ️  --verify-only : aucune base n’a été touchée.');
  process.exit(0);
}

const env = { ...readEnvFile(join(dirname(import.meta.dirname), '.env')), ...process.env };
const BASE = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
if (!BASE || !SERVICE) {
  console.error('⚠️  credentials de la cible absents — rien n’a été restauré.');
  process.exit(2);
}
if (manifest.project && manifest.project !== BASE && !ALLOW_MISMATCH) {
  console.error(
    `❌ la sauvegarde vient de « ${manifest.project} » et la cible est « ${BASE} » — ` +
      'refus (--allow-project-mismatch pour forcer, en connaissance de cause).',
  );
  process.exit(1);
}

const HDR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const countOf = async (name) => {
  const res = await fetch(`${BASE}/rest/v1/${name}?select=*&limit=0`, {
    headers: { ...HDR, Prefer: 'count=exact', Range: '0-0' },
  });
  const declared = Number((res.headers.get('content-range') ?? '').split('/')[1]);
  return Number.isFinite(declared) ? declared : null;
};

function readEnvFile(pathname) {
  const out = {};
  if (!existsSync(pathname)) return out;
  for (const line of readFileSync(pathname, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

// ── 2. Vider une cible de TRAVAIL, jamais la production ───────────────────────
// Un schéma neuf n'est jamais tout à fait vide : les migrations ensemencent des
// années scolaires et un réglage par défaut. Une preuve d'aller-retour qui
// exigerait l'égalité des comptes doit donc partir d'une cible vraiment vide —
// et c'est exactement le geste qui, mal ciblé, efface une école. D'où
// l'interlock : `--empty-first` REFUSE la base partagée, par son ref, avant la
// moindre requête. La suppression se fait dans l'ORDRE INVERSE des dépendances
// (les paiements avant les élèves) pour que les clés étrangères tiennent.
if (EMPTY_FIRST) {
  if (projectRefOf(BASE) === SHARED_PROJECT_REF) {
    console.error(
      `❌ --empty-first refusé : la cible EST la base partagée (${SHARED_PROJECT_REF}).\n` +
        '   Ce drapeau n’existe que pour préparer une cible de TRAVAIL (pile locale, bac à sable).',
    );
    process.exit(1);
  }
  let removed = 0;
  for (const table of [...BACKUP_TABLES].reverse()) {
    const res = await fetch(`${BASE}/rest/v1/${table.name}?${table.pk}=not.is.null`, {
      method: 'DELETE',
      headers: { ...HDR, Prefer: 'return=representation' },
    });
    if (!(res.status < 300)) {
      console.error(`❌ ${table.name} : vidage refusé (HTTP ${res.status}) ${(await res.text()).slice(0, 160)}`);
      process.exit(1);
    }
    const deleted = await res.json().catch(() => []);
    removed += Array.isArray(deleted) ? deleted.length : 0;
  }
  console.log(`🧹 cible de travail vidée : ${removed} ligne(s) supprimée(s) dans ${BACKUP_TABLES.length} table(s).`);
}

// ── 3. La cible est-elle vide ? ──────────────────────────────────────────────
const occupied = [];
for (const table of BACKUP_TABLES) {
  const n = await countOf(table.name);
  if (n) occupied.push(`${table.name}=${n}`);
}
if (occupied.length && !FORCE && !DRY_RUN) {
  console.error(
    `\n❌ la cible n’est PAS vide (${occupied.join(', ')}) — refus de restaurer par-dessus.\n` +
      '   Videz-la d’abord, ou passez --force en sachant que les lignes en conflit seront ÉCRASÉES.',
  );
  process.exit(1);
}
if (occupied.length) console.log(`ℹ️  cible déjà peuplée : ${occupied.join(', ')}`);

// ── 4. Restaurer, table par table, dans l'ordre des dépendances ──────────────
const authUsers = new Set();
{
  const res = await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, { headers: HDR });
  const body = res.ok ? await res.json() : { users: [] };
  for (const u of body.users ?? []) authUsers.add(u.id);
}

let written = 0;
let skippedForAuth = 0;
for (const table of BACKUP_TABLES) {
  const rows = parsed?.tables?.[table.name] ?? [];
  if (!rows.length) continue;
  // La règle vient de l'inventaire (`restorableRows`) : l'écriture et le
  // recomptage en dessous lisent le MÊME exemplaire, donc ils ne peuvent plus
  // diverger sur ce qu'une cible peut accueillir.
  const usable = restorableRows(table, rows, authUsers);
  skippedForAuth += rows.length - usable.length;
  if (DRY_RUN) {
    console.log(`   · ${table.name.padEnd(16)} ${usable.length} ligne(s) seraient écrites`);
    continue;
  }
  for (let i = 0; i < usable.length; i += CHUNK) {
    const chunk = usable.slice(i, i + CHUNK);
    const key = table.pk === 'key' ? chunk[0]?.key : chunk[0]?.id;
    const outcome = await replayableWrite(
      async () => {
        const res = await fetch(`${BASE}/rest/v1/${table.name}?on_conflict=${table.pk}`, {
          method: 'POST',
          headers: { ...HDR, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
        });
        return { status: res.status, body: { text: (await res.text()).slice(0, 160) } };
      },
      async () => {
        // Sonde de réconciliation : la ligne existe-t-elle déjà, sous SA clé ?
        const res = await fetch(
          `${BASE}/rest/v1/${table.name}?select=${table.pk}&${table.pk}=eq.${encodeURIComponent(key)}&limit=1`,
          { headers: HDR },
        );
        if (!res.ok) return null;
        const found = await res.json();
        return found.length ? { status: 200, body: { text: 'déjà présente' } } : null;
      },
      { label: `POST /rest/v1/${table.name} — `, log: (m) => console.log(`  ↻ ${m}`) },
    );
    if (!(outcome.status < 300)) {
      console.error(`❌ ${table.name} : écriture refusée (HTTP ${outcome.status}) ${outcome.body?.text ?? ''}`);
      process.exit(1);
    }
    written += chunk.length;
  }
  console.log(`   ✅ ${table.name.padEnd(16)} ${usable.length} ligne(s)${DRY_RUN ? ' (à écrire)' : ''}`);
}
if (skippedForAuth) {
  console.log(
    `   ➖ ${skippedForAuth} ligne(s) non restaurée(s) : leur compte ` +
      '`auth.users` n’existe pas dans la cible (les mots de passe ne voyagent pas par l’API REST — ' +
      'voir docs/BACKUP.md)',
  );
}
if (DRY_RUN) {
  console.log('\nℹ️  --dry-run : rien n’a été écrit.');
  process.exit(0);
}

// ── 5. Recompter : une restauration qui n'a pas restauré est rouge ───────────
const mismatches = [];
for (const table of BACKUP_TABLES) {
  // Le MÊME ensemble qu'à l'écriture : une ligne que la cible ne peut pas
  // accueillir (compte `auth.users` absent) ne peut pas non plus manquer.
  const expected = restorableRows(table, parsed?.tables?.[table.name] ?? [], authUsers).length;
  if (!expected) continue;
  const actual = await countOf(table.name);
  if (actual !== null && actual < expected) mismatches.push(`${table.name}: ${actual} < ${expected}`);
}
if (mismatches.length) {
  console.error(`\n❌ restauration incomplète : ${mismatches.join(', ')}`);
  process.exit(1);
}
console.log(`\n✅ restauration terminée : ${written} ligne(s) écrites, recomptées dans la cible.`);
