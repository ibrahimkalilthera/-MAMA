/**
 * Persistent welcome banner — extracted verbatim from App.tsx. Greets the
 * user by name with a role-based subtitle and role badge (with the
 * mamadou/fanta special cases).
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
    <div className="welcome-banner mb-8 p-5 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print shadow-md" style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3.5 z-10">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 flex-shrink-0">
          <ShieldCheck size={20} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-base tracking-tight" style={{ color: '#FFFFFF' }}>
            {t.welcomeBack}, <span style={{ color: '#34D399' }}>{currentUser?.name || currentUser?.username}</span> !
          </h3>
          <p className="text-[11px] font-medium" style={{ color: '#94A3B8' }}>
            {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
              ? (t.generalManagerFullAdministrationFinancialAccess)
              : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
              ? (t.schoolPromoterDirectorExecutiveOversight)
              : currentUser?.role === 'dev'
              ? (t.systemDeveloperFullTechnicalAdminAccess)
              : currentUser?.role === 'admin' 
              ? (t.administratorFullSystemAccess)
              : (t.accountantAccessFinanceReceipts)}
          </p>
        </div>
      </div>
      <div className="z-10 flex items-center gap-2">
        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] ${
          currentUser?.role === 'dev' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' :
          currentUser?.role === 'admin' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
        }`}>
          {(currentUser?.name || currentUser?.username || '').toLowerCase().includes('mamadou')
            ? (t.generalManager)
            : (currentUser?.name || currentUser?.username || '').toLowerCase().includes('fanta')
            ? (t.promoter)
            : currentUser?.role === 'dev'
            ? (t.developer)
            : currentUser?.role === 'admin'
            ? (t.admin)
            : (t.accountant)}
        </span>
      </div>
    </div>
  );
}
