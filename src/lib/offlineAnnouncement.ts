/**
 * ─── Ce que le poste DOIT DIRE quand il change d'état, et quand il doit se taire
 *
 * Le bandeau hors ligne (`OfflineBanner`) est VISUEL : la bascule hors ligne, le
 * retour de la ligne, la file qui se vide et le refus de la base s'y lisent, mais
 * un lecteur d'écran ne les annonce jamais — `aria-live` n'existait nulle part
 * dans `src/` (mesure du 2026-11-08 : 0 occurrence). L'information la plus
 * importante de l'application était donc rendue en couleur et en icône, pour un
 * guichet qui travaille parfois à l'oreille.
 *
 * Ce module ne rend rien : il décide de la PHRASE. La règle qui compte n'est pas
 * « annoncer l'état courant » — un lecteur d'écran lirait alors le même fait à
 * chaque rendu, et une région qui parle tout le temps ne s'écoute plus. C'est le
 * CHANGEMENT qui est annoncé, une fois :
 *
 *   • un NOUVEAU refus de la base passe avant tout le reste (c'est la seule
 *     nouvelle qui demande un geste) ;
 *   • hors ligne → en ligne : la ligne revient, et ce qui attend part ;
 *   • en ligne → hors ligne : ce que le poste va faire des gestes suivants ;
 *   • la file se VIDE (compte > 0 → 0) : combien de gestes sont arrivés ;
 *   • sinon : `''`, et la région live reste muette.
 *
 * Une clé de traduction absente rend `''` : annoncer le nom d'une clé
 * (`offlineBackOnline`) serait pire que le silence — c'est du bruit qui ne veut
 * rien dire, et il ferait douter du reste des annonces.
 */

/** L'état minimal dont dépend une annonce — aucun objet React, aucun DOM. */
export interface OfflineAnnouncementState {
  online: boolean;
  pendingCount: number;
  pendingFailures: number;
}

/** Les clés lues dans le dictionnaire de traduction. */
export type OfflineAnnouncementDict = Record<string, string | undefined>;

const fill = (template: string | undefined, vars: Record<string, string>): string => {
  if (typeof template !== 'string' || template.trim() === '') return '';
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, value);
  return out;
};

/**
 * La phrase à annoncer pour la transition `prev` → `next`, ou `''`.
 *
 * `prev` nul veut dire « premier rendu » : on n'annonce RIEN au montage. Le
 * bandeau est déjà à l'écran, l'utilisateur n'a pas encore agi, et une annonce
 * d'ouverture se confondrait avec un changement.
 */
export function announcementFor(
  prev: OfflineAnnouncementState | null,
  next: OfflineAnnouncementState,
  t: OfflineAnnouncementDict = {},
  failureReason: string | null = null,
): string {
  if (!prev) return '';

  const pending = Math.max(0, Math.trunc(Number(next.pendingCount) || 0));
  const before = Math.max(0, Math.trunc(Number(prev.pendingCount) || 0));
  const failures = Math.max(0, Math.trunc(Number(next.pendingFailures) || 0));
  const failuresBefore = Math.max(0, Math.trunc(Number(prev.pendingFailures) || 0));

  // 1) Un refus NOUVEAU de la base : la seule nouvelle qui demande un geste.
  if (failures > failuresBefore) {
    const head = fill(t.offlinePendingFailures, { count: String(failures) });
    if (head === '') return '';
    const reason = failureReason ? fill(t.offlineFailureReason, { reason: failureReason }) : '';
    return reason ? `${head} · ${reason}` : head;
  }

  // 2) La ligne revient — et ce qui attendait part maintenant. Le compte est
  // fourni à la phrase : elle n'en parle que si son modèle porte `{count}`.
  if (!prev.online && next.online) {
    return fill(t.offlineBackOnline, { count: String(pending) });
  }

  // 3) On perd la ligne : le poste dit ce qu'il fera des gestes suivants.
  if (prev.online && !next.online) {
    return pending > 0
      ? fill(t.offlinePendingCount, { count: String(pending) })
      : fill(t.offlineChangesWillBeQueuedLocally, {});
  }

  // 4) La file s'est vidée : c'est la fin d'une attente, et elle se dit.
  if (next.online && before > 0 && pending === 0) {
    return fill(t.offlineQueueSynced, { count: String(before) });
  }

  return '';
}
