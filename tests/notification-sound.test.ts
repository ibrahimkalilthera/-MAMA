/**
 * happy-dom tests for the notification chime.
 *
 * The module must be safe in every environment: no AudioContext at all
 * (happy-dom) → silent no-op; a throwing constructor (blocked autoplay /
 * no device) → silent no-op; a working AudioContext → one lazy context,
 * resumed when suspended, two oscillators started and stopped.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './harness';
import { playNotificationChime } from '../src/lib/notificationSound';

const win = installDomGlobals();

/** Minimal Web Audio fake recording oscillator lifecycles. */
function installFakeAudioContext(overrides: { throwOnNew?: boolean; suspended?: boolean } = {}) {
  const events: string[] = [];
  const started: number[] = [];
  class FakeGain {
    gain = { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} };
    connect = () => {};
  }
  class FakeOsc {
    type = '';
    frequency = { value: 0 };
    connect = () => {};
    start(t: number) { started.push(t); events.push('start'); }
    stop() { events.push('stop'); }
  }
  class FakeContext {
    state = overrides.suspended ? 'suspended' : 'running';
    currentTime = 0;
    destination = {};
    createOscillator() { events.push('osc'); return new FakeOsc(); }
    createGain() { events.push('gain'); return new FakeGain(); }
    resume() { events.push('resume'); this.state = 'running'; return Promise.resolve(); }
  }
  Object.defineProperty(win, 'AudioContext', {
    value: overrides.throwOnNew
      ? class { constructor() { throw new Error('autoplay blocked'); } }
      : FakeContext,
    configurable: true,
    writable: true,
  });
  return { events, started };
}

beforeEach(() => {
  delete (win as unknown as Record<string, unknown>).AudioContext;
  delete (win as unknown as Record<string, unknown>).webkitAudioContext;
});

describe('playNotificationChime', () => {
  it('is a silent no-op without any AudioContext (SSR/happy-dom)', () => {
    assert.doesNotThrow(() => playNotificationChime());
    assert.doesNotThrow(() => playNotificationChime());
  });

  it('is a silent no-op when the AudioContext constructor throws', () => {
    installFakeAudioContext({ throwOnNew: true });
    assert.doesNotThrow(() => playNotificationChime());
  });

  it('creates one lazy context and plays two oscillator notes', () => {
    const { events, started } = installFakeAudioContext();
    playNotificationChime();
    playNotificationChime();
    assert.equal(events.filter(e => e === 'osc').length, 4, 'two notes per chime, context reused');
    assert.equal(started.length, 4);
    assert.ok(started[1] > started[0], 'notes are offset in time');
    assert.ok(events.includes('stop'), 'oscillators are stopped');
  });

  it('resumes a suspended context (autoplay policy)', () => {
    const { events } = installFakeAudioContext({ suspended: true });
    playNotificationChime();
    assert.ok(events.includes('resume'));
  });
});