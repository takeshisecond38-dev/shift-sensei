import { Link } from 'wouter';
import { format, addMonths, subMonths } from 'date-fns';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { ja } from 'date-fns/locale';
import { useGetRecommendations, getGetRecommendationsQueryKey } from '@workspace/api-client-react';
import type { Recommendation } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, ChevronLeft as ArrowLeft, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  consecutive_work: '連勤',
  days_off: '休日数',
  night_balance: '夜勤バランス',
  shift_balance: 'シフトバランス',
  required_work_pending: '出勤希望未反映',
  facility_rule: '施設ルール',
  available_shift_violation: '対応不可シフト',
};

const SEVERITY_STYLE: Record<Recommendation['severity'], { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'bg-blue-50 text-blue-600 border-blue-100' },
  warning: { icon: AlertTriangle, className: 'bg-amber-50 text-amber-600 border-amber-100' },
  critical: { icon: AlertCircle, className: 'bg-red-50 text-red-600 border-red-100' },
};

export default function RecommendationsPage() {
  const [currentMonth, setCurrentMonth, monthStr] = useWorkingMonth();

  const { data: recommendations = [], isLoading } = useGetRecommendations(
    { month: monthStr },
    { query: { queryKey: getGetRecommendationsQueryKey({ month: monthStr }) } },
  );

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto pb-12">
      <div className="flex items-center gap-2 mb-4 mt-4">
        <Link
          href="/shift-sensei"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="戻る"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">💡 おすすめ</h1>
      </div>

      <div className="flex items-center justify-between bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 mb-4">
        <button
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="p-2 -m-2 text-gray-400 active:bg-gray-100 rounded-full"
          aria-label="前の月"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="font-bold text-gray-900">{format(currentMonth, 'yyyy年 M月', { locale: ja })}</span>
        <button
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="p-2 -m-2 text-gray-400 active:bg-gray-100 rounded-full"
          aria-label="次の月"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
        設定した基準をもとに気になる点を知らせます。自動で修正はされません。
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-900 font-bold mb-1">気になる点はありません</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">この月のシフトは基準を満たしています</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recommendations.map((rec, index) => {
            const { icon: Icon, className } = SEVERITY_STYLE[rec.severity];
            return (
              <div
                key={index}
                className={cn(
                  'flex items-start gap-3 bg-white p-4 rounded-2xl shadow-sm border',
                  className,
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide opacity-70 mb-1">
                    {TYPE_LABEL[rec.type] ?? rec.type}
                  </p>
                  <p className="text-sm font-medium text-gray-800">{rec.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
