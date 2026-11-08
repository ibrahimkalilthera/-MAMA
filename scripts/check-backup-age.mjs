#!/usr/bin/env node
/**
 * « La copie hors GitHub a-t-elle moins de 48 heures ? »
 *
 * Le contrôle qui manquait : une sauvegarde peut cesser de tourner (secret
 * retiré, seau supprimé, workflow désactivé) sans que personne ne l'apprenne,
 * parce que le silence d'un job quotidien ressemble au succès. Ce script LIT le
 * seau et refuse quand l'objet le plus récent est absent, illisible, dans le
 * futur, ou plus vieux que le seuil.
 *
 * Il tourne dans un workflow séparé (backup-age-watch.yml) : un run rouge y est
 * une alerte, pas une condition d'écriture — la sauvegarde du jour doit se faire
 * même si celle d'hier a été oubliée.
 *
 * Usage :
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-backup-age.mjs
 *   BACKUP_MAX_AGE_HOURS=48 (défaut)
 */
import { OFFSITE_BUCKET, OFFSITE_MAX_AGE_HOURS, ageVerdict, instantOfObjectName } from './lib/backup-offsite.mjs';

const base = String(process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const maxHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? OFFSITE_MAX_AGE_HOURS);

if (!base || !key) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent — impossible de dater la copie.');
  process.exit(2);
}


const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

const res = await fetch(`${base}/storage/v1/object/list/${OFFSITE_BUCKET}`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ prefix: '', limit: 100, sortBy: { column: 'name', order: 'desc' } }),
  signal: AbortSignal.timeout(30_000),
});

if (!res.ok) {
  const detail = await res.text();
  console.error(`❌ Lecture du seau « ${OFFSITE_BUCKET} » : HTTP ${res.status} ${detail.slice(0, 200)}`);
  console.error('   Un seau absent est une absence de sauvegarde : traitez ce rouge comme tel.');
  process.exit(1);
}

const objects = await res.json();
if (!Array.isArray(objects) || objects.length === 0) {
  const verdict = ageVerdict(null, new Date(), maxHours);
  console.error(`❌ ${verdict.message}`);
  process.exit(1);
}

const newest = objects.find((o) => instantOfObjectName(o?.name)) ?? null;
const instant = newest ? instantOfObjectName(newest.name) : null;
const verdict = ageVerdict(instant, new Date(), maxHours);

if (!verdict.ok) {
  console.error(`❌ ${verdict.message}`);
  process.exit(1);
}

console.log(`✅ Dernière copie hors GitHub : ${instant} (${verdict.ageHours?.toFixed(1)} h, seuil ${maxHours} h).`);
console.log(`   ${objects.length} objet(s) dans « ${OFFSITE_BUCKET} » (liste bornée à 100).`);
