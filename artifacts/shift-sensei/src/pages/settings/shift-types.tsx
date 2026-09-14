import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Drawer } from 'vaul';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useListShiftTypes,
  useCreateShiftType,
  useUpdateShiftType,
  useDeleteShiftType,
  useReorderShiftTypes,
  getListShiftTypesQueryKey,
} from '@workspace/api-client-react';
import type { ShiftType, ShiftTypeCategory } from '@workspace/api-client-react';
import { ChevronLeft, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORY_OPTIONS: { value: ShiftTypeCategory; label: string }[] = [
  { value: 'day_shift', label: '日勤' },
  { value: 'night_shift', label: '夜勤' },
  { value: 'after_night', label: '明け' },
  { value: 'holiday', label: '休日' },
  { value: 'paid_leave', label: '有休' },
  { value: 'other', label: 'その他' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label]),
);

const ROW_HEIGHT = 80;

const shiftTypeSchema = z.object({
  code: z.string().min(1, 'コードを入力してください'),
  name: z.string().min(1, '名前を入力してください'),
  shortLabel: z
    .string()
    .min(1, '表示ラベルを入力してください')
    .max(3, '3文字以内で入力してください'),
  bgColor: z.string().min(1),
  textColor: z.string().min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  workingHours: z.coerce.number().optional(),
  category: z.enum(['day_shift', 'night_shift', 'after_night', 'holiday', 'paid_leave', 'other']),
  countsAsConsecutiveWork: z.boolean(),
  canAiAutoAssign: z.boolean(),
  includeInMonthlyStats: z.boolean(),
  constraintOnly: z.boolean(),
});

type ShiftTypeFormData = z.infer<typeof shiftTypeSchema>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function ShiftTypesPage() {
  const { data: shiftTypes = [], isLoading } = useListShiftTypes();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingType, setEditingType] = useState<ShiftType | null>(null);

  const queryClient = useQueryClient();
  const shiftTypesKey = getListShiftTypesQueryKey();
  const createShiftType = useCreateShiftType();
  const updateShiftType = useUpdateShiftType();
  const deleteShiftType = useDeleteShiftType();
  const reorderShiftTypes = useReorderShiftTypes();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: shiftTypesKey });

  // Local ordering mirrors the server list, but is driven directly during a
  // drag gesture so reordering feels instant instead of waiting on a
  // round-trip. It resyncs from the server whenever a drag isn't in flight.
  const [orderedList, setOrderedList] = useState<ShiftType[]>([]);
  const orderRef = useRef<ShiftType[]>([]);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) {
      setOrderedList(shiftTypes);
      orderRef.current = shiftTypes;
    }
  }, [shiftTypes]);

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const dragStateRef = useRef<{ id: number; startY: number; pointerId: number } | null>(null);

  const handleDragPointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    dragStateRef.current = { id, startY: e.clientY, pointerId: e.pointerId };
    setDraggingId(id);
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const dy = e.clientY - state.startY;
    if (Math.abs(dy) < ROW_HEIGHT / 2) return;
    const index = orderRef.current.findIndex((t) => t.id === state.id);
    if (index === -1) return;
    const step = dy > 0 ? 1 : -1;
    const newIndex = clamp(index + step, 0, orderRef.current.length - 1);
    if (newIndex === index) return;
    const next = [...orderRef.current];
    const [item] = next.splice(index, 1);
    next.splice(newIndex, 0, item);
    orderRef.current = next;
    setOrderedList(next);
    dragStateRef.current = { ...state, startY: e.clientY };
  };

  const finishDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    draggingRef.current = false;
    setDraggingId(null);
    const original = shiftTypes.map((t) => t.id).join(',');
    const reordered = orderRef.current.map((t) => t.id).join(',');
    if (original !== reordered) {
      void reorderShiftTypes
        .mutateAsync({ data: { ids: orderRef.current.map((t) => t.id) } })
        .then(() => invalidate())
        .catch(() => {
          toast.error('並び替えに失敗しました', { position: 'bottom-center' });
          setOrderedList(shiftTypes);
          orderRef.current = shiftTypes;
        });
    }
  };

  const form = useForm<ShiftTypeFormData>({
    resolver: zodResolver(shiftTypeSchema),
    defaultValues: {
      code: '',
      name: '',
      shortLabel: '',
      bgColor: '#fb923c',
      textColor: '#000000',
      startTime: '',
      endTime: '',
      workingHours: undefined,
      category: 'day_shift',
      countsAsConsecutiveWork: true,
      canAiAutoAssign: true,
      includeInMonthlyStats: true,
      constraintOnly: false,
    },
  });

  const handleOpenNew = () => {
    setEditingType(null);
    form.reset({
      code: '',
      name: '',
      shortLabel: '',
      bgColor: '#fb923c',
      textColor: '#000000',
      startTime: '',
      endTime: '',
      workingHours: undefined,
      category: 'day_shift',
      countsAsConsecutiveWork: true,
      canAiAutoAssign: true,
      includeInMonthlyStats: true,
      constraintOnly: false,
    });
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (shiftType: ShiftType) => {
    setEditingType(shiftType);
    form.reset({
      code: shiftType.code,
      name: shiftType.name,
      shortLabel: shiftType.shortLabel,
      bgColor: shiftType.bgColor,
      textColor: shiftType.textColor,
      startTime: shiftType.startTime ?? '',
      endTime: shiftType.endTime ?? '',
      workingHours: shiftType.workingHours ?? undefined,
      category: shiftType.category,
      countsAsConsecutiveWork: shiftType.countsAsConsecutiveWork,
      canAiAutoAssign: shiftType.canAiAutoAssign,
      includeInMonthlyStats: shiftType.includeInMonthlyStats,
      constraintOnly: shiftType.constraintOnly,
    });
    setIsDrawerOpen(true);
  };

  const onSubmit = async (data: ShiftTypeFormData) => {
    const payload = {
      ...data,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      workingHours: Number.isFinite(data.workingHours) ? data.workingHours : null,
    };
    try {
      if (editingType) {
        await updateShiftType.mutateAsync({ id: editingType.id, data: payload });
        toast.success('更新しました');
      } else {
        await createShiftType.mutateAsync({ data: payload });
        toast.success('追加しました');
      }
      await invalidate();
      setIsDrawerOpen(false);
    } catch {
      toast.error('エラーが発生しました。コードが重複していないか確認してください');
    }
  };

  const handleDelete = async () => {
    if (!editingType) return;
    if (!confirm(`「${editingType.name}」を削除しますか？\n※既存のシフト表に残っているスタンプの表示に影響する場合があります`)) return;
    try {
      await deleteShiftType.mutateAsync({ id: editingType.id });
      await invalidate();
      toast.success('削除しました');
      setIsDrawerOpen(false);
    } catch {
      toast.error('削除に失敗しました');
    }
  };

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6 mt-4">
        <Link
          href="/settings"
          className="p-2 -m-2 text-gray-400 rounded-full active:bg-gray-100"
          aria-label="設定に戻る"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">シフト種別</h1>
        <button
          onClick={handleOpenNew}
          className="flex items-center gap-1.5 bg-[hsl(var(--primary))] text-white px-4 py-2.5 rounded-xl font-bold shadow-sm active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
          <span>追加</span>
        </button>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
        ハンドルをドラッグしてスタンプの並び順を変更できます
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />
          ))}
        </div>
      ) : (
        <div className="space-y-2 pb-8">
          {orderedList.map((shiftType) => (
            <div
              key={shiftType.id}
              className={cn(
                'w-full bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 transition-shadow touch-manipulation',
                draggingId === shiftType.id && 'shadow-lg ring-2 ring-[hsl(var(--primary))]',
              )}
              style={{ height: ROW_HEIGHT }}
            >
              <button
                type="button"
                onPointerDown={(e) => handleDragPointerDown(e, shiftType.id)}
                onPointerMove={handleDragPointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                className="p-2 -m-2 text-gray-300 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
                aria-label="並び替え"
              >
                <GripVertical className="w-5 h-5" />
              </button>

              <button
                onClick={() => handleOpenEdit(shiftType)}
                className="flex-1 flex items-center gap-3 text-left active:opacity-70 transition-opacity min-w-0"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-xs flex-shrink-0 border border-black/5"
                  style={{ backgroundColor: shiftType.bgColor, color: shiftType.textColor }}
                >
                  {shiftType.shortLabel}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate">{shiftType.name}</h3>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                    {CATEGORY_LABEL[shiftType.category] ?? shiftType.category}
                    {shiftType.startTime && shiftType.endTime
                      ? ` ・ ${shiftType.startTime}〜${shiftType.endTime}`
                      : ''}
                    {shiftType.workingHours != null ? ` ・ ${shiftType.workingHours}h` : ''}
                  </p>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      <Drawer.Root open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[92dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-6" />
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {editingType ? 'シフト種別編集' : 'シフト種別追加'}
                </h2>
                <button onClick={() => setIsDrawerOpen(false)} className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">コード</label>
                    <input
                      {...form.register('code')}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      placeholder="例: A"
                    />
                    {form.formState.errors.code && (
                      <p className="text-red-500 text-xs mt-1">{form.formState.errors.code.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">表示ラベル（1〜3文字）</label>
                    <input
                      {...form.register('shortLabel')}
                      maxLength={3}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      placeholder="例: A"
                    />
                    {form.formState.errors.shortLabel && (
                      <p className="text-red-500 text-xs mt-1">{form.formState.errors.shortLabel.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">名前</label>
                  <input
                    {...form.register('name')}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    placeholder="例: Aシフト"
                  />
                  {form.formState.errors.name && (
                    <p className="text-red-500 text-xs mt-1">{form.formState.errors.name.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">カテゴリー</label>
                  <select
                    {...form.register('category')}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">背景色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        {...form.register('bgColor')}
                        className="w-12 h-12 rounded-xl border border-gray-200 flex-shrink-0"
                      />
                      <input
                        {...form.register('bgColor')}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-sm font-mono focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">文字色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        {...form.register('textColor')}
                        className="w-12 h-12 rounded-xl border border-gray-200 flex-shrink-0"
                      />
                      <input
                        {...form.register('textColor')}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-sm font-mono focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">開始時刻</label>
                    <input
                      type="time"
                      {...form.register('startTime')}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2 py-3 text-sm font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">終了時刻</label>
                    <input
                      type="time"
                      {...form.register('endTime')}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2 py-3 text-sm font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">労働時間(h)</label>
                    <input
                      type="number"
                      step="0.5"
                      {...form.register('workingHours')}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-2 py-3 text-sm font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <h3 className="text-sm font-bold text-gray-900 mt-4 mb-1">AI設定</h3>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                    内部設定です。今すぐシフト表の見た目には影響しませんが、将来のAIによる自動スケジューリング・集計機能で使用されます。
                  </p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        {...form.register('countsAsConsecutiveWork')}
                        className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
                      />
                      <span className="text-sm">
                        <span className="font-bold text-gray-800 block">連勤としてカウントする</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          連勤日数の計算にこのシフトを含めます
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        {...form.register('canAiAutoAssign')}
                        className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
                      />
                      <span className="text-sm">
                        <span className="font-bold text-gray-800 block">AIによる自動割り当てを許可する</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          自動スケジューリング機能がこのシフトを割り当てられるようにします
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        {...form.register('includeInMonthlyStats')}
                        className="mt-0.5 w-5 h-5 rounded accent-[hsl(var(--primary))] flex-shrink-0"
                      />
                      <span className="text-sm">
                        <span className="font-bold text-gray-800 block">月次集計に含める</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          月間の勤務バランス統計にこのシフトを含めます
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">プレビュー</p>
                  <div
                    className="inline-flex min-w-[48px] h-9 px-3 rounded-lg font-black text-sm items-center justify-center border border-black/5"
                    style={{ backgroundColor: form.watch('bgColor'), color: form.watch('textColor') }}
                  >
                    {form.watch('shortLabel') || '?'}
                  </div>
                </div>

                <div className="pt-4 flex flex-col gap-3 pb-8">
                  <button
                    type="submit"
                    disabled={form.formState.isSubmitting}
                    className="w-full bg-[hsl(var(--primary))] text-white font-bold text-lg py-4 rounded-xl shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {editingType ? '保存する' : '追加する'}
                  </button>

                  {editingType && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="w-full bg-red-50 text-red-600 font-bold text-lg py-4 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-5 h-5" />
                      <span>このシフト種別を削除</span>
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
