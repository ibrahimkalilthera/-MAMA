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
 *
 * Sur un POSTE, `SUPABASE_URL` n'existe pas : le `.env` d'une station ne porte
 * que les variables du client (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) et
 * la clé de service. Lire aussi `VITE_SUPABASE_URL` fait de ce contrôle une
 * mesure que le guichet peut lancer lui-même — et c'est ce qui a permis, le
 * 2026-11-08, de CONSTATER que le seau ne contenait aucune copie au lieu de le
 * supposer depuis un commentaire.
 */
import {
  OFFSITE_BUCKET,
  OFFSITE_MAX_AGE_HOURS,
  ageVerdict,
  copyStampOf,
  instantOfObjectName,
  isCopyManifest,
} from './lib/backup-offsite.mjs';

const base = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const maxHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? OFFSITE_MAX_AGE_HOURS);

if (!base || !key) {
  console.error('❌ SUPABASE_URL (ou VITE_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY sont absents — impossible de dater la copie.');
  process.exit(2);
}


const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

/** Une lecture du seau, préfixe par préfixe : `null` quand l'API refuse. */
async function listPrefix(prefix) {
  const res = await fetch(`${base}/storage/v1/object/list/${OFFSITE_BUCKET}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefix, limit: 100, sortBy: { column: 'name', order: 'desc' } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`❌ Lecture du seau « ${OFFSITE_BUCKET} » (préfixe « ${prefix || '/'} ») : HTTP ${res.status} ${detail.slice(0, 200)}`);
    console.error('   Un seau absent est une absence de sauvegarde : traitez ce rouge comme tel.');
    return null;
  }
  const body = await res.json();
  return Array.isArray(body) ? body : null;
}

// Le premier niveau rend les DOSSIERS datés (« 20261108T184829Z »), pas les
// fichiers. Chercher un objet daté à ce niveau ne trouve rien dans un seau
// plein : c'est le défaut corrigé le 2026-11-08, constaté sur une copie réelle.
const root = await listPrefix('');
if (root === null) process.exit(1);

const stamps = [...new Set(root.map((o) => copyStampOf(o?.name)).filter(Boolean))].sort().reverse();
if (stamps.length === 0) {
  const verdict = ageVerdict(null, new Date(), maxHours);
  console.error(`❌ ${verdict.message}`);
  process.exit(1);
}

const newest = stamps[0];
const inner = await listPrefix(`${newest}/`);
if (inner === null) process.exit(1);

// Un dossier sans manifeste n'est pas une sauvegarde relue : le contenu a pu
// être déposé à moitié, et personne ne saurait ce qu'il contient.
if (!inner.some((o) => isCopyManifest(o?.name))) {
  console.error(`❌ la copie du ${newest} n’a pas de manifeste — elle n’a jamais été relue, elle ne compte pas comme sauvegarde.`);
  process.exit(1);
}

const instant = instantOfObjectName(`${newest}/`);
if (!instant) {
  console.error(`❌ le dossier « ${newest} » ne porte pas d’horodatage lisible — son âge est donc inconnu.`);
  process.exit(1);
}

const verdict = ageVerdict(instant, new Date(), maxHours);

if (!verdict.ok) {
  console.error(`❌ ${verdict.message}`);
  process.exit(1);
}

console.log(`✅ Dernière copie hors GitHub : ${instant} (${verdict.ageHours?.toFixed(1)} h, seuil ${maxHours} h).`);
console.log(`   ${stamps.length} copie(s) datée(s) dans « ${OFFSITE_BUCKET} » (liste bornée à 100) ; manifeste présent dans « ${newest} ».`);
