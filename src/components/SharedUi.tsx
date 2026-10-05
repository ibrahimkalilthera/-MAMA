/**
 * Shared pure UI helpers extracted verbatim from App.tsx and MainViews.tsx.
 *
 * HighlightText: search-term highlighting with <mark> matches.
 * ChartsFallback: skeleton placeholder shown while lazy chart views load.
 */

export const HighlightText = ({ text, highlight }: { text: string, highlight: string }) => {
  if (!highlight.trim()) {
    return <span>{text}</span>;
  }
  const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 font-bold rounded-sm px-0.5 text-slate-900">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
};

/**
 * Empty list state: icon + sentence + (optional) action.
 *
 * A bare "Aucune dépense trouvée" in an otherwise blank table reads as a
 * broken screen; naming the state and offering the next step does not.
 */
export const EmptyState = ({
  icon,
  title,
  hint,
  action,
  isDark = false,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  isDark?: boolean;
}) => (
  <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
    <div
      className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
        isDark ? 'bg-white/[0.06] text-slate-300' : 'bg-slate-100 text-slate-600'
      }`}
      aria-hidden="true"
    >
      {icon}
    </div>
    <p className={`text-sm font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>{title}</p>
    {hint && (
      <p className={`max-w-md text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{hint}</p>
    )}
    {action}
  </div>
);

/**
 * Skeleton primitive — the one way to say "content is coming".
 *
 * `.skeleton` (src/index.css) already carried the shimmer keyframe and a
 * theme-aware gradient, but nothing used it: every loading state in the app
 * hand-rolled its own `bg-slate-300 dark:bg-slate-700 animate-pulse` bars, so
 * two placeholders on the same screen could shimmer at different speeds and
 * disagree about their corner radius. This is that class, given a name.
 */
export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

/**
 * View-level loading placeholder: a titled card with a body block.
 *
 * Replaces the two Suspense fallbacks that were copy-pasted inline in AppShell
 * (main views and archives) — same pixels, one definition, so the next lazy
 * view inherits the loading language instead of inventing a third one.
 */
export const ViewSkeleton = ({
  card,
  border,
  titleClassName = 'h-6 w-64',
  bodyClassName = 'h-[400px]',
}: {
  card: string;
  border: string;
  titleClassName?: string;
  bodyClassName?: string;
}) => (
  <div className={`${card} p-8 rounded-3xl border ${border} shadow-xl shadow-slate-200/50`} aria-busy="true">
    <Skeleton className={`${titleClassName} rounded-lg mb-8`} />
    <Skeleton className={`${bodyClassName} w-full rounded-2xl`} />
  </div>
);

export const ChartsFallback = ({ isDark }: { isDark: boolean }) => (
  <>
    {[0, 1].map(i => (
      <div key={i} className={`card-elevated p-6 h-80 ${isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}>
        <Skeleton className="h-4 w-44 rounded-lg mb-6" />
        <Skeleton className="h-[calc(100%-2.5rem)] w-full rounded-2xl" />
      </div>
    ))}
  </>
);
