/**
 * Login screen extracted verbatim from App.tsx.
 */

import { useState, FormEvent } from 'react';
import { motion } from 'motion/react';
import {
  Globe,
  ShieldCheck,
  AlertCircle,
  Users,
  Lock,
  ChevronRight,
} from 'lucide-react';
import type { Language } from '../app/types';
import type { TranslationDict } from '../i18n/translations';

export const Login = ({ 
  onLogin, 
  lang, 
  setLang, 
  t
}: { 
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>, 
  lang: Language, 
  setLang: (l: Language) => void, 
  t: TranslationDict
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await onLogin(email.trim(), password);
    
    if (!result.success) {
      // Translate common Supabase auth errors
      let errorMsg = result.error || '';
      if (errorMsg.includes('Invalid login credentials')) {
        errorMsg = t.invalidEmailOrPassword;
      } else if (errorMsg.includes('Email not confirmed')) {
        errorMsg = t.pleaseConfirmYourEmailFirst;
      } else if (errorMsg.includes('Too many requests')) {
        errorMsg = t.tooManyAttemptsPleaseWaitAMoment;
      }
      setError(errorMsg);
    }
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4 z-[100]">
      <div className="absolute top-8 right-8">
        <button 
          onClick={() => setLang(lang === 'en' ? 'fr' : 'en')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all text-sm font-bold border border-white/10"
        >
          <Globe size={18} />
          {t.langToggle}
        </button>
      </div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
      >
        <div className="bg-slate-800 p-10 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10">
             <div className="grid grid-cols-6 gap-2 transform -rotate-12 scale-150">
               {[...Array(24)].map((_, i) => (
                 <div key={i} className="w-full aspect-square bg-white rounded-lg"></div>
               ))}
              </div>
          </div>
          <div className="relative z-10">
            <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/20">
              <ShieldCheck size={40} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mb-2">{t.loginTitle}</h1>
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-[0.2em]">{t.loginSubtitle}</p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="p-10 space-y-6">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600"
            >
              <AlertCircle size={18} />
              <span className="text-xs font-bold">{error}</span>
            </motion.div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{'Email'}</label>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold text-slate-800 animate-fade-in"
                placeholder="name@mamathera.org"
                required
                disabled={isLoading}
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{t.password}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all text-sm font-semibold text-slate-800"
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={isLoading}
            className={`w-full bg-slate-800 hover:bg-slate-900 text-white py-5 rounded-2xl font-black text-sm transition-all shadow-xl shadow-slate-800/20 active:scale-[0.98] flex items-center justify-center gap-2 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                {t.signingIn}
              </>
            ) : (
              <>
                {t.signIn}
                <ChevronRight size={18} />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};
