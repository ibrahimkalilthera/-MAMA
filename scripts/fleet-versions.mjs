#!/usr/bin/env node
/**
 * ─── LE RELEVÉ DU PARC : où en sont les postes, et lesquels se taisent ───────
 *
 *   npm run fleet:versions                       (secrets dans l'environnement)
 *   node scripts/fleet-versions.mjs              (lus depuis .env en local)
 *   node scripts/fleet-versions.mjs --silent-days=14 --max-rows=500
 *
 * Spécification : docs/CANAL_MISE_A_JOUR.md §7 (« Battement de version »), dont
 * la dernière ligne demande exactement ceci : « `npm run fleet:versions` imprime
 * la répartition par version, et NOMME les postes silencieux (aucun battement
 * depuis N jours) au lieu de les supposer à jour ».
 *
 * ─── Pourquoi cette commande existe ────────────────────────────────────────
 * Le §6 de la spécification ne se vérifie pas tout seul : « tous les postes sont
 * passés à la version de bascule » n'est pas un fait qu'on lit dans un dépôt, et
 * ce dépôt l'a écrit noir sur blanc — sans ce relevé, la bascule se prouve poste
 * par poste, c'est-à-dire ne se prouve pas. Chaque poste écrit donc une ligne en
 * base (§7, `public.record_station_beat`) ; cette commande la lit et la rend
 * lisible : quelle version tourne où, et QUI ne dit plus rien.
 *
 * ─── Pourquoi le silence se mesure sur `seen_at`, jamais sur la version ────
 * Le piège serait de lire la répartition par version et d'en déduire que les
 * postes absents de la liste sont à jour — c'est le supposer, exactement ce que
 * la spécification refuse. Le silence est donc l'écart entre l'instant où la
 * BASE a reçu le dernier battement (`seen_at`, horodaté par `now()` côté serveur,
 * donc à l'abri d'une horloge de poste déréglée) et maintenant. Un poste dont la
 * version est la bonne mais dont le battement date de trois semaines est
 * SILENCIEUX, et il est nommé.
 *
 * ─── Le contrôle de volume, et pourquoi il fait ÉCHOUER la commande ─────────
 * La clé publique de l'application peut appeler le geste d'écriture : rien
 * n'empêche quelqu'un d'inventer des `station_id`, et la table grossirait alors
 * sans fin. Un relevé qui resterait vert pendant que la table s'emballe
 * masquerait précisément ce qu'on lui demande de voir. Au-delà de `--max-rows`
 * (200 par défaut, très au-dessus des quelques dizaines de postes réels), la
 * commande ROUGIT en nommant le compte et le seuil.
 *
 * ─── Ce que ce relevé ne peut PAS voir, et le dit ──────────────────────────
 * Un poste qui n'a JAMAIS battu est invisible ici : on ne peut pas nommer ce
 * qu'on n'a jamais vu. C'est écrit dans la sortie plutôt que sous-entendu par un
 * vert, et c'est la raison pour laquelle ce relevé complète la preuve poste par
 * poste (§6) au lieu de la remplacer.
 *
 * ─── La lecture, et pourquoi elle est authentifiée ─────────────────────────
 * La table est ILLISIBLE par `anon` — c'est le prix assumé d'une écriture
 * anonyme : la clé publique livrée dans le bundle ne doit pas permettre de
 * recenser le parc. Ce relevé passe donc par la clé de service, comme les autres
 * lectures de la base partagée. Sans elle, le refus est NOMMÉ (sortie 2) : un
 * relevé vide n'est pas un parc vide.
 *
 * Codes de sortie : 0 relevé rendu (un poste silencieux est une INFORMATION, pas
 * une panne de l'outil) · 1 table au-delà du seuil de volume · 2 indécis
 * (secret absent, drapeau inconnu, base injoignable — on n'a pas pu regarder).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseEnvFile } from './lib/hosted-db.mjs';
import { SHARED_PROJECT_URL, projectRefOf } from './lib/shared-project.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Un poste vérifie au démarrage, toutes les 30 min et au retour sur la fenêtre. */
export const DEFAULT_SILENT_DAYS = 7;

/** Très au-dessus du parc réel (quelques dizaines) : un seuil serré crierait au loup. */
export const DEFAULT_MAX_ROWS = 200;

const DAY_MS = 86_400_000;
const CHECK_STATES = ['ok', 'feed-absent', 'html', 'unreachable'];
const COLUMNS = 'station_id,app_version,os_version,last_check,last_check_version,seen_at';

export const USAGE = [
  'Usage : npm run fleet:versions [--silent-days=N] [--max-rows=N]',
  '',
  `  --silent-days=N   un poste est « silencieux » au-delà de N jours sans battement (défaut ${DEFAULT_SILENT_DAYS})`,
  `  --max-rows=N      seuil de volume : au-delà, la commande échoue (défaut ${DEFAULT_MAX_ROWS})`,
].join('\n');

/**
 * Les drapeaux, lus à la main — et un drapeau inconnu est un REFUS, pas un oubli.
 *
 * `--silence-days` (au lieu de `--silent-days`) serait silencieusement ignoré par
 * un lecteur permissif, et le relevé sortirait avec le seuil par défaut en
 * croyant avoir appliqué celui qu'on lui a donné : c'est exactement le genre de
 * vert qu'on ne saurait pas expliquer.
 *
 * @param {string[]} argv
 * @returns {{ silentDays: number, maxRows: number, help: boolean, problems: string[] }}
 */
export function parseFlags(argv = []) {
  const out = { silentDays: DEFAULT_SILENT_DAYS, maxRows: DEFAULT_MAX_ROWS, help: false, problems: [] };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    const match = arg.match(/^--(silent-days|max-rows)=(-?\d+)$/);
    if (!match) {
      out.problems.push(`drapeau inconnu « ${arg} »`);
      continue;
    }
    const value = Number(match[2]);
    if (!Number.isInteger(value) || value < 1) {
      out.problems.push(`« ${arg} » attend un entier ≥ 1`);
      continue;
    }
    if (match[1] === 'silent-days') out.silentDays = value;
    else out.maxRows = value;
  }
  return out;
}

/**
 * La répartition par version, la plus grosse part d'abord.
 *
 * Le tri par COUNT (et non par version) répond à la question qu'on se pose
 * vraiment — « où est le gros du parc ? » —, et la casse par version sert
 * d'arbitre quand deux versions portent le même nombre de postes (la plus
 * récente d'abord, en comparaison NUMÉRIQUE : `1.0.9` avant `1.0.10` serait un
 * ordre de chaîne, donc un ordre faux).
 *
 * @param {object[]} rows
 * @returns {{ version: string, count: number, share: number }[]}
 */
export function versionDistribution(rows = []) {
  const counts = new Map();
  for (const row of rows) {
    const version = String(row?.app_version ?? '').trim() || '(version illisible)';
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  const total = rows.length;
  return [...counts.entries()]
    .map(([version, count]) => ({ version, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || b.version.localeCompare(a.version, 'fr', { numeric: true }));
}

/**
 * L'état du dernier contrôle, par état connu — un poste qui bat mais dont le
 * contrôle échoue n'est PAS compté comme sain.
 *
 * @param {object[]} rows
 * @returns {{ state: string, count: number }[]}
 */
export function checkStateBreakdown(rows = []) {
  const counts = new Map(CHECK_STATES.map((state) => [state, 0]));
  for (const row of rows) {
    const state = String(row?.last_check ?? '').trim() || '(état illisible)';
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  // L'ordre des états connus est stable (un relevé qu'on compare d'un jour à
  // l'autre se lit de la même façon) ; un état inconnu est NOMBÉ, jamais fondu
  // dans « ok ».
  const known = CHECK_STATES.map((state) => ({ state, count: counts.get(state) ?? 0 }));
  const extra = [...counts.entries()]
    .filter(([state]) => !CHECK_STATES.includes(state))
    .map(([state, count]) => ({ state, count }));
  return [...known, ...extra];
}

/**
 * Les postes SILENCIEUX — nommés, jamais supposés à jour.
 *
 * `seen_at` est posé par la BASE (`timezone('utc', now())`), donc un écart
 * négatif (horloge de poste en avance) ne peut pas venir du client : il ne
 * viendrait que d'un `seen_at` écrit à la main dans la table. Un horodatage
 * illisible rend le poste silencieux INCONNU — et il est alors nommé comme tel,
 * parce qu'un poste qu'on n'a pas su juger ne doit pas disparaître du relevé.
 *
 * @param {object[]} rows
 * @param {{ silentDays?: number, nowMs?: number }} [options]
 * @returns {{ stationId: string, seenAt: string|null, days: number|null, note: string|null }[]}
 */
export function silentStations(rows = [], { silentDays = DEFAULT_SILENT_DAYS, nowMs = Date.now() } = {}) {
  const threshold = silentDays * DAY_MS;
  const out = [];
  for (const row of rows) {
    const stationId = String(row?.station_id ?? '').trim() || '(identifiant illisible)';
    const seenAt = String(row?.seen_at ?? '').trim();
    const seenMs = Date.parse(seenAt);
    if (!seenAt || !Number.isFinite(seenMs)) {
      out.push({ stationId, seenAt: null, days: null, note: 'horodatage illisible — silence inconnu' });
      continue;
    }
    const ageMs = nowMs - seenMs;
    if (ageMs >= threshold) {
      out.push({ stationId, seenAt, days: ageMs / DAY_MS, note: null });
    }
  }
  return out.sort((a, b) => (b.days ?? Number.POSITIVE_INFINITY) - (a.days ?? Number.POSITIVE_INFINITY));
}

/**
 * Le verdict de volume.
 *
 * @param {{ total?: number, maxRows?: number }} [input]
 * @returns {{ ok: boolean, problem: string|null }}
 */
export function volumeVerdict({ total = 0, maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (total > maxRows) {
    return {
      ok: false,
      problem:
        `le relevé porte ${total} ligne(s) — au-delà du seuil de ${maxRows} : ` +
        'la clé publique peut appeler le geste d’écriture, donc ce volume est soit un parc ' +
        'qui a explosé, soit des `station_id` inventés. Augmenter --max-rows est un choix, ' +
        'pas une correction : regarder d’abord ce que la table porte.',
    };
  }
  return { ok: true, problem: null };
}

/** La barre de proportion, bornée : un relevé de 200 postes n'écrit pas 200 blocs. */
const bar = (share) => '█'.repeat(Math.max(0, Math.round(share * 24)));

/**
 * Le relevé, en TEXTE — pur, donc éprouvable sans base ni réseau.
 *
 * @param {{ rows?: object[], total?: number, silentDays?: number, maxRows?: number,
 *   nowMs?: number, projectRef?: string|null }} input
 * @returns {string}
 */
export function censusReport({
  rows = [],
  total = rows.length,
  silentDays = DEFAULT_SILENT_DAYS,
  maxRows = DEFAULT_MAX_ROWS,
  nowMs = Date.now(),
  projectRef = null,
} = {}) {
  const lines = [];
  lines.push(
    `📡 relevé du parc — ${total} poste(s) recensé(s) · base partagée ${projectRef ?? 'ref inconnue'}` +
      ` · version installée et dernier contrôle`,
  );

  if (total === 0) {
    lines.push('');
    lines.push('   aucun poste recensé. C’est un fait, pas un feu vert :');
    lines.push('   · soit aucun poste n’a encore battu (le battement vient d’être livré) ;');
    lines.push('   · soit le relevé regarde la mauvaise base (vérifier la ref ci-dessus).');
  }

  lines.push('');
  lines.push('── répartition par version ─────────────────────────────────────');
  for (const { version, count, share } of versionDistribution(rows)) {
    lines.push(`   ${version.padEnd(12)} ${String(count).padStart(4)} poste(s)  ${String(Math.round(share * 100)).padStart(3)} %  ${bar(share)}`);
  }

  lines.push('');
  lines.push('── dernier contrôle de mise à jour ─────────────────────────────');
  for (const { state, count } of checkStateBreakdown(rows)) {
    const note =
      state === 'ok'
        ? ''
        : state === 'feed-absent'
          ? '   ← le flux est absent de l’origine publique'
          : state === 'html'
            ? '   ← l’origine a répondu du HTML (un flux disparu n’est pas un 404)'
            : state === 'unreachable'
              ? '   ← l’origine n’a pas répondu'
              : '   ← état inconnu de cette commande';
    lines.push(`   ${state.padEnd(12)} ${String(count).padStart(4)}${note}`);
  }
  const failing = rows.filter((row) => String(row?.last_check ?? '') !== 'ok').length;
  if (failing > 0) {
    lines.push(`   ⚠️  ${failing} poste(s) battent mais leur dernier contrôle n’a PAS abouti — ils ne sont pas sains.`);
  }

  const silent = silentStations(rows, { silentDays, nowMs });
  lines.push('');
  lines.push(`── postes SILENCIEUX (aucun battement depuis ${silentDays} jour(s)) ─────────`);
  if (silent.length === 0) {
    lines.push('   aucun : tous les postes recensés ont battu dans la fenêtre.');
  } else {
    for (const entry of silent) {
      const age = entry.days === null ? entry.note : `${entry.days.toFixed(1)} jour(s)`;
      lines.push(`   ${entry.stationId.padEnd(24)} ${entry.seenAt ?? '(sans horodatage)'}  ${age}`);
    }
    lines.push('');
    lines.push(
      `   ${silent.length} poste(s) à ne PAS compter comme à jour : leur version est peut-être la bonne,` +
        ' mais rien ne l’a dit depuis la fenêtre.',
    );
  }

  lines.push('');
  lines.push('── ce que ce relevé ne peut pas voir ───────────────────────────');
  lines.push('   un poste qui n’a JAMAIS battu est invisible ici : on ne nomme pas ce qu’on n’a jamais vu.');
  lines.push('   La bascule du parc (§6) se prouve donc poste par poste AUSSI — ce relevé ne la remplace pas.');
  lines.push(`   Seuil de volume : ${maxRows} ligne(s).`);
  return lines.join('\n');
}

/** Le relevé lu à la base : une page bornée, et le compte EXACT dans l'en-tête. */
async function readFleet({ base, key, maxRows, fetchImpl = fetch }) {
  const url =
    `${base}/rest/v1/station_versions?select=${COLUMNS}&order=seen_at.desc&limit=${maxRows + 1}`;
  const res = await fetchImpl(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      // `count=exact` rend le compte total dans `content-range` (« 0-199/241 ») :
      // un relevé borné peut donc dire « il y en a 241 » sans les télécharger.
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `la base a répondu HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}` };
  }
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { error: 'la base n’a pas rendu une liste de lignes' };
  const range = res.headers?.get?.('content-range') ?? '';
  const declared = Number(String(range).split('/')[1]);
  return { rows, total: Number.isFinite(declared) ? declared : rows.length };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (flags.problems.length > 0) {
    for (const problem of flags.problems) console.error(`❌ ${problem}`);
    console.error(USAGE);
    process.exit(2);
  }

  // Le `.env` est lu par le lecteur du dépôt (`parseEnvFile`) : une troisième
  // copie de ce parseur divergerait — c'est la leçon écrite dans hosted-db.mjs.
  const env = { ...parseEnvFile(join(root, '.env')), ...process.env };
  const key = [env.SUPABASE_SERVICE_ROLE_KEY, env.SERVICE_ROLE_KEY].find((v) => v && String(v).trim());
  if (!key) {
    console.error(
      '❌ SUPABASE_SERVICE_ROLE_KEY absente — la table des battements est ILLISIBLE par la clé publique, ' +
        'donc ce relevé ne peut pas être rendu. Ce n’est pas un parc vide, c’est un relevé qui n’a pas eu lieu.',
    );
    process.exit(2);
  }
  // L'origine : celle de l'environnement quand elle est donnée (une base de test
  // se recense aussi), sinon LA base partagée — définie une seule fois dans
  // `scripts/lib/shared-project.mjs`, jamais recopiée ici.
  const base = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || SHARED_PROJECT_URL).replace(/\/$/, '');

  let fleet;
  try {
    fleet = await readFleet({ base, key: String(key).trim(), maxRows: flags.maxRows });
  } catch (error) {
    console.error(`❌ base injoignable (${base}) — ${error?.message ?? error}`);
    process.exit(2);
  }
  if (fleet.error) {
    console.error(`❌ ${fleet.error}`);
    process.exit(2);
  }

  const nowMs = Date.now();
  console.log(
    censusReport({
      rows: fleet.rows,
      total: fleet.total,
      silentDays: flags.silentDays,
      maxRows: flags.maxRows,
      nowMs,
      projectRef: projectRefOf(base),
    }),
  );

  const verdict = volumeVerdict({ total: fleet.total, maxRows: flags.maxRows });
  if (!verdict.ok) {
    console.error(`\n❌ ${verdict.problem}`);
    process.exit(1);
  }
  process.exit(0);
}

// Le garde d'entrée du dépôt : importer ce fichier (une suite de tests, par
// exemple) ne doit rien lire, rien imprimer et rien quitter.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`❌ relevé interrompu — ${error?.stack ?? error?.message ?? error}`);
    process.exit(2);
  });
}
