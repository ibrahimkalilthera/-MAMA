// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/hosted-db.mjs — LIRE la base hébergée : une seule convention.
//
// ─── Pourquoi ce module existe ──────────────────────────────────────────────
// Deux contrôles comparent le CATALOGUE de la base partagée à ce que les
// migrations déclarent : `check-rls-policies` (les politiques) et
// `check-db-objects` (les index, les contraintes et les déclencheurs). Ils
// doivent lire LA MÊME base par LE MÊME chemin : deux copies de la liste des
// hôtes, du nom de l'utilisateur ou de la lecture du mot de passe divergeraient
// un jour — et une divergence de connexion ne fait pas échouer un contrôle, elle
// lui fait juger une AUTRE base, en silence. C'est exactement la classe de défaut
// que ces gardes existent pour nommer.
//
// ─── Le canal, et pourquoi il n'y en a qu'un ────────────────────────────────
// Connexion DIRECTE (`pg`), jamais PostgREST : le catalogue (`pg_policies`,
// `pg_index`, `pg_constraint`, `pg_trigger`) ne se lit pas à travers une API qui
// applique elle-même les verrous, et une lecture qui dépendrait d'une politique
// pour vérifier les politiques serait circulaire. `pg` n'est pas une dépendance
// déclarée du dépôt (outillage ponctuel, comme les autres scripts qui lisent la
// base) : son absence est un REFUS nommé, jamais un silence.
//
// ─── Le mot de passe ────────────────────────────────────────────────────────
// `SUPABASE_DB_PASSWORD` dans l'environnement, sinon dans `.env` lu À LA MAIN :
// le `--env-file` de Node tronque au premier « # » non quoté, et ce mot de passe
// en contient un. Il n'est jamais imprimé, ni recopié dans une erreur.
//
// ─── Ce module ne juge rien ─────────────────────────────────────────────────
// Il connecte et il rend le client. Les requêtes et les verdicts appartiennent
// aux contrôles (`check-rls-policies.mjs`, `check-db-objects.mjs`), et les
// comparaisons pures à leurs modules (`rls-policies.mjs`, `db-objects.mjs`) —
// c'est ce qui les rend testables sans base.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHARED_PROJECT_REF } from './shared-project.mjs';

/** Lit un `.env` à la main (le mot de passe peut contenir « # »). */
export function parseEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

/**
 * Le mot de passe de la base, ou `null` — l'absence est un REFUS, pas un défaut.
 *
 * L'environnement d'abord : c'est ce que la veille (CI) fournit par
 * `secrets.SUPABASE_DB_PASSWORD`, et un `.env` périmé ne doit pas décider de la
 * base jugée. Le fichier ensuite, pour un lancement à la main.
 */
export function readDbPassword(root) {
  const fromEnv = process.env.SUPABASE_DB_PASSWORD;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  const env = parseEnvFile(join(root, '.env'));
  const fromFile = env.SUPABASE_DB_PASSWORD;
  return fromFile && String(fromFile).trim() ? String(fromFile).trim() : null;
}

/**
 * Les deux hôtes essayés, dans cet ordre.
 *
 * Le pooler d'abord (c'est la convention du dépôt), l'hôte direct ensuite :
 * certaines machines n'atteignent pas le pooler (IPv6, réseau d'école) — un
 * second candidat évite un échec qui ne dirait rien du catalogue lu.
 */
export function dbCandidates(projectRef = SHARED_PROJECT_REF) {
  return [
    { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${projectRef}` },
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: 'postgres' },
  ];
}

/**
 * Le client `pg` connecté, ou une exception qui dit POURQUOI.
 *
 * Trois tentatives par candidat : un DNS qui traîne ne doit pas faire passer un
 * catalogue lisible pour un catalogue absent (le refus, lui, sort en 2 et il est
 * NOMMÉ — « je n'ai pas pu regarder » n'est jamais un vert).
 *
 * @param {{ password?: string, projectRef?: string, attempts?: number,
 *   onAttempt?: (error: Error) => void }} [input]
 */
export async function connectHostedDb({ password, projectRef = SHARED_PROJECT_REF, attempts = 3, onAttempt } = {}) {
  const pg = await import('pg')
    .then((module) => module.default)
    .catch(() => null);
  if (!pg) throw new Error('Le module « pg » est absent. Installer l’outillage : npm i --no-save pg');
  if (!password) throw new Error('SUPABASE_DB_PASSWORD absent — sans lui, il n’y a pas de catalogue à lire.');

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const candidate of dbCandidates(projectRef)) {
      const client = new pg.Client({
        ...candidate,
        password,
        database: 'postgres',
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
        statement_timeout: 60000,
      });
      try {
        await client.connect();
        return client;
      } catch (error) {
        lastError = error;
        if (onAttempt) onAttempt(error);
        await client.end().catch(() => undefined);
      }
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw lastError ?? new Error('connexion impossible');
}
