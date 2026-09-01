/**
 * Focus-stack — Tab confinement and focus restoration for every overlay.
 *
 * Keyboard companion of src/lib/useEscapeToClose.ts, sharing its shape: each
 * OPEN overlay registers a trap on a module-level stack, ONE delegated
 * keydown listener confines Tab to the topmost trap (wrapping at both ends,
 * pulling focus back in when it sits outside), and closing an overlay returns
 * focus to the trigger that opened it — or, when another overlay is still
 * open above/below it, to the trigger inside that overlay, else into the
 * next open overlay.
 *
 * SSR-safe: without `window` the listener is never attached, and without
 * `document` the focus bookkeeping is skipped. Tests drive the decision core
 * (`confineTab`) and the stack lifecycle through structural fakes.
 */
import { useEffect, useRef } from 'react';

/** Minimal structural view of a focusable element (an HTMLElement suffices). */
export interface TrappedElement {
  focus(options?: FocusOptions): void;
  readonly isConnected: boolean;
}

/** Minimal structural view of a trap container (an Element suffices). */
export interface TrapContainer {
  querySelectorAll(selectors: string): Iterable<TrappedElement>;
  querySelector(selectors: string): TrappedElement | null;
  contains(node: unknown): boolean;
  focus(options?: FocusOptions): void;
}

/**
 * Where focus should land when an overlay opens — an explicit target that
 * overrides the blind "first focusable" rule. A CSS selector is resolved
 * against the trap container; a function receives the container (null when
 * absent) and returns the element (or null to fall back).
 */
export type InitialFocus =
  | string
  | ((container: TrapContainer | null) => TrappedElement | null);

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface TrapEntry {
  id: number;
  getContainer: () => TrapContainer | null;
  restoreTo: TrappedElement | null;
}

const stack: TrapEntry[] = [];
let nextId = 1;
let attached = false;

type KeyTarget = {
  addEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
};

const keyTarget: KeyTarget | null = typeof window !== 'undefined' ? window : null;

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  handleTabPress(event);
}

function ensureListener(): void {
  if (attached || !keyTarget) return;
  keyTarget.addEventListener('keydown', onKeyDown);
  attached = true;
}

function releaseListener(): void {
  if (!attached || !keyTarget) return;
  keyTarget.removeEventListener('keydown', onKeyDown);
  attached = false;
}

function focusablesOf(container: TrapContainer): TrappedElement[] {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

function focusFirst(container: TrapContainer): void {
  try {
    (focusablesOf(container)[0] ?? container).focus();
  } catch {
    /* the element may be inert or removed mid-flight — never throw */
  }
}

/** Resolve the explicit initial-focus target, if any (never throws). */
function resolveInitialFocus(
  container: TrapContainer | null,
  initialFocus: InitialFocus | undefined,
): TrappedElement | null {
  if (!container || !initialFocus) return null;
  try {
    return typeof initialFocus === 'string'
      ? container.querySelector(initialFocus)
      : initialFocus(container);
  } catch {
    return null;
  }
}

/**
 * Confine a Tab press to `container`. Exported as the pure decision core:
 * wraps at both ends (Tab on the last goes to the first, Shift+Tab on the
 * first goes to the last), pulls focus back inside when it sits outside the
 * container (or when the container has nothing focusable), and lets the
 * native Tab advance when focus already moves between two inner focusables.
 */
export function confineTab(opts: {
  container: TrapContainer;
  activeElement: TrappedElement | null;
  shiftKey: boolean;
  preventDefault(): void;
}): void {
  const { container, activeElement, shiftKey, preventDefault } = opts;
  const focusables = focusablesOf(container);

  if (focusables.length === 0) {
    preventDefault();
    focusFirst(container);
    return;
  }

  const index = activeElement ? focusables.indexOf(activeElement) : -1;

  if (index === -1) {
    // Focus is outside the container (or on a non-focusable spot inside):
    // pull it back in, going backwards when Shift+Tab was pressed.
    preventDefault();
    focusables[shiftKey ? focusables.length - 1 : 0].focus();
  } else if (shiftKey && index === 0) {
    preventDefault();
    focusables[focusables.length - 1].focus();
  } else if (!shiftKey && index === focusables.length - 1) {
    preventDefault();
    focusables[0].focus();
  }
  // Otherwise: let the native Tab advance inside the container.
}

/**
 * Register an open overlay's trap. Records the element that had focus (the
 * trigger) so it can be restored on close, and moves focus into the overlay —
 * onto the explicit `initialFocus` target when given (modals whose first
 * focusable is a form field rather than the ✕ declare their intent), else the
 * first focusable — unless focus is already inside it (e.g. an autofocused
 * input in a type-to-confirm dialog, which must keep the focus).
 */
export function pushFocusTrap(
  getContainer: () => TrapContainer | null,
  initialFocus?: InitialFocus,
): number {
  const id = nextId++;
  const container = getContainer();
  let current: TrappedElement | null = null;
  if (typeof document !== 'undefined') {
    current = document.activeElement as TrappedElement | null;
  }
  const restoreTo =
    current && container && container.contains(current) ? null : current;
  stack.push({ id, getContainer, restoreTo });
  ensureListener();
  if (container && (!current || !container.contains(current))) {
    const target = resolveInitialFocus(container, initialFocus);
    if (target) {
      try {
        target.focus();
      } catch {
        /* inert or removed mid-flight — fall back below */
        focusFirst(container);
      }
    } else {
      focusFirst(container);
    }
  }
  return id;
}

function restoreOrRefocus(popped: TrapEntry): void {
  const restoreTo = popped.restoreTo;
  const poppedContainer = popped.getContainer();

  const next = stack[stack.length - 1];
  if (next) {
    // A lower overlay is still open: return focus to the exact trigger when it
    // still lives inside that overlay, otherwise pull focus into that overlay.
    const container = next.getContainer();
    if (container) {
      const canRestore =
        restoreTo !== null &&
        restoreTo.isConnected &&
        container.contains(restoreTo) &&
        !poppedContainer?.contains(restoreTo);
      if (canRestore) {
        try {
          restoreTo.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      } else {
        focusFirst(container);
      }
    }
    return;
  }

  // Stack drained: back to the trigger that opened this overlay — unless it
  // lived inside the overlay itself (nothing meaningful to restore).
  if (
    restoreTo !== null &&
    restoreTo.isConnected &&
    !poppedContainer?.contains(restoreTo)
  ) {
    try {
      restoreTo.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
}

/** Close a trap: unregister it, then restore/refocus as appropriate. */
export function popFocusTrap(id: number): void {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  const [popped] = stack.splice(index, 1);
  restoreOrRefocus(popped);
  if (stack.length === 0) releaseListener();
}

/** Container of the currently topmost open overlay, or null. */
export function topmostContainer(): TrapContainer | null {
  const top = stack[stack.length - 1];
  return top ? top.getContainer() : null;
}

/** Confine a Tab keydown to the topmost open overlay (listener entry point). */
export function handleTabPress(event: { shiftKey: boolean; preventDefault(): void }): void {
  if (typeof document === 'undefined') return;
  const container = topmostContainer();
  if (!container) return;
  confineTab({
    container,
    activeElement: document.activeElement as TrappedElement | null,
    shiftKey: event.shiftKey,
    preventDefault: () => event.preventDefault(),
  });
}

/**
 * Register `getContainer` as an active trap while `active` is true; the
 * registration is popped on unmount (or when the overlay closes). Mirrors
 * `useEscapeToClose` — the container resolver stays in a ref so the effect
 * only re-runs when the overlay opens/closes. `initialFocus` (selector or
 * resolver) declares the element that receives focus on open; the resolver
 * also stays in a ref so the effect never re-runs for a new function identity.
 */
export function useFocusTrap(
  active: boolean,
  getContainer: () => TrapContainer | null,
  initialFocus?: InitialFocus,
): void {
  const getRef = useRef(getContainer);
  getRef.current = getContainer;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  useEffect(() => {
    if (!active) return;
    const id = pushFocusTrap(() => getRef.current(), initialFocusRef.current);
    return () => popFocusTrap(id);
  }, [active]);
}

/**
 * Variant for components hosting several overlays in JSX (AppModals): one
 * registration per open overlay, indexed in JSX order (last open = topmost).
 * Re-registers only when the open/closed pattern changes, never per render.
 */
export function useOverlayTraps(
  actives: readonly boolean[],
  getContainer: (index: number) => TrapContainer | null,
): void {
  const activesRef = useRef(actives);
  activesRef.current = actives;
  const getRef = useRef(getContainer);
  getRef.current = getContainer;

  const signature = actives.map((open) => (open ? '1' : '0')).join('');
  const signatureRef = useRef('');
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    const ids: number[] = [];
    activesRef.current.forEach((open, index) => {
      if (open) ids.push(pushFocusTrap(() => getRef.current(index)));
    });
    return () => {
      for (const id of ids) popFocusTrap(id);
    };
  }, [signature]);
}