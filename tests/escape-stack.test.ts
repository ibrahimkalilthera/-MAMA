// Unit tests for the escape-to-close stack (src/lib/useEscapeToClose.ts).
// DOM-free by design: the stack logic is driven directly through
// handleEscapePress; the keydown wiring itself is a thin DOM layer.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleEscapePress, popEscapeClose, pushEscapeClose } from '../src/lib/useEscapeToClose';

describe('escape-to-close stack', () => {
  it('closes only the topmost overlay per press', () => {
    const closed: string[] = [];
    const bottom = pushEscapeClose(() => closed.push('bottom'));
    const top = pushEscapeClose(() => closed.push('top'));

    assert.equal(handleEscapePress(), true);
    assert.deepEqual(closed, ['top'], 'one press must close exactly the topmost overlay');

    popEscapeClose(top);
    popEscapeClose(bottom);
    assert.equal(handleEscapePress(), false, 'stack fully drained');
  });

  it('falls back to the overlay below after the top one unmounts', () => {
    const closed: string[] = [];
    const a = pushEscapeClose(() => closed.push('a'));
    const b = pushEscapeClose(() => closed.push('b'));

    assert.equal(handleEscapePress(), true);
    assert.deepEqual(closed, ['b']);
    popEscapeClose(b); // simulates the overlay unmounting after its close()

    assert.equal(handleEscapePress(), true);
    assert.deepEqual(closed, ['b', 'a'], 'the next press closes the now-topmost overlay');

    popEscapeClose(a);
    assert.equal(handleEscapePress(), false);
  });

  it('press with an empty stack is a no-op', () => {
    assert.equal(handleEscapePress(), false);
  });

  it('popping an unknown id is a safe no-op', () => {
    popEscapeClose(424242);
    assert.equal(handleEscapePress(), false);
  });

  it('re-arms after a full drain', () => {
    const hits: string[] = [];
    const first = pushEscapeClose(() => hits.push('first'));
    assert.equal(handleEscapePress(), true);
    popEscapeClose(first);
    assert.equal(handleEscapePress(), false, 'listener released when the stack empties');

    const second = pushEscapeClose(() => hits.push('second'));
    assert.equal(handleEscapePress(), true);
    assert.deepEqual(hits, ['first', 'second'], 'a fresh registration works after a full drain');
    popEscapeClose(second);
  });
});
