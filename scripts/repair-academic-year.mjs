#!/usr/bin/env node
/**
 * ─── Reclasser des lignes d'une année scolaire à une autre ───────────────────
 *
 *   npm run repair:academic-year -- --from 2024-2025 --to 2026-2027
 *   npm run repair:academic-year -- --from 2024-2025 --to 2026-2027 --current --yes
 *
 * Pourquoi cette commande existe : le 2026-09-13, deux littéraux se partageaient
 * la vérité de l'année scolaire. L'application s'ouvrait sur « 2026-2027 » et
 * filtrait listes et tableau de bord dessus ; le formulaire d'élève naissait en
 * « 2024-2025 » et écrivait ça. Un élève enregistré était donc **dans la base et
 * invisible** — ce qui se lit « mes données ont disparu ». Le code est corrigé
 * (une seule source : `academic_years`), mais ce qu'il a écrit est resté rangé
 * sous la mauvaise année. Ce script répare ce qu'il a laissé.
 *
 * Ce qu'il refuse, parce qu'un reclassement touche des données réelles :
 *   • un `--from` ou un `--to` manquant — l'année cible se décide, elle ne se
 *     devine pas (voir scripts/lib/year-refile.mjs) ;
 *   • une année cible absente de `academic_years` : une année doit exister avant
 *     de recevoir des lignes ;
 *   • un `--from` identique au `--to`.
 *
 * Ce qu'il fait, dans l'ordre : il **compte** les lignes de chaque table qui
 * portent l'année de départ, dit le plan, n'écrit que sur `--yes`, puis
 * **recompte** les deux années. Une mutation qui répond 200 sans rien déplacer
 * serait un faux vert ; le verdict est calculé sur les comptes d'après.
 *
 * `--current` marque aussi l'année cible comme `is_current` : c'est le drapeau
 * sur lequel l'application s'ouvre (`useAcademicYears`), donc sans lui les lignes
 * déplacées resteraient invisibles à l'ouverture. Les autres années sont
 * démarquées, la base ne peut pas en désigner deux.
 *
 * L'écriture est **idempotente** : un second passage ne trouve plus rien sous
 * `--from` et le dit, sans réécrire quoi que ce soit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BACKUP_TABLES } from './lib/db-tables.mjs';
import { projectRefOf } from './lib/shared-project.mjs';
import { refileRefusals, refileVerdict } from './lib/year-refile.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const FROM = valueOf('--from');
const TO = valueOf('--to');
const MARK_CURRENT = flag('--current');
const APPLY = flag('--yes');

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
const BASE = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
if (!BASE || !SERVICE) {
  console.error('⚠️  credentials absents (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — rien n’a été écrit.');
  process.exit(2);
}
const HDR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

/** Les années déclarées par la base — la seule liste qui fait autorité. */
async function readYears() {
  const res = await fetch(`${BASE}/rest/v1/academic_years?select=year_name,is_current&order=year_name`, { headers: HDR });
  if (!res.ok) return null;
  return await res.json();
}

/** La table porte-t-elle `academic_year` ? On le DEMANDE, on ne le suppose pas. */
async function hasYearColumn(table) {
  const res = await fetch(`${BASE}/rest/v1/${table}?select=academic_year&limit=0`, { headers: HDR });
  return res.ok;
}

/** Le nombre de lignes d'une table pour une année donnée, ou `null` si illisible. */
async function countIn(table, year) {
  const res = await fetch(
    `${BASE}/rest/v1/${table}?select=academic_year&academic_year=eq.${encodeURIComponent(year)}&limit=0`,
    { headers: { ...HDR, Prefer: 'count=exact', Range: '0-0' } },
  );
  if (!res.ok) return null;
  const declared = Number((res.headers.get('content-range') ?? '').split('/')[1]);
  return Number.isFinite(declared) ? declared : null;
}

/** Déplace les lignes d'une table de `--from` vers `--to`. Rend le nombre écrit. */
async function move(table, from, to) {
  const res = await fetch(`${BASE}/rest/v1/${table}?academic_year=eq.${encodeURIComponent(from)}`, {
    method: 'PATCH',
    headers: { ...HDR, Prefer: 'return=representation' },
    body: JSON.stringify({ academic_year: to }),
  });
  if (!res.ok) {
    console.error(`❌ ${table} : écriture refusée (HTTP ${res.status}) ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

/** Le drapeau `is_current`, écrit par nom d'année : une base ne désigne qu'un courant. */
async function markCurrent(years, target) {
  for (const row of years) {
    const res = await fetch(`${BASE}/rest/v1/academic_years?year_name=eq.${encodeURIComponent(row.year_name)}`, {
      method: 'PATCH',
      headers: { ...HDR, Prefer: 'return=minimal' },
      body: JSON.stringify({ is_current: row.year_name === target }),
    });
    if (!res.ok) {
      console.error(`❌ academic_years « ${row.year_name} » : écriture refusée (HTTP ${res.status}).`);
      return false;
    }
  }
  return true;
}

const years = await readYears();
if (!years) {
  console.error(`❌ academic_years illisible sur ${BASE} — sans roster d’années, rien ne peut être décidé.`);
  process.exit(1);
}

const refusals = refileRefusals({ from: FROM, to: TO, years });
if (refusals.length) {
  console.error(`\n❌ reclassement refusé (${refusals.length} raison(s)) :`);
  for (const r of refusals) console.error(`   • ${r}`);
  console.error('\n   Rien n’a été écrit.');
  process.exit(1);
}

console.log(`🔎 reclassement d’année — ${BASE} (${projectRefOf(BASE) ?? 'ref inconnu'})`);
console.log(`   « ${FROM} » → « ${TO} »${MARK_CURRENT ? ' · « is_current » déplacé sur la cible' : ''}`);

const tables = [];
for (const { name, label } of BACKUP_TABLES) {
  if (name === 'academic_years') continue;
  if (await hasYearColumn(name)) tables.push({ name, label });
}
console.log(`   ${tables.length} table(s) portent une année scolaire : ${tables.map((t) => t.name).join(', ')}`);

const before = new Map();
let total = 0;
for (const table of tables) {
  const count = await countIn(table.name, FROM);
  if (count === null) {
    console.error(`❌ ${table.name} : compte illisible — rien n’est écrit, un compte manquant rendrait le verdict faux.`);
    process.exit(1);
  }
  before.set(table.name, count);
  total += count;
  if (count > 0) console.log(`   ${table.label} (${table.name}) : ${count} ligne(s)`);
}

if (total === 0) {
  console.log(`\n✅ rien à reclasser : aucune ligne ne porte « ${FROM} ».`);
  console.log('   (la commande est idempotente — un second passage ne réécrit rien)');
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nℹ️  simulation : ${total} ligne(s) seraient reclassées vers « ${TO} ».`);
  console.log('   Ajoutez --yes pour écrire' + (MARK_CURRENT ? '' : ', et --current pour que l’application s’ouvre sur cette année.'));
  process.exit(0);
}

let moved = 0;
for (const table of tables) {
  const count = before.get(table.name) ?? 0;
  if (count === 0) continue;
  const written = await move(table.name, FROM, TO);
  if (written === null) process.exit(1);
  moved += written;
}
if (MARK_CURRENT && !(await markCurrent(years, TO))) process.exit(1);

let afterFrom = 0;
let afterTo = 0;
for (const table of tables) {
  const left = await countIn(table.name, FROM);
  const now = await countIn(table.name, TO);
  afterFrom += left ?? NaN;
  afterTo += now ?? NaN;
}

const problems = refileVerdict({ from: FROM, to: TO, moved, afterFrom, afterTo });
if (problems.length) {
  console.error(`\n❌ le reclassement n’est pas concluant (${problems.length} raison(s)) :`);
  for (const p of problems) console.error(`   • ${p}`);
  process.exit(1);
}

console.log(`\n✅ ${moved} ligne(s) reclassée(s) de « ${FROM} » vers « ${TO} » — recompté : 0 / ${afterTo}.`);
if (MARK_CURRENT) console.log(`   « ${TO} » est l’année sur laquelle l’application s’ouvre.`);
