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
 * ─── Ce que ce relevé doit dire de la FORME d'un poste (2026-10-21) ─────────
 * Depuis le 2026-10-16, un poste portable s'installe lui-même et devient un
 * poste INSTALLÉ, qui se met à jour tout seul ensuite : il n'est plus condamné à
 * rester en arrière. Le geste était décidé, éprouvé, justifié — mais INVISIBLE.
 * Le relevé portait la version et le dernier contrôle, jamais la forme : « le
 * parc s'est converti » restait donc une espérance, et un poste encore portable
 * ne se distinguait pas d'un poste converti — le même défaut que la section 6 a
 * payé trois jours en septembre, une affirmation que personne ne peut confirmer.
 *
 * Deux lectures sont donc ajoutées ici, et elles ne disent PAS la même chose :
 *   • la forme DÉCLARÉE par chaque poste au dernier battement (`install_mode`) :
 *     qui se met à jour tout seul, et qui — resté portable — ne se corrigera
 *     PAS à distance (il lui faut une installation manuelle, une fois) ;
 *   • la trace `converted_at` / `converted_to_version`, posée par la BASE à la
 *     PREMIÈRE conversion portable → installé OBSERVÉE sur ce poste : une
 *     conversion datée, donc un FAIT, au lieu d'une supposition.
 *
 * Et la sortie nomme seulement ce qu'elle a vu : un poste converti AVANT
 * l'arrivée de ce champ n'a laissé aucune trace, et c'est dit — un zéro
 * silencieux se lirait comme « il ne s'est rien passé ».
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

import { publishEvidence } from './lib/evidence-publisher.mjs';
import { parseEnvFile } from './lib/hosted-db.mjs';
import { SHARED_PROJECT_URL, projectRefOf } from './lib/shared-project.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Un poste vérifie au démarrage, toutes les 30 min et au retour sur la fenêtre. */
export const DEFAULT_SILENT_DAYS = 7;

/** Très au-dessus du parc réel (quelques dizaines) : un seuil serré crierait au loup. */
export const DEFAULT_MAX_ROWS = 200;

const DAY_MS = 86_400_000;
const CHECK_STATES = ['ok', 'feed-absent', 'html', 'unreachable'];

/** Les deux formes d'installation que la base accepte, et elles seules. */
const INSTALL_MODES = ['portable', 'installed'];

/**
 * La migration qui a porté la forme du poste et la trace des conversions.
 *
 * Elle est NOMMÉE ici pour une raison précise : le jour où le relevé demande une
 * colonne que la base n'a pas encore, le refus ne dit pas seulement « HTTP 400 »
 * — il dit QUELLE migration appliquer. Un lecteur ne se baisse pas au niveau de
 * la base ; c'est la base qu'on met à niveau (même règle que `db-ready`).
 */
export const STATION_INSTALL_MODE_MIGRATION = '20261021000000_station_install_mode.sql';

/** Les colonnes ajoutées par cette migration, nommées pour ce refus-là. */
export const INSTALL_MODE_COLUMNS = ['install_mode', 'converted_at', 'converted_to_version'];

const COLUMNS = [
  'station_id',
  'app_version',
  'os_version',
  'last_check',
  'last_check_version',
  'seen_at',
  ...INSTALL_MODE_COLUMNS,
].join(',');

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
 * La FORME des postes, telle que chacun la déclare — et le nombre de ceux qui ne
 * la déclarent pas.
 *
 * Une forme inconnue est COMPTÉE (jamais fondue dans « installed ») : la base
 * contraint l'énumération, donc une valeur hors liste ne peut venir que d'une
 * ligne écrite à la main — et la fondre dans la forme la plus favorable ferait
 * dire au relevé l'inverse de ce qu'il a lu. Le nombre de postes SANS forme est
 * rendu à part pour la même raison : « pas mesurée » (poste resté sur une version
 * qui ne l'envoie pas) n'est pas « installé ».
 *
 * @param {object[]} rows
 * @returns {{ modes: { mode: string, count: number }[], unmeasured: number }}
 */
export function installModeBreakdown(rows = []) {
  const counts = new Map(INSTALL_MODES.map((mode) => [mode, 0]));
  let unmeasured = 0;
  for (const row of rows) {
    const mode = String(row?.install_mode ?? '').trim();
    if (!mode) {
      unmeasured += 1;
      continue;
    }
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return {
    modes: [...counts.entries()].map(([mode, count]) => ({ mode, count })),
    unmeasured,
  };
}

/**
 * Les conversions portable → installé OBSERVÉES — nommées, datées, jamais
 * déduites.
 *
 * Une ligne n'entre ici QUE si la base a inscrit `converted_at` : c'est la seule
 * source de ce fait, et elle ne l'écrit qu'en voyant une ligne `portable`
 * remplacée par une ligne `installed`. Un poste installé depuis toujours n'y est
 * donc pas — et c'est voulu : on ne compte pas comme converti ce qu'on n'a jamais
 * vu portable. La version inscrite est celle du PASSAGE, pas celle du jour.
 *
 * Le cas `backToPortable` est une INFORMATION, pas une erreur : la trace reste
 * (le fait a eu lieu), et la forme du jour dit qu'un exe portable a été relancé
 * depuis. La nommer évite qu'un relevé le lise comme une conversion ratée.
 *
 * @param {object[]} rows
 * @returns {{ stationId: string, convertedAt: string, convertedToVersion: string|null,
 *   installMode: string|null, backToPortable: boolean }[]}
 */
/**
 * LA PREMIÈRE conversion observée — celle que ce relevé existe pour annoncer.
 *
 * Le fait n'est pas « la plus récente » : c'est l'ÉVÉNEMENT, le jour où un poste
 * d'école cesse d'être un poste à convertir à la main. Une liste le noie ; cette
 * fonction l'isole pour qu'il soit annoncé en tête du relevé.
 *
 * Un horodatage ILLISIBLE ne peut pas porter ce titre : s'il n'y a que des dates
 * qu'on ne sait pas lire, la fonction rend `null` (et la sortie le dit
 * autrement) — nommer « première conversion » une ligne dont on ignore la date
 * serait annoncer un fait qu'on n'a pas lu. À égalité d'instant (deux postes
 * convertis dans la même seconde), le plus petit identifiant gagne : un relevé
 * relu deux fois dit la même chose.
 *
 * @param {object[]} rows
 * @returns {{ stationId: string, convertedAt: string, convertedToVersion: string|null,
 *   installMode: string|null, backToPortable: boolean, at: number }|null}
 */
export function firstConversion(rows = []) {
  const dated = convertedStations(rows)
    .map((entry) => ({ ...entry, at: Date.parse(entry.convertedAt) }))
    .filter((entry) => Number.isFinite(entry.at));
  if (dated.length === 0) return null;
  return dated.reduce((best, entry) =>
    entry.at < best.at || (entry.at === best.at && entry.stationId < best.stationId) ? entry : best,
  );
}

export function convertedStations(rows = []) {
  const out = [];
  for (const row of rows) {
    const convertedAt = String(row?.converted_at ?? '').trim();
    if (!convertedAt) continue;
    const installMode = String(row?.install_mode ?? '').trim() || null;
    out.push({
      stationId: String(row?.station_id ?? '').trim() || '(identifiant illisible)',
      convertedAt,
      convertedToVersion: String(row?.converted_to_version ?? '').trim() || null,
      installMode,
      backToPortable: installMode === 'portable',
    });
  }
  // La plus récente d'abord, et une date ILLISIBLE passe en dernier sans
  // disparaître : un horodatage qu'on n'a pas su lire ne retire pas le fait.
  return out.sort((a, b) => (Date.parse(b.convertedAt) || 0) - (Date.parse(a.convertedAt) || 0));
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
      ` · version installée, forme du poste et dernier contrôle`,
  );

  // ── L'ANNONCE, et pourquoi elle passe EN PREMIER ────────────────────────
  // Les conversions sont listées plus bas, avec le reste du relevé — et c'est
  // exactement le défaut : une liste se lit quand on la cherche. Or la PREMIÈRE
  // conversion est l'événement que ce relevé existe pour rendre visible : le
  // jour où un poste cesse d'être un poste à convertir à la main. Elle est donc
  // annoncée ici, en tête, et son ABSENCE est annoncée aussi — un silence se
  // lirait comme un relevé qui n'a pas regardé.
  const conversions = convertedStations(rows);
  const first = firstConversion(rows);
  lines.push('');
  if (first) {
    lines.push(`🔔 PREMIÈRE conversion portable → installé observée le ${first.convertedAt}`);
    lines.push(
      `   poste ${first.stationId} — version du passage ${first.convertedToVersion ?? '(non inscrite)'}` +
        (first.backToPortable ? ' — relancé en portable depuis (la trace reste)' : ''),
    );
    lines.push('   → ce poste n’a plus besoin d’une installation manuelle : il se met à jour tout seul.');
    if (conversions.length > 1) {
      lines.push(`   (${conversions.length - 1} autre(s) conversion(s) plus récente(s), listées plus bas)`);
    }
    lines.push(
      '   ⚠️ le relevé ne porte AUCUN nom d’école (§7 : un recensement, pas une télémétrie — ' +
        'l’identité du poste est aléatoire et rangée sur la machine).',
    );
  } else {
    lines.push('🔔 aucune conversion portable → installé observée à ce jour.');
    lines.push(
      conversions.length > 0
        ? '   ⚠️ des conversions sont inscrites mais AUCUNE n’a de date lisible — il n’y a donc pas de « première » à annoncer.'
        : '   Aucun poste portable n’a encore basculé — ou aucun poste ne bat encore (voir ci-dessous) : ces deux lectures ne se distinguent pas ici.',
    );
  }

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

  const { modes, unmeasured } = installModeBreakdown(rows);
  lines.push('');
  lines.push('── forme des postes (ce que chaque poste déclare de lui-même) ───');
  // Une seule largeur de colonne pour les trois étiquettes — y compris
  // `(non mesurée)`, la plus longue : un relevé dont les comptes ne s'alignent
  // pas se lit de travers, et c'est un relevé qu'on lit pour décider.
  const modeColumn = 14;
  for (const { mode, count } of modes) {
    const note =
      mode === 'installed'
        ? '   ← la forme qui se met à jour toute seule'
        : mode === 'portable'
          ? '   ← ENCORE portable : ce poste ne se corrige PAS à distance (installation manuelle, une fois)'
          : '   ← forme inconnue de cette commande';
    lines.push(`   ${mode.padEnd(modeColumn)} ${String(count).padStart(4)}${note}`);
  }
  if (unmeasured > 0) {
    lines.push(
      `   ${'(non mesurée)'.padEnd(modeColumn)} ${String(unmeasured).padStart(4)}` +
        '   ← le battement ne portait pas la forme (poste pas encore à jour de ce champ)',
    );
  }

  lines.push('');
  lines.push('── conversions portable → installé OBSERVÉES ───────────────────');
  if (conversions.length === 0) {
    lines.push('   aucune conversion observée. Deux lectures, et ce relevé ne tranche pas :');
    lines.push('   · aucun poste portable ne s’est encore converti (ou il n’y en a aucun) ;');
    lines.push('   · un poste converti AVANT l’arrivée de cette trace n’en a laissé aucune.');
    lines.push(
      '   Ce qui est sûr, dans les deux cas : un poste resté portable ne se corrige pas' +
        ' à distance — une installation manuelle, une fois, et il se met à jour seul ensuite.',
    );
  } else {
    for (const entry of conversions) {
      const version = entry.convertedToVersion ?? '(version du passage non inscrite)';
      lines.push(
        `   ${entry.stationId.padEnd(24)} ${entry.convertedAt}  →  ${version}` +
          (entry.backToPortable ? '  ⚠️ relancé en portable depuis (la trace reste)' : ''),
      );
    }
    lines.push('');
    lines.push(
      `   ${conversions.length} conversion(s) : chacune est un fait DATÉ par la base, pas une espérance.`,
    );
    if (first) {
      lines.push(
        `   La PREMIÈRE — ${first.stationId}, le ${first.convertedAt} — est annoncée en tête de ce relevé.`,
      );
    }
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

/**
 * Le refus de lecture, NOMMÉ — et son REMÈDE quand la base est simplement en
 * retard sur une migration (pure, donc éprouvable sans base ni réseau).
 *
 * Le cas s'est produit et se reproduira : la forme du poste est arrivée dans le
 * CODE avant d'arriver dans la BASE (les migrations sont appliquées à la main),
 * et PostgREST refuse alors la lecture entière — `column
 * station_versions.install_mode does not exist` — parce qu'une colonne inconnue
 * invalide la requête. Un « HTTP 400 » nu enverrait chercher la panne du côté du
 * lecteur ; le remède est une MIGRATION, et il est nommé ici, comme `db-ready`
 * le fait pour le publieur. Un relevé qui baisse les bras devant une base en
 * retard laisserait le parc sans témoin au moment précis où on le change.
 *
 * @param {{ status?: number, body?: string }} [input]
 * @returns {string}
 */
export function readRefusalMessage({ status = 0, body = '' } = {}) {
  const text = String(body ?? '');
  const message = `la base a répondu HTTP ${status}${text ? ` — ${text.slice(0, 160)}` : ''}`;
  const missing = INSTALL_MODE_COLUMNS.filter((column) => text.includes(column));
  if (missing.length === 0) return message;
  return (
    `${message}\n   ⏳ la base est EN RETARD sur la migration « ${STATION_INSTALL_MODE_MIGRATION} » ` +
    `(colonne(s) absente(s) : ${missing.join(', ')}) — on met la BASE à niveau, jamais le relevé :\n` +
    `      npm run db:apply -- supabase/migrations/${STATION_INSTALL_MODE_MIGRATION}`
  );
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
    return { error: readRefusalMessage({ status: res.status, body }) };
  }
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { error: 'la base n’a pas rendu une liste de lignes' };
  const range = res.headers?.get?.('content-range') ?? '';
  const declared = Number(String(range).split('/')[1]);
  return { rows, total: Number.isFinite(declared) ? declared : rows.length };
}

/**
 * La preuve que ce relevé publie — pure, donc éprouvable sans base ni réseau.
 *
 * Le `count` est OMIS quand il n'y a rien à compter, et ce n'est pas un détail :
 * le contrat de preuve REFUSE `--acted --count 0` (« une preuve qui déclare avoir
 * agi sur zéro chose se contredit elle-même »), alors qu'un parc vide est une
 * issue NORMALE du relevé — le jour où le battement vient d'être livré, il n'y a
 * aucun poste à compter. La substance ne disparaît pas pour autant : elle est
 * dans la RAISON, qui nomme le zéro. Mesuré le jour où cette veille a été
 * branchée — un relevé à 0 poste faisait rougir le script sur son propre contrat.
 *
 * Les CONVERSIONS sont nommées seulement quand il y en a : une preuve qui
 * déclarerait « 0 conversion » à chaque exécution d'un parc qui n'en attendait
 * pas ferait du zéro une information qu'il n'est pas. Ce qui compte est dans
 * l'autre sens — le jour où un poste passe de portable à installé, la veille
 * quotidienne le DIT, avec le nombre et la version du passage.
 *
 * Et la PREMIÈRE est annoncée à part, avec sa date : c'est l'événement isolé,
 * celui que l'annotation « Automation evidence » doit porter sans qu'on ait à le
 * déduire d'une liste — une liste, dans un journal de CI, personne ne la lit.
 *
 * @param {{ total?: number, silent?: object[], failing?: number, silentDays?: number,
 *   maxRows?: number, projectRef?: string|null, volumeOk?: boolean,
 *   conversions?: { stationId: string, convertedToVersion: string|null }[],
 *   first?: { stationId: string, convertedToVersion: string|null, convertedAt: string }|null }} [input]
 * @returns {{ acted: boolean, count: number|null, reason: string }}
 */
export function censusEvidence({
  total = 0,
  silent = [],
  failing = 0,
  silentDays = DEFAULT_SILENT_DAYS,
  maxRows = DEFAULT_MAX_ROWS,
  projectRef = null,
  volumeOk = true,
  conversions = [],
  first = null,
} = {}) {
  // L'annonce, en tête de la liste de ce qui a été mesuré : c'est la première
  // conversion OBSERVÉE, datée par la base — le fait que la veille existe pour
  // publier.
  const firstDetail = first
    ? `, 1ʳᵉ conversion portable → installé observée le ${first.convertedAt} ` +
      `(poste ${first.stationId} → ${first.convertedToVersion ?? 'version inconnue'})`
    : '';
  const convertedDetail = conversions.length
    ? `, ${conversions.length} conversion(s) portable → installé observée(s) ` +
      `(${conversions
        .map((entry) => `${entry.stationId} → ${entry.convertedToVersion ?? 'version inconnue'}`)
        .join(', ')})`
    : '';
  return {
    acted: true,
    count: total > 0 ? total : null,
    reason:
      `relevé du parc lu sur la base partagée ${projectRef ?? '(ref inconnue)'} : ` +
      `${total} poste(s) recensé(s), ${silent.length} silencieux depuis ${silentDays} jour(s), ` +
      `${failing} dont le dernier contrôle n’a pas abouti` +
      firstDetail +
      convertedDetail +
      (volumeOk ? '' : ` — VOLUME au-delà du seuil de ${maxRows} ligne(s)`),
  };
}

/**
 * Un refus qui n'a PAS PU REGARDER se dit, puis sort en 2.
 *
 * Le relevé est une automatisation : sans preuve, un run vert ou rouge ne dit
 * pas s'il a seulement lu quelque chose. La substance (« combien de postes, dont
 * combien de silencieux ») part d'ICI, du seul endroit qui la connaît ; le
 * workflow, lui, ne fait que le lancement.
 *
 * Hors mandat (`AUTOMATION_EVIDENCE=1` absent — un lancement à la main, la suite
 * de tests) `publishEvidence` se tait : cette fonction n'ajoute donc rien à la
 * sortie locale, et ne peut pas faire accuser un job qui n'est pas le sien.
 *
 * @param {string} reason
 * @returns {never}
 */
function inertAndExit(reason) {
  publishEvidence({ acted: false, reason });
  process.exit(2);
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
    inertAndExit(`drapeaux refusés : ${flags.problems.join(' ; ')}`);
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
    inertAndExit(
      'SUPABASE_SERVICE_ROLE_KEY absente — la table des battements est ILLISIBLE par la clé publique, ' +
        'donc le relevé n’a pas eu lieu (ce n’est pas un parc vide)',
    );
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
    inertAndExit(`base injoignable (${base}) — ${error?.message ?? error}`);
  }
  if (fleet.error) {
    console.error(`❌ ${fleet.error}`);
    inertAndExit(fleet.error);
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

  // La SUBSTANCE de la preuve : ce que ce relevé a réellement compté. Un run
  // vert qui ne dit pas combien de postes il a vus ne prouve rien de plus qu'un
  // run qui n'a rien regardé — c'est la raison d'être du contrat de preuve.
  const silent = silentStations(fleet.rows, { silentDays: flags.silentDays, nowMs });
  const failing = fleet.rows.filter((row) => String(row?.last_check ?? '') !== 'ok').length;
  const verdict = volumeVerdict({ total: fleet.total, maxRows: flags.maxRows });
  // Les conversions OBSERVÉES partent avec la preuve : c'est le fait que cette
  // veille existe pour publier — un poste d'école qui passe de portable à
  // installé, daté, avec la version du passage.
  const conversions = convertedStations(fleet.rows);
  publishEvidence(
    censusEvidence({
      total: fleet.total,
      silent,
      failing,
      silentDays: flags.silentDays,
      maxRows: flags.maxRows,
      projectRef: projectRefOf(base),
      volumeOk: verdict.ok,
      conversions,
      // L'annonce : la PREMIÈRE conversion observée, datée, publiée avec la
      // preuve — c'est elle que lit l'audit des automatisations, et c'est ce
      // qu'un journal de CI ne laisse pas voir dans une liste.
      first: firstConversion(fleet.rows),
    }),
  );
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
