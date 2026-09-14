import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { addMonths, format, subMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  useWipeMonthData,
  getListShiftsQueryKey,
  getListNightDutyOwnershipQueryKey,
  getListDayRemarksQueryKey,
  getGetMonthlySummaryQueryKey,
} from '@workspace/api-client-react';
import type { WipeMonthDataTarget } from '@workspace/api-client-react';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { cn } from '@/lib/utils';

// 削除対象の選択肢
const TARGETS: {
  id: WipeMonthDataTarget;
  label: string;
  description: string;
}[] = [
  {
    id: 'shifts',
    label: '勤務シフト',
    description: '通常勤務・夜勤・明けなど（制約なしのシフト）',
  },
  {
    id: 'constraints',
    label: '制約',
    description: '希望休固定・出勤固定・有給固定',
  },
  {
    id: 'nightDutyOwnership',
    label: '夜勤担当行',
    description: '〇・❌マーク（夜勤ユニット割り当て）',
  },
  {
    id: 'dayRemarks',
    label: '備考',
    description: '日付ごとのメモ欄',
  },
];

export default function DataManagementPage() {
  const [currentMonth, setCurrentMonth, monthStr] = useWorkingMonth();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<WipeMonthDataTarget>>(new Set());
  const [confirmInput, setConfirmInput] = useState('');

  const wipe = useWipeMonthData();

  const monthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });
  const isInputMatch = confirmInput === monthLabel;
  const canSubmit = selected.size > 0 && isInputMatch && !wipe.isPending;

  const toggle = (id: WipeMonthDataTarget) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleWipe = async () => {
    if (!canSubmit) return;
    try {
      const result = await wipe.mutateAsync({
        data: { month: monthStr, targets: [...selected] },
      });

      // 変更された可能性があるキャッシュを全て無効化
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListShiftsQueryKey({ month: monthStr }) }),
        queryClient.invalidateQueries({ queryKey: getListNightDutyOwnershipQueryKey({ month: monthStr }) }),
        queryClient.invalidateQueries({ queryKey: getListDayRemarksQueryKey({ month: monthStr }) }),
        queryClient.invalidateQueries({ queryKey: getGetMonthlySummaryQueryKey({ month: monthStr }) }),
      ]);

      const total =
        result.deletedShifts +
        result.deletedConstraints +
        result.deletedNightDutyOwnership +
        result.deletedDayRemarks;
      toast.success(`${monthLabel}のデータを削除しました（${total} 件）`);

      // リセット
      setSelected(new Set());
      setConfirmInput('');
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  return (
    <div className="min-h-full p-4 md:p-6 max-w-xl mx-auto pb-16">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6 mt-2">
        <Link
          href="/settings"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">データ管理</h1>
      </div>

      {/* 月選択 */}
      <div className="flex items-center gap-2 mb-6 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
        <button
          onClick={() => { setSelected(new Set()); setConfirmInput(''); setCurrentMonth((m) => subMonths(m, 1)); }}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="flex-1 text-center font-bold text-gray-900 text-sm">{monthLabel}</span>
        <button
          onClick={() => { setSelected(new Set()); setConfirmInput(''); setCurrentMonth((m) => addMonths(m, 1)); }}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 警告 */}
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 mb-5 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
        <span>選択した項目を完全に削除します。この操作は元に戻せません。</span>
      </div>

      {/* 削除対象チェックボックス */}
      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 mb-5 overflow-hidden">
        {TARGETS.map((target) => {
          const checked = selected.has(target.id);
          return (
            <label
              key={target.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none transition-colors',
                checked ? 'bg-rose-50' : 'active:bg-gray-50',
              )}
            >
              <input
                type="checkbox"
                className="w-4 h-4 accent-rose-600 flex-shrink-0"
                checked={checked}
                onChange={() => toggle(target.id)}
              />
              <div className="flex-1">
                <p className={cn('text-sm font-bold', checked ? 'text-rose-800' : 'text-gray-800')}>
                  {target.label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{target.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      {/* 確認入力 */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 mb-2">
          確認のため、下の欄に <span className="font-bold text-gray-700">「{monthLabel}」</span> と入力してください。
        </p>
        <input
          type="text"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          placeholder={monthLabel}
          className={cn(
            'w-full px-4 py-3 rounded-xl border text-sm transition-colors outline-none',
            isInputMatch && confirmInput !== ''
              ? 'border-rose-400 bg-rose-50 text-rose-900'
              : 'border-gray-200 bg-white text-gray-900 focus:border-gray-400',
          )}
        />
      </div>

      {/* 削除ボタン */}
      <button
        onClick={handleWipe}
        disabled={!canSubmit}
        className={cn(
          'w-full h-12 rounded-xl font-bold text-sm transition-all',
          canSubmit
            ? 'bg-rose-600 text-white active:scale-[0.98]'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed',
        )}
      >
        {wipe.isPending ? '削除中...' : `選択した項目を削除する（${selected.size} 項目）`}
      </button>
    </div>
  );
}
