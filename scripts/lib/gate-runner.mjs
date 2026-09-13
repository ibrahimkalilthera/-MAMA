/**
 * ─── Faire tourner un gate, et rendre son verdict LISIBLE ──────────────────
 *
 * Le publieur enchaîne des vérifications qui sont d'autres programmes
 * (`scripts/check-release-coherence.mjs --draft`, `--live`, `--channel`). Deux
 * besoins opposés se rencontraient dans son ancienne boucle :
 *
 *   • **ne pas noyer le verdict** — la reprise bornée qui suit une promotion
 *     (la liste publique n'est pas à jour tout de suite) réessaie jusqu'à six
 *     fois, et afficher les cinq échecs transitoires ferait perdre de vue la
 *     ligne qui compte ;
 *   • **ne jamais perdre le verdict** — une preuve dont le texte n'apparaît
 *     nulle part n'est pas une preuve.
 *
 * L'ancienne version croyait résoudre le premier point en gardant les tentatives
 * intermédiaires dans un tube et en laissant parler la DERNIÈRE
 * (`stdio: 'inherit'` au dernier essai). C'était faux dans le cas le plus
 * fréquent — le succès du premier coup : la tentative réussie était une
 * tentative intermédiaire comme une autre, donc son texte partait dans le tube,
 * et personne ne l'imprimait. Mesuré pendant la publication de la 1.0.6 : la
 * promotion affichait « ── flux publié, relu SANS jeton ── » suivi du vide,
 * alors que le gate venait de conclure vert. Un succès silencieux apprend
 * exactement la même chose qu'un échec silencieux : rien.
 *
 * D'où ce module : on capture le texte de chaque tentative, on n'affiche QUE
 * celle qui conclut (succès, ou dernier échec), et l'appelant ne peut plus
 * l'oublier — c'est lui qui reçoit le texte, et il doit l'écrire.
 *
 * Il est pur par rapport au processus : l'exécution et l'attente sont injectées,
 * donc la cadence se teste sans lancer quoi que ce soit.
 */

/**
 * Faire tourner un gate, avec reprise bornée — et rendre le texte de la
 * tentative qui CONCLUT.
 *
 * @param {{ attempts?: number, delayMs?: number,
 *   run: () => { ok: boolean, output: string },
 *   sleep?: (ms: number) => void,
 *   onRetry?: (attempt: number, attempts: number, delayMs: number) => void }} input
 * @returns {{ ok: boolean, output: string, attempts: number, retried: number }}
 *   `output` est le texte de la tentative qui conclut (succès, ou dernier
 *   échec) — celui que l'appelant doit afficher, jamais jeter.
 */
export function runGateAttempts({
  attempts = 1,
  delayMs = 4000,
  run,
  sleep = () => {},
  onRetry = () => {},
} = {}) {
  const total = Math.max(1, Number(attempts) || 1);
  let retried = 0;
  let outcome = { ok: false, output: '' };
  for (let attempt = 1; attempt <= total; attempt += 1) {
    outcome = run();
    if (outcome.ok) return { ...outcome, attempts: attempt, retried };
    const last = attempt === total;
    if (last) return { ...outcome, attempts: attempt, retried };
    retried += 1;
    onRetry(attempt, total, delayMs);
    sleep(delayMs);
  }
  return { ...outcome, attempts: total, retried };
}
