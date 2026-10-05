/**
 * happy-dom render tests for Login — the submit path, and the one failure mode
 * that made the form look broken while the check script worked.
 *
 * Mesuré : le formulaire est un formulaire CONTRÔLÉ. Tant que les valeurs
 * arrivaient par de vrais événements `input` (une frappe), l'état React suivait.
 * Mais un remplissage qui écrit la valeur SANS émettre d'événement — gestionnaire
 * de mots de passe, remplissage programmatique, automatisation — laissait l'état
 * vide : le formulaire soumettait des identifiants VIDES et le serveur répondait
 * `400 invalid_credentials`, un refus qui accuse le mot de passe alors que rien
 * n'avait été envoyé. Le script de contrôle, lui, poste la valeur directement et
 * ne rencontre jamais ce piège.
 *
 * Ces cas verrouillent le remède : la source de vérité est le CHAMP au moment de
 * soumettre. Le premier cas garde le chemin normal (frappe) intact ; le second
 * est la régression elle-même ; le troisième garde le `trim()` sur l'email qui
 * coexistait déjà.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { Login } from '../src/components/Login';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals();
// Login anime avec motion — le ticker WAAPI de happy-dom n'avance jamais, donc
// les animations doivent se résoudre instantanément (même béquille que
// parent-form-modal.test / staff-form-modal.test).
const finishedAnimation = {
  finished: Promise.resolve(),
  currentTime: 0,
  playState: 'finished',
  effect: null,
  onfinish: null,
  oncancel: null,
  play: () => {},
  pause: () => {},
  cancel: () => {},
  finish: () => {},
  reverse: () => {},
  commitStyles: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
(win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

const EMAIL = 'ibrahimkalilthera@mamathera.org';
const PASSWORD = 'YgveH%@gBHoZJa9ycrKo';

type SignIn = (email: string, password: string) => Promise<{ success: boolean; error?: string }>;

function mount(onLogin: SignIn) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Login, { onLogin, lang: 'fr' as const, setLang: () => {}, t }));
  });
  const form = container.querySelector('form') as HTMLFormElement;
  const email = container.querySelector("input[name='username']") as HTMLInputElement;
  const password = container.querySelector("input[name='password']") as HTMLInputElement;
  assert.ok(form && email && password, 'le formulaire de connexion est rendu');
  return { container, root, form, email, password };
}

function unmount(rendered: ReturnType<typeof mount>) {
  rendered.root.unmount();
  document.body.removeChild(rendered.container);
}

/** Frappe « humaine » : pose la valeur ET l'événement `input` que React écoute. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
  });
}

describe('Login — l’envoi lit le CHAMP, pas seulement l’état React', () => {
  it('une frappe normale passe l’email (nettoyé) et le mot de passe', async () => {
    const calls: [string, string][] = [];
    const rendered = mount(async (email, password) => {
      calls.push([email, password]);
      return { success: true };
    });
    typeInto(rendered.email, `  ${EMAIL}  `);
    typeInto(rendered.password, PASSWORD);
    await submit(rendered.form);
    assert.deepEqual(calls, [[EMAIL, PASSWORD]], 'la frappe donne bien email.trim() + mot de passe');
    unmount(rendered);
  });

  it('un remplissage SANS événement `input` envoie quand même les identifiants (la régression)', async () => {
    const calls: [string, string][] = [];
    const rendered = mount(async (email, password) => {
      calls.push([email, password]);
      return { success: true };
    });
    // Écriture directe : c'est ce que fait un gestionnaire de mots de passe ou une
    // automatisation — l'état React reste vide, et le formulaire « nu » enverrait ''.
    rendered.email.value = EMAIL;
    rendered.password.value = PASSWORD;
    await submit(rendered.form);
    assert.deepEqual(
      calls,
      [[EMAIL, PASSWORD]],
      'le formulaire doit soumettre ce que les champs contiennent (sinon : 400 invalid_credentials)',
    );
    unmount(rendered);
  });

  it('les champs restent renseignés après l’envoi (l’état est resynchronisé)', async () => {
    const rendered = mount(async () => ({ success: false, error: 'Invalid login credentials' }));
    rendered.email.value = EMAIL;
    rendered.password.value = PASSWORD;
    await submit(rendered.form);
    assert.equal(rendered.email.value, EMAIL, 'le champ email ne se vide pas');
    assert.equal(rendered.password.value, PASSWORD, 'le champ mot de passe ne se vide pas');
    unmount(rendered);
  });
});
