/**
 * ─── Quand redemander ──────────────────────────────────────────────────────
 *
 * L'auto-update existait déjà, mais il ne posait sa question qu'**une fois**,
 * cinq secondes après le démarrage. Un poste d'école reste ouvert des journées
 * entières : une version publiée le matin n'était donc jamais annoncée à qui
 * avait déjà lancé l'application, et « Plus tard » valait « jamais » — la
 * fenêtre ne se rouvrait qu'au démarrage suivant. Résultat : la mise à jour ne
 * circulait pas chez les gens qui avaient installé le setup, ce qui est
 * exactement la demande.
 *
 * Ce module ne fait qu'une chose : décider QUAND on redemande. Il est pur (des
 * horodatages en entrée, une décision en sortie), donc la cadence est testée
 * comme une décision et non observée en attendant une demi-heure.
 *
 * Trois règles, et chacune a sa raison :
 *   • **re-vérifier périodiquement** — sinon l'app ouverte ne voit rien passer ;
 *   • **re-vérifier au retour sur la fenêtre** — le moment où l'utilisateur est
 *     là, donc le bon moment pour lui parler, mais pas à chaque alt-tab (d'où
 *     le délai minimal entre deux vérifications) ;
 *   • **relancer le rappel après un report** — un « plus tard » honnête, pas un
 *     refus définitif : la version est déjà téléchargée, ne pas la proposer
 *     reviendrait à la garder pour soi.
 */

/** Toutes les 30 min : assez pour une journée de travail, assez peu pour ne pas marteler le service. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Jamais deux vérifications à moins de 10 min d'intervalle, même au retour sur la fenêtre. */
const FOCUS_COOLDOWN_MS = 10 * 60 * 1000;

/** Un report vaut 15 min, puis la question revient. */
const RE_PROMPT_MS = 15 * 60 * 1000;

/**
 * ─── Jusqu'où un poste peut rester en retard ───────────────────────────────
 *
 * Les trois règles ci-dessus rendent la mise à jour VISIBLE ; elles ne la
 * rendent pas obligatoire, et c'est le trou qui restait : « Plus tard » offert,
 * un poste d'école peut rester des mois sur la même version sans que personne
 * ne décide jamais de ne pas la faire. Un poste en 1.0.0 pendant qu'une 2.0.0
 * est publiée n'est pas « en retard de quelques jours » : il exécute un autre
 * logiciel, avec ses correctifs absents.
 *
 * Trois seuils, et pas un seul, parce qu'un retard ne se mesure pas de la même
 * façon selon la distance :
 *   • **une version majeure** — le saut le plus coûteux à laisser traîner ;
 *   • **deux versions mineures** dans la même majeure — un trimestre de
 *     correctifs, et le signal qu'un poste n'a pas été mis à jour depuis
 *     longtemps alors que rien ne l'empêchait ;
 *   • **une publication vieille de 45 jours toujours pas installée** — le filet
 *     qui attrape le cas le plus courant, celui d'une version « mineure » qui
 *     reste, parce que ce n'est pas le numéro qui compte mais le fait :
 *     quelqu'un l'a publiée, personne ne l'a prise.
 *
 * Deux asymétries assumées, dans le même sens que l'horloge qui recule :
 *   • une version illisible ne force RIEN. Forcer est une contrainte sur
 *     l'utilisateur ; on ne l'impose pas sur une supposition. Ici, se tromper
 *     dans le sens permissif coûte un poste en retard — dans l'autre sens, ça
 *     bloque un poste sous un prétexte inventé ;
 *   • la date de publication absente n'empêche que la règle de date, pas les
 *     deux autres : chaque règle juge ce qu'elle sait.
 */
const FORCED_MAJOR_BEHIND = 1;

/** Deux mineures de retard, même majeure. */
const FORCED_MINOR_BEHIND = 2;

/** Une version publiée depuis 45 jours et toujours pas installée. */
const FORCED_RELEASE_AGE_DAYS = 45;

/** Une obligation ne se reporte pas : elle se rappelle, et vite. */
const FORCED_RE_PROMPT_MS = 60 * 1000;

/**
 * Faut-il (re)vérifier maintenant ?
 * @param {{ kind?: 'interval' | 'focus' | 'startup', lastCheckAt?: number | null,
 *   nowMs?: number, checkIntervalMs?: number, focusCooldownMs?: number }} input
 * @returns {{ check: boolean, reason: string }}
 */
function shouldCheck({
  kind = 'interval',
  lastCheckAt = null,
  nowMs = Date.now(),
  checkIntervalMs = CHECK_INTERVAL_MS,
  focusCooldownMs = FOCUS_COOLDOWN_MS,
} = {}) {
  // Un premier démarrage vérifie toujours : c'est le seul moment où l'on sait
  // qu'un poste vient d'être ouvert.
  if (lastCheckAt === null || lastCheckAt === undefined) {
    return { check: true, reason: 'première vérification du process' };
  }
  const since = nowMs - Number(lastCheckAt);
  if (!Number.isFinite(since) || since < 0) {
    // Horloge qui recule (fuseau, NTP, veille) : on ne peut rien en déduire, et
    // refuser serait pire que vérifier une fois de trop.
    return { check: true, reason: 'horodatage incohérent — on vérifie' };
  }
  const limit = kind === 'focus' ? focusCooldownMs : checkIntervalMs;
  if (since < limit) {
    return { check: false, reason: `trop tôt (${Math.round(since / 1000)} s < ${Math.round(limit / 1000)} s)` };
  }
  return { check: true, reason: kind === 'focus' ? 'retour sur la fenêtre' : 'intervalle écoulé' };
}

/**
 * Faut-il (re)demander à l'utilisateur d'installer ?
 *
 * @param {{ downloaded: boolean, lastPromptAt?: number | null, nowMs?: number,
 *   rePromptMs?: number }} input
 * @returns {{ prompt: boolean, reason: string }}
 */
function shouldPrompt({
  downloaded,
  lastPromptAt = null,
  nowMs = Date.now(),
  rePromptMs = RE_PROMPT_MS,
  forced = false,
} = {}) {
  if (!downloaded) return { prompt: false, reason: 'rien de téléchargé' };
  // Obligatoire : le report n'existe pas. Le premier « plus tard » a déjà été
  // accordé — au poste de ne pas rester des mois, donc à la question de
  // revenir tout de suite (et non dans 15 min).
  if (forced) return { prompt: true, reason: 'mise à jour obligatoire : le report ne s’applique pas' };
  if (lastPromptAt === null || lastPromptAt === undefined) {
    return { prompt: true, reason: 'première proposition' };
  }
  const since = nowMs - Number(lastPromptAt);
  if (!Number.isFinite(since) || since >= rePromptMs) {
    return { prompt: true, reason: 'le report a expiré — la question revient' };
  }
  return { prompt: false, reason: `report en cours (${Math.round(since / 1000)} s)` };
}

/**
 * « 1.4.2 » → { major: 1, minor: 4, patch: 2 }. `null` si ce n'est pas une
 * version : on ne devine pas un numéro à partir d'une chaîne libre.
 * @param {unknown} value
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
}

/**
 * Le retard de ce poste est-il devenu intolérable ?
 *
 * @param {{ currentVersion?: unknown, availableVersion?: unknown, releaseDate?: unknown,
 *   nowMs?: number, majorBehind?: number, minorBehind?: number, releaseAgeDays?: number }} input
 * @returns {{ forced: boolean, code: 'major' | 'minor' | 'age' | 'none' | 'unknown',
 *   behindMajor: number | null, behindMinor: number | null, releaseAgeDays: number | null,
 *   detail: string }}
 */
function updatePressure({
  currentVersion = null,
  availableVersion = null,
  releaseDate = null,
  nowMs = Date.now(),
  majorBehind = FORCED_MAJOR_BEHIND,
  minorBehind = FORCED_MINOR_BEHIND,
  releaseAgeDays = FORCED_RELEASE_AGE_DAYS,
} = {}) {
  const current = parseVersion(currentVersion);
  const available = parseVersion(availableVersion);
  if (!current || !available) {
    return {
      forced: false,
      code: 'unknown',
      behindMajor: null,
      behindMinor: null,
      releaseAgeDays: null,
      detail: 'version locale ou disponible illisible — forcer serait deviner',
    };
  }
  const behindMajor = available.major - current.major;
  // Un écart de mineure ne veut rien dire entre deux majeures différentes
  // (2.0.0 vs 1.9.0 n'est pas « une mineure de retard »).
  const behindMinor = behindMajor === 0 ? available.minor - current.minor : null;
  const ageMs = releaseDate === null || releaseDate === undefined ? NaN : nowMs - Date.parse(String(releaseDate));
  const ageDays = Number.isFinite(ageMs) && ageMs >= 0 ? Math.floor(ageMs / 86400000) : null;

  const base = { behindMajor: Math.max(0, behindMajor), behindMinor, releaseAgeDays: ageDays };
  if (behindMajor >= majorBehind) {
    return { ...base, forced: true, code: 'major', detail: `${behindMajor} version(s) majeure(s) de retard` };
  }
  if (behindMinor !== null && behindMinor >= minorBehind) {
    return { ...base, forced: true, code: 'minor', detail: `${behindMinor} version(s) mineure(s) de retard` };
  }
  if (ageDays !== null && ageDays >= releaseAgeDays) {
    return {
      ...base,
      forced: true,
      code: 'age',
      detail: `version publiée il y a ${ageDays} jour(s), toujours pas installée`,
    };
  }
  return {
    ...base,
    forced: false,
    code: 'none',
    detail: ageDays === null
      ? 'retard sous le seuil (date de publication illisible — la règle de date ne juge pas)'
      : 'retard sous le seuil',
  };
}

/**
 * Que peut faire une installation pour appliquer la mise à jour ?
 *
 * Le portable ne peut pas s'auto-installer : electron-updater a besoin de
 * l'installeur NSIS. Le laisser muet serait le trahir — il apprend l'existence
 * de la version et reçoit un lien, c'est le mieux qu'il puisse avoir.
 * @param {{ isPortable?: boolean }} input
 * @returns {{ action: 'restart' | 'open-download', detail: string }}
 */
function updateAction({ isPortable = false } = {}) {
  return isPortable
    ? {
        action: 'open-download',
        detail: 'version portable : téléchargement manuel (l’installation automatique exige l’installeur NSIS)',
      }
    : { action: 'restart', detail: 'version installée : redémarrage pour appliquer' };
}

module.exports = {
  CHECK_INTERVAL_MS,
  FOCUS_COOLDOWN_MS,
  RE_PROMPT_MS,
  FORCED_MAJOR_BEHIND,
  FORCED_MINOR_BEHIND,
  FORCED_RELEASE_AGE_DAYS,
  FORCED_RE_PROMPT_MS,
  parseVersion,
  shouldCheck,
  shouldPrompt,
  updatePressure,
  updateAction,
};
