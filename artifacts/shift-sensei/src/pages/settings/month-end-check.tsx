import { useEffect, useState } from 'react';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useGetScheduleSettings,
  useUpdateScheduleSettings,
  getGetScheduleSettingsQueryKey,
  useListStaff,
  useListShiftTypes,
  useUpdateShiftType,
  getListShiftTypesQueryKey,
} from '@workspace/api-client-react';
import { ChevronLeft } from 'lucide-react';

export default function MonthEndCheckSettingsPage() {
  const { data: settings, isLoading } = useGetScheduleSettings();
  const { data: staffList = [] } = useListStaff();
  const { data: shiftTypes = [] } = useListShiftTypes();
  const [, , workingMonthStr] = useWorkingMonth(true);

  const queryClient = useQueryClient();
  const updateSettings = useUpdateScheduleSettings();
  const updateShiftType = useUpdateShiftType();

  const [maxConsecutiveWorkDays, setMaxConsecutiveWorkDays] = useState(5);
  const [countNightAfterAsConsecutive, setCountNightAfterAsConsecutive] = useState(true);
  const [minDaysOffPerMonth, setMinDaysOffPerMonth] = useState(9);
  const [nightShiftTarget, setNightShiftTarget] = useState(4);
  const [nightShiftTolerance, setNightShiftTolerance] = useState(1);
  const [nightBalanceStaffIds, setNightBalanceStaffIds] = useState<number[] | null>(null);

  useEffect(() => {
    if (!settings) return;
    setMaxConsecutiveWorkDays(settings.maxConsecutiveWorkDays);
    setCountNightAfterAsConsecutive(settings.countNightAfterAsConsecutive);
    setMinDaysOffPerMonth(settings.minDaysOffPerMonth);
    setNightShiftTarget(settings.nightShiftTarget);
    setNightShiftTolerance(settings.nightShiftTolerance);
    setNightBalanceStaffIds(settings.nightBalanceStaffIds ?? null);
  }, [settings]);

  const allStaffIncluded = nightBalanceStaffIds === null;

  const toggleStaffIncluded = (staffId: number) => {
    setNightBalanceStaffIds((current) => {
      // Once narrowed away from "all staff", the base set is the full
      // staff list minus whichever the user has already unchecked.
      const base = current ?? staffList.map((s) => s.id);
      return base.includes(staffId) ? base.filter((id) => id !== staffId) : [...base, staffId];
    });
  };

  const handleSaveSettings = async () => {
    try {
      await updateSettings.mutateAsync({
        data: {
          maxConsecutiveWorkDays,
          countNightAfterAsConsecutive,
          minDaysOffPerMonth,
          nightShiftTarget,
          nightShiftTolerance,
          nightBalanceStaffIds,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetScheduleSettingsQueryKey() });
      toast.success('保存しました');
    } catch {
      toast.error('保存に失敗しました');
    }
  };

  const handleToleranceChange = async (shiftTypeId: number, value: number) => {
    try {
      await updateShiftType.mutateAsync({ id: shiftTypeId, data: { balanceTolerance: value } });
      await queryClient.invalidateQueries({ queryKey: getListShiftTypesQueryKey() });
    } catch {
      toast.error('更新に失敗しました');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto">
        <div className="space-y-3 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto pb-12">
      <div className="flex items-center gap-2 mb-6 mt-4">
        <Link
          href="/settings"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="設定に戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">月末チェック設定</h1>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
        ここで設定した基準は「おすすめ」画面のチェックに使われます。自動で修正されることはありません。
      </p>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-5 mb-4">
        <h2 className="font-bold text-gray-900">連勤・休日</h2>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">最大連勤日数</label>
          <input
            type="number"
            min={1}
            value={maxConsecutiveWorkDays}
            onChange={(e) => setMaxConsecutiveWorkDays(Number(e.target.value))}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
          />
        </div>

        <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={countNightAfterAsConsecutive}
            onChange={(e) => setCountNightAfterAsConsecutive(e.target.checked)}
            className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
          />
          <span className="text-sm">
            <span className="font-bold text-gray-800 block">夜勤の「明け」を連勤に含める</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              夜勤の翌日の明け休みも連勤日数の計算に含めます
            </span>
          </span>
        </label>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">月の最低休日数</label>
          <input
            type="number"
            min={0}
            value={minDaysOffPerMonth}
            onChange={(e) => setMinDaysOffPerMonth(Number(e.target.value))}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
          />
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-5 mb-4">
        <h2 className="font-bold text-gray-900">夜勤バランス</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">目標回数</label>
            <input
              type="number"
              min={0}
              value={nightShiftTarget}
              onChange={(e) => setNightShiftTarget(Number(e.target.value))}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">許容差（±）</label>
            <input
              type="number"
              min={0}
              value={nightShiftTolerance}
              onChange={(e) => setNightShiftTolerance(Number(e.target.value))}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-gray-700">対象スタッフ</span>
            <button
              type="button"
              onClick={() => setNightBalanceStaffIds(allStaffIncluded ? [] : null)}
              className="text-xs font-bold text-[hsl(var(--primary))]"
            >
              {allStaffIncluded ? '個別に選択する' : '全員を対象にする'}
            </button>
          </label>
          {!allStaffIncluded && (
            <div className="space-y-2">
              {staffList.map((staff) => {
                const checked = (nightBalanceStaffIds ?? []).includes(staff.id);
                return (
                  <label
                    key={staff.id}
                    className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStaffIncluded(staff.id)}
                      className="w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-gray-800">{staff.name}</span>
                  </label>
                );
              })}
              {staffList.length === 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  スタッフが登録されていません
                </p>
              )}
            </div>
          )}
          {allStaffIncluded && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">現在、全スタッフが対象です</p>
          )}
        </div>
      </div>

      <button
        onClick={handleSaveSettings}
        disabled={updateSettings.isPending}
        className="w-full bg-[hsl(var(--primary))] text-white font-bold text-lg py-4 rounded-xl shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50 mb-4"
      >
        保存する
      </button>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
        <h2 className="font-bold text-gray-900">シフト種別ごとの許容差</h2>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          スタッフ間の回数の平均からどのくらいずれていたら知らせるか、シフト種別ごとに設定します
        </p>
        <div className="space-y-2">
          {shiftTypes.map((shiftType) => (
            <div
              key={shiftType.id}
              className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs flex-shrink-0 border border-black/5"
                  style={{ backgroundColor: shiftType.bgColor, color: shiftType.textColor }}
                >
                  {shiftType.shortLabel}
                </div>
                <span className="text-sm font-medium text-gray-800 truncate">{shiftType.name}</span>
              </div>
              <input
                type="number"
                min={0}
                defaultValue={shiftType.balanceTolerance}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (value !== shiftType.balanceTolerance && Number.isFinite(value)) {
                    void handleToleranceChange(shiftType.id, value);
                  }
                }}
                className="w-16 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-medium text-center focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow flex-shrink-0"
              />
            </div>
          ))}
          {shiftTypes.length === 0 && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              シフト種別が登録されていません
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
