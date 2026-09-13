// Suite for the parent-form contract (scripts/lib/parent-form-contract.mjs).
//
// WHY THIS EXISTS
// ---------------
// Le blocage signalé en production n'était pas dans le code qui enregistre :
// `handleParentSubmit` acceptait déjà une adresse vide. Il tenait en DEUX MOTS du
// formulaire — l'attribut `required` du navigateur et l'astérisque du libellé —
// donc le refus tombait avant que le code soit atteint, et se lisait comme une
// règle métier. Ces cas protègent donc un CONTRAT, pas un attribut : ce que le
// navigateur impose, et ce que le libellé promet.
//
// Les deux cas qui comptent le plus ne vérifient pas la correction mais la
// PREUVE : un champ introuvable n'est pas un champ conforme, et « le formulaire
// est valide » ne prouve rien si le formulaire est toujours valide.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parentFormVerdict } from '../scripts/lib/parent-form-contract.mjs';

type Override = Partial<{ label: string; placeholder: string; required: boolean }>;
type Overrides = Partial<Record<'name' | 'primaryPhone' | 'address', Override>>;

/** Les champs d'une fiche parent déployée, dans les deux langues servies. */
const fr = (over: Overrides = {}) => [
  { label: 'NOM DU PARENT *', placeholder: 'ex. Mamadou Traoré', required: true, ...(over.name ?? {}) },
  { label: 'TÉLÉPHONE PRINCIPAL *', placeholder: '+223 70 00 00 00', required: true, ...(over.primaryPhone ?? {}) },
  { label: 'TÉLÉPHONE SECONDAIRE', placeholder: '+223 66 00 00 00', required: false },
  { label: 'ADRESSE', placeholder: 'ex. Quartier Hippodrome, Bamako', required: false, ...(over.address ?? {}) },
];
const en = () => [
  { label: 'PARENT NAME *', placeholder: 'e.g. Mamadou Traoré', required: true },
  { label: 'PRIMARY PHONE *', placeholder: '+223 70 00 00 00', required: true },
  { label: 'ADDRESS', placeholder: 'e.g. Hippodrome district, Bamako', required: false },
];
/** Un gate de navigateur lu pour de vrai : valide sans adresse, invalide sans nom. */
const gate = { validWithoutAddress: true, invalidWithoutName: false };

describe('contrat de la fiche parent — ce que le navigateur impose', () => {
  it('une adresse facultative, sans astérisque, et un formulaire qui laisse passer : conforme', () => {
    const v = parentFormVerdict({ fields: fr(), gate });
    assert.equal(v.ok, true, v.problems.join(' | '));
    assert.equal(v.found.address?.required, false);
  });

  it('les libellés anglais sont reconnus aussi — la preuve ne dépend pas de la langue', () => {
    assert.equal(parentFormVerdict({ fields: en(), gate }).ok, true);
  });

  it("l'astérisque de l'adresse est un refus : un libellé qui dit « obligatoire » quand rien ne l'est", () => {
    const v = parentFormVerdict({ fields: fr({ address: { label: 'ADRESSE *' } }), gate });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /astérisque/);
  });

  it("l'attribut `required` remis sur l'adresse est un refus, même sans astérisque", () => {
    const v = parentFormVerdict({ fields: fr({ address: { required: true } }), gate });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /required/);
  });

  it("enlever l'obligation ne doit pas en enlever d'autres : le nom reste exigé", () => {
    const v = parentFormVerdict({ fields: fr({ name: { label: 'NOM DU PARENT', required: false } }), gate });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /identité d'un parent/);
  });

  it('un champ INTROUVABLE est un refus, pas une conformité : personne ne juge zéro lecture', () => {
    const v = parentFormVerdict({ fields: fr().filter((f) => f.placeholder !== 'ex. Quartier Hippodrome, Bamako'), gate });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /champ absent n'est pas un champ facultatif/);
  });

  it('« valide avec une adresse vide » ne prouve rien si le nom vide est accepté aussi (non-vacuité)', () => {
    const v = parentFormVerdict({ fields: fr(), gate: { validWithoutAddress: true, invalidWithoutName: true } });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /ne prouve donc rien/);
  });

  it('un formulaire encore invalide sans adresse est le défaut signalé, nommé tel quel', () => {
    const v = parentFormVerdict({ fields: fr(), gate: { validWithoutAddress: false, invalidWithoutName: false } });
    assert.equal(v.ok, false);
    assert.match(v.problems.join(' '), /continue de refuser/);
  });

  it('sans gate lu, la conformité est un AVERTISSEMENT — les attributs ne disent pas ce que la soumission ferait', () => {
    const v = parentFormVerdict({ fields: fr(), gate: null });
    assert.equal(v.ok, true);
    assert.match(v.warnings.join(' '), /gate du navigateur/);
  });

  it('un champ obligatoire dont le libellé ne le dit pas est un avertissement, pas un refus', () => {
    const v = parentFormVerdict({ fields: fr({ name: { label: 'NOM DU PARENT' } }), gate });
    assert.equal(v.ok, true);
    assert.match(v.warnings.join(' '), /ne le dit pas/);
  });
});
