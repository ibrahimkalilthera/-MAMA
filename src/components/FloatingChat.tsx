/**
 * Floating AI chat panel — App.tsx (floating widget section).
 *
 * Desktop: floating widget bottom-right (backdrop hidden, click-outside via X).
 * Mobile:  full-width sheet clamped to the viewport with a dim backdrop that
 *          closes on outside tap — same pattern as the Productivité panel.
 */
import { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useFocusTrap } from '../lib/focusStack';
import type { TranslationDict } from '../i18n/translations';

interface FloatingChatProps {
  t: TranslationDict;
  isFloatingChatOpen: boolean;
  setIsFloatingChatOpen: (open: boolean) => void;
  floatingChatMessages: { sender: 'user' | 'assistant'; text: string }[];
  floatingChatInput: string;
  setFloatingChatInput: (v: string) => void;
  handleFloatingAiQuery: (q: string) => void;
}

export function FloatingChatPanel(props: FloatingChatProps) {
  const {
    t, isFloatingChatOpen, setIsFloatingChatOpen,
    floatingChatMessages, floatingChatInput, setFloatingChatInput, handleFloatingAiQuery,
  } = props;

  // Tab is confined to the panel while open; focus returns to the FAB on close.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(isFloatingChatOpen, () => rootRef.current);

  const quickQuestions: string[] = [
    t.aiQuickQuestion1 ?? 'How much tuition was collected this month?',
    t.aiQuickQuestion2 ?? 'Which parents still owe school fees?',
    t.aiQuickQuestion3 ?? 'Show all expenses for June.',
    t.aiQuickQuestion4 ?? 'Generate this month\u2019s financial report.',
  ];

  return (
    <AnimatePresence>
      {isFloatingChatOpen && (
        <>
          {/* Mobile-only dim backdrop — tap to close */}
          <motion.div
            className="fixed inset-0 z-[60] bg-slate-900/50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsFloatingChatOpen(false)}
          />
          <motion.div
            ref={rootRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.floatingChatTitle ?? 'Mama Thera Assistant'}
            className="fixed bottom-24 right-6 z-[61] flex w-[360px] max-w-[calc(100vw_-_3rem)] max-h-[calc(100dvh_-_3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">AI</span>
                <span className="text-sm font-semibold text-slate-800">{t.floatingChatTitle ?? 'Mama Thera Assistant'}</span>
              </div>
              <button
                onClick={() => setIsFloatingChatOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                aria-label="Close chat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {floatingChatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.sender === 'user'
                        ? 'rounded-br-sm bg-slate-900 text-white'
                        : 'rounded-bl-sm bg-slate-100 text-slate-800'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick questions */}
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-2">
              {quickQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleFloatingAiQuery(q)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
              <input
                value={floatingChatInput}
                onChange={(e) => setFloatingChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && floatingChatInput.trim()) {
                    handleFloatingAiQuery(floatingChatInput);
                  }
                }}
                placeholder={t.floatingChatPlaceholder ?? 'Ask about school finance…'}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
              <button
                onClick={() => handleFloatingAiQuery(floatingChatInput)}
                disabled={!floatingChatInput.trim()}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {t.send ?? 'Send'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Floating action button (FAB) that opens the chat panel.
 * Extracted from the same App.tsx ternary so the panel + FAB share one
 * AnimatePresence — the FAB hides while the panel is open.
 */
export function FloatingChatFab(props: {
  isFloatingChatOpen: boolean;
  setIsFloatingChatOpen: (open: boolean) => void;
  label?: string;
}) {
  const { isFloatingChatOpen, setIsFloatingChatOpen, label = 'AI' } = props;
  return (
    <AnimatePresence>
      {!isFloatingChatOpen && (
        <motion.button
          className="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white shadow-xl hover:bg-slate-700"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => setIsFloatingChatOpen(true)}
          aria-label="Open AI chat"
        >
          {label}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
