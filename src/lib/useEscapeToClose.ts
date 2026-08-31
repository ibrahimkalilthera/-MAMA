/**
 * Escape-to-close for every overlay of the app (modals, dialogs, panels).
 *
 * A module-level stack registers each OPEN overlay; one shared `keydown`
 * listener — attached only while the stack is non-empty — closes exactly the
 * TOPMOST entry per press. So a confirm dialog stacked over a form closes
 * first, then the form. Registration order follows mount order, which matches
 * the visual stacking of the overlays.
 *
 * SSR-safe: without `window` the listener is simply never attached; the stack
 * itself still works and tests drive it through `handleEscapePress`.
 */
import { useEffect, useRef } from 'react';

type CloseFn = () => void;

interface Entry {
  id: number;
  close: CloseFn;
}

const stack: Entry[] = [];
let nextId = 1;
let attached = false;

type KeyTarget = {
  addEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: string, listener: (event: KeyboardEvent) => void): void;
};

const keyTarget: KeyTarget | null = typeof window !== 'undefined' ? window : null;

function onKeyDown(event: KeyboardEvent): void {
  // Ignore auto-repeat: holding Escape must not rip through the whole stack.
  if (event.key !== 'Escape' || event.repeat) return;
  handleEscapePress();
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

/** Close exactly the topmost registered overlay. Returns true when one closed. */
export function handleEscapePress(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function pushEscapeClose(close: CloseFn): number {
  const id = nextId++;
  stack.push({ id, close });
  ensureListener();
  return id;
}

export function popEscapeClose(id: number): void {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index !== -1) stack.splice(index, 1);
  if (stack.length === 0) releaseListener();
}

/**
 * Register `onClose` while `active` is true; the registration is popped on
 * unmount (or when the overlay closes). Each Escape press closes the topmost
 * overlay only.
 */
export function useEscapeToClose(active: boolean, onClose: CloseFn): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const id = pushEscapeClose(() => closeRef.current());
    return () => popEscapeClose(id);
  }, [active]);
}
