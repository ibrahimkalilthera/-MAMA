/**
 * Notifications panel — extracted verbatim from App.tsx.
 *
 * Renders the due/note reminder cards (slide-in animation) above the header;
 * clicking a card opens the student's profile through `onOpenStudent`, keeping
 * this component presentational.
 */
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { DashboardNotification } from '../app/useDashboard';

export interface NotificationsPanelProps {
  notifications: DashboardNotification[];
  onOpenStudent: (studentId: string) => void;
}

export function NotificationsPanel({ notifications, onOpenStudent }: NotificationsPanelProps) {
  return (
    <AnimatePresence>
      {notifications.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="mb-8 flex gap-4 overflow-x-auto pb-2 custom-scrollbar"
        >
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => onOpenStudent(n.studentId)}
              className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] ${n.type === 'due' ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-rose-50 border-rose-100 text-rose-700 animate-subtle-pulse'}`}
            >
              <Bell size={18} className={n.type === 'due' ? 'text-amber-500' : 'text-rose-500'} />
              <span className="text-xs font-bold whitespace-nowrap">{n.message}</span>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
