/**
 * Les barres d'outils des vues ne se partagent plus la ligne du titre.
 *
 * Le défaut a été MESURÉ dans un navigateur (Chrome sans tête, 1024/1280/1536,
 * rendu réel des vues + CSS compilé, rail de 256 px reproduit) :
 *
 *   • Paie — sept commandes (filtre « Tout le personnel », recherche, pastille
 *     des administrateurs, bordereau mensuel, trois « Ajouter … ») réclament
 *     ~1330 px. Partagées avec le titre, elles n'avaient que **385 px** à
 *     1024 : sept rangées empilées sur **342 px de haut**, titre centré contre
 *     elles, et la page défilait de **70 px** de côté (les cartes de personnel,
 *     à trois colonnes dès `lg`, ne tenaient que 208 px pour ~314 px de
 *     matière ; à `xl` un bouton était coupé de 34 px). Après : titre sur sa
 *     ligne, commandes en dessous en pleine largeur (1024 → 672 px, 164 px de
 *     haut), cartes à deux colonnes jusqu'à `2xl` (426 px à 1280, 355 px et
 *     trois colonnes à 1536), **plus aucun défilement latéral**.
 *
 *   • Parents — le champ de recherche a un plancher de 340 px et le bouton
 *     « Ajouter Parent/Tuteur » fait 164 px : 520 px côte à côte. La rangée ne
 *     les laissait pas cohabiter, à AUCUNE largeur (à 1536 encore, 498 px pour
 *     les commandes) : le bouton tombait sous le champ, et le titre était
 *     écrasé à 242 px à 1024. Après : empilé sous `xl` (titre pleine largeur,
 *     commandes sur une seule ligne), côte à côte à partir de `xl` (520 px
 *     intacts), **le bouton sur la même ligne que le champ partout**.
 *
 *   • Dépenses — mesurée aussi, et RIEN à corriger : ses deux boutons tiennent
 *     leur libellé sur une ligne à 1024 comme à 1536, sans chevauchement ni
 *     débordement. Aucun cas ici, volontairement : un test qui n'a rien mesuré
 *     ne verrouille rien.
 *
 * Une suite happy-dom ne mesure pas de mise en page : ce qui est verrouillé
 * ici est le CONTRAT que la mesure a validé.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { installDomGlobals } from './harness';
import { renderWithContext } from './views-harness';
import { translations } from '../src/i18n/translations';
import { PayrollView } from '../src/components/PayrollView';
import { ParentsView } from '../src/components/ParentsView';

const t = translations.fr;
const win = installDomGlobals();

const staff = [
  { id: 's1', name: 'Aïssata Traoré', position: 'Enseignante', phone: '+223 70 00 00 01', email: 'a@mamathera.org', salary: 150000, bankDetails: '', emergencyContact: '' },
  { id: 's2', name: 'Moussa Diarra', position: 'Surveillant', phone: '+223 70 00 00 02', email: 'm@mamathera.org', salary: 90000, bankDetails: '', emergencyContact: '' },
];

const parents = [
  {
    id: 'p1', fullName: 'Ibrahim Kalil Théra', relationship: 'Father', primaryPhone: '+223 76 00 00 01',
    secondaryPhone: '', email: 'k@mamathera.org', address: 'Bamako', occupation: 'Commerçant',
    notes: '', linkedStudentIds: ['st1'], createdAt: '2026-09-01', phones: ['+223 76 00 00 01'],
  },
];

/** Le HTML rendu, posé dans un DOM interrogeable. */
function dom(html: string): Document {
  win.document.body.innerHTML = html;
  return win.document as unknown as Document;
}

/** Le plus proche ancêtre dont la classe contient `needle`. */
function ancestorWith(el: Element, needle: string): Element {
  let node: Element | null = el.parentElement;
  while (node && !(node.className || '').toString().includes(needle)) node = node.parentElement;
  assert.ok(node, `un ancêtre porte « ${needle} »`);
  return node;
}

/** Vrai si la classe demande un affichage côte à côte à un palier QUELCONQUE. */
const hasRowVariant = (className: string): boolean => /(^|\s)[^\s]*:?flex-row(\s|$)/.test(className);

describe('Barres d’outils des vues — le titre garde sa ligne, les commandes ne se compriment plus', () => {
  it('Paie : la barre du répertoire empile le titre et ses sept commandes, qui prennent toute la largeur', () => {
    const doc = dom(renderWithContext(createElement(PayrollView), {
      t, staff, filteredStaff: staff, salaryPayments: [], adminStaffCount: 1,
    }));

    const title = [...doc.querySelectorAll('h3')].find((h) => h.textContent === t.staffDirectory);
    assert.ok(title, 'le titre du répertoire est rendu');
    const toolbar = title.parentElement!.parentElement!;

    assert.ok(toolbar.className.includes('flex-col'), 'la barre empile ses deux blocs');
    assert.ok(!hasRowVariant(toolbar.className), 'aucun palier ne remet le titre à côté des commandes');
    assert.ok(!toolbar.className.includes('md:flex-1'), 'la barre ne se réserve plus la moitié de la ligne');

    const controls = toolbar.children[1] as Element;
    assert.ok(controls, 'les commandes suivent le titre');
    assert.ok(controls.className.includes('w-full'), 'les commandes disposent de toute la largeur');
    assert.ok(controls.className.includes('flex-wrap'), 'elles se replient sur leurs propres rangées');
    assert.ok(!controls.className.includes('justify-end'), 'rien ne les aligne à droite dans un espace étroit');
  });

  it('Paie : les cartes de personnel ne passent à trois colonnes qu’à 2xl', () => {
    const doc = dom(renderWithContext(createElement(PayrollView), {
      t, staff, filteredStaff: staff, salaryPayments: [], adminStaffCount: 1,
    }));

    const name = [...doc.querySelectorAll('h4')].find((h) => h.textContent?.includes(staff[0]!.name));
    assert.ok(name, 'une carte de personnel est rendue');
    const grid = ancestorWith(name, 'grid-cols-1');

    assert.ok(grid.className.includes('md:grid-cols-2'), 'deux colonnes dès md');
    assert.ok(grid.className.includes('2xl:grid-cols-3'), 'trois colonnes seulement quand ~314 px tiennent par carte');
    assert.ok(!grid.className.includes('lg:grid-cols-3'), 'trois colonnes dès lg écrasaient la carte (208 px pour ~314)');
  });

  it('Parents : l’en-tête ne passe côte à côte qu’à xl, et les commandes ne cèdent plus leur contenu', () => {
    const doc = dom(renderWithContext(createElement(ParentsView), { t, parents, parentSearchTerm: '' }));

    const input = doc.querySelector('input[placeholder]');
    assert.ok(input, 'le champ de recherche des parents est rendu');
    const cluster = input.parentElement!.parentElement!;
    const header = cluster.parentElement!;

    assert.ok(header.className.includes('flex-col'), 'l’en-tête empile sous xl');
    assert.ok(header.className.includes('xl:flex-row'), 'côte à côte à partir de xl seulement');
    assert.ok(!header.className.includes('md:flex-row'), 'dès md, 520 px de commandes ne tenaient pas à côté du titre');

    assert.ok(cluster.className.includes('xl:shrink-0'), 'les commandes gardent les 520 px du champ et du bouton');
    assert.ok(
      header.children[0]!.className.includes('min-w-0'),
      'c’est le titre qui se replie quand la place manque, pas les commandes',
    );
  });
});
