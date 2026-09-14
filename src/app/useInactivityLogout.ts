/**
 * ─── Déconnexion après 45 minutes d'INACTIVITÉ ───────────────────────────────
 *
 * Demande du 2026-09-14 : « fais en sorte qu'après 45 mn d'inactivité chez
 * n'importe quel utilisateur, l'utilisateur en question se voie déconnecté — je
 * répète : inactivité ».
 *
 * Ce que le mot « inactivité » veut dire ici, précisément : **aucun geste de
 * l'utilisateur** pendant 45 minutes. Les gestes qui comptent sont ceux qui
 * prouvent une présence — appui (souris, doigt, stylet), touche au clavier,
 * défilement, molette, et déplacement de la souris (au plus une fois toutes les
 * 30 secondes, pour ne pas recalculer un minuteur à chaque pixel). Rester
 * devant une page sans rien toucher EST de l'inactivité, par définition — c'est
 * la différence avec l'ancien réglage, qui était jugé sur une durée sans
 * distinguer « devant l'écran » de « parti ».
 *
 * ─── Ce qui a été retiré de la version précédente, et pourquoi ───────────────
 *  • **le réglage d'équipe** (`app_settings.inactivity_minutes`, son écran, sa
 *    lecture en base) : la fenêtre est maintenant une CONSTANTE, la même pour
 *    tout le monde — « n'importe quel utilisateur » n'a pas besoin d'un réglage
 *    par équipe, et un réglage qu'on ne change jamais est une dépendance en
 *    plus (une lecture en base qui peut échouer, un cache à gérer) ;
 *  • **le cache `localStorage`** : il n'y a plus de valeur à mettre en cache ;
 *  • **la déconnexion à la sortie** (`useLogoutOnLeave`) : elle appelait
 *    `signOut()` sur `pagehide`/`beforeunload`, donc **un rechargement (F5)
 *    fermait la session** — mesuré comme inacceptable. Aucune API de navigateur
 *    ne distingue un F5 d'une fermeture au moment du déchargement, donc la
 *    seule façon d'épargner F5 est de ne rien révoquer à cet instant. La
 *    session reste **liée à l'onglet** (`sessionStorage`, déjà en place) :
 *    fermer l'onglet ou l'application la ferme toujours, c'est un effet du
 *    stockage et non d'un geste au déchargement. Et `tests/logout-on-leave`
 *    n'existe plus ; c'est `tests/inactivity.test.tsx` qui verrouille tout cela,
 *    y compris l'absence de tout `signOut` au déchargement.
 *
 * Le préavis de 60 secondes est conservé : sans lui, une saisie longue (un
 * montant, une note) se ferait couper au milieu sans que rien n'ait prévenu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** La fenêtre d'inactivité, en minutes — la même pour tous les comptes. */
export const INACTIVITY_MINUTES = 45;
/** Le préavis affiché avant la coupure. */
export const INACTIVITY_WARN_SECONDS = 60;

/** Gestes qui comptent comme une présence immédiate. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
/** `mousemove` ne relance le minuteur qu'au plus une fois par fenêtre. */
const MOUSE_THROTTLE_MS = 30_000;

export interface InactivityLogoutApi {
  /** Vrai pendant le préavis affiché avant la coupure. */
  warningOpen: boolean;
  /** Secondes restantes avant la coupure forcée. */
  remainingSeconds: number;
  /** Écarte le préavis et relance la fenêtre complète (l'utilisateur est là). */
  reset: () => void;
}

export function useInactivityLogout(deps: {
  /** La session est-elle ouverte ? */
  enabled: boolean;
  /** Ferme la session (révoque le jeton côté serveur). */
  signOut: () => Promise<void>;
}): InactivityLogoutApi {
  const { enabled, signOut } = deps;
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(INACTIVITY_WARN_SECONDS);

  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const mainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const clearTimers = useCallback(() => {
    if (mainTimerRef.current !== null) {
      clearTimeout(mainTimerRef.current);
      mainTimerRef.current = null;
    }
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  /** (Re)lance la fenêtre complète ; ferme le préavis s'il était ouvert. */
  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    clearTimers();
    setWarningOpen(false);
    if (!enabledRef.current) return;
    mainTimerRef.current = setTimeout(() => {
      setWarningOpen(true);
      setRemainingSeconds(INACTIVITY_WARN_SECONDS);
      countdownRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            if (countdownRef.current !== null) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            void signOutRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, INACTIVITY_MINUTES * 60 * 1000);
  }, [clearTimers]);

  // Démarre avec la session, s'arrête avec elle.
  useEffect(() => {
    if (enabled) reset();
    else {
      clearTimers();
      setWarningOpen(false);
    }
    return clearTimers;
  }, [enabled, reset, clearTimers]);

  // Les gestes de l'utilisateur : n'importe lequel relance la fenêtre.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = (): void => reset();
    const onMouseMove = (): void => {
      const now = Date.now();
      if (now - lastActivityRef.current >= MOUSE_THROTTLE_MS) reset();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [enabled, reset]);

  return { warningOpen, remainingSeconds, reset };
}
