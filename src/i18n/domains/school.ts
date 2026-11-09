/**
 * ─── Le nom de l'école, son bloc de réglage, dans les deux langues ───────────
 *
 * Ces clés vivaient dans le domaine `admin` ; elles en sont sorties le
 * 2026-10-16, quand `adminEn.ts` / `adminFr.ts` ont franchi le budget de 700
 * lignes de la campagne de scission en accueillant le réglage du nom de l'école.
 *
 * Le sujet justifie la découpe au-delà du budget : ces phrases ne parlent pas
 * d'administration mais d'une IDENTITÉ d'établissement — un nom écrit une fois
 * pour tout le parc, porté ensuite par chaque remontée de poste à côté du nom de
 * la machine (`src/lib/schoolName.ts`, `src/lib/desktopUpdateReport.ts`). Elles
 * voyagent ensemble, et elles se relisent ensemble.
 *
 * `schoolNameUnread` dit la LECTURE RATÉE — « la base n'a pas répondu » —, à ne
 * pas confondre avec l'absence de nom déclaré : un champ vide devant une lecture
 * ratée inviterait à réécrire un nom que l'école avait déjà publié (voir
 * `src/app/useSchoolName.ts`).
 */
export const en = {
  schoolMonthsAdminOnly: "Only an administrator can set the school year's months.",
  schoolMonthsEnd: "Last month",
  schoolMonthsHint: "The months a receipt claims — the first and the last of the year. A school year usually runs September to June, sometimes October to June, sometimes through July.",
  schoolMonthsNoYear: "No school year selected: pick one in the header to see its months.",
  schoolMonthsPreview: "Months of the year: {months}",
  schoolMonthsQueued: "Offline: the range will be sent when the line returns (it is not in the database yet).",
  schoolMonthsRefused: "Not saved: the database did not take the range.",
  schoolMonthsSave: "Save the months",
  schoolMonthsSaved: "Saved: this year's receipts now claim these months.",
  schoolMonthsStart: "First month",
  schoolMonthsTitle: "School year months",
  schoolNameAdminOnly: "Only an administrator can change the school name.",
  schoolNameHint: "Written once for the whole fleet: it accompanies every station report — blocks and conversions — next to the machine name.",
  schoolNamePlaceholder: "Complexe Scolaire Mama Thera",
  schoolNameQueued: "Offline: the name will be sent when the line returns (it is not in the database yet).",
  schoolNameRefused: "Not saved: the database did not take the change.",
  schoolNameSave: "Save the name",
  schoolNameSaved: "Saved for the whole fleet.",
  schoolNameTitle: "School name",
  schoolNameUnread: "Not read: the database did not answer, so the name shown may not be the one already published.",
};

export const fr = {
  schoolMonthsAdminOnly: "Seule l'administration peut régler les mois de l'année scolaire.",
  schoolMonthsEnd: "Dernier mois",
  schoolMonthsHint: "Les mois que les reçus réclament — le premier et le dernier de l'année. Une année scolaire va le plus souvent de septembre à juin, parfois d'octobre à juin, parfois jusqu'en juillet.",
  schoolMonthsNoYear: "Aucune année scolaire sélectionnée : choisissez-en une dans l'en-tête pour voir ses mois.",
  schoolMonthsPreview: "Mois de l'année : {months}",
  schoolMonthsQueued: "Hors ligne : la plage partira au retour de la ligne (elle n'est pas encore en base).",
  schoolMonthsRefused: "Non enregistré : la base n'a pas pris la plage.",
  schoolMonthsSave: "Enregistrer les mois",
  schoolMonthsSaved: "Enregistré : les reçus de cette année réclament désormais ces mois.",
  schoolMonthsStart: "Premier mois",
  schoolMonthsTitle: "Mois de l'année scolaire",
  schoolNameAdminOnly: "Seule l'administration peut changer le nom de l'école.",
  schoolNameHint: "Écrit une fois pour tout le parc : il accompagne chaque remontée de poste — blocages et conversions — à côté du nom de la machine.",
  schoolNamePlaceholder: "Complexe Scolaire Mama Thera",
  schoolNameQueued: "Hors ligne : le nom partira au retour de la ligne (il n'est pas encore en base).",
  schoolNameRefused: "Non enregistré : la base n'a pas pris le changement.",
  schoolNameSave: "Enregistrer le nom",
  schoolNameSaved: "Enregistré pour tout le parc.",
  schoolNameTitle: "Nom de l'école",
  schoolNameUnread: "Non lu : la base n'a pas répondu — le nom affiché n'est peut-être pas celui déjà publié.",
};
