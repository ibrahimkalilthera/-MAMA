import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  currentTheme: { card: string; border: string; muted: string; isDark: boolean };
  /**
   * Mode danger pour les actions irréversibles :
   *  - 'type' : l'utilisateur doit taper `danger.text` pour activer le bouton
   *  - 'doubleClick' : le premier clic arme le bouton, le second confirme
   */
  danger?: {
    mode: 'type' | 'doubleClick';
    text?: string;       // texte à taper en mode 'type' (défaut : 'SUPPRIMER')
    hint?: string;       // message d'aide affiché sous le champ (traduit par l'appelant)
    armedLabel?: string; // libellé du bouton une fois armé en mode 'doubleClick'
  };
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  currentTheme,
  danger,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [armed, setArmed] = useState(false);

  // Réinitialiser l'état du mode danger à chaque fermeture
  useEffect(() => {
    if (!open) {
      setTyped('');
      setArmed(false);
    }
  }, [open]);

  const isTypeMode = danger?.mode === 'type';
  const isDoubleClickMode = danger?.mode === 'doubleClick';
  const requiredText = danger?.text || 'SUPPRIMER';
  const canConfirm = isTypeMode ? typed === requiredText : true;
  const isArmed = isDoubleClickMode && armed;
  const armedLabel = danger?.armedLabel || `${confirmLabel} ?`;

  const handleConfirmClick = () => {
    if (isDoubleClickMode && !armed) {
      setArmed(true);
      return;
    }
    onConfirm();
  };

  const handleCancel = () => {
    setTyped('');
    setArmed(false);
    onCancel();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`relative w-full max-w-sm ${currentTheme.card} p-6 rounded-3xl border ${currentTheme.border} shadow-2xl space-y-5`}
          >
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 flex-shrink-0 rounded-2xl bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <h3 className={`text-sm font-black ${currentTheme.isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h3>
                <p className={`text-xs font-semibold leading-relaxed ${currentTheme.muted}`}>{message}</p>
              </div>
              <button
                onClick={handleCancel}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg transition-all flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {isTypeMode && (
              <div className="space-y-1.5">
                <input
                  type="text"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) onConfirm(); }}
                  placeholder={requiredText}
                  className={`w-full px-4 py-3 text-xs font-black rounded-xl border ${currentTheme.border} ${currentTheme.isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'} focus:outline-none focus:ring-2 focus:ring-rose-500/30 transition-all ${typed === requiredText ? 'border-emerald-500' : ''}`}
                />
                {danger?.hint && (
                  <p className={`text-[10px] font-semibold ${currentTheme.muted}`}>{danger.hint}</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancel}
                className={`px-4 py-2.5 rounded-xl border ${currentTheme.border} text-xs font-bold ${currentTheme.muted} hover:bg-slate-100 dark:hover:bg-white/10 transition-all`}
              >
                {cancelLabel}
              </button>
              <button
                onClick={handleConfirmClick}
                disabled={!canConfirm}
                className={`px-4 py-2.5 rounded-xl text-xs font-black text-white transition-all shadow-lg flex items-center gap-1.5 ${
                  isArmed
                    ? 'bg-rose-700 hover:bg-rose-800 shadow-rose-700/30'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                } ${!canConfirm ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {isArmed ? armedLabel : confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
