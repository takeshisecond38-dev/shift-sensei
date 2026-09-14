import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useListStaff,
  useCreateStaff,
  useUpdateStaff,
  useDeleteStaff,
  useReorderStaff,
  useListShiftTypes,
  getListStaffQueryKey,
} from '@workspace/api-client-react';
import type { Staff } from '@workspace/api-client-react';
import { GripVertical, Plus, Settings2, Star, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', 
  '#10b981', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', 
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
];

const ROW_HEIGHT = 84;

const staffSchema = z.object({
  name: z.string().min(1, '名前を入力してください'),
  color: z.string().min(1),
  shortLabel: z
    .string()
    .min(1, '表示ラベルを入力してください')
    .max(3, '3文字以内で入力してください'),
  isLeader: z.boolean(),
  // null = no restriction (can work all shift types)
  // number[] = only these shift type IDs are allowed
  availableShiftTypeIds: z.array(z.number()).nullable(),
});

type StaffFormData = z.infer<typeof staffSchema>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Derives a reasonable default short label (first char of the name) so the
// field starts pre-filled instead of forcing every new staff member through
// an extra manual step.
function defaultShortLabel(name: string) {
  return name.slice(0, 1) || '?';
}

export default function StaffPage() {
  const { data: staffList = [], isLoading } = useListStaff();
  const { data: allShiftTypes = [] } = useListShiftTypes();
  // Only real (non-constraint) shift types are relevant for availability
  const assignableShiftTypes = allShiftTypes.filter((st) => !st.constraintOnly);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const queryClient = useQueryClient();
  const staffKey = getListStaffQueryKey();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const reorderStaff = useReorderStaff();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: staffKey });

  // Local ordering mirrors the server list, but is driven directly during a
  // drag gesture so reordering feels instant instead of waiting on a
  // round-trip. It resyncs from the server whenever a drag isn't in flight.
  const [orderedList, setOrderedList] = useState<Staff[]>([]);
  const orderRef = useRef<Staff[]>([]);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) {
      setOrderedList(staffList);
      orderRef.current = staffList;
    }
  }, [staffList]);

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
    const index = orderRef.current.findIndex((s) => s.id === state.id);
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
    const original = staffList.map((s) => s.id).join(',');
    const newOrder = orderRef.current;
    const reordered = newOrder.map((s) => s.id).join(',');
    if (original !== reordered) {
      // Write the new order into the shared query cache immediately —
      // before the network round-trip even starts — so every screen
      // reading staff (this page and the shifts grid) reflects it right
      // away instead of racing a background refetch. The server request
      // still fires right after to persist it; its response reconciles the
      // cache with the authoritative saved order (or reverts on failure).
      queryClient.setQueryData(staffKey, newOrder);
      void reorderStaff
        .mutateAsync({ data: { ids: newOrder.map((s) => s.id) } })
        .then((saved) => {
          queryClient.setQueryData(staffKey, saved);
        })
        .catch(() => {
          toast.error('並び替えに失敗しました', { position: 'bottom-center' });
          queryClient.setQueryData(staffKey, staffList);
          setOrderedList(staffList);
          orderRef.current = staffList;
        });
    }
  };

  const form = useForm<StaffFormData>({
    resolver: zodResolver(staffSchema),
    defaultValues: { name: '', color: COLORS[0], shortLabel: '', isLeader: false, availableShiftTypeIds: null },
  });

  const handleOpenNew = () => {
    setEditingStaff(null);
    setConfirmingDelete(false);
    form.reset({
      name: '',
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shortLabel: '',
      isLeader: false,
      availableShiftTypeIds: null,
    });
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setConfirmingDelete(false);
    form.reset({
      name: staff.name,
      color: staff.color,
      shortLabel: staff.shortLabel,
      isLeader: staff.isLeader,
      // null means no restriction; preserve existing selection
      availableShiftTypeIds: staff.availableShiftTypeIds ?? null,
    });
    setIsDrawerOpen(true);
  };

  const onSubmit = async (data: StaffFormData) => {
    try {
      // null → null (制限なし を明示的に送信してDBをNULLに上書き)
      // [] → null (全解除は「制限なし」と同義として扱う)
      // [id,...] → そのまま送信
      const ids = data.availableShiftTypeIds;
      const availableShiftTypeIds: number[] | null =
        ids && ids.length > 0 ? ids : null;
      const payload = { ...data, availableShiftTypeIds };
      if (editingStaff) {
        await updateStaff.mutateAsync({ id: editingStaff.id, data: payload });
        toast.success('更新しました');
      } else {
        await createStaff.mutateAsync({ data: payload });
        toast.success('追加しました');
      }
      await invalidate();
      setIsDrawerOpen(false);
    } catch (e) {
      toast.error('エラーが発生しました');
    }
  };

  const handleDelete = async () => {
    if (!editingStaff) return;
    try {
      await deleteStaff.mutateAsync({ id: editingStaff.id });
      await invalidate();
      toast.success('削除しました');
      setIsDrawerOpen(false);
    } catch (e) {
      toast.error('削除に失敗しました');
    }
  };

  return (
    <div className="min-h-full p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 mt-4">
        <h1 className="text-2xl font-bold text-gray-900">スタッフ管理</h1>
        <button 
          onClick={handleOpenNew}
          className="flex items-center gap-1.5 bg-[hsl(var(--primary))] text-white px-4 py-2.5 rounded-xl font-bold shadow-sm active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
          <span>追加</span>
        </button>
      </div>

      {!isLoading && staffList.length > 1 && (
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 px-1">
          ハンドルをドラッグして並び順を変更できます（シフト表の行順に反映されます）
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-white border border-gray-100 animate-pulse rounded-2xl shadow-sm" />)}
        </div>
      ) : staffList.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm mt-8">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Plus className="w-8 h-8 text-blue-500" />
          </div>
          <p className="text-gray-900 font-bold mb-1">スタッフを追加しましょう</p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">右上の「追加」ボタンから登録できます</p>
        </div>
      ) : (
        <div className="space-y-2 pb-8">
          {orderedList.map((staff) => (
            <div
              key={staff.id}
              className={cn(
                'w-full bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 transition-shadow touch-manipulation',
                draggingId === staff.id && 'shadow-lg ring-2 ring-[hsl(var(--primary))]',
              )}
              style={{ height: ROW_HEIGHT }}
            >
              <button
                type="button"
                onPointerDown={(e) => handleDragPointerDown(e, staff.id)}
                onPointerMove={handleDragPointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                className="p-2 -m-2 text-gray-300 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
                aria-label="並び替え"
              >
                <GripVertical className="w-5 h-5" />
              </button>

              <button
                onClick={() => handleOpenEdit(staff)}
                className="flex-1 flex items-center gap-3 text-left active:opacity-70 transition-opacity min-w-0"
              >
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shadow-inner flex-shrink-0"
                  style={{ backgroundColor: staff.color }}
                >
                  {staff.shortLabel || staff.name.charAt(0)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-gray-900 text-lg truncate">{staff.name}</h3>
                    {staff.isLeader && (
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0" aria-label="リーダー" />
                    )}
                  </div>
                </div>
              </button>
              <div className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full flex-shrink-0">
                <Settings2 className="w-5 h-5 text-gray-500" onClick={() => handleOpenEdit(staff)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Drawer.Root open={isDrawerOpen} onOpenChange={(open) => { setIsDrawerOpen(open); if (!open) setConfirmingDelete(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[92dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-6" />
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">{editingStaff ? 'スタッフ編集' : 'スタッフ追加'}</h2>
                <button onClick={() => setIsDrawerOpen(false)} className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2">名前</label>
                    <input 
                      {...form.register('name')}
                      onChange={(e) => {
                        form.setValue('name', e.target.value);
                        if (!editingStaff && !form.getFieldState('shortLabel').isDirty) {
                          form.setValue('shortLabel', defaultShortLabel(e.target.value));
                        }
                      }}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-medium focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      placeholder="例: 山田 太郎"
                    />
                    {form.formState.errors.name && (
                      <p className="text-red-500 text-sm mt-1">{form.formState.errors.name.message}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">表示ラベル</label>
                    <input
                      {...form.register('shortLabel')}
                      maxLength={3}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-lg font-medium text-center focus:ring-2 focus:ring-[hsl(var(--primary))] outline-none transition-shadow"
                      placeholder="例: 山"
                    />
                    {form.formState.errors.shortLabel && (
                      <p className="text-red-500 text-xs mt-1">{form.formState.errors.shortLabel.message}</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))] -mt-2">
                  表示ラベルはシフト表の行見出しに使われる1〜3文字の略称です
                </p>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3">カラー</label>
                  <div className="grid grid-cols-5 gap-3">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => form.setValue('color', color)}
                        className={cn(
                          "aspect-square rounded-full flex items-center justify-center transition-all",
                          form.watch('color') === color ? "scale-110 ring-4 ring-offset-2 ring-gray-300 shadow-md" : ""
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Star className="w-5 h-5 text-amber-400" />
                    <span className="font-bold text-gray-700">リーダー</span>
                  </div>
                  <input
                    type="checkbox"
                    {...form.register('isLeader')}
                    className="w-5 h-5 accent-[hsl(var(--primary))]"
                  />
                </label>

                {/* Assignable shift types */}
                {assignableShiftTypes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-sm font-bold text-gray-700">対応可能なシフト</label>
                      <button
                        type="button"
                        className="text-xs text-[hsl(var(--primary))] font-medium"
                        onClick={() => {
                          const current = form.getValues('availableShiftTypeIds');
                          const allIds = assignableShiftTypes.map((st) => st.id);
                          // Toggle between "all selected" and "none selected"
                          const allSelected = current === null || allIds.every((id) => current?.includes(id));
                          form.setValue(
                            'availableShiftTypeIds',
                            allSelected ? [] : null,
                            { shouldDirty: true }
                          );
                        }}
                      >
                        {(() => {
                          const v = form.watch('availableShiftTypeIds');
                          const allIds = assignableShiftTypes.map((st) => st.id);
                          const allSelected = v === null || allIds.every((id) => v?.includes(id));
                          return allSelected ? 'すべて解除' : 'すべて選択';
                        })()}
                      </button>
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
                      チェックを外したシフトはAI相談での自動割り当て対象外になります
                    </p>
                    <div className="space-y-2">
                      {assignableShiftTypes.map((st) => {
                        const selected = form.watch('availableShiftTypeIds');
                        // null means no restriction = all available
                        const isChecked = selected === null || selected.includes(st.id);
                        return (
                          <label
                            key={st.id}
                            className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer active:opacity-70 transition-opacity"
                          >
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                              style={{ backgroundColor: st.bgColor, color: st.textColor }}
                            >
                              {st.shortLabel}
                            </div>
                            <span className="flex-1 font-medium text-gray-800 text-sm">{st.name}</span>
                            {st.startTime && st.endTime && (
                              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                                {st.startTime}–{st.endTime}
                              </span>
                            )}
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const current = form.getValues('availableShiftTypeIds');
                                const allIds = assignableShiftTypes.map((s) => s.id);
                                // Expand null to all IDs first
                                const base = current === null ? allIds : [...current];
                                const next = e.target.checked
                                  ? [...new Set([...base, st.id])]
                                  : base.filter((id) => id !== st.id);
                                // If all checked again, store null (= no restriction)
                                form.setValue(
                                  'availableShiftTypeIds',
                                  allIds.every((id) => next.includes(id)) ? null : next,
                                  { shouldDirty: true }
                                );
                              }}
                              className="w-5 h-5 accent-[hsl(var(--primary))] flex-shrink-0"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pt-6 flex flex-col gap-3 pb-8">
                  <button 
                    type="submit"
                    disabled={form.formState.isSubmitting}
                    className="w-full bg-[hsl(var(--primary))] text-white font-bold text-lg py-4 rounded-xl shadow-sm active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {editingStaff ? '保存する' : '追加する'}
                  </button>

                  {editingStaff && !confirmingDelete && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="w-full text-red-500 font-medium text-sm py-3 rounded-xl active:opacity-60 transition-opacity flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>このスタッフを削除</span>
                    </button>
                  )}

                  {editingStaff && confirmingDelete && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-bold text-red-700">
                        「{editingStaff.name}」を削除しますか？
                      </p>
                      <p className="text-xs text-red-600">
                        ※関連するシフトや打刻データも影響を受ける可能性があります。この操作は取り消せません。
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(false)}
                          className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold text-sm py-3 rounded-xl active:scale-[0.98] transition-transform"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          className="flex-1 bg-red-600 text-white font-bold text-sm py-3 rounded-xl active:scale-[0.98] transition-transform"
                        >
                          削除する
                        </button>
                      </div>
                    </div>
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
