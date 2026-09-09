/**
 * happy-dom tests for the notification chime.
 *
 * The module must be safe in every environment: no AudioContext at all
 * (happy-dom) → silent no-op; a throwing constructor (blocked autoplay /
 * no device) → silent no-op. Browsers refuse to START an AudioContext
 * created/resumed outside a user gesture (and log a console warning), so
 * the context must only ever be created on the first user gesture: a chime
 * requested before it is held and played once the gesture unlocks audio.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomGlobals } from './harness';
import { playNotificationChime, __resetNotificationSoundForTests } from '../src/lib/notificationSound';

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
    constructor() { events.push('new'); }
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

/** Simulates the first user gesture that unlocks audio. */
function unlock(): void {
  win.dispatchEvent(new win.Event('pointerdown'));
}

beforeEach(() => {
  __resetNotificationSoundForTests();
  delete (win as unknown as Record<string, unknown>).AudioContext;
  delete (win as unknown as Record<string, unknown>).webkitAudioContext;
});

describe('playNotificationChime', () => {
  it('is a silent no-op without any AudioContext (SSR/happy-dom)', () => {
    assert.doesNotThrow(() => playNotificationChime());
    assert.doesNotThrow(() => playNotificationChime());
  });

  it('never creates the AudioContext before a user gesture (no autoplay warning)', () => {
    const { events } = installFakeAudioContext();
    playNotificationChime();
    playNotificationChime();
    assert.equal(events.filter(e => e === 'new').length, 0, 'no blocked context creation before a gesture');
  });

  it('is a silent no-op when the AudioContext constructor throws', () => {
    installFakeAudioContext({ throwOnNew: true });
    assert.doesNotThrow(() => playNotificationChime());
    unlock(); // constructor still throws inside the gesture → stays silent
    assert.doesNotThrow(() => playNotificationChime());
  });

  it('holds the pre-gesture chime and plays it once the first gesture unlocks audio', () => {
    const { events, started } = installFakeAudioContext();
    playNotificationChime(); // before any gesture → held, no context yet
    playNotificationChime(); // still held
    unlock();
    assert.equal(events.filter(e => e === 'new').length, 1, 'one shared context created inside the gesture');
    assert.equal(events.filter(e => e === 'osc').length, 2, 'the held chime plays at unlock');
    playNotificationChime(); // unlocked now → plays immediately
    assert.equal(events.filter(e => e === 'osc').length, 4, 'two notes per chime, context reused');
    assert.equal(started.length, 4);
    assert.ok(started[1] > started[0], 'notes are offset in time');
    assert.ok(events.includes('stop'), 'oscillators are stopped');
  });

  it('resumes a suspended context during the unlock gesture (autoplay policy)', () => {
    const { events } = installFakeAudioContext({ suspended: true });
    playNotificationChime();
    unlock();
    assert.ok(events.includes('resume'), 'context resumed inside the gesture');
    assert.equal(events.filter(e => e === 'osc').length, 2, 'the held chime plays after the resume');
  });
});