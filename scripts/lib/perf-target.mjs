/**
 * ─── Un SEUIL qui bloque et une CIBLE qui tire : deux nombres, deux rôles ───
 *
 * Le seul contrôle de performance du dépôt était un seuil unique
 * (`PERF_THRESHOLD`), réglé à 0,70 en local et à 0,60 en CI. Ce nombre sert à
 * BLoquer une régression : il est bas parce qu'un runner partagé mesure ~25
 * points sous la production réelle, et le relever au niveau souhaité aurait
 * transformé chaque run en faux rouge — donc en garde qu'on désactive.
 *
 * La cible, elle, dit où l'on veut aller (0,90 sur l'écran d'entrée). La
 * confondre avec le seuil serait le mensonge habituel : soit on baisse la cible
 * jusqu'à ce qu'elle passe, soit on bloque sur une machine qui ne peut pas la
 * tenir. Ce module garde donc les deux ensemble, et les NOMME séparément :
 *
 *   • `ok`        — le seuil est tenu : le déploiement peut partir ;
 *   • `meetsTarget` — la cible est tenue : c'est une information, pas un droit ;
 *   • `gapPct`    — ce qu'il reste à gagner, en points, quand la cible manque.
 *
 * Rien ici ne mesure : le score vient de Lighthouse, l'appelant le passe.
 */

/** La cible par défaut de l'écran d'entrée (login / tableau de bord). */
export const PERF_TARGET = 0.9;

/** Le seuil par défaut, celui qui bloque (inchangé : 0,70). */
export const PERF_THRESHOLD = 0.7;

const pct = (value) => Math.round(value * 100);

/**
 * Le verdict d'un score mesuré, seuil ET cible.
 *
 * Un score non fini ou hors [0, 1] n'est pas un score : il rend un refus NOMMÉ
 * (`invalid`) plutôt qu'un `ok` par défaut — un audit qui n'a pas rendu de note
 * ne doit jamais passer pour une note.
 */
export function perfVerdict(score, options = {}) {
  const threshold = Number.isFinite(options?.threshold) ? options.threshold : PERF_THRESHOLD;
  const target = Number.isFinite(options?.target) ? options.target : PERF_TARGET;
  // `typeof` AVANT la conversion : `Number(null)` vaut 0 et `Number('')` aussi
  // — un audit qui n'a rien rendu serait alors lu comme un score de 0, et un
  // score de 0 est encore un score. Seul un NOMBRE est une mesure.
  const measured = typeof score === 'number' ? score : Number.NaN;
  if (!Number.isFinite(measured) || measured < 0 || measured > 1) {
    return {
      invalid: true,
      ok: false,
      meetsTarget: false,
      pct: null,
      thresholdPct: pct(threshold),
      targetPct: pct(target),
      gapPct: null,
      message: `score illisible (${String(score)}) — un audit sans note n'est pas une note`,
    };
  }
  const meetsTarget = measured >= target;
  const ok = measured >= threshold;
  return {
    invalid: false,
    ok,
    meetsTarget,
    pct: pct(measured),
    thresholdPct: pct(threshold),
    targetPct: pct(target),
    gapPct: meetsTarget ? 0 : pct(target) - pct(measured),
    message: ok
      ? meetsTarget
        ? `seuil ${pct(threshold)} tenu, cible ${pct(target)} atteinte`
        : `seuil ${pct(threshold)} tenu, cible ${pct(target)} manquée de ${pct(target) - pct(measured)} point(s)`
      : `seuil ${pct(threshold)} manqué (${pct(measured)}) — déploiement bloqué`,
  };
}
