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
} = {}) {
  if (!downloaded) return { prompt: false, reason: 'rien de téléchargé' };
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
  shouldCheck,
  shouldPrompt,
  updateAction,
};
