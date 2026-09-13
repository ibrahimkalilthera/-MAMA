// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/backup-manifest.mjs — un instantané qui dit ce qu'il contient, et
// qu'on peut VÉRIFIER avant de s'y fier.
//
// Trois règles, chacune payée par l'expérience de ce dépôt (un journal illisible
// vaut un vert, une preuve sans chiffre ne prouve rien, un fichier qu'on n'a
// jamais rouvert n'est pas une sauvegarde) :
//
//   1. **Le manifeste dit ce qu'il y a**, table par table, avec le nombre de
//      lignes et l'empreinte du contenu. « Sauvegarde OK » sans chiffres ne se
//      distingue pas d'un export vide — et une base d'école à 0 élève est un
//      cas légitime, donc la différence doit être LUE, pas supposée.
//   2. **L'intégrité est vérifiable hors ligne** : `verifyManifest` recalcule
//      tout depuis les octets. Un fichier tronqué, un manifeste qui ne décrit
//      pas son propre contenu, une table annoncée mais absente : trois refus.
//   3. **Le chiffrement est obligatoire en CI** et le déchiffrement ÉCHOUE
//      bruyamment sur un mot de passe faux ou un octet modifié (AES-256-GCM :
//      l'authentification du message est gratuite, autant s'en servir). Un dépôt
//      public ne peut pas héberger un dump lisible en clair.
//
// Module PUR : aucun réseau, aucun accès disque — donc chaque règle ci-dessus
// est éprouvable sans base de données.
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Version du format : un fichier d'une autre version n'est pas deviné. */
export const BACKUP_FORMAT = 1;

/** En-tête du conteneur chiffré — lisible sans le mot de passe, et rien d'autre. */
export const ENCRYPTED_MAGIC = 'MTFB1';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Sérialisation canonique : l'empreinte ne dépend pas de l'ordre des clés. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

/** L'empreinte du contenu d'une table, telle qu'elle est écrite dans le fichier. */
export const contentFingerprint = (rows) => sha256(canonical(rows ?? []));

/**
 * Le manifeste d'une sauvegarde.
 *
 * @param {{
 *   project?: string,          // ref du projet Supabase sauvegardé
 *   takenAt?: string,          // ISO 8601
 *   tables?: Array<{ name: string, pk?: string, rows?: number, sha256?: string }>,
 *   encrypted?: boolean,
 *   payloadSha256?: string,
 * }} input
 * @returns {{
 *   format: number,
 *   project: string,
 *   takenAt: string,
 *   encrypted: boolean,
 *   payloadSha256: string|null,
 *   tables: Array<{ name: string, pk: string, rows: number, sha256: string }>,
 *   totalRows: number,
 *   manifestSha256: string,
 * }} le manifeste, prêt à être écrit à côté du fichier
 */
export function buildManifest({
  project = '',
  takenAt = new Date().toISOString(),
  tables = [],
  encrypted = false,
  payloadSha256 = null,
} = {}) {
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error('buildManifest: aucune table — un manifeste vide ne décrit rien');
  }
  const rows = tables.map((t) => ({
    name: t.name,
    pk: t.pk ?? 'id',
    rows: Number.isFinite(t.rows) ? Number(t.rows) : 0,
    sha256: t.sha256 ?? contentFingerprint([]),
  }));
  const totalRows = rows.reduce((n, t) => n + t.rows, 0);
  const body = {
    format: BACKUP_FORMAT,
    project,
    takenAt,
    encrypted: !!encrypted,
    payloadSha256,
    tables: rows,
    totalRows,
  };
  return { ...body, manifestSha256: sha256(canonical({ ...body, manifestSha256: undefined })) };
}

/**
 * Le manifeste décrit-il bien les octets qu'on a sous les yeux ?
 *
 * Le paramètre est volontairement LARGE : cette fonction juge des manifestes
 * d'origines diverses — un fichier écrit par une autre version, un `null`, un
 * objet retouché — et c'est exactement son travail que de refuser ce qu'elle ne
 * comprend pas. Le typer au format exact empêcherait de tester ces refus.
 *
 * @param {Record<string, any>|null} manifest
 * @param {{ payloadSha256?: string|null, tables?: Array<{ name: string, rows: number, sha256: string }> }} actual
 * @returns {string[]} les problèmes, vides si tout concorde
 */
export function verifyManifest(manifest, actual = {}) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['manifeste absent ou illisible'];
  if (manifest.format !== BACKUP_FORMAT) {
    problems.push(`format ${manifest.format ?? '?'} inconnu (attendu ${BACKUP_FORMAT})`);
  }
  if (!Array.isArray(manifest.tables) || manifest.tables.length === 0) {
    problems.push('le manifeste ne déclare aucune table');
  }
  if (manifest.payloadSha256) {
    if (!actual.payloadSha256) problems.push('empreinte du contenu disponible pour comparaison');
    else if (manifest.payloadSha256 !== actual.payloadSha256) {
      problems.push(
        `le contenu ne correspond PAS à son empreinte (manifeste ${manifest.payloadSha256.slice(0, 12)}…, ` +
          `octets ${actual.payloadSha256.slice(0, 12)}…) — fichier modifié ou tronqué`,
      );
    }
  }
  const actualByName = new Map((actual.tables ?? []).map((t) => [t.name, t]));
  for (const declared of manifest.tables ?? []) {
    const found = actualByName.get(declared.name);
    if (!found) {
      problems.push(`table « ${declared.name} » annoncée dans le manifeste mais absente du contenu`);
      continue;
    }
    if (found.rows !== declared.rows) {
      problems.push(`table « ${declared.name} » : ${found.rows} ligne(s) au lieu de ${declared.rows} annoncée(s)`);
    }
    if (found.sha256 !== declared.sha256) {
      problems.push(`table « ${declared.name} » : le contenu ne correspond pas à son empreinte`);
    }
  }
  const declaredNames = new Set((manifest.tables ?? []).map((t) => t.name));
  for (const extra of actual.tables ?? []) {
    if (!declaredNames.has(extra.name)) problems.push(`table « ${extra.name} » présente mais non déclarée`);
  }
  return problems;
}

/** Vérifie qu'un manifeste n'a pas été retouché (lui-même, pas son contenu). */
export function manifestHashMatches(manifest) {
  if (!manifest?.manifestSha256) return false;
  const { manifestSha256, ...rest } = manifest;
  const expected = sha256(canonical({ ...rest, manifestSha256: undefined }));
  const a = Buffer.from(expected);
  const b = Buffer.from(String(manifestSha256));
  return a.length === b.length && timingSafeEqual(a, b);
}

// `maxmem` est posé explicitement : N=2^15, r=8 demande ~33 Mo, au-dessus du
// plafond par défaut de Node (32 Mo) — mesuré, sinon scryptSync refuse de
// tourner (« memory limit exceeded »). On garde le paramétrage FORT.
const KDF_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 };

/**
 * Chiffre un contenu avec un mot de passe (scrypt + AES-256-GCM).
 * @param {Buffer|string} plaintext
 * @param {string} passphrase
 * @returns {Buffer} `MTFB1` + salt + iv + tag + chiffré
 */
export function encryptPayload(plaintext, passphrase) {
  const secret = String(passphrase ?? '');
  if (secret.length < 12) throw new Error('encryptPayload: mot de passe trop court (12 caractères minimum)');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, KDF_PARAMS.keylen, KDF_PARAMS);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([Buffer.from(ENCRYPTED_MAGIC, 'utf8'), salt, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Déchiffre un contenu produit par `encryptPayload`.
 * Échoue bruyamment : mauvais mot de passe, octet modifié, en-tête inconnu.
 * @param {Buffer|string} payload
 * @param {string} passphrase
 * @returns {Buffer}
 */
export function decryptPayload(payload, passphrase) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'binary');
  const magic = buf.subarray(0, ENCRYPTED_MAGIC.length).toString('utf8');
  if (magic !== ENCRYPTED_MAGIC) {
    throw new Error(`en-tête « ${magic} » inconnu : ce fichier n’est pas une sauvegarde chiffrée (MTFB1)`);
  }
  const salt = buf.subarray(5, 21);
  const iv = buf.subarray(21, 33);
  const tag = buf.subarray(33, 49);
  const ciphertext = buf.subarray(49);
  const key = scryptSync(String(passphrase ?? ''), salt, KDF_PARAMS.keylen, KDF_PARAMS);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** L'empreinte d'un contenu quelconque (utilisée pour le fichier entier). */
export const payloadFingerprint = (payload) =>
  sha256(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8'));
