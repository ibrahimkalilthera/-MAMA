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
  getDeletedNotificationIds,
  getReadNotificationIds,
  saveDeletedNotificationIds,
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

  it('keeps the read store on its historical storage key', () => {
    // Contract: deployed desktops already hold read-state under this exact
    // key — renaming it would silently reset every user's dismissal history.
    saveReadNotificationIds('u1', ['due-a']);
    assert.equal(localStorage.getItem('mama-notifications-read-v1:u1'), '["due-a"]');
  });

  it('keeps the deleted store independent from the read store', () => {
    saveReadNotificationIds('u1', ['due-a']);
    saveDeletedNotificationIds('u1', ['note-b']);
    assert.deepEqual(getReadNotificationIds('u1'), ['due-a']);
    assert.deepEqual(getDeletedNotificationIds('u1'), ['note-b']);
  });

  it('round-trips the deleted ids and keeps users independent', () => {
    saveDeletedNotificationIds('u1', ['due-a']);
    assert.deepEqual(getDeletedNotificationIds('u1'), ['due-a']);
    assert.deepEqual(getDeletedNotificationIds('u2'), []);
  });

  it('degrades the deleted store to [] on corrupt or non-array payloads', () => {
    localStorage.setItem('mama-notifications-deleted-v1:u1', '{not json');
    assert.deepEqual(getDeletedNotificationIds('u1'), []);
    localStorage.setItem('mama-notifications-deleted-v1:u1', '["due-a", 42]');
    assert.deepEqual(getDeletedNotificationIds('u1'), ['due-a']);
  });

  it('an empty deleted save brings everything back (restore)', () => {
    saveDeletedNotificationIds('u1', ['due-a']);
    saveDeletedNotificationIds('u1', []);
    assert.deepEqual(getDeletedNotificationIds('u1'), []);
  });
});