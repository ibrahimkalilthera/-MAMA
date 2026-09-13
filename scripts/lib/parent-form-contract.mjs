// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/parent-form-contract.mjs — ce que le NAVIGATEUR impose dans la
// fiche parent, lu dans une application RÉELLE.
//
// WHY THIS EXISTS
// ---------------
// Le blocage que ce contrat protège n'était pas dans le code d'enregistrement :
// `handleParentSubmit` tolère déjà une adresse vide (il écrit `'N/A'`, comme pour
// la profession). Il tenait en DEUX MOTS du formulaire — l'attribut `required`
// du navigateur et l'astérisque du libellé — donc le refus tombait **avant** que
// le code qui enregistre soit atteint, et se lisait comme une règle métier alors
// qu'il n'était qu'un attribut. Un test de source peut vérifier ces deux mots ;
// seule une application lancée peut vérifier que le NAVIGATEUR a cessé de
// refuser. C'est le sujet de ce module : transformer des champs observés dans une
// vraie fenêtre en un verdict, et refuser de conclure quand la preuve serait
// vacuité.
//
// Deux pièges, tous deux déjà payés dans ce dépôt :
//   • un champ que le contrôle ne TROUVE PAS n'est pas un champ conforme — un
//     sélecteur qui ne matche rien rendrait un « aucune objection » sur zéro
//     lecture, donc l'absence est un refus ;
//   • un « le formulaire est valide » n'est pas une preuve si le formulaire est
//     TOUJOURS valide : le verdict exige la preuve inverse (`gate`), c'est-à-dire
//     qu'un champ VRAIMENT obligatoire vidé rende bien la soumission invalide.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comment reconnaître chaque champ, sur les deux langues que l'application sert.
 *
 * Les libellés sont traduits (« ADRESSE » / « ADDRESS ») et les champs n'ont ni
 * `name` ni `data-testid` : les reconnaître par leur RANG serait la faute que la
 * suite de composants a déjà refusée (l'ordre du formulaire peut changer sans que
 * le cas devienne faux). Les motifs couvrent donc les libellés ET les
 * placeholders des deux langues.
 */
export const PARENT_FIELD_PATTERNS = {
  name: /nom du parent|parent(’|')?s? name|nom|full ?name|mamadou|traor/i,
  primaryPhone: /t[ée]l[ée]phone principal|primary phone|\+223\s*70/i,
  address: /adresse|address|quartier|hippodrome|district/i,
};
const FIELDS = PARENT_FIELD_PATTERNS;

/**
 * Le verdict de la fiche parent telle qu'elle est RENDUE.
 *
 * @param {{ fields?: { label?: string, placeholder?: string, required?: boolean }[],
 *   gate?: { validWithoutAddress?: boolean|null, invalidWithoutName?: boolean|null }|null }} input
 * @returns {{ ok: boolean, problems: string[], warnings: string[],
 *   found: Record<'name'|'primaryPhone'|'address',
 *     { label?: string, placeholder?: string, required?: boolean }|null> }}
 */
export function parentFormVerdict({ fields = [], gate = null } = {}) {
  const problems = [];
  const warnings = [];
  /** @type {Record<'name'|'primaryPhone'|'address', { label?: string, placeholder?: string, required?: boolean }|null>} */
  const found = { name: null, primaryPhone: null, address: null };

  // Le LIBELLÉ d'abord, le placeholder seulement en repli : un écran porte d'autres
  // champs (la recherche d'élève, le filtre de classe), et un motif qui matcherait
  // l'un d'eux AVANT le vrai champ ferait porter le verdict sur un autre champ —
  // le genre de faux positif qui rougit pour la mauvaise raison.
  for (const [key, pattern] of Object.entries(FIELDS)) {
    found[key] =
      fields.find((f) => pattern.test(f?.label ?? '')) ??
      fields.find((f) => pattern.test(`${f?.label ?? ''} ${f?.placeholder ?? ''}`)) ??
      null;
  }

  // 1. Ce qu'on n'a pas TROUVÉ ne peut pas être conforme.
  for (const [key, why] of [
    ['address', "le champ adresse n'a pas été trouvé dans la fiche parent — un champ absent n'est pas un champ facultatif"],
    ['name', "le champ nom n'a pas été trouvé — « plus aucune obligation » n'est pas « adresse facultative »"],
    ['primaryPhone', "le champ téléphone principal n'a pas été trouvé — « plus aucune obligation » n'est pas « adresse facultative »"],
  ]) {
    if (!found[key]) problems.push(why);
  }

  // 2. L'adresse : le navigateur ne doit plus la refuser, et le libellé ne doit pas
  //    prétendre le contraire. C'est le défaut mesuré, mot pour mot.
  if (found.address) {
    if (found.address.required === true) {
      problems.push(
        "l'adresse est encore marquée `required` : le navigateur refuse la soumission AVANT que le code d'enregistrement soit atteint, " +
          'donc le refus se lit comme une règle métier alors qu’il n’est qu’un attribut',
      );
    }
    if (/\*/.test(String(found.address.label ?? ''))) {
      problems.push(
        "le libellé de l'adresse porte encore une astérisque (« obligatoire ») alors que le champ n'est plus requis — " +
          'un formulaire qui ment sur ce qui est obligatoire se paie en rejets incompris',
      );
    }
  }

  // 3. Le reste des obligations : enlever une obligation n'est pas n'en garder
  //    aucune. Les deux champs qui portent l'identité d'un parent doivent rester
  //    obligatoires, sinon la preuve verte cacherait une régression plus large.
  for (const key of ['name', 'primaryPhone']) {
    const field = found[key];
    if (!field) continue;
    if (field.required !== true) {
      problems.push(
        `« ${String(field.label ?? key).trim()} » n'est plus marqué \`required\` — l'identité d'un parent doit rester exigée`,
      );
    } else if (!/\*/.test(String(field.label ?? ''))) {
      warnings.push(
        `« ${String(field.label ?? key).trim()} » est obligatoire mais son libellé ne le dit pas (aucune astérisque)`,
      );
    }
  }

  // 4. Le GATE du navigateur — la seule mesure qui prouve que le blocage a
  //    disparu, et la seule qui prouve qu'elle n'est pas vacuité.
  if (gate) {
    if (gate.validWithoutAddress !== true) {
      problems.push(
        'le formulaire est encore invalide avec une adresse vide (et le reste rempli) : le navigateur continue de refuser une fiche parent sans adresse',
      );
    }
    if (gate.invalidWithoutName !== false) {
      problems.push(
        "le formulaire reste valide même sans le nom : le verdict « valide sans adresse » ne prouve donc rien — " +
          'la lecture du gate du navigateur n’a pas été exercée',
      );
    }
  } else {
    warnings.push(
      "le gate du navigateur n'a pas été lu (`checkValidity`) — la conformité porte sur les attributs, pas sur ce que la soumission ferait",
    );
  }

  return { ok: problems.length === 0, problems, warnings, found };
}
