#!/usr/bin/env node
/**
 * La copie qui survit à GitHub.
 *
 * `backup-watch.yml` déposait son archive en artefact, et GitHub la supprime au
 * bout de 30 jours : au 31e, l'école n'avait plus AUCUNE copie, et rien ne le
 * disait. Ce script dépose la même archive CHIFFRÉE dans le seau `db-backups`
 * du projet Supabase de l'école (le seul stockage durable que ce dépôt
 * connaisse, déjà utilisé pour les données), relit l'objet déposé, et échoue
 * bruyamment s'il n'y est pas.
 *
 * Il crée le seau s'il manque (une seule fois), puis dépose le contenu ET son
 * manifeste : un contenu sans manifeste ne dit pas ce qu'il contient, et
 * `backup:verify` le refuserait — à juste titre.
 *
 * Usage (le workflow le fait après `backup:verify`) :
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/upload-backup-offsite.mjs
 */
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OFFSITE_BUCKET, uploadPlan } from './lib/backup-offsite.mjs';

const DIR = resolve(process.argv.includes('--from')
  ? process.argv[process.argv.indexOf('--from') + 1]
  : process.env.BACKUP_DIR ?? '.backup/current');

const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
};

async function readManifest() {
  const raw = await readFile(join(DIR, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

async function api(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  return res;
}

/** Le seau existe-t-il ? S'il manque, on le crée (privé), une seule fois. */
async function ensureBucket(base, headers) {
  const bucketUrl = `${base}/storage/v1/bucket/${OFFSITE_BUCKET}`;
  const head = await api(bucketUrl, { headers });
  if (head.ok) return;
  if (head.status !== 404 && head.status !== 400) {
    throw new Error(`Lecture du seau « ${OFFSITE_BUCKET} » : HTTP ${head.status}`);
  }
  const created = await api(`${base}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: OFFSITE_BUCKET, name: OFFSITE_BUCKET, public: false }),
  });
  // 400/409 : créé entre-temps par un autre run — ce n'est pas un échec.
  if (!created.ok && ![400, 409].includes(created.status)) {
    throw new Error(`Création du seau « ${OFFSITE_BUCKET} » : HTTP ${created.status} ${await created.text()}`);
  }
}

async function put(url, file, headers) {
  const body = await readFile(file);
  const res = await api(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Dépôt de ${file} : HTTP ${res.status} ${await res.text()}`);
  return body.length;
}

async function main() {
  const manifest = await readManifest();
  const plan = uploadPlan(manifest, env);
  if (!plan.ok) {
    console.error(`❌ Copie hors GitHub impossible : ${plan.reason}`);
    console.error('   Posez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (secrets du dépôt).');
    process.exit(2);
  }

  const base = env.supabaseUrl.replace(/\/+$/, '');
  await ensureBucket(base, plan.headers);

  const payloadFile = join(DIR, 'payload.json.enc');
  const manifestFile = join(DIR, 'manifest.json');
  const payloadBytes = (await stat(payloadFile)).size;
  const sent = await put(plan.url, payloadFile, plan.headers);
  if (sent !== payloadBytes) throw new Error(`Contenu tronqué à l'envoi (${sent} ≠ ${payloadBytes})`);
  await put(plan.manifestUrl, manifestFile, plan.manifestHeaders);

  // RELIRE ce qu'on vient de déposer : un 200 sur l'envoi ne prouve pas que
  // l'objet est là, et une copie qu'on n'a jamais rouverte n'est pas une copie.
  const check = await api(plan.url, { headers: plan.headers });
  if (!check.ok) throw new Error(`Relecture de l'objet déposé : HTTP ${check.status}`);

  console.log(`✅ Copie hors GitHub : ${OFFSITE_BUCKET}/${plan.key}`);
  console.log(`   ${manifest.totalRows} ligne(s), ${manifest.tables.length} table(s), ${(payloadBytes / 1024).toFixed(1)} Ko chiffrés.`);
  console.log('   Elle ne périme pas avec l’artefact GitHub ; `check:backup-age` la relit chaque jour.');
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
