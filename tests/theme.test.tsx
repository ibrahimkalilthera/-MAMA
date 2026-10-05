/**
 * happy-dom unit tests for the useTheme domain hook.
 *
 * Real hook rendered through a probe: the default theme (Cyber Minuit) and its
 * one-time reprise, the legacy `modern`→`cream` rename, the theme/logo/color
 * persistence effects, the currentTheme token derivation and the logo upload
 * handler (base64 saved to localStorage; FileReader is stubbed globally because
 * happy-dom has no file input runtime).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { useTheme } from '../src/app/useTheme';
import { parseColor } from '../src/lib/brandAccent';
import { installDomGlobals, renderHook } from './harness';
import type { HookRender } from './harness';

// ── global stubs ─────────────────────────────────────────────────────────────
// FileReader is stubbed as a plain global class (no node:test mock): the test
// grabs the latest instance and fires `onload` with a base64 payload (the
// canvas color-extraction part is skipped: happy-dom has no real canvas for
// getImageData).
let lastReader: StubFileReader | null = null;
function registerReader(r: StubFileReader): void { lastReader = r; }
class StubFileReader {
  onload: ((ev: { target: { result: string } }) => void) | null = null;
  constructor() { registerReader(this); }
  readAsDataURL(_f: unknown): void { /* the instance is already registered */ }
}

const win = installDomGlobals();
// File-specific extras (Image needed by handleLogoUpload's color extraction
// path, FileReader replaced by the controllable stub).
Object.defineProperty(globalThis, 'Image', { value: win.Image ?? win.HTMLImageElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'FileReader', { value: StubFileReader, configurable: true, writable: true });

type ThemeApi = ReturnType<typeof useTheme>;
type ApiRef = { current: ThemeApi | null };
type UploadEvent = Parameters<NonNullable<ThemeApi>['handleLogoUpload']>[0];

let mounted: HookRender<undefined, ThemeApi> | null = null;
function render(api: ApiRef): void {
  mounted?.unmount();
  mounted = renderHook(useTheme, undefined, api);
}
function unmount(): void {
  mounted?.unmount();
  mounted = null;
}

const KEY_THEME = 'school-finance-theme';
const KEY_LOGO = 'school-finance-logo';
const KEY_COLOR = 'school-finance-logo-color';
/** Which default theme this browser has already adopted (see useTheme). */
const KEY_DEFAULT = 'school-finance-theme-default';

describe('useTheme', () => {
  it('defaults to the Cyber Minuit theme (the midnight id)', () => {
    win.localStorage.clear();
    const api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'midnight');
    assert.equal(api.current?.currentTheme.isDark, true);
    assert.equal(api.current?.currentTheme.bg, 'bg-[#090D16]');
    assert.equal(api.current?.currentTheme.accent, 'amber-400');
    unmount();
  });

  it('adopts the default ONCE for a browser that had saved another theme', () => {
    // A saved 'navy' cannot be told apart from the old default (the persist
    // effect wrote that same value on first load) — which is why the reprise
    // reads its own marker: a browser that predates the default change adopts
    // Cyber Minuit once, and the marker records that it happened.
    win.localStorage.clear();
    win.localStorage.setItem(KEY_THEME, 'navy');
    const api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'midnight');
    assert.equal(win.localStorage.getItem(KEY_THEME), 'midnight');
    assert.equal(win.localStorage.getItem(KEY_DEFAULT), 'midnight');
    unmount();
  });

  it('honours the theme the user picked after that reprise', () => {
    win.localStorage.clear();
    win.localStorage.setItem(KEY_DEFAULT, 'midnight'); // default already adopted
    win.localStorage.setItem(KEY_THEME, 'emerald');
    const api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'emerald');
    assert.equal(api.current?.currentTheme.isDark, false);
    assert.equal(api.current?.currentTheme.accent, 'emerald-600');
    unmount();
  });

  it('exposes the group-hover token for every theme and a custom logo accent', () => {
    win.localStorage.clear();
    const api: ApiRef = { current: null };
    render(api);
    try {
      for (const theme of ['navy', 'slate', 'emerald', 'bordeaux', 'cream', 'midnight'] as const) {
        act(() => { api.current?.setTheme(theme); });
        assert.equal(api.current?.currentTheme.accentGroupHover, 'accent-group-hover', theme);
        assert.deepEqual(parseColor(document.documentElement.style.getPropertyValue('--accent-primary')), parseColor(api.current!.currentTheme.accentHex));
        assert.ok(document.documentElement.style.getPropertyValue('--accent-ink'), `${theme}: readable ink supplied`);
      }
      act(() => { api.current?.setLogoColor('rgb(10, 20, 30)'); });
      assert.equal(api.current?.currentTheme.accentGroupHover, 'accent-group-hover');
      assert.equal(document.documentElement.style.getPropertyValue('--accent-primary'), 'rgb(10,20,30)');
    } finally {
      unmount();
      win.localStorage.clear();
    }
  });

  it('applies the legacy modern→cream migration but keeps midnight as itself', () => {
    // `midnight` (Cyber Minuit) is a real picker theme with its own palette —
    // a saved midnight must restore as midnight, NOT be silently flipped to
    // slate (the old midnight→slate migration predates midnight being its own
    // theme and broke Cyber Minuit persistence on every reload). The default
    // marker is set so the reprise cannot mask the saved value under test.
    win.localStorage.clear();
    win.localStorage.setItem(KEY_DEFAULT, 'midnight');
    win.localStorage.setItem(KEY_THEME, 'midnight');
    let api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'midnight');
    assert.equal(api.current?.currentTheme.isDark, true);
    assert.equal(api.current?.currentTheme.bg, 'bg-[#090D16]');
    unmount();

    // Only the true legacy id (`modern`, no such theme exists) is migrated.
    win.localStorage.setItem(KEY_DEFAULT, 'midnight');
    win.localStorage.setItem(KEY_THEME, 'modern');
    api = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'cream');
    assert.equal(api.current?.currentTheme.isDark, false);
    assert.equal(api.current?.currentTheme.bg, 'bg-[#FDFBF7]');
    unmount();
    win.localStorage.removeItem(KEY_THEME);
  });

  it('persists the theme to localStorage when changed', () => {
    win.localStorage.clear();
    const api: ApiRef = { current: null };
    render(api);
    act(() => { api.current?.setTheme('emerald'); });
    assert.equal(win.localStorage.getItem(KEY_THEME), 'emerald');
    assert.equal(api.current?.currentTheme.accent, 'emerald-600');
    unmount();
  });

  it('restores a saved logo and derives the header color from it', () => {
    win.localStorage.setItem(KEY_LOGO, 'data:image/png;base64,AAAA');
    win.localStorage.setItem(KEY_COLOR, 'rgb(10, 20, 30)');
    const api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.schoolLogo, 'data:image/png;base64,AAAA');
    assert.equal(api.current?.logoColor, 'rgb(10, 20, 30)');
    assert.equal(api.current?.currentTheme.header, 'rgb(10, 20, 30)');
    unmount();
  });

  it('persists a newly set logo/color and clears them when removed', () => {
    win.localStorage.clear();
    const api: ApiRef = { current: null };
    render(api);
    act(() => {
      api.current?.setSchoolLogo('data:image/png;base64,BBBB');
      api.current?.setLogoColor('rgb(1, 2, 3)');
    });
    assert.equal(win.localStorage.getItem(KEY_LOGO), 'data:image/png;base64,BBBB');
    assert.equal(win.localStorage.getItem(KEY_COLOR), 'rgb(1, 2, 3)');
    act(() => { api.current?.setSchoolLogo(null); });
    assert.equal(win.localStorage.getItem(KEY_LOGO), null);
    unmount();
  });

  it('handleLogoUpload saves the base64 and keeps the flow silent for empty files', () => {
    win.localStorage.clear();
    const api: ApiRef = { current: null };
    render(api);
    // No file selected → early return, nothing written
    const emptyEvent = { target: { files: null } } as unknown as UploadEvent;
    api.current?.handleLogoUpload(emptyEvent);
    assert.equal(win.localStorage.getItem(KEY_LOGO), null);
    // With a file: the FileReader stub fires onload with the base64 payload
    const fileEvent = { target: { files: [new File(['x'], 'logo.png')] } } as unknown as UploadEvent;
    api.current?.handleLogoUpload(fileEvent);
    act(() => { lastReader?.onload?.({ target: { result: 'data:image/png;base64,CCCC' } }); });
    assert.equal(api.current?.schoolLogo, 'data:image/png;base64,CCCC');
    assert.equal(win.localStorage.getItem(KEY_LOGO), 'data:image/png;base64,CCCC');
    unmount();
  });
});