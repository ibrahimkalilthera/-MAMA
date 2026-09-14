/**
 * ─── Déconnexion à la SORTIE, pas après un compte à rebours ──────────────────
 *
 * Demande du 2026-09-14 : « enlève complètement la déconnexion auto de tous les
 * comptes après 30 mn ; à la place, déconnecte automatiquement à chaque fois
 * qu'un utilisateur quitte la page ou ferme l'application ».
 *
 * Ce que ça remplace, et pourquoi c'est plus solide : l'ancien minuteur jugeait
 * une DURÉE (30 minutes sans geste) — il laissait donc une session ouverte
 * devant une machine quittée, et il ne la fermait pas quand la personne
 * s'en allait. Celui-ci juge un ÉVÉNEMENT : le départ. Il ne peut pas arriver
 * « trop tard », puisque rien ne s'écoule.
 *
 * Deux moitiés, et la seconde est celle qui manquait :
 *   1. **le stockage.** La session vit déjà dans `sessionStorage`
 *      (src/lib/supabaseClientCore.ts) : fermer l'onglet l'emporte. Ici on le
 *      fait AUSSI explicitement, parce que « ça disparaît tout seul » n'est pas
 *      une garantie qu'on peut éprouver — c'est un effet de bord d'un réglage
 *      qu'un futur changement pourrait déplacer ;
 *   2. **la révocation.** `signOut()` parle au serveur : le jeton de
 *      rafraîchissement est invalidé, pas seulement oublié par ce navigateur.
 *      Un `sessionStorage` vidé laisse un jeton encore valable ailleurs ; un
 *      `signOut()` ne le laisse pas.
 *
 * L'événement est `pagehide` (fermeture d'onglet, navigation vers un autre
 * site, fin de fenêtre Electron, mise à l'écart d'un onglet) doublé de
 * `beforeunload` (certains chemins de fermeture Electron ne déclenchent que
 * celui-là). Le geste est idempotent : les deux peuvent partir pour un seul
 * départ, et la sortie ne s'exécute qu'une fois.
 *
 * ─── Ce que ce choix coûte, et il est assumé ─────────────────────────────────
 * Un RECHARGEMENT (F5) est un départ comme un autre : la session est fermée et
 * il faut se reconnecter. C'est la conséquence directe de « quitte la page »,
 * et elle est plus visible sur le web que dans l'application empaquetée, où le
 * rechargement n'est pas un geste courant. L'alternative — garder la session
 * en mémoire seule pour rendre F5 indolore — aurait aussi supprimé la reprise
 * de session après navigation, donc elle n'a pas été retenue.
 */
import { useEffect, useRef } from 'react';

/**
 * Les clés de session écrites par supabase-js (`sb-<projectRef>-auth-token`,
 * et ses éventuelles variantes suffixées). On les balaie sans connaître le
 * projectRef : la forme est stable, et une liste de clés écrite à la main en
 * fonction de l'URL du projet serait une deuxième copie de cette URL.
 */
export const SUPABASE_SESSION_KEY = /^sb-.*-auth-token/;

/** Les événements qui signalent un départ (fermeture, navigation, fin de fenêtre). */
export const LEAVE_EVENTS = ['pagehide', 'beforeunload'] as const;

/**
 * Retire de `storage` toutes les clés de session Supabase, et rend celles qui
 * ont été retirées (pour que l'appelant puisse le dire au lieu de le supposer).
 *
 * @param {Storage} storage
 * @returns {string[]}
 */
export function clearSupabaseSession(storage: Storage): string[] {
  const removed: string[] = [];
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && SUPABASE_SESSION_KEY.test(key)) {
        storage.removeItem(key);
        removed.push(key);
      }
    }
  } catch {
    // Stockage indisponible : le `signOut()` ci-dessous reste la vraie sortie.
  }
  return removed;
}

export interface LogoutOnLeaveOptions {
  /** La session est-elle ouverte ? Sans session, rien à fermer. */
  enabled: boolean;
  /** Ferme la session (révoque le jeton côté serveur). */
  signOut: () => Promise<void>;
  /** Le stockage de session (injecté pour être éprouvable). */
  storage?: Storage;
}

/**
 * Branche la déconnexion à la sortie. Ne rend rien : il n'y a plus d'état à
 * afficher — c'est précisément ce que l'ancien minuteur apportait de trop.
 */
export function useLogoutOnLeave({
  enabled,
  signOut,
  storage = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
}: LogoutOnLeaveOptions): void {
  // La dernière valeur, lue au moment du départ : brancher/débrancher les
  // écouteurs à chaque rendu serait du bruit, et un `enabled` figé dans une
  // fermeture laisserait la session ouverte après un changement d'état.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const firedRef = useRef(false);

  useEffect(() => {
    // Un départ ne se rejoue pas : sans ce drapeau, `pagehide` PUIS
    // `beforeunload` enverraient deux révocations pour une seule sortie.
    firedRef.current = false;
    if (!enabled) return;

    const onLeave = (): void => {
      if (!enabledRef.current || firedRef.current) return;
      firedRef.current = true;
      if (storageRef.current) clearSupabaseSession(storageRef.current);
      // Pas d'`await` : une page qui se ferme n'attend personne. Le stockage est
      // déjà vidé ci-dessus, donc l'utilisateur est déconnecté immédiatement
      // pour ce navigateur ; la requête qui suit révoque le jeton côté serveur.
      void signOutRef.current().catch(() => {
        /* le départ ne doit jamais lever : la page s'en va dans tous les cas */
      });
    };

    for (const ev of LEAVE_EVENTS) window.addEventListener(ev, onLeave);
    return () => {
      for (const ev of LEAVE_EVENTS) window.removeEventListener(ev, onLeave);
    };
  }, [enabled]);
}
