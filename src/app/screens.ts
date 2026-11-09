/**
 * ─── Les écrans, en UNE seule table ─────────────────────────────────────────
 *
 * Trois navigations nommaient les mêmes douze écrans, chacune sa liste : le rail
 * (`Sidebar`), la barre du bas (`MobileNav`) et la palette (`CommandPalette`).
 * Les DROITS, eux, avaient déjà été unifiés dans `src/app/tabRights.ts` — mais
 * l'ordre, le libellé et l'icône restaient écrits trois fois, et une entrée
 * ajoutée à deux endroits sur trois se serait tue à la troisième.
 *
 * Cette table est la liste. Chaque navigation garde sa MISE EN PAGE — le rail
 * porte des pastilles et des portes, la barre du bas une grille fixe, la palette
 * une recherche — mais elle n'écrit plus ni libellé ni icône : elle lit ici.
 *
 * Ce que la table ne décide PAS : qui voit quoi. C'est `canOpenTab(tab, rôle)`,
 * et lui seul (voir `src/app/tabRights.ts`).
 */
import {
  Briefcase,
  Calendar,
  CalendarClock,
  HandCoins,
  History,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  Settings,
  ShieldCheck,
  StickyNote,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { AppTab } from '../components/Sidebar';

export interface ScreenEntry {
  tab: AppTab;
  /** La clé du dictionnaire, jamais le libellé : la langue se choisit à l'exécution. */
  label: keyof TranslationDict;
  Icon: LucideIcon;
}

/** L'ordre est celui du rail, et c'est celui que les trois navigations suivent. */
export const SCREENS: readonly ScreenEntry[] = [
  { tab: 'dashboard', label: 'navDashboard', Icon: LayoutDashboard },
  { tab: 'students', label: 'navStudents', Icon: Users },
  { tab: 'parents', label: 'navParents', Icon: MessageSquare },
  { tab: 'payroll', label: 'payroll', Icon: Briefcase },
  { tab: 'expenses', label: 'expenses', Icon: Receipt },
  { tab: 'calendar', label: 'navCalendar', Icon: Calendar },
  { tab: 'notes', label: 'notes', Icon: StickyNote },
  { tab: 'archives', label: 'navArchives', Icon: TrendingUp },
  { tab: 'silentReceipts', label: 'navSilentReceipts', Icon: CalendarClock },
  { tab: 'installments', label: 'navInstallments', Icon: HandCoins },
  { tab: 'audit', label: 'auditTrail', Icon: ShieldCheck },
  { tab: 'paymentHistory', label: 'paymentHistory', Icon: History },
  { tab: 'settings', label: 'navSettings', Icon: Settings },
];

const BY_TAB = new Map<AppTab, ScreenEntry>(SCREENS.map((screen) => [screen.tab, screen]));

/** L'entrée d'un écran — `undefined` n'existe pas : un onglet sans entrée est un oubli de table. */
export const screenOf = (tab: AppTab): ScreenEntry => {
  const entry = BY_TAB.get(tab);
  if (!entry) throw new Error(`Écran absent de la table : ${tab}`);
  return entry;
};
