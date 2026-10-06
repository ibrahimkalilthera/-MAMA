/**
 * La corbeille isolée ne doit plus se lire comme un ornement.
 *
 * Constat de départ, le 2026-10-06 : la suppression portait, selon la vue, soit
 * une pastille AVEC son libellé (« Supprimer le paiement », « Supprimer
 * l'élève », « Supprimer la dépense », « Supprimer l'employé »), soit une
 * corbeille SEULE, de la même couleur et de la même taille qu'une icône
 * décorative — et c'est justement le geste qu'on ne veut pas presser par
 * erreur. `ParentsView`, `NotesView` et `ProductivityPanel` étaient dans le
 * second cas.
 *
 * Ce fichier mesure le HTML RENDU, pas la source : le libellé doit être écrit
 * en TEXTE à côté de l'icône, pas seulement dans l'attribut `title` qui porte le
 * même mot. Compter les occurrences distingue les deux — l'attribut en donne
 * une, le texte en ajoute une.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { NotesView } from '../src/components/NotesView';
import { ProductivityPanel } from '../src/components/ProductivityPanel';
import { ParentsView } from '../src/components/ParentsView';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import type { TranslationDict } from '../src/i18n/translations';
import type { Parent, Todo } from '../src/lib/domainTypes';
import { translations } from '../src/i18n/translations';
import { makeProps, renderWithContext } from './views-harness';

const t = translations.en as TranslationDict;
const theme: CurrentTheme = makeProps().currentTheme;

const TASK: Todo = { id: 't1', text: 'Appeler le parent de Fatou', completed: false };

const GUARDIAN: Parent = {
  id: 'pa1',
  fullName: 'Moussa Kanté',
  phones: ['70 00 00 00'],
  email: 'moussa@mamathera.org',
  address: '',
  occupation: '',
  relationship: 'Père',
  notes: '',
};

/**
 * Le libellé est-il ÉCRIT, et pas seulement posé dans un `title` ? On compte :
 * l'attribut donne une occurrence du mot, le texte doit en ajouter une.
 */
function assertLabelIsWritten(html: string, label: string, where: string): void {
  const enTexte = html.split(label).length - 1;
  const enTitre = html.split(`title="${label}"`).length - 1;
  assert.ok(
    enTexte > enTitre,
    `${where} : le libellé « ${label} » doit accompagner l'icône, pas une corbeille seule`,
  );
}

describe('les corbeilles isolées portent leur libellé', () => {
  it('NotesView : la corbeille de tâche est une pastille libellée, pas une icône seule', () => {
    const html = renderWithContext(createElement(NotesView), { todos: [TASK] });
    assert.ok(html.includes(TASK.text), 'la tâche est bien rendue (sinon rien n’est mesuré)');
    assertLabelIsWritten(html, t.deleteTask, 'NotesView');
  });

  it('ProductivityPanel : la corbeille de tâche est une pastille libellée, pas une icône seule', () => {
    const html = renderToString(
      createElement(ProductivityPanel, {
        t,
        open: true,
        onClose: () => {},
        productivitySidebarTab: 'tasks',
        setProductivitySidebarTab: () => {},
        aiMessages: [],
        aiInput: '',
        setAiInput: () => {},
        handleAiQuery: () => {},
        todoInput: '',
        setTodoInput: () => {},
        todoDate: '2026-01-15',
        setTodoDate: () => {},
        handleAddTodo: () => {},
        todos: [TASK],
        toggleTodo: () => {},
        deleteTodo: () => {},
        handleUpdateTodoDate: async () => true,
        currentTheme: theme,
      }),
    );
    assert.ok(html.includes(TASK.text), 'la tâche est bien rendue (sinon rien n’est mesuré)');
    assertLabelIsWritten(html, t.deleteTask, 'ProductivityPanel');
  });

  it('ParentsView : supprimer un parent est une pastille libellée, pas une icône seule', () => {
    const html = renderWithContext(createElement(ParentsView), {
      parents: [GUARDIAN],
      canDelete: true,
    });
    assert.ok(html.includes(GUARDIAN.fullName), 'le parent est bien rendu (sinon rien n’est mesuré)');
    assertLabelIsWritten(html, t.deleteParent, 'ParentsView');
  });
});
