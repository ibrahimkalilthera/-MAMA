/**
 * happy-dom unit tests for the useTheme domain hook.
 *
 * Real hook rendered through a probe: default theme, the legacy
 * `midnight`→`slate` / `modern`→`cream` localStorage migrations, the
 * theme/logo/color persistence effects, the currentTheme token derivation
 * and the logo upload handler (base64 saved to localStorage; FileReader is
 * stubbed globally because happy-dom has no file input runtime).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useTheme } from '../src/app/useTheme';

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

/** Install happy-dom globals (localStorage included). */
function installDomGlobals(): Window {
  const win = new Window({ url: 'http://localhost/' });
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('CustomEvent', win.CustomEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('localStorage', win.localStorage);
  define('Image', win.Image ?? win.HTMLImageElement);
  define('FileReader', StubFileReader);
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}

const win = installDomGlobals();

type ThemeApi = ReturnType<typeof useTheme>;
type ApiRef = { current: ThemeApi | null };
type UploadEvent = Parameters<NonNullable<ThemeApi>['handleLogoUpload']>[0];

function Harness(props: { api: ApiRef }): null {
  props.api.current = useTheme();
  return null;
}

let root: Root;
let container: HTMLElement;
function render(api: ApiRef): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness, { api })));
}
function unmount(): void {
  if (root) { act(() => root.unmount()); root = null as unknown as Root; }
  if (container) container.remove();
}

const KEY_THEME = 'school-finance-theme';
const KEY_LOGO = 'school-finance-logo';
const KEY_COLOR = 'school-finance-logo-color';

describe('useTheme', () => {
  it('defaults to the navy theme with light tokens', () => {
    const api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'navy');
    assert.equal(api.current?.currentTheme.isDark, false);
    assert.equal(api.current?.currentTheme.bg, 'bg-[#F8FAFC]');
    assert.equal(api.current?.currentTheme.accent, 'blue-600');
    unmount();
  });

  it('applies the legacy midnight→slate and modern→cream migrations on load', () => {
    win.localStorage.setItem(KEY_THEME, 'midnight');
    let api: ApiRef = { current: null };
    render(api);
    assert.equal(api.current?.theme, 'slate');
    assert.equal(api.current?.currentTheme.isDark, true);
    unmount();

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
    win.localStorage.removeItem(KEY_THEME);
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