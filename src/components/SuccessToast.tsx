/**
 * SuccessToast — Legacy success toast (bottom-center) after a saved mutation. Pure presentational — the auto-dismiss timer lives in App.tsx, not here.
 */
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';

export interface SuccessToastProps {
  t: TranslationDict;
}

export function SuccessToast(props: SuccessToastProps) {
  const { t } = props;
  // `bottom-24` sous `lg` : la barre de navigation mobile occupe le bas de
  // l'écran, et le toast à 40 px se posait dessus — il couvrait les onglets au
  // moment précis où l'on vient d'en changer. Au-dessus de `lg` la barre
  // disparaît, le toast redescend. `role="status"` le fait annoncer.
  return (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-24 lg:bottom-10 left-1/2 -translate-x-1/2 z-[60] accent-surface accent-surface-text px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 size={20} />
            {t.successMessage}
          </motion.div>
  );
}
