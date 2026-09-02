/**
 * happy-dom tests for the notification read-state persistence module.
 *
 * The module is BY DESIGN localStorage-backed (same convention as
 * teamSettings / offlineQueue), so it legitimately needs the happy-dom
 * globals — unlike the pure-logic suites listed in tests/harness.ts.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './harness';
import {
  getReadNotificationIds,
  saveReadNotificationIds,
} from '../src/lib/notificationReads';

installDomGlobals();

describe('notificationReads', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] when nothing was stored', () => {
    assert.deepEqual(getReadNotificationIds('u1'), []);
  });

  it('round-trips the dismissed ids', () => {
    saveReadNotificationIds('u1', ['due-a', 'note-b']);
    assert.deepEqual(getReadNotificationIds('u1'), ['due-a', 'note-b']);
  });

  it('keeps per-user stores independent', () => {
    saveReadNotificationIds('u1', ['due-a']);
    saveReadNotificationIds('u2', ['note-b']);
    assert.deepEqual(getReadNotificationIds('u1'), ['due-a']);
    assert.deepEqual(getReadNotificationIds('u2'), ['note-b']);
  });

  it('degrades to [] on corrupt JSON', () => {
    localStorage.setItem('mama-notifications-read-v1:u1', '{not json');
    assert.deepEqual(getReadNotificationIds('u1'), []);
  });

  it('degrades to [] when the payload is not an array', () => {
    localStorage.setItem('mama-notifications-read-v1:u1', '{"a":1}');
    assert.deepEqual(getReadNotificationIds('u1'), []);
  });

  it('drops non-string entries from a malformed array', () => {
    localStorage.setItem('mama-notifications-read-v1:u1', '["due-a", 42, null]');
    assert.deepEqual(getReadNotificationIds('u1'), ['due-a']);
  });

  it('an empty save overwrites the previous state', () => {
    saveReadNotificationIds('u1', ['due-a']);
    saveReadNotificationIds('u1', []);
    assert.deepEqual(getReadNotificationIds('u1'), []);
  });
});