/**
 * Floating AI chat widget — extracted verbatim from App.tsx (panel + FAB).
 *
 * One AnimatePresence holds the mobile-only backdrop, the chat panel and the
 * FAB: the FAB hides while the panel is open. The panel carries the ARIA
 * dialog semantics and the focus trap (same treatment as every other
 * overlay); Escape-to-close is wired by the useFloatingChat domain hook in
 * App.tsx. Desktop keeps the floating-widget behaviour; mobile gets the
 * full-width sheet with dimmed backdrop and outside-tap close (viewport
 * clamps from the overlay audit).
 */
import { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bot, X } from 'lucide-react';
import { useFocusTrap } from '../lib/focusStack';
import type { TranslationDict } from '../i18n/translations';
import type { ChatMessage } from '../app/useFloatingChat';

/** Props of the floating chat widget — App.tsx forwards the hook API. */
export interface FloatingChatProps {
  t: TranslationDict;
  /** Panel visibility; the FAB renders while this is false. */
  isFloatingChatOpen: boolean;
  setIsFloatingChatOpen: (open: boolean) => void;
  /** Chat history of the floating surface (seeded greeting first). */
  floatingChatMessages: ChatMessage[];
  floatingChatInput: string;
  setFloatingChatInput: (value: string) => void;
  /** Send a query from the floating surface (input or quick prompt). */
  handleFloatingAiQuery: (query: string) => void;
  /** Theme tokens from the app theme engine. */
  themeCard: string;
  themeBorder: string;
  themeHeader: string;
  themeIsDark: boolean;
}

export function FloatingChat(props: FloatingChatProps) {
  const {
    t,
    isFloatingChatOpen,
    setIsFloatingChatOpen,
    floatingChatMessages,
    floatingChatInput,
    setFloatingChatInput,
    handleFloatingAiQuery,
    themeCard,
    themeBorder,
    themeHeader,
    themeIsDark,
  } = props;

  // Tab is confined to the panel while open; focus returns to the FAB on close.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(isFloatingChatOpen, () => rootRef.current);

  return (
    <div className="fixed bottom-6 right-6 z-50 no-print font-sans">
      <AnimatePresence>
        {/* Below the lg breakpoint the w-[360px] chat card covers ~86% of a
            360px-wide viewport with no visual cue — the same silent-takeover
            pattern the Productivité panel had. Dim the app behind it and
            close on outside click on mobile, identical to every other
            overlay; desktop keeps the floating-widget behaviour. The caps
            also keep the card inside short/landscape viewports. */}
        {isFloatingChatOpen && (
          <motion.div
            key="chat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsFloatingChatOpen(false)}
            className="fixed inset-0 z-10 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          />
        )}
        {isFloatingChatOpen ? (
          <motion.div
            key="chat-panel"
            ref={rootRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.floatingChatTitle ?? 'Mama Thera Assistant'}
            aria-labelledby="modal-title-floating-chat"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`relative z-20 w-[360px] sm:w-96 h-[500px] max-w-[calc(100vw_-_3rem)] max-h-[calc(100dvh_-_3rem)] rounded-[2.5rem] shadow-2xl border ${themeBorder} ${themeCard} flex flex-col overflow-hidden`}
          >
            {/* Header */}
            <div
              className="px-6 py-4 text-white flex justify-between items-center"
              style={{ backgroundColor: themeHeader }}
            >
              <div className="flex items-center gap-2">
                <Bot size={20} className="flex-shrink-0" />
                <div>
                  <h4 id="modal-title-floating-chat" className="font-bold text-sm">
                    {t.floatingChatTitle ?? 'Mama Thera Assistant'}
                  </h4>
                  <p className="text-[10px] text-white/75 font-semibold">
                    {t.liveFinancialIntelligence}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsFloatingChatOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-xl transition-all"
                aria-label="Close chat"
              >
                <X size={16} />
              </button>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50/50">
              {floatingChatMessages.map((msg: ChatMessage, idx: number) => (
                <div
                  key={idx}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2.5 text-xs font-semibold leading-relaxed shadow-sm ${
                      msg.sender === 'user'
                        ? `${themeIsDark ? 'bg-emerald-700 text-white' : 'bg-blue-600 text-white'} rounded-t-2xl rounded-bl-2xl`
                        : `${themeIsDark ? 'bg-[#334155] border-[#475569] text-white' : 'bg-white border-slate-100 text-slate-800'} border rounded-t-2xl rounded-br-2xl`
                    }`}
                    style={{ whiteSpace: 'pre-line' }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Prompt Suggesters */}
            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex gap-2 overflow-x-auto whitespace-nowrap bg-white dark:bg-[#1E293B] custom-scrollbar">
              {(
                [
                  t.aiPrompt1,
                  t.aiPrompt2,
                  t.aiPrompt3,
                  t.aiPrompt4,
                  t.aiPrompt5,
                  t.aiPrompt6,
                ] as (string | undefined)[]
              ).map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => q && handleFloatingAiQuery(q)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 font-bold rounded-full text-[10px] transition-all shrink-0 border border-slate-200/50 dark:border-slate-600"
                >
                  {(q ?? '').length > 35 ? (q ?? '').substring(0, 32) + '...' : q}
                </button>
              ))}
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleFloatingAiQuery(floatingChatInput);
              }}
              className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1E293B] flex gap-2 items-center"
            >
              <input
                type="text"
                value={floatingChatInput}
                onChange={(e) => setFloatingChatInput(e.target.value)}
                placeholder={t.askAFinancialQuestion}
                className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!floatingChatInput.trim()}
                className={`px-4 py-2 rounded-xl text-white font-extrabold text-xs transition-all ${
                  floatingChatInput.trim()
                    ? `${themeIsDark ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-600 hover:bg-blue-700'} shadow-lg`
                    : 'bg-slate-500 cursor-not-allowed'
                }`}
              >
                {t.send}
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            onClick={() => setIsFloatingChatOpen(true)}
            aria-label={t.mamaTheraAiAssistant}
            className={`px-6 py-4 rounded-full text-white font-extrabold text-sm transition-all flex items-center gap-2 shadow-2xl active:scale-[0.98] ${
              themeIsDark
                ? 'bg-emerald-700 hover:bg-emerald-800 shadow-emerald-500/30'
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'
            }`}
          >
            <Bot size={18} className="flex-shrink-0" />
            <span>{t.mamaTheraAiAssistant}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}