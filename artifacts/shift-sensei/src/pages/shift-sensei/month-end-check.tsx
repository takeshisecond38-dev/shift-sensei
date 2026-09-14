import { useState } from 'react';
import { Link } from 'wouter';
import { format, addMonths, subMonths } from 'date-fns';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { ja } from 'date-fns/locale';
import { useGetRecommendations, getGetRecommendationsQueryKey } from '@workspace/api-client-react';
import type { Recommendation, RecommendationType } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Month-End Check is computed entirely client-side by re-bucketing the
// existing /recommendations response by category — there is no separate
// backend endpoint. Each category's status is the worst severity among its
// findings: any "critical" -> ERROR, any "warning"/"info" (with no
// critical) -> WARNING, no findings -> PASS.

type CheckStatus = 'pass' | 'warning' | 'error';

const CATEGORY_ORDER: { type: RecommendationType; label: string }[] = [
  { type: 'consecutive_work', label: '連勤' },
  { type: 'days_off', label: '休日数' },
  { type: 'night_balance', label: '夜勤バランス' },
  { type: 'shift_balance', label: 'シフトバランス' },
  { type: 'facility_rule', label: '施設ルール' },
  { type: 'required_work_pending', label: '制約違反' },
  { type: 'available_shift_violation', label: '対応不可シフト' },
];

function statusForFindings(findings: Recommendation[]): CheckStatus {
  if (findings.some((f) => f.severity === 'critical')) return 'error';
  if (findings.length > 0) return 'warning';
  return 'pass';
}

const STATUS_STYLE: Record<CheckStatus, { icon: typeof CheckCircle2; label: string; className: string }> = {
  pass: { icon: CheckCircle2, label: 'PASS', className: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  warning: { icon: AlertTriangle, label: 'WARNING', className: 'bg-amber-50 text-amber-600 border-amber-100' },
  error: { icon: XCircle, label: 'ERROR', className: 'bg-red-50 text-red-600 border-red-100' },
};

export default function MonthEndCheckPage() {
  const [currentMonth, setCurrentMonth, monthStr] = useWorkingMonth();
  const [expanded, setExpanded] = useState<Set<RecommendationType>>(new Set());

  const { data: recommendations = [], isLoading } = useGetRecommendations(
    { month: monthStr },
    { query: { queryKey: getGetRecommendationsQueryKey({ month: monthStr }) } },
  );

  const findingsByCategory = new Map<RecommendationType, Recommendation[]>();
  for (const rec of recommendations) {
    const list = findingsByCategory.get(rec.type) ?? [];
    list.push(rec);
    findingsByCategory.set(rec.type, list);
  }

  const overallStatus = statusForFindings(recommendations);
  const toggleExpanded = (type: RecommendationType) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto pb-12">
      <div className="flex items-center gap-2 mb-4 mt-4">
        <Link
          href="/shift-sensei"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">📅 月末チェック</h1>
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

      {!isLoading && (
        <div
          className={cn(
            'flex items-center gap-3 rounded-2xl border px-4 py-3 mb-4 font-bold',
            STATUS_STYLE[overallStatus].className,
          )}
        >
          {(() => {
            const Icon = STATUS_STYLE[overallStatus].icon;
            return <Icon className="w-5 h-5 flex-shrink-0" />;
          })()}
          <span>
            {overallStatus === 'pass'
              ? 'すべての項目が基準を満たしています'
              : `確認が必要な項目があります（総合判定: ${STATUS_STYLE[overallStatus].label}）`}
          </span>
        </div>
      )}

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
        「おすすめ」チェックの結果を項目ごとに PASS / WARNING / ERROR で表示します。自動で修正はされません。基準は設定から変更できます。
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-16 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {CATEGORY_ORDER.map(({ type, label }) => {
            const findings = findingsByCategory.get(type) ?? [];
            const status = statusForFindings(findings);
            const { icon: Icon, label: statusLabel, className } = STATUS_STYLE[status];
            const isOpen = expanded.has(type);
            return (
              <div key={type} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <button
                  onClick={() => findings.length > 0 && toggleExpanded(type)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                  disabled={findings.length === 0}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border flex-shrink-0',
                      className,
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {statusLabel}
                  </span>
                  <span className="flex-1 font-bold text-gray-900">{label}</span>
                  {findings.length > 0 && (
                    <>
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">{findings.length}件</span>
                      <ChevronDown
                        className={cn('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')}
                      />
                    </>
                  )}
                </button>
                {isOpen && findings.length > 0 && (
                  <div className="px-4 pb-4 space-y-2 border-t border-gray-50 pt-3">
                    {findings.map((finding, index) => (
                      <p key={index} className="text-sm text-gray-700 leading-relaxed">
                        {finding.date && <span className="font-bold text-gray-900">{finding.date.slice(-2)}日: </span>}
                        {finding.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
