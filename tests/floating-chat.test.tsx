/**
 * happy-dom render tests for the floating AI chat widget.
 *
 * Unlike the SSR-based views tests, these exercise the widget in a real DOM
 * (happy-dom installed as the global window/document for this file's process):
 * the FAB opens the panel, clicking a quick prompt sends the query through the
 * REAL useFloatingChat domain hook (user bubble added synchronously, input
 * cleared, assistant reply appended after the hook's response delay). The
 * focus trap and Escape wiring are the real ones too — no mocks anywhere
 * except the data the hook needs.
 *
 * Note on animations: motion prefers the Web Animations API, but happy-dom's
 * `Element.animate` ticker never advances, so WAAPI animations never finish
 * and AnimatePresence would wait forever on the exit path (the closing
 * scenario was removed for exactly this reason — the open/prompt/reply flow
 * is what matters here; exit-completion belongs to a real-browser e2e).
 * The environment below therefore stubs `Element.animate`/`getAnimations`
 * with instantly-finished animations (enter animations resolve immediately)
 * and keeps a setTimeout-based rAF loop as the non-WAAPI fallback.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { useFloatingChat } from '../src/app/useFloatingChat';
import type { DashboardStats } from '../src/app/mainViewsProps';
import { FloatingChat } from '../src/components/FloatingChat';
import { installDomGlobals } from './harness';

const t = translations.en as TranslationDict;
const greeting = t.helloIAmYourMamaTheraFinanceAssistantHowCanIAssistYouWithSchoolStatisticsTodayYouCanAskMeFinancialQuestionsOrClickOneOfTheQuickOptionsBelow;
// The quick prompts are truncated in the button label when longer than 35 chars.
const prompt1Label = t.aiPrompt1.length > 35 ? `${t.aiPrompt1.slice(0, 32)}...` : t.aiPrompt1;

const win = installDomGlobals({
  extra: {
    // A setTimeout-driven rAF loop (happy-dom's own rAF never fires its
    // callbacks — verified) for the non-WAAPI animation path.
    requestAnimationFrame: (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (id: number): void => clearTimeout(id),
  },
});
// File-specific event constructors (need the returned window instance, so
// they are wired after the shared install).
Object.defineProperty(globalThis, 'MouseEvent', { value: win.MouseEvent, configurable: true, writable: true });
Object.defineProperty(globalThis, 'KeyboardEvent', { value: win.KeyboardEvent, configurable: true, writable: true });
// Motion resolves `window.requestAnimationFrame` off the window object, not
// the global — patch the window instance too.
win.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number) as unknown as typeof win.requestAnimationFrame;
win.cancelAnimationFrame = ((id: number): void => clearTimeout(id)) as unknown as typeof win.cancelAnimationFrame;
  // WAAPI: happy-dom implements Element.animate but its virtual ticker never
  // advances, so motion (which prefers WAAPI over rAF) would wait forever on
  // any animation. Replace it with an instantly-finished stub — enter/exit
  // animations resolve immediately, which is all the assertions need.
  const finishedAnimation = {
    finished: Promise.resolve(),
    currentTime: 0,
    playState: 'finished',
    effect: null,
    onfinish: null,
    oncancel: null,
    play: () => {},
    pause: () => {},
    cancel: () => {},
    finish: () => {},
    reverse: () => {},
    commitStyles: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
  win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
  (win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

const stats: DashboardStats = {
  totalOutstanding: 0,
  collectedMonth: 0,
  prevMonthCollected: 0,
  lateParentsCount: 0,
  totalFees: 0,
  totalCollected: 0,
  totalExpenses: 0,
  totalArrears: 0,
  expensesThisMonth: 0,
  enrolledStudentsCount: 0,
};

/** Renders the real widget driven by the real domain hook (empty data). */
function Harness(): ReactNode {
  const chat = useFloatingChat({
    lang: 'en',
    t,
    stats,
    students: [],
    staff: [],
    salaryPayments: [],
    expenses: [],
    vendorExpenses: [],
    formatCurrency: (value: number) => `${value} XOF`,
    formatDate: (dateStr: string) => dateStr,
  });
  return (
    <FloatingChat
      t={t}
      isFloatingChatOpen={chat.isFloatingChatOpen}
      setIsFloatingChatOpen={chat.setIsFloatingChatOpen}
      floatingChatMessages={chat.floatingChatMessages}
      floatingChatInput={chat.floatingChatInput}
      setFloatingChatInput={chat.setFloatingChatInput}
      handleFloatingAiQuery={chat.handleFloatingAiQuery}
      currentTheme={{ bg: 'bg-slate-100', card: 'bg-white', text: 'text-slate-900', muted: 'text-slate-500', border: 'border-slate-200', header: '#0F172A', sidebar: 'bg-slate-800', accent: 'text-blue-600', accentBg: 'bg-blue-50', accentHover: 'hover:bg-blue-100', accentShadow: 'shadow-blue-200', tableHeader: 'bg-slate-100', rowHover: 'hover:bg-slate-50', input: 'bg-white', isDark: false }}
    />
  );
}

function mount(): { root: Root; container: Element } {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  return { root, container: container as unknown as Element };
}

const q = (selector: string): Element | null =>
  win.document.querySelector(selector) as unknown as Element | null;

const qa = (selector: string): Element[] =>
  Array.from(win.document.querySelectorAll(selector)) as unknown as Element[];

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** All chat bubbles (user + assistant share the max-w-[85%] bubble class). */
const bubbles = (): Element[] => qa('[class*="max-w-[85%]"]');

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function renderAndMount(): Promise<{ root: Root; container: Element }> {
  const { root, container } = mount();
  await act(async () => {
    root.render(createElement(Harness));
  });
  return { root, container };
}

describe('FloatingChat — happy-dom render', () => {
  it('shows only the FAB initially, then opens the panel with the greeting', async () => {
    const { root, container } = await renderAndMount();
    try {
      assert.ok(q(`[aria-label="${t.mamaTheraAiAssistant}"]`), 'the FAB button is rendered');
      assert.equal(q('[role="dialog"]'), null, 'no panel before opening');

      click(q(`[aria-label="${t.mamaTheraAiAssistant}"]`) as Element);
      await act(async () => {});

      const panel = q('[role="dialog"]');
      assert.ok(panel, 'the panel opens as a dialog');
      assert.equal(panel?.getAttribute('aria-label'), t.floatingChatTitle);
      assert.equal(panel?.getAttribute('aria-labelledby'), 'modal-title-floating-chat');
      const list = bubbles();
      assert.equal(list.length, 1, 'the greeting is the only message');
      assert.equal(list[0]?.textContent, greeting, 'greeting is the seeded assistant message');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('a quick prompt sends the query and adds the user message immediately', async () => {
    const { root, container } = await renderAndMount();
    try {
      click(q(`[aria-label="${t.mamaTheraAiAssistant}"]`) as Element);
      await act(async () => {});
      assert.equal(bubbles().length, 1);

      const prompt = qa('button').find((b) => b.textContent === prompt1Label);
      assert.ok(prompt, `quick prompt button "${prompt1Label}" is rendered`);
      click(prompt as Element);
      await act(async () => {});

      const list = bubbles();
      assert.equal(list.length, 2, 'the user message is appended on click');
      assert.equal(list[1]?.textContent, t.aiPrompt1, 'the sent query is the full quick prompt text');
      const input = q('input[type="text"]') as unknown as HTMLInputElement;
      assert.equal(input.value, '', 'the input is cleared after the quick prompt');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('appends the assistant reply after the response delay', async () => {
    const { root, container } = await renderAndMount();
    try {
      click(q(`[aria-label="${t.mamaTheraAiAssistant}"]`) as Element);
      await act(async () => {});
      click(qa('button').find((b) => b.textContent === prompt1Label) as Element);
      await act(async () => {});
      assert.equal(bubbles().length, 2);

      // The hook answers "tuition collected this month" (aiPrompt1) after 450 ms.
      await delay(600);
      await act(async () => {});

      const list = bubbles();
      assert.equal(list.length, 3, 'the assistant reply is appended after the delay');
      assert.ok(
        list[2]?.textContent?.includes('tuition fees collected this month'),
        `reply mentions the tuition total: ${list[2]?.textContent}`
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});