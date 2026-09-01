/**
 * Full-screen loading spinner — extracted verbatim from App.tsx (used for
 * both the auth-restore and the Supabase-loading screens, which differ only
 * in their title/subtitle).
 */
import { ShieldCheck } from 'lucide-react';

export interface AppLoadingScreenProps {
  title: string;
  subtitle: string;
}

export function AppLoadingScreen({ title, subtitle }: AppLoadingScreenProps) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0C1222 0%, #111827 50%, #0F172A 100%)' }}>
      <div className="text-center">
        <div className="relative w-14 h-14 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full border-2 border-white/[0.06]"></div>
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
          <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck size={18} className="text-emerald-400" />
          </div>
        </div>
        <h2 className="text-xl font-semibold text-white tracking-tight mb-2">{title}</h2>
        <p className="text-slate-500 text-sm font-medium">{subtitle}</p>
      </div>
    </div>
  );
}
