/**
 * Pure unit tests for the new-notification detection (no DOM, no React —
 * see tests/harness.ts "When NOT to use it").
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNewNotifications } from '../src/lib/notificationWatch';

const ids = (list: string[]): Set<string> => new Set(list);

const notif = (id: string) => ({ id, message: `msg ${id}` });

describe('findNewNotifications', () => {
  it('returns nothing on the first observation (session start)', () => {
    assert.deepEqual(
      findNewNotifications(null, [notif('due-a'), notif('note-b')]),
      [],
    );
  });

  it('returns nothing when the set is unchanged', () => {
    assert.deepEqual(
      findNewNotifications(ids(['due-a', 'note-b']), [notif('due-a'), notif('note-b')]),
      [],
    );
  });

  it('returns the newly appeared notifications', () => {
    const fresh = findNewNotifications(ids(['due-a']), [
      notif('due-a'),
      notif('note-b'),
      notif('due-c'),
    ]);
    assert.deepEqual(fresh.map(n => n.id), ['note-b', 'due-c']);
  });

  it('returns nothing when reminders disappear', () => {
    assert.deepEqual(
      findNewNotifications(ids(['due-a', 'note-b']), [notif('due-a')]),
      [],
    );
  });

  it('re-appearing ids (new due period) are treated as new', () => {
    const fresh = findNewNotifications(ids(['due-a']), [
      notif('due-a'),
      notif('due-a'),
      notif('note-b'),
    ]);
    assert.deepEqual(fresh.map(n => n.id), ['note-b']);
  });
});