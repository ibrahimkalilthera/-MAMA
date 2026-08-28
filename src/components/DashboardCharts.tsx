import { motion } from 'motion/react';
import { TrendingUp, PieChart } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
} from 'recharts';

interface DashboardChartsProps {
  chartData: { name: string; income: number; expenses: number }[];
  pieData: { name: string; value: number }[];
  t: { incomeVsExpenses: string; income: string; expenses: string; feeStatus: string };
  currentTheme: { isDark: boolean };
}

export function DashboardCharts({ chartData, pieData, t, currentTheme }: DashboardChartsProps) {
  const { isDark } = currentTheme;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`card-elevated p-6 ${isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.incomeVsExpenses}</h3>
          <div className={`p-2 ${isDark ? 'bg-white/[0.06] text-white/60' : 'bg-slate-100 text-slate-500'} rounded-lg`}>
            <TrendingUp size={16} />
          </div>
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#064e3b' : '#f1f5f9'} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: isDark ? '#10b981' : '#64748b' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: isDark ? '#10b981' : '#64748b' }} />
              <Tooltip
                contentStyle={{ backgroundColor: isDark ? '#1e1e1e' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              />
              <RechartsLegend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold' }} />
              <Bar dataKey="income" name={t.income} fill={isDark ? '#10b981' : '#3b82f6'} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name={t.expenses} fill={isDark ? '#ef4444' : '#f43f5e'} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className={`card-elevated p-6 ${isDark ? '!bg-slate-800/60 !border-white/[0.06]' : ''}`}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-800'} tracking-tight`}>{t.feeStatus}</h3>
          <div className={`p-2 ${isDark ? 'bg-white/[0.06] text-white/60' : 'bg-slate-100 text-slate-500'} rounded-lg`}>
            <PieChart size={16} />
          </div>
        </div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RePieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={8}
                dataKey="value"
              >
                <Cell fill={isDark ? '#10b981' : '#3b82f6'} />
                <Cell fill={isDark ? '#ef4444' : '#f43f5e'} />
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: isDark ? '#1e1e1e' : '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              />
              <RechartsLegend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }} />
            </RePieChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </>
  );
}
