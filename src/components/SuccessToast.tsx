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
  return (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[60] bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
          >
            <CheckCircle2 size={20} />
            {t.successMessage}
          </motion.div>
  );
}
