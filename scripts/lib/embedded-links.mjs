/**
 * scripts/lib/embedded-links.mjs — un lien embarqué répond-il à ce qu'on exige
 * de LUI, et pas à ce qu'on exige d'un autre ?
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/check-public-origin.mjs` ne relisait qu'une URL : l'origine de repli.
 * Les autres liens que l'application embarque partaient dans chaque installeur
 * sans que personne ne les relise jamais — et le plus fragile des trois est le
 * seul dont un poste PORTABLE dépend pour reprendre une version, puisqu'il ne
 * s'auto-installe pas.
 *
 * Le piège, en étendant la lecture, n'est pas de lire plus : c'est de juger les
 * trois par la même règle. Une application qu'on sert, une page de
 * téléchargement qu'on ne sert pas, et le domaine d'un tiers n'ont pas les mêmes
 * refus possibles, et une règle unique donne soit un contrôle toujours rouge
 * (le tiers qui répond 429 à un runner), soit un contrôle toujours vert (son
 * 200 pris pour un service rendu). Chaque catégorie porte donc SES refus, et la
 * fonction dit lequel a parlé.
 *
 * Ce fichier est PUR : il reçoit un statut, l'URL d'atterrissage et une erreur,
 * et rend des problèmes nommés. Le réseau vit dans le CLI, donc chaque branche de
 * refus se prouve sans site en ligne.
 */

/**
 * Ce que « ce lien marche » veut dire, par catégorie.
 *
 * `app` est jugé ailleurs (`scripts/lib/public-origin.mjs`) parce que sa règle a
 * besoin des modules du document, que ce module ne lit pas. La table existe pour
 * qu'aucune catégorie ne puisse être ajoutée à l'inventaire sans passer par une
 * règle nommée : une catégorie inconnue est un REFUS, jamais un saut silencieux
 * — un lien qu'on ne sait pas juger n'est pas un lien vérifié.
 */
export const KIND_JUDGED_BY = {
  app: 'originVerdict',
  'release-page': 'link',
  'third-party': 'link',
};

/** La page d'atterrissage d'une page de version : le geste « atteindre les versions ». */
export const RELEASE_TAG_PAGE = /\/releases\/tag\/[^/?#]+/;

/** Les statuts qu'un tiers peut nous rendre sans que NOTRE lien soit mort. */
const THIRD_PARTY_REFUSALS_ARE_NOT_OURS = (status) => Number(status) >= 400;

/**
 * @param {{ link: { id: string, url: string, kind: string, where?: string, why?: string },
 *   status?: number|null, finalUrl?: string, error?: string|null, body?: string,
 *   apiProof?: { ok: boolean, tag?: string, error?: string }|null }} input
 *   `apiProof` n'est renseigné que pour une `release-page` refusée à une lecture
 *   ANONYME : c'est ce que la deuxième question a répondu (voir plus bas).
 * @returns {{ ok: boolean, problems: string[], warnings: string[], detail: string }}
 */
export function embeddedLinkVerdict({ link, status = null, finalUrl = '', error = null, body = '', apiProof = null } = {}) {
  const problems = [];
  const warnings = [];
  const id = String(link?.id ?? '');
  const url = String(link?.url ?? '');
  const where = String(link?.where ?? 'emplacement inconnu');
  const at = `« ${id} » (${url}) — ${where}`;
  const firstLine = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? '';

  if (error) {
    problems.push(
      `le lien ${at} ne répond pas du tout (${error}) — DNS, TLS ou délai : un poste qui suit ce lien n'arrive nulle part`,
    );
    return { ok: false, problems, warnings, detail: `injoignable (${error})` };
  }
  if (status === null) {
    problems.push(`le lien ${at} n'a pas pu être interrogé — une lecture qui n'aboutit pas n'est pas un feu vert`);
    return { ok: false, problems, warnings, detail: 'aucune réponse' };
  }

  if (link?.kind === 'release-page') {
    // 1. La page existe-t-elle ? Un 404 est le cas mesuré d'un dépôt supprimé,
    //    renommé ou rendu privé : le geste « reprendre une version » disparaît,
    //    et il ne reste alors aucune porte de sortie à un poste portable.
    //
    //    MAIS un 404 n'est pas toujours la mort du lien : MESURÉ le 2026-09-27,
    //    `github.com/<dépôt>/releases/latest` répond 200 depuis un poste ordinaire
    //    et **404 à une adresse machine** — cinq runs de suite, sur le même
    //    runner où `api.github.com` (la liste des versions) et
    //    `raw.githubusercontent.com` (le frein) répondaient 200. Ce n'est donc pas
    //    « le lien est mort » : c'est « ce client-ci n'a pas le droit de lire
    //    cette page ». Quand la deuxième question a pu être posée (`apiProof`),
    //    c'est ELLE qui tranche — et le rapport dit que la page a été prouvée
    //    autrement, jamais qu'un navigateur l'a lue.
    //
    //    Ce que ce repli ne fait pas, et c'est délibéré : il ne s'applique QU'À
    //    un refus. Un 200 qui atterrit au mauvais endroit reste un refus ferme
    //    (point 2), parce que là, la page a bien été servie — et elle ne permet
    //    pas le geste attendu.
    if (status !== 200) {
      if (apiProof?.ok) {
        warnings.push(
          `le lien ${at} a été refusé à CETTE lecture-ci (HTTP ${status}${firstLine ? ` — « ${firstLine.slice(0, 60)} »` : ''}) — ` +
            `la page de version a donc été prouvée autrement : l'API du dépôt nomme la version publiée ${apiProof.tag}. ` +
            'Ce n’est PAS une lecture de navigateur : ce rapport dit qu’une page de version existe et qu’elle a une cible, pas ce qu’un client humain voit — un refus de page entière, lui, resterait invisible ici',
        );
        return { ok: true, problems, warnings, detail: `HTTP ${status} → prouvé par l’API (version publiée ${apiProof.tag})` };
      }
      problems.push(
        `le lien ${at} répond HTTP ${status}${firstLine ? ` — « ${firstLine.slice(0, 120)} »` : ''} — ` +
          "un poste portable n'a pas d'autre porte de sortie que cette page pour reprendre une version",
      );
      // Le repli qui n'a pas pu répondre est NOMMÉ : sans ça, un refus de page et
      // un refus d'API se liraient pareil, et le lecteur chercherait la panne du
      // mauvais côté.
      if (apiProof && !apiProof.ok) {
        problems.push(
          `et la preuve de repli n’a rien pu dire non plus (${apiProof.error}) — ` +
            'un refus qu’on ne sait pas expliquer n’est pas un refus mesuré',
        );
      }
      return { ok: false, problems, warnings, detail: `HTTP ${status}` };
    }
    // 2. Et atterrit-elle sur une PAGE DE VERSION ? Mesuré : `/releases/latest`
    //    répond 302 vers `/releases/tag/v1.0.8`. Un 200 qui atterrit ailleurs
    //    (page d'accueil du dépôt, passage de connexion, page d'un compte) est un
    //    lien qui s'ouvre sans rien permettre — le faux vert du canal, transposé
    //    au geste de l'utilisateur.
    if (!RELEASE_TAG_PAGE.test(String(finalUrl))) {
      problems.push(
        `le lien ${at} répond 200 mais atterrit sur ${finalUrl || '(adresse inconnue)'} au lieu d'une page de version — ` +
          'le geste attendu (atteindre les versions) n’est pas permis, même si la page s’ouvre',
      );
      return { ok: false, problems, warnings, detail: `HTTP 200 → ${finalUrl || 'ailleurs'}` };
    }
    return { ok: true, problems, warnings, detail: `HTTP 200 → ${finalUrl} (page de version)` };
  }

  if (link?.kind === 'third-party') {
    // On ne juge ici que ce qu'on peut tenir contre un domaine qui n'est pas le
    // nôtre : qu'il RÉPONDE. Un 4xx (limitation de débit, filtrage d'une IP de
    // centre de données) avertit — il dit qu'un utilisateur pourrait ne pas
    // aboutir — mais il est un AVERTISSEMENT, pas un refus : accuser notre
    // installeur d'un refus d'un tiers ferait rougir la veille sur un lien sain,
    // et un contrôle toujours allumé ne se lit plus.
    if (THIRD_PARTY_REFUSALS_ARE_NOT_OURS(status)) {
      warnings.push(
        `le lien ${at} répond HTTP ${status} — le domaine répond (DNS, TLS, HTTP), donc le lien n'est pas mort, ` +
          'mais un utilisateur pourrait ne pas aboutir ; ce n’est pas notre serveur, donc ce n’est pas un refus',
      );
    }
    return { ok: true, problems, warnings, detail: `HTTP ${status} (une réponse suffit : ce domaine n’est pas le nôtre)` };
  }

  problems.push(
    `le lien ${at} porte une catégorie que ce contrôle ne sait pas juger (« ${link?.kind} ») — ` +
      'un lien qu’on ne sait pas juger n’est pas un lien vérifié, et le laisser passer ferait de ce contrôle un feu vert de plus',
  );
  return { ok: false, problems, warnings, detail: `catégorie inconnue « ${link?.kind} »` };
}
