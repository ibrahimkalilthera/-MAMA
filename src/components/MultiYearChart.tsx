import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from 'recharts';

interface MultiYearChartProps {
  academicYears: string[];
  getYearStats: (year: string) => { revenue: number; expenses: number };
  lang: 'en' | 'fr';
  t: { revenueVsExpenses: string };
  currentTheme: { isDark: boolean; card: string; border: string; muted: string };
  formatCurrency: (value: number) => string;
}

export function MultiYearChart({ academicYears, getYearStats, lang, t, currentTheme, formatCurrency }: MultiYearChartProps) {
  const { isDark, card, border, muted } = currentTheme;

  return (
    <div className={`${card} p-8 rounded-[2.5rem] border ${border} shadow-xl shadow-slate-200/50`}>
      <div className="mb-8">
        <h3 className={`text-xl font-bold ${isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
          {t.revenueVsExpenses}
        </h3>
        <p className={`text-xs ${muted} mt-1`}>
          {lang === 'en' ? 'Visual overview of multi-year school performance' : 'Aperçu visuel de la performance scolaire sur plusieurs années'}
        </p>
      </div>

      <div className="h-[320px] w-full flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={academicYears.map(year => {
              const { revenue, expenses } = getYearStats(year);
              return {
                name: year,
                [lang === 'en' ? 'Revenue' : 'Recettes']: revenue,
                [lang === 'en' ? 'Expenses' : 'Dépenses']: expenses
              };
            })}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#E2E8F0"} />
            <XAxis dataKey="name" stroke={isDark ? "#94A3B8" : "#64748B"} />
            <YAxis stroke={isDark ? "#94A3B8" : "#64748B"} tickFormatter={(val) => `${val / 1000}k`} />
            <Tooltip
              contentStyle={{
                backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                borderColor: isDark ? '#475569' : '#E2E8F0',
                borderRadius: '16px',
                color: isDark ? '#F8FAFC' : '#0F172A'
              }}
              formatter={(value: any) => [formatCurrency(Number(value)), '']}
            />
            <RechartsLegend />
            <Bar dataKey={lang === 'en' ? 'Revenue' : 'Recettes'} fill="#10B981" radius={[8, 8, 0, 0]} />
            <Bar dataKey={lang === 'en' ? 'Expenses' : 'Dépenses'} fill="#EF4444" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
