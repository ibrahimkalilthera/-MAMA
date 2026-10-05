/**
 * Persistent welcome banner — extracted verbatim from App.tsx. Greets the
 * user by name with a role-based subtitle and role badge (with the
 * fanta special case kept for the promoter display name).
 */
import { ShieldCheck } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { User } from '../app/types';

export interface WelcomeBannerProps {
  t: TranslationDict;
  currentUser: User | null;
}

export function WelcomeBanner({ t, currentUser }: WelcomeBannerProps) {
  return (
    <div data-slot="app-welcome-banner" className="welcome-banner mb-8 p-5 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print shadow-md" style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3.5 z-10">
        {/* The banner is a fixed dark gradient in every theme, so it reads the
            accent straight from the CSS variables rather than threading
            `currentTheme` through — the two mark-up the brand, and the variable
            already holds the logo colour or the theme accent. */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-primary)', boxShadow: '0 10px 15px -3px var(--accent-primary-shadow)' }}
        >
          <ShieldCheck size={20} style={{ color: 'var(--accent-ink, #fff)' }} />
        </div>
        <div>
          <h3 className="font-bold text-base tracking-tight" style={{ color: '#FFFFFF' }}>
            {t.welcomeBack},{' '}
            {/* Was a hardcoded #34D399 — the last green standing in Cyber Minuit,
                where the whole accent is amber. `-lifted` because this banner is
                dark in every theme. */}
            <span style={{ color: 'var(--accent-soft-ink-lifted)' }}>{currentUser?.name || currentUser?.username}</span> !
          </h3>
          <p className="text-2xs font-medium" style={{ color: '#94A3B8' }}>        {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
          ? (t.schoolPromoterDirectorExecutiveOversight)
          : currentUser?.role === 'general_manager'
          ? (t.generalManagerFullAdministrationFinancialAccess)
          : currentUser?.role === 'dev'
          ? (t.systemDeveloperFullTechnicalAdminAccess)
          : currentUser?.role === 'admin'
          ? (t.administratorFullSystemAccess)
          : (t.accountantAccessFinanceReceipts)}
          </p>
        </div>
      </div>
      <div className="z-10 flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-2xs font-bold uppercase tracking-[0.08em] ${
          currentUser?.role === 'dev' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' :
          currentUser?.role === 'admin' ? 'accent-soft-surface accent-on-dark-text border accent-border' :
          currentUser?.role === 'general_manager' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'accent-soft-surface accent-on-dark-text border accent-border'
        }`}>
          {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
            ? (t.promoter)
            : currentUser?.role === 'general_manager'
            ? (t.generalManager)
            : currentUser?.role === 'dev'
            ? (t.developer)
            : currentUser?.role === 'admin'
            ? (t.admin)
            : currentUser?.role === 'econome'
            ? (t.roleEconome)
            : (t.roleStaff)}
        </span>
      </div>
    </div>
  );
}
