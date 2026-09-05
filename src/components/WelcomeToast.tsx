/**
 * WelcomeToast — Top-center welcome toast carrying the role subtitle (dev/admin/general_manager/econome portal). Pure presentational — auto-dismiss lives in App.tsx.
 */
import { motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';

export interface WelcomeToastProps {
  t: TranslationDict;
  welcomeMessage: string;
  currentUser: { name?: string; role?: string; username?: string } | null;
}

export function WelcomeToast(props: WelcomeToastProps) {
  const { t, welcomeMessage, currentUser } = props;
  return (
          <motion.div 
            initial={{ opacity: 0, y: -100, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.9 }}
            className="fixed top-10 left-1/2 -translate-x-1/2 z-[110] bg-slate-900 text-white dark:bg-emerald-600 px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-4 font-black text-sm border-2 border-emerald-500/20"
          >
            <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center text-white">
              <ShieldCheck size={18} />
            </div>
            <div className="text-left">
              <p className="leading-tight">{welcomeMessage}</p>
              <p className="text-[10px] text-white/90 font-medium">
                {currentUser?.role === 'dev'
                  ? (t.systemDeveloperPortal)
                  : currentUser?.role === 'admin' 
                  ? (t.promoterOwnerPortal) 
                  : currentUser?.role === 'general_manager'
                  ? (t.generalManagerPortal)
                  : (t.accountantAccess)}
              </p>
            </div>
          </motion.div>
  );
}
