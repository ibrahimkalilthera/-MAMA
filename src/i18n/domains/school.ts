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
