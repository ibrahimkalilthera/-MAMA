// Unit tests for the focus-stack (src/lib/focusStack.ts).
// DOM-free by design, like the escape-stack tests: the decision core
// (confineTab) and the stack lifecycle run against structural fakes; the
// document stubs used for focus-restore tests are set/removed per test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  confineTab,
  handleTabPress,
  popFocusTrap,
  pushFocusTrap,
  topmostContainer,
  type TrapContainer,
  type TrappedElement,
} from '../src/lib/focusStack';

class FakeFocusable implements TrappedElement {
  isConnected = true;
  private _focusCalls = 0;
  get focusCalls(): number {
    return this._focusCalls;
  }
  focus(): void {
    this._focusCalls += 1;
  }
}

class FakeContainer implements TrapContainer {
  readonly items: FakeFocusable[];
  private readonly bySelector: Record<string, FakeFocusable>;
  private _focusCalls = 0;
  constructor(items: FakeFocusable[] = [], bySelector: Record<string, FakeFocusable> = {}) {
    this.items = items;
    this.bySelector = bySelector;
  }
  get focusCalls(): number {
    return this._focusCalls;
  }
  querySelectorAll(): FakeFocusable[] {
    return this.items;
  }
  querySelector(selector: string): FakeFocusable | null {
    return this.bySelector[selector] ?? null;
  }
  contains(node: unknown): boolean {
    return node === this || this.items.includes(node as FakeFocusable);
  }
  focus(): void {
    this._focusCalls += 1;
  }
}

function preventDefaultSpy(): { prevented: boolean; preventDefault(): void } {
  const spy = { prevented: false, preventDefault: (): void => { spy.prevented = true; } };
  return spy;
}

/** Stub `document.activeElement` for the duration of a test. */
function withActiveElement(el: FakeFocusable | null, fn: () => void): void {
  const doc = {} as { activeElement: unknown };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  doc.activeElement = el;
  try {
    fn();
  } finally {
    Reflect.deleteProperty(globalThis, 'document');
  }
}

describe('focus-stack — confineTab decision core', () => {
  it('wraps Tab from the last focusable to the first', () => {
    const [a, b, c] = [new FakeFocusable(), new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b, c]);
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: c, shiftKey: false, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, true, 'the wrap must prevent the native tab-out');
    assert.equal(a.focusCalls, 1, 'focus moved to the first focusable');
    assert.equal(c.focusCalls, 0);
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const [a, b, c] = [new FakeFocusable(), new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b, c]);
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: a, shiftKey: true, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, true);
    assert.equal(c.focusCalls, 1);
    assert.equal(a.focusCalls, 0);
  });

  it('lets the native Tab advance between two inner focusables', () => {
    const [a, b, c] = [new FakeFocusable(), new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b, c]);
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: b, shiftKey: false, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, false, 'no intervention needed mid-list');
    assert.equal(a.focusCalls + b.focusCalls + c.focusCalls, 0);
  });

  it('pulls focus back inside when it sits outside the container', () => {
    const [a, b] = [new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b]);
    const outside = new FakeFocusable();
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: outside, shiftKey: false, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, true);
    assert.equal(a.focusCalls, 1, 'forward Tab pulls into the first focusable');
  });

  it('pulls focus to the last focusable on Shift+Tab when outside', () => {
    const [a, b] = [new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b]);
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: null, shiftKey: true, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, true);
    assert.equal(b.focusCalls, 1);
  });

  it('keeps focus on the container itself when nothing is focusable', () => {
    const container = new FakeContainer([]);
    const spy = preventDefaultSpy();
    confineTab({ container, activeElement: null, shiftKey: false, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, true);
    assert.equal(container.focusCalls, 1);
  });
});

describe('focus-stack — lifecycle', () => {
  it('topmostContainer resolves the last registered trap', () => {
    const bottom = new FakeContainer([new FakeFocusable()]);
    const top = new FakeContainer([new FakeFocusable()]);
    const idBottom = pushFocusTrap(() => bottom);
    assert.equal(topmostContainer(), bottom);
    const idTop = pushFocusTrap(() => top);
    assert.equal(topmostContainer(), top);
    popFocusTrap(idTop);
    assert.equal(topmostContainer(), bottom);
    popFocusTrap(idBottom);
    assert.equal(topmostContainer(), null);
  });

  it('popping an unknown id is a safe no-op', () => {
    popFocusTrap(424242);
    assert.equal(topmostContainer(), null);
  });

  it('re-arms after a full drain', () => {
    const first = new FakeContainer([new FakeFocusable()]);
    const second = new FakeContainer([new FakeFocusable()]);
    popFocusTrap(pushFocusTrap(() => first));
    assert.equal(topmostContainer(), null);
    const id = pushFocusTrap(() => second);
    assert.equal(topmostContainer(), second);
    popFocusTrap(id);
  });

  it('moves focus into the overlay on push and restores the trigger on pop', () => {
    const trigger = new FakeFocusable();
    const [first] = [new FakeFocusable()];
    const container = new FakeContainer([first]);
    withActiveElement(trigger, () => {
      const id = pushFocusTrap(() => container);
      assert.equal(first.focusCalls, 1, 'focus enters the overlay on open');
      popFocusTrap(id);
      assert.equal(trigger.focusCalls, 1, 'focus returns to the trigger on close');
    });
  });

  it('does not steal focus when focus is already inside the overlay', () => {
    const [inside] = [new FakeFocusable()];
    const container = new FakeContainer([inside]);
    withActiveElement(inside, () => {
      const id = pushFocusTrap(() => container);
      assert.equal(inside.focusCalls, 0, 'autofocused input keeps the focus');
      popFocusTrap(id);
      assert.equal(inside.focusCalls, 0, 'nothing to restore — restoreTo was inside the overlay');
    });
  });

  it('focuses the explicit selector target instead of the first focusable', () => {
    const [a, b] = [new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b], { 'input[type="text"]': b });
    const id = pushFocusTrap(() => container, 'input[type="text"]');
    assert.equal(b.focusCalls, 1, 'the selector target receives focus');
    assert.equal(a.focusCalls, 0, 'the first DOM focusable is skipped');
    popFocusTrap(id);
  });

  it('focuses the explicit function target (resolver form)', () => {
    const [a, b] = [new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b]);
    const id = pushFocusTrap(() => container, (c) => c?.querySelector('missing') ?? b);
    assert.equal(b.focusCalls, 1, 'the resolver return value receives focus');
    assert.equal(a.focusCalls, 0);
    popFocusTrap(id);
  });

  it('falls back to the first focusable when the explicit target is missing', () => {
    const [a] = [new FakeFocusable()];
    const container = new FakeContainer([a]);
    const id = pushFocusTrap(() => container, 'input[type="text"]');
    assert.equal(a.focusCalls, 1, 'no match → first focusable, as before');
    popFocusTrap(id);
  });

  it('ignores a throwing initialFocus resolver (never breaks the trap)', () => {
    const [a] = [new FakeFocusable()];
    const container = new FakeContainer([a]);
    const id = pushFocusTrap(() => container, () => { throw new Error('boom'); });
    assert.equal(a.focusCalls, 1, 'graceful fallback to the first focusable');
    popFocusTrap(id);
  });

  it('closing the top overlay pulls focus into the next one when the trigger is gone', () => {
    const [topFirst] = [new FakeFocusable()];
    const top = new FakeContainer([topFirst]);
    const bottom = new FakeContainer([new FakeFocusable()]);
    const orphanTrigger = new FakeFocusable();
    const idBottom = pushFocusTrap(() => bottom);
    withActiveElement(orphanTrigger, () => {
      const idTop = pushFocusTrap(() => top);
      assert.equal(topFirst.focusCalls, 1, 'initial focus into the top overlay on open');
      popFocusTrap(idTop); // trigger no longer lives in bottom → pull into bottom
      // bottom's first focusable: 1st call at its own open, 2nd call when the
      // top overlay closed and focus was pulled back into it.
      assert.equal(bottom.items[0].focusCalls, 2);
      assert.equal(orphanTrigger.focusCalls, 0, 'orphaned trigger is never refocused');
    });
    popFocusTrap(idBottom);
  });

  it('restores to a trigger still living inside the next open overlay', () => {
    const triggerInsideBottom = new FakeFocusable();
    const bottom = new FakeContainer([triggerInsideBottom]);
    const top = new FakeContainer([new FakeFocusable()]);
    const idBottom = pushFocusTrap(() => bottom);
    // 1st call: initial focus when bottom opened (document absent → pulls to first).
    withActiveElement(triggerInsideBottom, () => {
      const idTop = pushFocusTrap(() => top);
      popFocusTrap(idTop);
      assert.equal(triggerInsideBottom.focusCalls, 2, 'exact trigger restored into the open overlay (initial focus + restore)');
    });
    popFocusTrap(idBottom);
  });
});

describe('focus-stack — tab handler', () => {
  it('is a no-op with an empty stack', () => {
    const spy = preventDefaultSpy();
    handleTabPress({ shiftKey: false, preventDefault: spy.preventDefault });
    assert.equal(spy.prevented, false);
  });

  it('confines the press to the topmost trap', () => {
    const [a, b] = [new FakeFocusable(), new FakeFocusable()];
    const container = new FakeContainer([a, b]);
    const id = pushFocusTrap(() => container);
    withActiveElement(b, () => {
      const spy = preventDefaultSpy();
      handleTabPress({ shiftKey: false, preventDefault: spy.preventDefault });
      assert.equal(spy.prevented, true);
      // a: 1st call = initial focus on open, 2nd call = Tab wrap from the last.
      assert.equal(a.focusCalls, 2);
      assert.equal(b.focusCalls, 0);
    });
    popFocusTrap(id);
  });
});