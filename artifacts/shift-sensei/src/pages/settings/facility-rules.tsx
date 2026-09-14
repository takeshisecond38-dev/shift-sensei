import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Drawer } from 'vaul';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useListFacilityRules,
  useCreateFacilityRule,
  useUpdateFacilityRule,
  useDeleteFacilityRule,
  getListFacilityRulesQueryKey,
  useListUnits,
  useListStaff,
} from '@workspace/api-client-react';
import type { FacilityRule, FacilityRuleType } from '@workspace/api-client-react';
import { ChevronLeft, Plus, Trash2, X, ClipboardList, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Facility rules are edited generically here — every form below is built
// from the same flat, all-optional config shape the rule engine evaluates
// (see artifacts/api-server/src/services/facility-rule-engine.ts): which
// fields matter depends on `ruleType`. Adding a new rule of an existing
// type never requires a code change; adding a genuinely new rule type
// means adding one evaluator server-side and one form branch here.
//
// `source` distinguishes rules configured directly on this screen
// ("facility") from rules accepted from a "Teach Shift Sensei" suggestion
// in AI相談 ("learned") — they're rendered in separate sections below but
// share the same edit/delete/toggle machinery.

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface RuleFormState {
  ruleType: FacilityRuleType;
  name: string;
  description: string;
  unitId: number | null;
  // staffing_count
  targetCodes: string;
  comparison: 'min' | 'max';
  count: number;
  hasCondition: boolean;
  conditionCodes: string;
  conditionMode: 'present' | 'absent';
  // staff_day_restriction / staff_fixed_shift
  staffId: number | null;
  dayOfWeek: number;
  disallowedCodes: string;
  allowedCodes: string;
}

const EMPTY_FORM: RuleFormState = {
  ruleType: 'staffing_count',
  name: '',
  description: '',
  unitId: null,
  targetCodes: '',
  comparison: 'min',
  count: 1,
  hasCondition: false,
  conditionCodes: '',
  conditionMode: 'absent',
  staffId: null,
  dayOfWeek: 6,
  disallowedCodes: '',
  allowedCodes: '',
};

function splitCodes(value: string): string[] {
  return value
    .split(/[,、\s]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function ruleToFormState(rule: FacilityRule): RuleFormState {
  const config = rule.config;
  return {
    ...EMPTY_FORM,
    ruleType: rule.ruleType,
    name: rule.name,
    description: rule.description,
    unitId: rule.unitId,
    targetCodes: (config.targetCodes ?? []).join(', '),
    comparison: config.comparison ?? 'min',
    count: config.count ?? 1,
    hasCondition: config.condition != null,
    conditionCodes: config.condition?.codes.join(', ') ?? '',
    conditionMode: config.condition?.mode ?? 'absent',
    staffId: config.staffId ?? null,
    dayOfWeek: config.dayOfWeek ?? 6,
    disallowedCodes: (config.disallowedCodes ?? []).join(', '),
    allowedCodes: (config.allowedCodes ?? []).join(', '),
  };
}

const RULE_TYPE_LABELS: Record<FacilityRuleType, string> = {
  staffing_count: '人数ルール',
  staff_day_restriction: 'スタッフ別・曜日制限',
  staff_fixed_shift: 'スタッフ別・固定シフト',
};

export default function FacilityRulesPage() {
  const { data: rules = [], isLoading } = useListFacilityRules();
  const { data: units = [] } = useListUnits();
  const { data: staffList = [] } = useListStaff();

  const queryClient = useQueryClient();
  const rulesKey = getListFacilityRulesQueryKey();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: rulesKey });

  const createRule = useCreateFacilityRule();
  const updateRule = useUpdateFacilityRule();
  const deleteRule = useDeleteFacilityRule();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FacilityRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);

  useEffect(() => {
    if (!isDrawerOpen) return;
    if (units.length > 0 && form.unitId === null && !editingRule) {
      setForm((f) => ({ ...f, unitId: units[0]?.id ?? null }));
    }
    if (staffList.length > 0 && form.staffId === null && !editingRule) {
      setForm((f) => ({ ...f, staffId: staffList[0]?.id ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawerOpen, units, staffList]);

  const handleOpenNew = () => {
    setEditingRule(null);
    setForm({ ...EMPTY_FORM, unitId: units[0]?.id ?? null, staffId: staffList[0]?.id ?? null });
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (rule: FacilityRule) => {
    setEditingRule(rule);
    setForm(ruleToFormState(rule));
    setIsDrawerOpen(true);
  };

  const handleToggleEnabled = async (rule: FacilityRule) => {
    try {
      await updateRule.mutateAsync({ id: rule.id, data: { enabled: !rule.enabled } });
      await invalidate();
    } catch {
      toast.error('更新に失敗しました');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      toast.error('ルール名を入力してください');
      return;
    }

    let config: FacilityRule['config'];
    if (form.ruleType === 'staffing_count') {
      const targetCodes = splitCodes(form.targetCodes);
      if (targetCodes.length === 0) {
        toast.error('対象シフトを入力してください');
        return;
      }
      const conditionCodes = splitCodes(form.conditionCodes);
      config = {
        targetCodes,
        comparison: form.comparison,
        count: form.count,
        condition:
          form.hasCondition && conditionCodes.length > 0
            ? { codes: conditionCodes, mode: form.conditionMode }
            : null,
      };
    } else if (form.ruleType === 'staff_day_restriction') {
      if (form.staffId === null) {
        toast.error('対象スタッフを選択してください');
        return;
      }
      const disallowedCodes = splitCodes(form.disallowedCodes);
      if (disallowedCodes.length === 0) {
        toast.error('禁止するシフトを入力してください');
        return;
      }
      config = { staffId: form.staffId, dayOfWeek: form.dayOfWeek, disallowedCodes };
    } else {
      if (form.staffId === null) {
        toast.error('対象スタッフを選択してください');
        return;
      }
      const allowedCodes = splitCodes(form.allowedCodes);
      if (allowedCodes.length === 0) {
        toast.error('固定するシフトを入力してください');
        return;
      }
      config = { staffId: form.staffId, allowedCodes };
    }

    const payload = {
      ruleType: form.ruleType,
      name: form.name.trim(),
      description: form.description.trim(),
      unitId: form.ruleType === 'staffing_count' ? form.unitId : null,
      config,
    };

    try {
      if (editingRule) {
        await updateRule.mutateAsync({ id: editingRule.id, data: payload });
        toast.success('更新しました');
      } else {
        await createRule.mutateAsync({ data: { ...payload, source: 'facility', enabled: true } });
        toast.success('追加しました');
      }
      await invalidate();
      setIsDrawerOpen(false);
    } catch {
      toast.error('エラーが発生しました');
    }
  };

  const handleDelete = async () => {
    if (!editingRule) return;
    if (!confirm(`「${editingRule.name}」を削除しますか？`)) return;
    try {
      await deleteRule.mutateAsync({ id: editingRule.id });
      await invalidate();
      toast.success('削除しました');
      setIsDrawerOpen(false);
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  const unitNameById = new Map(units.map((u) => [u.id, u.name]));
  const facilityRules = rules.filter((r) => r.source !== 'learned');
  const learnedRules = rules.filter((r) => r.source === 'learned');

  const renderRuleCard = (rule: FacilityRule) => (
    <div
      key={rule.id}
      className={cn(
        'bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-opacity',
        !rule.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={() => handleOpenEdit(rule)}
          className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
        >
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {rule.unitId != null && unitNameById.has(rule.unitId) && (
              <span className="text-[11px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex-shrink-0">
                {unitNameById.get(rule.unitId)}
              </span>
            )}
            {rule.source === 'learned' && (
              <span className="text-[11px] font-bold bg-violet-50 text-violet-600 px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI学習
              </span>
            )}
            <h3 className="font-bold text-gray-900 truncate">{rule.name}</h3>
          </div>
          {rule.description && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
              {rule.description}
            </p>
          )}
        </button>

        <button
          onClick={() => void handleToggleEnabled(rule)}
          role="switch"
          aria-checked={rule.enabled}
          aria-label={rule.enabled ? 'ルールを無効にする' : 'ルールを有効にする'}
          className={cn(
            'relative flex-shrink-0 w-12 h-7 rounded-full transition-colors',
            rule.enabled ? 'bg-[hsl(var(--primary))]' : 'bg-gray-200',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform',
              rule.enabled && 'translate-x-5',
            )}
          />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto pb-8">
      <div className="flex items-center gap-2 mb-6 mt-4">
        <Link
          href="/settings"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="設定に戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">施設ルール</h1>
        <button
          onClick={handleOpenNew}
          className="flex items-center gap-1.5 bg-[hsl(var(--primary))] text-white px-4 py-2.5 rounded-xl font-bold shadow-sm active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
          <span>追加</span>
        </button>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
        ここで登録したルールは月末チェック・おすすめ・AI相談での判定に使われます。ONにしたルールのみ判定されます。
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <ClipboardList className="w-10 h-10 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-900 font-bold mb-1">ルールがまだありません</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">「追加」からルールを作成できます</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">{facilityRules.map(renderRuleCard)}</div>

          {learnedRules.length > 0 && (
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-gray-500 mb-2 px-1">
                <Sparkles className="w-4 h-4 text-violet-500" />
                学習ルール（AI相談で教えた内容）
              </h2>
              <div className="space-y-2">{learnedRules.map(renderRuleCard)}</div>
            </div>
          )}
        </div>
      )}

      <Drawer.Root open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[92dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-6" />
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">{editingRule ? 'ルール編集' : 'ルール追加'}</h2>
                <button onClick={() => setIsDrawerOpen(false)} className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {!editingRule && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">ルールの種類</label>
                    <select
                      value={form.ruleType}
                      onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value as FacilityRuleType }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    >
                      <option value="staffing_count">人数ルール（毎日〇人以上/以下）</option>
                      <option value="staff_day_restriction">スタッフ別・曜日制限</option>
                      <option value="staff_fixed_shift">スタッフ別・固定シフト</option>
                    </select>
                  </div>
                )}
                {editingRule && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] -mt-2">
                    種類: {RULE_TYPE_LABELS[form.ruleType]}（作成後は変更できません）
                  </p>
                )}

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">ルール名</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    placeholder="例: B2勤務は毎日最低1人"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">説明（任意）</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow resize-none"
                    placeholder="このルールがどんな内容かをメモできます"
                  />
                </div>

                {form.ruleType === 'staffing_count' && (
                  <>
                    {units.length > 0 && (
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">対象ユニット</label>
                        <select
                          value={form.unitId ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value ? Number(e.target.value) : null }))}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                        >
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="pt-2 border-t border-gray-100 space-y-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">対象シフト（カンマ区切り）</label>
                        <input
                          value={form.targetCodes}
                          onChange={(e) => setForm((f) => ({ ...f, targetCodes: e.target.value }))}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                          placeholder="例: A や 2夜, 特2夜"
                        />
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          複数のシフトコードを入れると「いずれか」の合計人数で判定します（例: 2夜と特2夜を夜勤としてまとめる）
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">条件</label>
                          <select
                            value={form.comparison}
                            onChange={(e) => setForm((f) => ({ ...f, comparison: e.target.value as 'min' | 'max' }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                          >
                            <option value="min">最低（min）</option>
                            <option value="max">最大（max）</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2">人数</label>
                          <input
                            type="number"
                            min={0}
                            value={form.count}
                            onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100 space-y-3">
                      <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.hasCondition}
                          onChange={(e) => setForm((f) => ({ ...f, hasCondition: e.target.checked }))}
                          className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
                        />
                        <span className="text-sm">
                          <span className="font-bold text-gray-800 block">特定のシフトの有無で条件を絞る</span>
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            例:「明けがいない日」だけA勤務を必要にする
                          </span>
                        </span>
                      </label>

                      {form.hasCondition && (
                        <div className="pl-2 space-y-3">
                          <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                              このシフトが
                            </label>
                            <select
                              value={form.conditionMode}
                              onChange={(e) => setForm((f) => ({ ...f, conditionMode: e.target.value as 'present' | 'absent' }))}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                            >
                              <option value="present">いる日に適用</option>
                              <option value="absent">いない日に適用</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">シフト（カンマ区切り）</label>
                            <input
                              value={form.conditionCodes}
                              onChange={(e) => setForm((f) => ({ ...f, conditionCodes: e.target.value }))}
                              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                              placeholder="例: 明け や 2夜, 特2夜"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {form.ruleType === 'staff_day_restriction' && (
                  <div className="pt-2 border-t border-gray-100 space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">対象スタッフ</label>
                      <select
                        value={form.staffId ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      >
                        {staffList.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">曜日</label>
                      <select
                        value={form.dayOfWeek}
                        onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      >
                        {WEEKDAY_LABELS.map((label, index) => (
                          <option key={label} value={index}>
                            {label}曜日
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">禁止するシフト（カンマ区切り）</label>
                      <input
                        value={form.disallowedCodes}
                        onChange={(e) => setForm((f) => ({ ...f, disallowedCodes: e.target.value }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                        placeholder="例: 2夜, 特2夜"
                      />
                    </div>
                  </div>
                )}

                {form.ruleType === 'staff_fixed_shift' && (
                  <div className="pt-2 border-t border-gray-100 space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">対象スタッフ</label>
                      <select
                        value={form.staffId ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      >
                        {staffList.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">固定するシフト（カンマ区切り）</label>
                      <input
                        value={form.allowedCodes}
                        onChange={(e) => setForm((f) => ({ ...f, allowedCodes: e.target.value }))}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                        placeholder="例: B2"
                      />
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        休日・有休のシフトは常に許可されます
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-4 flex flex-col gap-3 pb-8">
                  <button
                    type="submit"
                    disabled={createRule.isPending || updateRule.isPending}
                    className="w-full bg-[hsl(var(--primary))] text-white font-bold text-lg py-4 rounded-xl shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {editingRule ? '保存する' : '追加する'}
                  </button>

                  {editingRule && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full bg-red-50 text-red-600 font-bold text-lg py-4 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-5 h-5" />
                      <span>このルールを削除</span>
                    </button>
                  )}
                </div>
              </form>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
