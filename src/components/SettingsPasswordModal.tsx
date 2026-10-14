/**
 * « Définir mot de passe » modal — extracted verbatim from SettingsView so the
 * view stays under the line budget. Reads its data and actions through the
 * MainViewsContext.
 */
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useMainViews } from '../app/mainViewsContext';

export function SettingsPasswordModal() {
  const { t, currentTheme, passwordTarget, setPasswordTarget, passwordInput, setPasswordInput, handleSetPassword } = useMainViews();

  return (
    <>
        <AnimatePresence>
          {passwordTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              data-slot="settings-password-modal"
              className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
              onClick={() => setPasswordTarget(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                onClick={(e) => e.stopPropagation()}
                className={`relative ${currentTheme.card} w-full max-w-md rounded-3xl shadow-2xl border ${currentTheme.border} overflow-hidden`}
              >
                <div className="p-6 border-b border-slate-100 flex justify-between items-center" style={{ backgroundColor: currentTheme.header }}>
                  <h2 className="text-lg font-bold text-white">{t.setPasswordTitle.replace('{name}', passwordTarget.fullName)}</h2>
                  <button onClick={() => setPasswordTarget(null)} className={`p-2 ${currentTheme.hoverSurfaceDark} rounded-xl transition-all text-white`}>
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <label className={`block text-xs font-bold ${currentTheme.muted}`}>{t.newPasswordLabel}</label>
                  <input
                    type="password"
                    name="new-password"
                    autoComplete="new-password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="••••••••"
                    autoFocus
                    className={`w-full px-4 py-3 rounded-xl border ${currentTheme.border} text-sm font-semibold ${currentTheme.isDark ? 'bg-white/5 text-white' : 'bg-white text-slate-800'} focus:outline-none ${currentTheme.accentRing}`}
                  />
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setPasswordTarget(null)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 ${currentTheme.hoverSurface} transition-all`}
                    >
                      {t.cancel}
                    </button>
                    <button
                      disabled={passwordInput.trim().length < 6}
                      onClick={() => { void handleSetPassword(); }}
                      className={`px-4 py-2 ${currentTheme.accentBg} ${currentTheme.accentHover} disabled:opacity-40 disabled:cursor-not-allowed ${currentTheme.accentText} rounded-xl text-xs font-bold transition-all active:scale-95`}
                    >
                      {t.save}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
    </>
  );
}
