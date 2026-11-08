/**
 * backup-offsite.mjs — la copie qui survit à GitHub, et la date qui la rend
 * impossible à oublier.
 *
 * ─── Pourquoi ce fichier existe ────────────────────────────────────────────
 * `backup-watch.yml` dépose l'archive chiffrée en ARTEFACT de workflow, retenu
 * 30 jours. C'est mieux que rien, mais ce n'est pas une sauvegarde : au 31e
 * jour GitHub supprime l'objet, et il ne reste RIEN — ni copie, ni avis. Une
 * copie qui périme sans le dire n'est pas une sauvegarde, c'est une impression
 * de sauvegarde. Deux choses manquaient, et ce module les nomme sans réseau :
 *
 *   1. une destination DURABLE (le Storage du projet Supabase, déjà utilisé par
 *      l'application, donc déjà sauvegardé et facturé) ;
 *   2. une VÉRIFICATION D'ÂGE : si la dernière copie relue a plus de 48 h,
 *      c'est un incident, pas une ligne de journal.
 *
 * ─── Ce que ce fichier ne fait pas ─────────────────────────────────────────
 * Aucun appel réseau, aucune écriture : les fonctions rendent un PLAN (URL,
 * en-têtes, clé) ou un VERDICT (âge, message). C'est l'appelant — le workflow
 * ou un script — qui l'exécute, et c'est ce qui rend ces règles testables sans
 * base, sans secret et sans horloge réelle.
 *
 * ─── Le nom de l'archive vient du dépôt, pas d'une convention inventée ─────
 * `scripts/backup-db.mjs` n'écrit pas de `tar.gz` : il écrit `payload.json.enc`
 * (ou `payload.json` en clair, refusé en CI) à côté de son `manifest.json`.
 * La clé reprend donc CE nom réel — une clé qui annoncerait une archive que
 * personne ne produit ferait chercher un fichier qui n'existe pas.
 */

/** Le seau Storage où vivent les copies hors GitHub. */
export const OFFSITE_BUCKET = 'db-backups';

/**
 * Au-delà de ce délai, la dernière copie relue n'est plus une sauvegarde
 * fraîche : 48 h laisse passer une nuit manquée (panne du runner, secret
 * retiré, job rouge) sans transformer un retard ordinaire en silence, et
 * n'attend pas une semaine pour dire qu'il n'y a plus rien.
 */
export const OFFSITE_MAX_AGE_HOURS = 48;

const pad = (n) => String(n).padStart(2, '0');

/** Horodatage ISO « basique » : triable comme du texte, sans espace ni `:`. */
function stampOf(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * L'instant de la sauvegarde, tel que le manifeste le porte.
 *
 * `takenAt` absent ou illisible retombe sur `now` : une clé doit exister pour
 * qu'une copie puisse être déposée, et l'appelant fournit alors l'instant qu'il
 * mesure. Une date du futur n'est pas « corrigée » ici — elle rend une clé
 * triable, et c'est `ageVerdict` qui refuse de conclure sur une horloge
 * incohérente.
 */
function takenAtOf(manifest, now) {
  const raw = manifest && typeof manifest.takenAt === 'string' ? manifest.takenAt : '';
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms);
  return new Date(now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now());
}

function countOf(manifest) {
  const declared = Number(manifest?.totalRows);
  if (Number.isFinite(declared) && declared >= 0) return Math.trunc(declared);
  const tables = Array.isArray(manifest?.tables) ? manifest.tables : [];
  return tables.reduce((sum, t) => sum + (Number(t?.rows) > 0 ? Math.trunc(Number(t.rows)) : 0), 0);
}

function tableCountOf(manifest) {
  return Array.isArray(manifest?.tables) ? manifest.tables.length : 0;
}

/** Le préfixe daté commun au contenu et à son manifeste. */
function prefixOf(manifest, now) {
  return `${stampOf(takenAtOf(manifest, now))}/db-backup-${countOf(manifest)}l-${tableCountOf(manifest)}t`;
}

/**
 * La clé du CONTENU chiffré, stable et triable.
 *
 * Forme : `<AAAAMMJJ>T<hhmmss>Z/db-backup-<lignes>l-<tables>t-payload.json.enc`.
 * Le préfixe temporel fait que lister le seau rend les copies dans l'ordre ;
 * les compteurs dans le nom font qu'un objet vide (`0l-0t`) se reconnaît sans
 * ouvrir le manifeste — c'est exactement le cas qu'un humain doit voir.
 */
export function offsiteObjectKey(manifest, now = new Date()) {
  return `${prefixOf(manifest, now)}-payload.json.enc`;
}

/**
 * La clé du manifeste, À CÔTÉ du contenu.
 *
 * Les deux voyagent ensemble parce qu'un contenu sans manifeste ne dit pas ce
 * qu'il contient : déposer le `payload` seul reviendrait à archiver un fichier
 * muet, et `backup:verify` le refuserait — à juste titre.
 */
export function offsiteManifestKey(manifest, now = new Date()) {
  return `${prefixOf(manifest, now)}-manifest.json`;
}

function cleanBase(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return '';
  return trimmed;
}

/**
 * Le plan de dépôt du contenu — refusé NOMMÉ, jamais une URL vide.
 *
 * Une URL sans clé, ou une clé sans URL, produirait une requête qui échoue
 * plus loin avec un message d'authentification trompeur. Ici, l'absence est
 * dite à l'endroit qui la connaît : le secret n'est pas posé.
 *
 * `x-upsert: true` rend le dépôt rejouable : un run relancé le même jour
 * réécrit le même objet au lieu d'échouer en « already exists ».
 */
export function uploadPlan(manifest, env = {}) {
  const base = cleanBase(env.supabaseUrl);
  const serviceKey = typeof env.serviceKey === 'string' ? env.serviceKey.trim() : '';
  if (!base) {
    return { ok: false, reason: 'SUPABASE_URL absente ou illisible — aucune destination durable ne peut être nommée.' };
  }
  if (!serviceKey) {
    return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY absente — le dépôt hors GitHub ne peut pas être authentifié.' };
  }
  const key = offsiteObjectKey(manifest);
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/octet-stream',
    'x-upsert': 'true',
  };
  return {
    ok: true,
    key,
    url: `${base}/storage/v1/object/${OFFSITE_BUCKET}/${key}`,
    headers,
    // Le manifeste suit le contenu : deux dépôts, un seul plan, pour que
    // l'appelant ne puisse pas en oublier un.
    manifestKey: offsiteManifestKey(manifest),
    manifestUrl: `${base}/storage/v1/object/${OFFSITE_BUCKET}/${offsiteManifestKey(manifest)}`,
    manifestHeaders: { ...headers, 'Content-Type': 'application/json' },
  };
}

/**
 * La dernière copie relue est-elle encore fraîche ?
 *
 * Trois rouges, et aucun n'est un zéro silencieux :
 *   • date absente → « aucune sauvegarde vérifiée connue » (le cas d'un dépôt
 *     neuf, ou d'un relevé qui n'a jamais été publié) ;
 *   • date illisible → la valeur fautive est citée, bornée ;
 *   • date dans le futur → une horloge qui avance rendrait le contrôle
 *     complaisant pour toujours, donc elle est refusée.
 */
export function ageVerdict(lastVerifiedAt, now = new Date(), maxHours = OFFSITE_MAX_AGE_HOURS) {
  const max = Number.isFinite(maxHours) && maxHours > 0 ? maxHours : OFFSITE_MAX_AGE_HOURS;
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  if (typeof lastVerifiedAt !== 'string' || lastVerifiedAt.trim() === '') {
    return {
      ok: false,
      ageHours: null,
      message: `aucune sauvegarde vérifiée connue — la copie hors GitHub n'a jamais été relue (seuil ${max} h).`,
    };
  }
  const ms = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(ms)) {
    const shown = lastVerifiedAt.slice(0, 40);
    return {
      ok: false,
      ageHours: null,
      message: `horodatage de sauvegarde illisible (« ${shown} ») — l'âge de la dernière copie est donc inconnu.`,
    };
  }
  const ageHours = Math.round(((nowMs - ms) / 3_600_000) * 10) / 10;
  if (ageHours < 0) {
    return {
      ok: false,
      ageHours,
      message: `horodatage de sauvegarde dans le futur (${lastVerifiedAt}) — une horloge qui avance rendrait ce contrôle aveugle.`,
    };
  }
  if (ageHours > max) {
    return {
      ok: false,
      ageHours,
      message: `la dernière sauvegarde vérifiée a ${ageHours} h (seuil ${max} h) — la copie hors GitHub est périmée.`,
    };
  }
  return { ok: true, ageHours, message: `dernière sauvegarde vérifiée il y a ${ageHours} h (seuil ${max} h).` };
}

/**
 * Relit un horodatage dans un relevé Markdown, sans jamais lever.
 *
 * Deux formes sont acceptées parce que les deux existent dans les relevés
 * publiés à la main :
 *   • ISO complet, `2026-11-08T02:41:07Z` (ou avec décalage `+00:00`) ;
 *   • la forme lisible, `2026-11-08 02:41 UTC` — rendue en ISO canonique pour
 *     que `ageVerdict` n'ait qu'un seul format à comprendre.
 *
 * Un relevé qui ne porte aucune date rend `null` : « je n'ai pas trouvé » ne
 * doit pas devenir « c'est vieux » ni « c'est récent ».
 */
/**
 * L'instant que porte le nom d'un objet déposé.
 *
 * La clé commence par `AAAAMMJJThhmmssZ/` : c'est ce préfixe qui rend la liste
 * triable, et c'est lui — jamais la date de dernière modification du stockage,
 * qui peut être réécrite par une restauration — qui date la copie. Un nom sans
 * préfixe lisible rend `null` : ce n'est pas une copie de ce dépôt, et la
 * dater serait une invention.
 */
export function instantOfObjectName(name) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\//.exec(String(name ?? ''));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function parseLastVerified(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return null;

  const isoPattern = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g;
  for (const match of markdown.matchAll(isoPattern)) {
    const candidate = `${match[1]}T${match[2]}`;
    if (Number.isFinite(Date.parse(candidate))) return candidate;
  }

  const readable = /\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?\s*(?:UTC|Z)\b/g;
  for (const match of markdown.matchAll(readable)) {
    const candidate = `${match[1]}T${match[2]}:${match[3] ?? '00'}Z`;
    if (Number.isFinite(Date.parse(candidate))) return candidate;
  }

  return null;
}
