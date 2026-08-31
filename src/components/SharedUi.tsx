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

export const ChartsFallback = ({ isDark }: { isDark: boolean }) => (
  <>
    {[0, 1].map(i => (
      <div key={i} className={`card-elevated p-6 h-80 ${isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''} animate-pulse`}>
        <div className="h-4 w-44 bg-slate-300 dark:bg-slate-700 rounded-lg mb-6" />
        <div className="h-[calc(100%-2.5rem)] w-full bg-slate-200 dark:bg-slate-800 rounded-2xl" />
      </div>
    ))}
  </>
);
