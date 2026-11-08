/**
 * Le contrat clavier des dialogues — prouvé sur le DOM réel (happy-dom).
 *
 * Ce que ces cas tiennent, et qu'aucun autre test du dépôt ne regardait : `Tab`
 * ne sort pas d'un dialogue, `Shift+Tab` boucle dans l'autre sens, le focus est
 * rendu à son point de départ, et deux ouvertures successives ne laissent pas
 * deux écouteurs à se contredire.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { focusablesIn, trapFocus } from '../src/lib/focusTrap';
import { installDomGlobals } from './harness';

let win: Window & typeof globalThis;
let root: HTMLElement;
let trigger: HTMLButtonElement;

/** Un `Tab` réel : l'événement part de l'élément actif, comme au clavier. */
function pressTab(shiftKey = false): void {
  const event = new win.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  const active = document.activeElement;
  assert.ok(active instanceof win.HTMLElement, 'un élément doit avoir le focus avant d’envoyer Tab');
  active.dispatchEvent(event as unknown as Event);
}

beforeEach(() => {
  win = installDomGlobals() as unknown as Window & typeof globalThis;
  // Le déclencheur vit HORS du dialogue : c'est lui que la restauration doit
  // retrouver, et un test qui le placerait dedans ne prouverait rien.
  trigger = document.createElement('button');
  trigger.textContent = 'ouvrir';
  document.body.appendChild(trigger);
  trigger.focus();

  root = document.createElement('div');
  root.innerHTML = `
    <button id="premier">premier</button>
    <input id="champ" />
    <a id="lien" href="#fin">lien</a>
    <button id="desactive" disabled>désactivé</button>
    <button id="cache" hidden>caché</button>
    <div aria-hidden="true"><button id="fantome">fantôme</button></div>
  `;
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
  trigger.remove();
});

describe('focusTrap — l’inventaire des focalisables', () => {
  it('trouve boutons, champs et liens, et ignore désactivé / caché / aria-hidden', () => {
    const ids = focusablesIn(root).map((el) => el.id);
    assert.deepEqual(ids, ['premier', 'champ', 'lien']);
  });

  it('n’inclut jamais un point de focus programmatique (tabindex="-1")', () => {
    const programmatic = document.createElement('div');
    programmatic.id = 'racine-programmatique';
    programmatic.setAttribute('tabindex', '-1');
    root.appendChild(programmatic);
    assert.ok(!focusablesIn(root).some((el) => el.id === 'racine-programmatique'));
  });
});

describe('focusTrap — le bouclage', () => {
  it('à l’ouverture, le focus entre dans le dialogue (premier focalisable)', () => {
    const release = trapFocus(root);
    assert.equal(document.activeElement?.id, 'premier');
    release();
  });

  it('Tab sur le dernier élément revient au premier', () => {
    const release = trapFocus(root);
    document.getElementById('lien')?.focus();
    pressTab();
    assert.equal(document.activeElement?.id, 'premier', 'le focus est resté piégé');
    release();
  });

  it('Shift+Tab sur le premier élément va au dernier', () => {
    const release = trapFocus(root);
    document.getElementById('premier')?.focus();
    pressTab(true);
    assert.equal(document.activeElement?.id, 'lien');
    release();
  });

  it('Shift+Tab depuis la racine (aucun enfant actif) va au dernier', () => {
    const release = trapFocus(root);
    root.focus();
    pressTab(true);
    assert.equal(document.activeElement?.id, 'lien');
    release();
  });

  it('un dialogue sans focalisable garde le focus et se rend focalisable lui-même', () => {
    const vide = document.createElement('div');
    vide.textContent = 'aucun contrôle';
    document.body.appendChild(vide);
    const release = trapFocus(vide);
    assert.equal(document.activeElement, vide, 'la racine prend le focus au lieu de la page');
    assert.equal(vide.getAttribute('tabindex'), '-1');
    pressTab();
    assert.equal(document.activeElement, vide, 'Tab ne sort pas d’un dialogue vide');
    release();
    assert.equal(vide.hasAttribute('tabindex'), false, 'l’attribut posé est retiré au débranchement');
    vide.remove();
  });
});

describe('focusTrap — le débranchement', () => {
  it('rend le focus à l’élément qui l’avait avant l’ouverture', () => {
    const release = trapFocus(root);
    assert.notEqual(document.activeElement, trigger);
    release();
    assert.equal(document.activeElement, trigger);
  });

  it('deux activations ne laissent qu’UN écouteur vivant sur la même racine', () => {
    const first = trapFocus(root);
    const second = trapFocus(root);
    // Le premier débranchement est retiré par la seconde activation : le piège
    // doit rester actif, sinon `Tab` sortirait du dialogue à la première fermeture.
    first();
    document.getElementById('lien')?.focus();
    pressTab();
    assert.equal(document.activeElement?.id, 'premier', 'le second piège est toujours actif');

    second();
    document.getElementById('lien')?.focus();
    pressTab();
    assert.equal(document.activeElement?.id, 'lien', 'débranché : plus aucune interception');
  });

  it('débrancher deux fois ne restaure pas deux fois (idempotent)', () => {
    const release = trapFocus(root);
    trigger.focus();
    release();
    assert.equal(document.activeElement, trigger);
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    release();
    assert.equal(document.activeElement, elsewhere, 'la seconde sortie ne touche à rien');
    elsewhere.remove();
  });

  it('un élément retiré du DOM ne fait pas lever le débranchement', () => {
    const release = trapFocus(root);
    const detached = document.getElementById('premier');
    detached?.remove();
    root.remove();
    assert.doesNotThrow(() => release());
  });
});
