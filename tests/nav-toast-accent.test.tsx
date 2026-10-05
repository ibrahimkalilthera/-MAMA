/**
 * L'accent de marque quitte Sidebar, MobileNav et ToastNotification.
 *
 * Ces trois surfaces portaient un bleu codé en dur — le badge « Ouvert » et le
 * badge d'archive du rail, la pastille + le soulignement de la navigation basse,
 * et le badge d'environnement DEV. Sur un thème dont l'accent n'est pas ce bleu
 * (ambre de Cyber Minuit, vert d'Émeraude), le remap `!important` ne pouvait pas
 * les rattraper. Ils portent maintenant les jetons d'accent (`accent-surface` /
 * `accent-surface-text`, c'est-à-dire `currentTheme.accentBg` / `accentText`).
 *
 * Le contrôle mesure le HTML RENDU : c'est la classe réellement émise qui décide
 * si l'affordance suit le thème. Le vert SÉMANTIQUE du toast de succès
 * (`bg-emerald-900/90`) reste, protégé par scripts/check-green-surface.mjs ; seule
 * sa bordure saturée est devenue un liséré neutre.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Sidebar } from '../src/components/Sidebar';
import { MobileNav } from '../src/components/MobileNav';
import { ToastContainer, OfflineBanner, EnvBadge } from '../src/components/ToastNotification';
import type { CurrentTheme } from '../src/app/mainViewsProps';
import type { PayrollWindowStatus } from '../src/app/mainViewsProps';
import type { Toast } from '../src/lib/useToast';
import { translations } from '../src/i18n/translations';
import { installDomGlobals } from './harness';

installDomGlobals();

const t = translations.fr;

const windowStatus = (): PayrollWindowStatus => ({
  currentDay: 5, currentCalendarYear: 2026, currentCalendarMonth: 8,
  totalPaidCurrentMonth: 0, isOverdue: false, isOpen: true,
});

/** Les jetons réels du thème (ceux de useTheme), pour lire une classe émise. */
const theme: CurrentTheme = {
  bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500',
  border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800',
  accent: 'text-blue-600', accentBg: 'accent-surface', accentText: 'accent-surface-text',
  accentHover: 'accent-surface-hover', accentGroupHover: 'accent-group-hover', accentShadow: 'accent-shadow',
  accentSoft: 'accent-soft-surface', accentSoftText: 'accent-soft-text', accentSoftHover: 'accent-soft-hover',
  accentSoftTextHover: 'accent-soft-text-hover',
  accentHex: '#2563EB', accentHexDeep: '#1D4ED8', accentRing: 'accent-ring', inkStrong: 'text-slate-800',
  accentBorder: 'accent-border', accentBorderHover: 'accent-border-hover', surfaceInset: 'bg-slate-50',
  accentSoftDark: 'accent-soft-surface', accentSoftDarkHover: 'accent-soft-hover',
  accentSoftDarkText: 'accent-on-dark-text',
  tableHeader: 'bg-slate-50', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false,
};

const BLUE = ['bg-blue-600', 'bg-blue-500', 'bg-blue-700', 'bg-sky-400', 'bg-sky-500'];

describe('Sidebar / MobileNav / ToastNotification portent leur accent sur le thème', () => {
  it('Sidebar : les badges « Ouvert » et archive suivent les jetons, plus de bleu', () => {
    const html = renderToString(createElement(Sidebar, {
      t, schoolLogo: null, currentTheme: theme, activeTab: 'dashboard', setActiveTab: () => {},
      payrollWindowStatus: { ...windowStatus(), isOpen: true }, currentUser: { username: 'ing', role: 'dev' },
      fetchAuditLogs: () => {}, showTodoSidebar: false, setShowTodoSidebar: () => {},
      onSignOut: () => {}, onToggleLanguage: () => {}, onAddStudent: () => {}, onAddCr: () => {},
      onRecordPayment: () => {}, auditArchivePending: true,
    }));
    for (const bad of BLUE) assert.ok(!html.includes(bad), `bleu codé en dur encore rendu : ${bad}`);
    assert.ok(html.includes('accent-surface-text'), 'les badges portent l’encre d’accent');
  });

  it('MobileNav : la pastille d’archive et le soulignement suivent l’accent, plus de bleu', () => {
    const html = renderToString(createElement(MobileNav, {
      t, activeTab: 'dashboard', setActiveTab: () => {}, payrollWindowStatus: windowStatus(),
      onToggleLanguage: () => {}, currentUser: { role: 'dev' }, auditArchivePending: true,
    }));
    for (const bad of BLUE) assert.ok(!html.includes(bad), `bleu codé en dur encore rendu : ${bad}`);
    assert.ok(html.includes('accent-surface'), 'la pastille et le soulignement portent l’accent');
  });

  it('ToastNotification : le vert sémantique reste, la bordure saturée devient neutre', () => {
    const toasts: Toast[] = [{ id: 't1', type: 'success', message: 'Enregistré' }];
    const html = renderToString(createElement(ToastContainer, { toasts, onDismiss: () => {} }));
    assert.ok(html.includes('bg-emerald-900/90'), 'le fond vert sémantique du succès est conservé');
    assert.ok(!html.includes('border-emerald-500'), 'plus de bordure verte saturée');
    assert.ok(html.includes('border-white/10'), 'la bordure est devenue un liséré neutre');
  });

  it('ToastNotification : bandeau « en ligne » et badge DEV suivent l’accent', () => {
    const online = renderToString(createElement(OfflineBanner, { lang: 'fr', pendingCount: 2, t: { offlinePendingSync: 'sync {count}' } }));
    for (const bad of BLUE) assert.ok(!online.includes(bad), `bleu codé en dur encore rendu : ${bad}`);
    assert.ok(online.includes('accent-surface'), 'le bandeau « en ligne » porte l’accent');

    const dev = renderToString(createElement(EnvBadge, { env: 'development' }));
    for (const bad of BLUE) assert.ok(!dev.includes(bad), `bleu codé en dur encore rendu : ${bad}`);
    assert.ok(dev.includes('accent-surface'), 'le badge DEV porte l’accent');
  });
});
