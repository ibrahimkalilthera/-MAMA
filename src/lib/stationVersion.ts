/**
 * Le battement de version d'un poste — la moitié qui COMPOSE et qui ENVOIE.
 *
 * ─── Pourquoi ce module existe ──────────────────────────────────────────────
 * La section 6 du canal de mise à jour ne peut pas se vérifier toute seule :
 * « le parc est passé » exige un relevé par poste, sinon la question se prouve
 * machine par machine — c'est-à-dire ne se prouve pas (`npm run fleet:versions`
 * n'avait rien à lire). Le poste écrit donc, au démarrage, une ligne qui dit
 * seulement : qui il est (un identifiant ALÉATOIRE), quelle version il exécute,
 * le majeur de son système, et ce que son dernier contrôle de mise à jour a
 * rendu. Aucun nom, aucun compte, aucune donnée d'école : c'est un recensement
 * de parc, pas une télémétrie d'usage.
 *
 * ─── Le partage des rôles, et pourquoi il est là ────────────────────────────
 * Le processus principal INSCRIT (il a l'état de l'updater dans la main) ; ce
 * module LIT ce qu'il a inscrit et l'emporte par le client Supabase de
 * l'application. C'est exactement le partage déjà payé par le journal du poste
 * (`electron/update-journal.cjs` + `desktopUpdateReport.ts`) : le local ne
 * dépend ni du réseau ni d'une session, et le distant ne devine rien.
 *
 * ─── Trois règles, et chacune évite un défaut précis ────────────────────────
 *   • **la composition est PURE** (`stationBeatArgs`) : ce qui part est décidé
 *     et testé ici, jamais recopié dans un composant — et un battement que la
 *     base REFUSERAIT n'est jamais envoyé à l'aveugle (`stationBeatProblem` le
 *     nomme avant l'appel, au lieu de laisser un 400 muet dans la console) ;
 *   • **un échec n'est jamais fatal** : l'application continue, et le relevé
 *     perd une ligne, pas la mise à jour. Une écriture refusée n'a AUCUN effet
 *     sur le canal — c'est la propriété que la spécification exige ;
 *   • **le silence de la page web est normal** : sans pont de bureau, il n'y a
 *     ni identité de poste ni état d'updater, donc rien à dire. C'est un
 *     no-op silencieux, pas une erreur à signaler.
 *
 * ─── Ce que le module ne fait jamais ────────────────────────────────────────
 * Il n'invente, ne journalise et ne transmet rien d'autre que les cinq champs
 * ci-dessous. Le nom de machine qui existe ailleurs (dans le journal des
 * blocages) n'entre PAS ici : la spécification range le battement hors de toute
 * identité, et un relevé qui porterait un nom d'école serait une autre chose.
 */

/** Les quatre états du dernier contrôle, ceux que la migration accepte. */
export const LAST_CHECK_STATES = ['ok', 'feed-absent', 'html', 'unreachable'] as const;

/**
 * Le nom de la fonction de la base — le SEUL chemin d'écriture de la table.
 *
 * Exporté parce qu'il est vérifié ailleurs : `tests/station-version.test.ts`
 * compare ce nom, et les noms d'arguments ci-dessous, à la signature réellement
 * déclarée par la migration. Un renommage d'un seul côté doit rougir, pas
 * produire un 400 que personne ne lit.
 */
export const STATION_BEAT_RPC = 'record_station_beat';

export type LastCheckState = (typeof LAST_CHECK_STATES)[number];

/**
 * Les bornes de longueur, écrites AUSSI dans la migration
 * (`station_versions_station_id_bounds` et ses sœurs).
 *
 * Elles sont ici pour la même raison qu'un refus est ici : la base refuse une
 * ligne invalide, et un poste qui enverrait quand même cette ligne n'apprendrait
 * son refus que par une réponse HTTP qu'il ne lit pas. Deux copies qui doivent
 * s'accorder, donc — et `fleet-versions` comme la migration les nomment pareil.
 */
const BOUNDS = {
  appVersion: [1, 32],
  lastCheckVersion: [1, 32],
  osVersion: [1, 32],
  stationId: [8, 64],
} as const;

/** Ce que le pont de bureau rend : le battement tel que le poste l'a inscrit. */
export interface StationBeatPayload {
  stationId?: string | null;
  appVersion?: string | null;
  osVersion?: string | null;
  lastCheck?: string | null;
  lastCheckVersion?: string | null;
  /** Quand le contrôle a été fait, tel que le poste l'a horodaté. */
  checkedAt?: string | null;
}

/**
 * Les arguments de l'appel, nommés comme la fonction de la base
 * (`public.record_station_beat`) : c'est le seul chemin d'écriture, et le nom
 * d'un argument faux ferait un 400 que personne ne lirait.
 */
export interface StationBeatArgs {
  p_station_id: string;
  p_app_version: string;
  p_os_version: string | null;
  p_last_check: LastCheckState;
  p_last_check_version: string | null;
}

/** Le pont, réduit au seul canal qui sert au battement. */
export interface StationBeatApi {
  stationBeat?: () => Promise<StationBeatPayload | null>;
}

export interface StationBeatOutcome {
  /** La ligne a-t-elle été enregistrée ? */
  sent: boolean;
  /** Ce qui s'est passé, lisible par un humain — vide quand il n'y avait rien à dire. */
  detail: string;
}

export type StationBeatRpc = (args: StationBeatArgs) => Promise<boolean>;

const text = (value: unknown): string => (value == null ? '' : String(value).trim());

/** Un texte borné, ou `null` : l'absence ne part jamais en chaîne vide. */
const optionalText = (value: unknown, [min, max]: readonly [number, number]): string | null | false => {
  const raw = text(value);
  if (!raw) return null;
  return raw.length >= min && raw.length <= max ? raw : false;
};

const inBounds = (value: string, [min, max]: readonly [number, number]): boolean =>
  value.length >= min && value.length <= max;

/**
 * Pourquoi ce battement ne partirait pas — et rien quand il partirait.
 *
 * Un refus NOMMÉ, jamais un `null` muet : c'est ce qui permet à l'appelant de
 * dire ce qui manque (un identifiant trop court, un état de contrôle inconnu)
 * au lieu de laisser croire que tout allait bien. La base applique les mêmes
 * bornes : les deux refusent, mais seule cette moitié-ci peut l'expliquer.
 *
 * @param beat ce que le pont a rendu
 * @returns le motif du refus, ou `null` si le battement est valide.
 */
export function stationBeatProblem(beat: StationBeatPayload | null | undefined): string | null {
  if (!beat || typeof beat !== 'object') return 'aucun battement à envoyer';
  const stationId = text(beat.stationId);
  if (!stationId) return 'identifiant de poste absent';
  if (!inBounds(stationId, BOUNDS.stationId)) {
    return `identifiant de poste de longueur ${stationId.length} hors bornes (${BOUNDS.stationId[0]}..${BOUNDS.stationId[1]})`;
  }
  const appVersion = text(beat.appVersion);
  if (!inBounds(appVersion, BOUNDS.appVersion)) {
    return `version installée de longueur ${appVersion.length} hors bornes (${BOUNDS.appVersion[0]}..${BOUNDS.appVersion[1]})`;
  }
  const lastCheck = text(beat.lastCheck);
  if (!(LAST_CHECK_STATES as readonly string[]).includes(lastCheck)) {
    return `état de contrôle inconnu « ${lastCheck || '(vide)'} » (attendu : ${LAST_CHECK_STATES.join(', ')})`;
  }
  const osVersion = optionalText(beat.osVersion, BOUNDS.osVersion);
  if (osVersion === false) {
    return `version de système de longueur ${text(beat.osVersion).length} hors bornes (0..${BOUNDS.osVersion[1]})`;
  }
  const lastCheckVersion = optionalText(beat.lastCheckVersion, BOUNDS.lastCheckVersion);
  if (lastCheckVersion === false) {
    return `version proposée de longueur ${text(beat.lastCheckVersion).length} hors bornes (0..${BOUNDS.lastCheckVersion[1]})`;
  }
  return null;
}

/**
 * Les arguments de l'appel — ou `null` si la base refuserait ce battement.
 *
 * Pure : elle ne lit rien, n'écrit rien, et ne connaît ni le pont ni Supabase.
 * C'est ce qui rend la composition testable sans configuration, et c'est aussi
 * ce qui garantit qu'un battement invalide ne part pas « pour voir ».
 *
 * @param beat ce que le pont a rendu
 * @returns les arguments nommés, ou `null` (voir `stationBeatProblem`).
 */
export function stationBeatArgs(beat: StationBeatPayload | null | undefined): StationBeatArgs | null {
  if (stationBeatProblem(beat)) return null;
  const source = beat as StationBeatPayload;
  return {
    p_station_id: text(source.stationId),
    p_app_version: text(source.appVersion),
    // `null` et non `''` : la colonne accepte l'absence, pas une chaîne vide qui
    // se lirait comme une valeur.
    p_os_version: optionalText(source.osVersion, BOUNDS.osVersion) || null,
    p_last_check: text(source.lastCheck) as LastCheckState,
    p_last_check_version: optionalText(source.lastCheckVersion, BOUNDS.lastCheckVersion) || null,
  };
}

/**
 * Lire le battement que le processus principal a inscrit sur ce poste.
 *
 * Le pont est absent sur la page web, et le battement peut être DÉSACTIVÉ sur
 * une machine (`STATION_HEARTBEAT=off`, décidé côté processus principal) : les
 * deux cas rendent `null`, et c'est voulu — l'appelant n'a rien à distinguer, il
 * n'a rien à envoyer. Un pont qui répond mal ne doit pas non plus faire tomber
 * l'application : on rend `null` et on se tait.
 *
 * @param api le pont (injecté dans les tests)
 * @returns le battement, ou `null` quand il n'y en a pas.
 */
export async function readStationBeat(api?: StationBeatApi | null): Promise<StationBeatPayload | null> {
  const bridge = api ?? (globalThis as { desktop?: { updates?: StationBeatApi } }).desktop?.updates ?? null;
  if (!bridge?.stationBeat) return null;
  try {
    const beat = await bridge.stationBeat();
    return beat && typeof beat === 'object' ? beat : null;
  } catch {
    // Un pont muet n'est pas un incident : le prochain démarrage retentera.
    return null;
  }
}

/**
 * L'appel réel, chargé PARESSEUSEMENT.
 *
 * L'import du client Supabase vit ici et jamais à l'import du module : c'est ce
 * qui permet d'importer ce fichier (et de le tester) sans configuration, sans
 * clé et sans effet de bord. Le nom de la fonction est littéral, et le transtypage
 * est DIT : `database.types.ts` est régénéré avec la migration, donc le jour où
 * les deux divergent, c'est la compilation qui le dit.
 */
const supabaseRpc: StationBeatRpc = async (args) => {
  const { supabase } = await import('./supabaseClient');
  const call = supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ error: { message?: string } | null }>;
  const { error } = await call(STATION_BEAT_RPC, args as unknown as Record<string, unknown>);
  if (error) throw new Error(error.message ?? 'appel refusé');
  return true;
};

/**
 * Envoyer le battement de ce poste, une fois.
 *
 * Trois issues, et aucune n'est une exception :
 *   • **rien à envoyer** (page web, battement désactivé, pont muet) — un no-op
 *     silencieux, sans détail : il n'y a pas d'échec à raconter ;
 *   • **battement invalide** — refusé AVANT l'appel, avec son motif, et la base
 *     n'est pas réveillée pour rien ;
 *   • **appel refusé** — `sent: false` et la raison rendue à l'appelant, qui
 *     décide de la montrer ou non. Un battement est un relevé de parc : il ne
 *     doit jamais gêner le travail de l'école.
 *
 * @param options.api le pont (défaut : celui de la page)
 * @param options.rpc l'appel (défaut : le client Supabase de l'application)
 * @param options.log où dire un refus (défaut : la console)
 * @returns `sent` et un détail lisible.
 */
export async function sendStationBeat(
  options: {
    api?: StationBeatApi | null;
    rpc?: StationBeatRpc;
    log?: (message: string) => void;
  } = {},
): Promise<StationBeatOutcome> {
  const beat = await readStationBeat(options.api);
  if (!beat) return { sent: false, detail: '' };

  const problem = stationBeatProblem(beat);
  if (problem) {
    const detail = `battement non envoyé — ${problem}`;
    (options.log ?? console.warn)(detail);
    return { sent: false, detail };
  }

  const args = stationBeatArgs(beat) as StationBeatArgs;
  try {
    const ok = await (options.rpc ?? supabaseRpc)(args);
    if (!ok) {
      const detail = 'battement refusé par la base';
      (options.log ?? console.warn)(detail);
      return { sent: false, detail };
    }
    return { sent: true, detail: `battement enregistré — version ${args.p_app_version}` };
  } catch (error) {
    const detail = `battement refusé : ${(error as Error)?.message || 'cause inconnue'}`;
    (options.log ?? console.warn)(detail);
    return { sent: false, detail };
  }
}
