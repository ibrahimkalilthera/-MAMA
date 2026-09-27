/**
 * ─── Le journal d'audit, découpé en SEMAINES ────────────────────────────────
 *
 * La demande : « à chaque fin de semaine, l'admin et le dev doivent pouvoir
 * télécharger le journal d'audit de la semaine en PDF ». Une phrase, et une
 * décision qu'on ne peut pas laisser au hasard : **qu'est-ce qu'une semaine ?**
 *
 * Le dépôt a déjà répondu à cette question une fois, sans le dire : son
 * calendrier est « lundi d'abord » (`src/lib/classes.ts`, `getCalendarDays` —
 * l'écran de calendrier place la semaine du lundi au dimanche). Une semaine qui
 * commencerait le dimanche ici et le lundi là produirait deux découpages du même
 * journal, donc deux PDF dont les totaux ne se recoupent pas — exactement le
 * genre d'écart que ce dépôt refuse.
 *
 * On prend donc la semaine **ISO-8601** : lundi 00:00:00.000 → dimanche
 * 23:59:59.999, dans l'heure LOCALE du poste (le personnel lit des dates civiles,
 * pas des instants UTC ; un paiement de 21 h le dimanche doit compter dans la
 * semaine qui finit, pas dans celle qui commence).
 *
 * Le NUMÉRO de semaine est lui aussi celui de l'ISO-8601, et ce n'est pas un
 * détail cosmétique : il peut appartenir à l'année précédente ou suivante
 * (le 29 déc. 2025 est la semaine 1 de 2026 ; le 3 janv. 2027 est la semaine 53
 * de 2026). Afficher « 2025-S1 » pour une semaine dont la première journée est
 * en 2026, ou dériver le numéro de l'année civile, ferait diverger l'étiquette
 * du contenu — le module porte donc `isoYear` à côté de `isoWeek`, et la CLÉ
 * (`2026-S39`) est ce couple, jamais l'année du jour regardé.
 *
 * Le module est PUR : il ne lit ni la base, ni le DOM, ni l'horloge. La date est
 * toujours passée en paramètre, ce qui rend chaque cas mesurable (une semaine
 * calculée à partir de `new Date()` ne se teste pas deux fois de la même façon).
 */
import type { AuditLogEntry } from './auditLogger';

/** Une semaine d'audit : la fenêtre, son identité ISO, et de quoi la nommer. */
export interface AuditWeek {
  /** Le lundi 00:00:00.000, heure locale du poste. */
  start: Date;
  /** Le dimanche 23:59:59.999, heure locale du poste. */
  end: Date;
  /** L'instant de début en ISO — ce qu'une requête de plage attend. */
  startIso: string;
  /** L'instant de fin en ISO — compris, pas exclu. */
  endIso: string;
  /** L'année ISO de la semaine (≠ année civile aux deux bords de l'année). */
  isoYear: number;
  /** Le numéro de semaine ISO, 1 à 53. */
  isoWeek: number;
  /** L'identité stable de la semaine : `2026-S39`. */
  key: string;
}

/**
 * L'année et le numéro de semaine ISO d'une date civile.
 *
 * L'algorithme est celui de la norme, réduit à ce qui nous sert : la semaine ISO
 * est celle qui porte le jeudi. On avance donc la date jusqu'au jeudi de sa
 * semaine, et son année est l'année ISO ; le numéro est le nombre de semaines
 * écoulées depuis le jeudi de la semaine 1.
 *
 * Les calculs se font à midi, en UTC, sur la seule DATE civile : un jeudi local
 * décalé par un fuseau pourrait changer de semaine, et c'est la date lue par
 * l'utilisateur qui doit décider.
 *
 * @param year l'année civile locale
 * @param month le mois local, 0-indexé (comme `Date`)
 * @param day le jour local du mois
 */
function isoWeekParts(year: number, month: number, day: number): { isoYear: number; isoWeek: number } {
  // Midi UTC : jamais à cheval sur un minuit, donc l'aller-retour local→UTC ne
  // peut pas déplacer la date civile d'un jour.
  const date = new Date(Date.UTC(year, month, day, 12));
  // getUTCDay() : dimanche = 0. On veut lundi = 0 … dimanche = 6.
  const dayFromMonday = (date.getUTCDay() + 6) % 7;
  // Le jeudi de la semaine : lundi + 3 jours.
  date.setUTCDate(date.getUTCDate() - dayFromMonday + 3);
  const isoYear = date.getUTCFullYear();
  // Le jeudi de la semaine 1 : le 4 janvier appartient toujours à la semaine 1.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4, 12));
  const firstDayFromMonday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayFromMonday + 3);
  const isoWeek = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return { isoYear, isoWeek };
}

/**
 * La semaine d'audit qui CONTIENT cette date.
 *
 * @param date n'importe quel instant du jour regardé (heures ignorées)
 * @returns la fenêtre du lundi 00:00 au dimanche 23:59:59.999 (heure locale)
 */
export function auditWeekOf(date: Date): AuditWeek {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() : dimanche = 0. On remonte au lundi de la semaine ISO.
  const dayFromMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayFromMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  const { isoYear, isoWeek } = isoWeekParts(monday.getFullYear(), monday.getMonth(), monday.getDate());
  return {
    start: monday,
    end: sunday,
    startIso: monday.toISOString(),
    endIso: sunday.toISOString(),
    isoYear,
    isoWeek,
    key: `${isoYear}-S${isoWeek}`,
  };
}

/**
 * Les `count` dernières semaines, de la plus récente à la plus ancienne.
 *
 * La semaine en cours est la PREMIÈRE : c'est celle qu'on archive le dimanche
 * soir, et celle qu'un administrateur qui ouvre l'écran en fin de semaine
 * cherche. Les précédentes restent offertes parce qu'une semaine oubliée doit
 * pouvoir être rattrapée sans changer la date du poste.
 *
 * @param date le jour d'ancrage
 * @param count combien de semaines offrir (borné à 1 au minimum)
 */
export function recentAuditWeeks(date: Date, count = 8): AuditWeek[] {
  const weeks: AuditWeek[] = [];
  const span = Math.max(1, Math.floor(count));
  for (let offset = 0; offset < span; offset += 1) {
    const anchor = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset * 7);
    weeks.push(auditWeekOf(anchor));
  }
  return weeks;
}

/**
 * Les entrées du journal qui tombent DANS cette semaine.
 *
 * Une entrée dont la date n'est pas lisible n'est PAS rattachée à une semaine :
 * on ne devine pas. Elle reste dans le journal, elle ne figure simplement pas
 * dans une fenêtre qu'on prétendrait exacte — fondre une date illisible dans la
 * mauvaise semaine ferait signer un PDF faux.
 *
 * Les bornes sont INCLUSIVES aux deux extrémités : l'entrée de dimanche
 * 23:59:59.999 appartient à la semaine qui finit.
 *
 * @param entries les entrées du journal (l'ordre n'importe pas)
 * @param week la fenêtre
 * @returns les entrées de la semaine, de la plus récente à la plus ancienne
 */
export function entriesInWeek(entries: AuditLogEntry[] | null | undefined, week: AuditWeek): AuditLogEntry[] {
  const from = week.start.getTime();
  const to = week.end.getTime();
  const inWeek = (Array.isArray(entries) ? entries : []).filter((entry) => {
    const ms = Date.parse(String(entry?.createdAt ?? ''));
    return Number.isFinite(ms) && ms >= from && ms <= to;
  });
  return inWeek.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Le nom de fichier d'une semaine — le même sur chaque poste, pour la même
 * semaine.
 *
 * Il porte la CLÉ ISO (`2026-S39`), pas la date du téléchargement : deux
 * personnes qui archivent la même semaine obtiennent le même nom, et deux
 * archives ne se confondent pas quand la semaine suivante arrive.
 */
export function auditWeekFilename(week: AuditWeek, extension = 'pdf'): string {
  return `Journal_Audit_MAMA_THERA_${week.key}.${extension}`;
}
