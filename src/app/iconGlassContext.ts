/**
 * Icon glass context (discreet / crisp / animated).
 *
 * The choice is owned once by <App> (`useIconGlassState`) and provided through
 * `IconGlassContext` so both the app-shell root (which carries the `icon-glass-*`
 * class the CSS layer keys on) and the Settings → Préférences control read the
 * SAME value. A consumer without a provider gets the default (`animated`, the
 * dose the couche was delivered with) and a no-op setter, so shell tests that
 * mount <AppShell> alone keep working unchanged.
 *
 * No component lives here on purpose (react-refresh only exports components
 * from .tsx files): the provider is used directly as
 * `<IconGlassContext.Provider value={…}>` in App.tsx — the same shape as the
 * table density right beside it.
 */
import { createContext, useCallback, useContext, useState } from 'react';

import { DEFAULT_ICON_GLASS, getStoredIconGlass, saveIconGlass } from '../lib/iconGlass';
import type { IconGlass } from '../lib/iconGlass';

export interface IconGlassValue {
  iconGlass: IconGlass;
  setIconGlass: (glass: IconGlass) => void;
}

const fallback: IconGlassValue = { iconGlass: DEFAULT_ICON_GLASS, setIconGlass: () => {} };

export const IconGlassContext = createContext<IconGlassValue>(fallback);

/** Read the current dose. Safe outside a provider (defaults to animated). */
export const useIconGlass = (): IconGlassValue => useContext(IconGlassContext);

/** Own the icon glass state and persist every change. Meant to be called once. */
export function useIconGlassState(): IconGlassValue {
  const [iconGlass, setGlass] = useState<IconGlass>(() => getStoredIconGlass());
  const setIconGlass = useCallback((next: IconGlass) => {
    setGlass(next);
    saveIconGlass(next);
  }, []);
  return { iconGlass, setIconGlass };
}
