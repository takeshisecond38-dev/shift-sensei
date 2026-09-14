import { useEffect, useMemo, useRef, useState } from 'react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from 'date-fns';
import { useWorkingMonth } from '@/hooks/useWorkingMonth';
import { ja } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  BarChart3,
  X,
  Undo2,
  Redo2,
  Lock,
  LockOpen,
  Move,
  StickyNote,
  Eraser,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Drawer } from 'vaul';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useListStaff,
  useListShifts,
  useListShiftTypes,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
  useResetShiftMonth,
  useGetMonthlySummary,
  useListUnits,
  useListNightDutyOwnership,
  useUpsertNightDutyOwnership,
  useListDayRemarks,
  useUpsertDayRemark,
  useListDayStaffingStatus,
  getListShiftsQueryKey,
  getGetMonthlySummaryQueryKey,
  getListNightDutyOwnershipQueryKey,
  getListDayRemarksQueryKey,
} from '@workspace/api-client-react';
import { ConstraintType } from '@workspace/api-client-react';
import type {
  Shift,
  ShiftCode as ShiftCodeType,
  ShiftType,
  ConstraintType as ConstraintTypeType,
  Staff,
} from '@workspace/api-client-react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { aiUndoStore } from '@/lib/aiUndoStore';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Phase 1 (制約入力) shows exactly these three protected constraint modes —
// normal shift stamps are hidden so they can't be accidentally selected
// while entering constraints. Just like Phase 2 (勤務入力), the manager
// picks one mode first, then taps/drags cells to paint it continuously —
// there is no picker dialog for any of the three.
const CONSTRAINT_STAMPS: {
  code: ConstraintTypeType;
  label: string;
  emoji: string;
  className: string;
}[] = [
  {
    code: ConstraintType.attendance,
    label: '出勤固定',
    emoji: '📌',
    className: 'bg-white text-blue-600 border-2 border-blue-400',
  },
  {
    code: ConstraintType.hope_off,
    label: '休み',
    emoji: '🚫',
    className: 'bg-red-50 text-red-600 border-2 border-red-300',
  },
  {
    code: ConstraintType.paid_leave,
    label: '有給',
    emoji: '🌴',
    className: 'bg-emerald-50 text-emerald-600 border-2 border-emerald-300',
  },
];

// Display info for the two "fixed off" constraint types set via the
// off-day picker dialog. Keyed by ConstraintType so grid/menu rendering
// never needs to branch on the string literal directly.
const OFF_DAY_CONSTRAINT_INFO: Record<
  'hope_off' | 'paid_leave',
  { label: string; emoji: string; ringClassName: string }
> = {
  hope_off: { label: '休み', emoji: '🚫', ringClassName: 'ring-2 ring-red-500' },
  paid_leave: { label: '有給', emoji: '🌴', ringClassName: 'ring-2 ring-emerald-500' },
};

const SUMMARY_ROWS: { key: keyof import('@workspace/api-client-react').ShiftCodeCounts; label: string }[] = [
  { key: 'A', label: 'A' },
  { key: 'B2', label: 'B2' },
  { key: 'C3', label: 'C3' },
  { key: 'D', label: 'D' },
  { key: 'E2', label: 'E2' },
  { key: 'nightShift', label: '夜勤' },
  { key: 'yasumi', label: '休み' },
  { key: 'yuukyuu', label: '有休' },
];

// Fixed dimensions for the parts of the grid that must never zoom.
const AVATAR_COL_WIDTH = 36;
const HEADER_HEIGHT = 32;
const OWNERSHIP_ROW_HEIGHT = 20;
const TOTAL_HEADER_HEIGHT = HEADER_HEIGHT + OWNERSHIP_ROW_HEIGHT;
// 備考 is shown vertically (縦書き), up to 2 columns per day, so its row
// grows with content instead of truncating — clamped between a compact
// empty-state height and a cap (beyond which a single tall cell scrolls
// internally rather than stretching the whole row).
const REMARKS_ROW_MIN_HEIGHT = 30;
const REMARKS_ROW_MAX_HEIGHT = 96;
const REMARKS_CHAR_HEIGHT = 13;

// Base (zoom = 1) column/row sizes per orientation, tuned so that portrait
// shows ~14-16 days / 8-10 staff and landscape shows ~25-31 days / 8-10 staff.
const BASE_COL_WIDTH = { portrait: 24, landscape: 27 };
const BASE_ROW_HEIGHT = { portrait: 30, landscape: 24 };
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;
const MAX_HISTORY = 50;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isLandscape;
}

// Avatar labels come directly from each staff member's manually-entered
// `shortLabel` (set in Staff Management) rather than being derived from
// `name` — auto-derived prefixes collide often (山本/山田) and don't handle
// transliterated names well (トゥーサン -> トゥ), so the user picks it.
function useAvatarLabels(staffList: Staff[]): Map<number, string> {
  return useMemo(
    () => new Map(staffList.map((s) => [s.id, s.shortLabel || s.name.slice(0, 1)])),
    [staffList],
  );
}

type CellState = {
  code: ShiftCodeType | null;
  constraintType: ConstraintTypeType | null;
  locked: boolean;
} | null;
type CellChange = { staffId: number; date: string; before: CellState; after: CellState };
type UndoEntry = { changes: CellChange[] };

function cellKey(staffId: number, date: string) {
  return `${staffId}|${date}`;
}

function shiftMapFromList(list: Shift[]) {
  const map = new Map<string, CellState>();
  for (const s of list)
    map.set(cellKey(s.staffId, s.date), {
      code: s.code,
      constraintType: s.constraintType,
      locked: s.locked,
    });
  return map;
}

function diffShiftLists(before: Shift[], after: Shift[]): CellChange[] {
  const beforeMap = shiftMapFromList(before);
  const afterMap = shiftMapFromList(after);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: CellChange[] = [];
  for (const key of keys) {
    const b = beforeMap.get(key) ?? null;
    const a = afterMap.get(key) ?? null;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const sep = key.indexOf('|');
    changes.push({
      staffId: Number(key.slice(0, sep)),
      date: key.slice(sep + 1),
      before: b,
      after: a,
    });
  }
  return changes;
}

export default function ShiftsPage() {
  const [currentMonth, setCurrentMonth, monthStr] = useWorkingMonth();
  const [selectedStamp, setSelectedStamp] = useState<ShiftCodeType | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Two-phase workflow: 制約入力 (constraint entry) always runs before
  // 勤務入力 (normal shift entry). Each phase has its own stamp selection so
  // switching modes never leaves a stamp from the other phase armed.
  const [mode, setMode] = useState<'shift' | 'constraint'>('shift');
  const [selectedConstraint, setSelectedConstraint] = useState<ConstraintTypeType | null>(null);
  const modeRef = useRef(mode);
  const selectedConstraintRef = useRef(selectedConstraint);
  const switchMode = (next: 'shift' | 'constraint') => {
    setMode(next);
    setSelectedStamp(null);
    setSelectedConstraint(null);
  };

  // 連続入力 (continuous input): OFF by default every session. While OFF, a
  // finger down and moved is treated as a normal scroll gesture (native
  // panning wins) and only a plain tap edits a cell — this is what makes
  // scrolling the grid feel normal on a phone. While ON, moving the finger
  // across cells paints/deletes continuously along the path, exactly like
  // the app's original (pre-toggle) behavior. Applies identically to both
  // 制約入力 and 勤務入力 — the toggle lives above the mode switch, not
  // inside either mode.
  const [continuousInputEnabled, setContinuousInputEnabled] = useState(false);
  const continuousInputEnabledRef = useRef(continuousInputEnabled);
  useEffect(() => {
    continuousInputEnabledRef.current = continuousInputEnabled;
  }, [continuousInputEnabled]);

  const isLandscape = useIsLandscape();
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const colWidth = Math.round(BASE_COL_WIDTH[isLandscape ? 'landscape' : 'portrait'] * zoom);
  const rowHeight = Math.round(BASE_ROW_HEIGHT[isLandscape ? 'landscape' : 'portrait'] * zoom);
  const cellFontSize = clamp(9 * zoom, 7, 15);

  const bodyRef = useRef<HTMLDivElement>(null);
  const headerTrackRef = useRef<HTMLDivElement>(null);
  const avatarTrackRef = useRef<HTMLDivElement>(null);
  const remarksTrackRef = useRef<HTMLDivElement>(null);

  // Zoom (`zoom` state above) and scroll position are never reset by any
  // data mutation — only a genuine pinch gesture changes zoom. Scroll,
  // however, lives in the DOM (`bodyRef.scrollLeft/Top`) and can be nudged
  // by the browser when the scrollable content resizes during a refetch or
  // month change, so we explicitly snapshot/restore it around anything that
  // re-renders the grid (undo, redo, paint, month navigation, refetches).
  const scrollPositionRef = useRef({ left: 0, top: 0 });
  const captureScrollPosition = () => {
    if (bodyRef.current) {
      scrollPositionRef.current = {
        left: bodyRef.current.scrollLeft,
        top: bodyRef.current.scrollTop,
      };
    }
  };
  const restoreScrollPosition = () => {
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      const { left, top } = scrollPositionRef.current;
      el.scrollLeft = left;
      el.scrollTop = top;
      if (headerTrackRef.current) headerTrackRef.current.style.transform = `translateX(-${left}px)`;
      if (avatarTrackRef.current) avatarTrackRef.current.style.transform = `translateY(-${top}px)`;
    });
  };

  const { data: staffList = [], isLoading: staffLoading } = useListStaff();
  const { data: shifts = [] } = useListShifts(
    { month: monthStr },
    { query: { queryKey: getListShiftsQueryKey({ month: monthStr }) } },
  );
  const { data: summary } = useGetMonthlySummary(
    { month: monthStr },
    { query: { queryKey: getGetMonthlySummaryQueryKey({ month: monthStr }) } },
  );
  // Stamp toolbar / grid colors come entirely from the editable shift types
  // list (Settings > シフト種別) instead of a hardcoded array, already sorted
  // by their sortOrder.
  const { data: shiftTypes = [] } = useListShiftTypes();
  const shiftTypeByCode = useMemo(
    () => new Map(shiftTypes.map((t) => [t.code, t])),
    [shiftTypes],
  );
  const shiftTypeByCodeRef = useRef(shiftTypeByCode);
  useEffect(() => {
    shiftTypeByCodeRef.current = shiftTypeByCode;
  }, [shiftTypeByCode]);
  // Read via the ref inside drag-gesture handlers (which close over stale
  // values otherwise), and directly during render.
  const isHolidayCode = (code: string) =>
    shiftTypeByCodeRef.current.get(code)?.category === 'holiday';

  // Set of shift codes whose category is 'night_shift' — used for the
  // 月末チェック (night duty coverage check) in the summary drawer.
  const nightShiftCodes = useMemo(
    () => new Set(shiftTypes.filter((t) => t.category === 'night_shift').map((t) => t.code)),
    [shiftTypes],
  );

  const avatarLabels = useAvatarLabels(staffList);

  // Night Duty Ownership row: which unit is on the hook for a given
  // night's shift, before an individual staff member is assigned to it.
  // Blank = 西町 (default, no row needed), ○ = 東町, ❌ = 中央・南町 (a
  // night where East/West don't need to provide night duty). Read-only by
  // default so it can never be bumped accidentally while painting shifts —
  // an explicit edit toggle (pencil button) arms it.
  const [ownershipEditMode, setOwnershipEditMode] = useState(false);
  const { data: units = [] } = useListUnits();
  const eastUnitId = units.find((u) => u.name === '東町')?.id ?? null;
  const centralSouthUnitId = units.find((u) => u.name === '中央・南町')?.id ?? null;
  const { data: nightDutyOwnership = [] } = useListNightDutyOwnership({ month: monthStr });
  const ownershipByDate = useMemo(
    () => new Map(nightDutyOwnership.map((o) => [o.date, o.unitId])),
    [nightDutyOwnership],
  );
  const upsertNightDutyOwnership = useUpsertNightDutyOwnership();
  const nightDutyOwnershipKey = getListNightDutyOwnershipQueryKey({ month: monthStr });
  const nightDutyCircleCount = useMemo(
    () => nightDutyOwnership.filter((o) => o.unitId === eastUnitId).length,
    [nightDutyOwnership, eastUnitId],
  );
  const nightDutyCrossCount = useMemo(
    () => nightDutyOwnership.filter((o) => o.unitId !== null && o.unitId !== eastUnitId).length,
    [nightDutyOwnership, eastUnitId],
  );

  // Per-day understaffing coloring — derived only from enabled
  // staffing_count facility rules (施設ルールで設定した必要人数), never from
  // staff-preference rule types. Recomputed automatically as shifts change
  // because it's just a query keyed by month, invalidated alongside the
  // shifts list below.
  const { data: dayStaffingStatus = [] } = useListDayStaffingStatus({ month: monthStr });
  const staffingSeverityByDate = useMemo(
    () => new Map(dayStaffingStatus.map((s) => [s.date, s.severity])),
    [dayStaffingStatus],
  );

  // 備考 (remarks): one free-text field per date, persisted server-side.
  // Hiding the row is a pure display toggle — it never deletes data, since
  // it only controls whether the (already-saved) row renders.
  const REMARKS_VISIBLE_STORAGE_KEY = 'shift-sensei:remarksVisible';
  const [remarksVisible, setRemarksVisible] = useState(() => {
    try {
      return localStorage.getItem(REMARKS_VISIBLE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(REMARKS_VISIBLE_STORAGE_KEY, remarksVisible ? '1' : '0');
    } catch {
      // Ignore write failures — persistence is a nice-to-have, not critical.
    }
  }, [remarksVisible]);
  const { data: dayRemarks = [] } = useListDayRemarks({ month: monthStr });
  const remarksByDate = useMemo(() => new Map(dayRemarks.map((r) => [r.date, r.text])), [dayRemarks]);
  const upsertDayRemark = useUpsertDayRemark();
  const dayRemarksKey = getListDayRemarksQueryKey({ month: monthStr });
  const saveRemark = (dateStr: string, text: string) => {
    const previousText = remarksByDate.get(dateStr) ?? '';
    if (text === previousText) return;
    upsertDayRemark.mutate(
      { data: { date: dateStr, text } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: dayRemarksKey }),
        onError: () => toast.error('備考の保存に失敗しました', { position: 'bottom-center' }),
      },
    );
  };
  // 備考 entries are stored as one newline-separated string per date; each
  // line becomes its own vertical (縦書き) column, capped at 2 for display
  // so the grid stays scannable (「ユニット会議」「D残り」など2件まで).
  const remarkEntries = (text: string) =>
    text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2);
  const remarksRowHeight = useMemo(() => {
    let maxChars = 0;
    for (const r of dayRemarks) {
      for (const entry of remarkEntries(r.text)) {
        maxChars = Math.max(maxChars, entry.length);
      }
    }
    if (maxChars === 0) return REMARKS_ROW_MIN_HEIGHT;
    return Math.min(REMARKS_ROW_MAX_HEIGHT, Math.max(REMARKS_ROW_MIN_HEIGHT, 10 + maxChars * REMARKS_CHAR_HEIGHT));
  }, [dayRemarks]);
  const [remarksDrawerDate, setRemarksDrawerDate] = useState<string | null>(null);
  const [remarksDrawerText, setRemarksDrawerText] = useState('');
  const openRemarksDrawer = (dateStr: string) => {
    setRemarksDrawerDate(dateStr);
    setRemarksDrawerText(remarksByDate.get(dateStr) ?? '');
  };
  const closeRemarksDrawer = (save: boolean) => {
    if (save && remarksDrawerDate) saveRemark(remarksDrawerDate, remarksDrawerText);
    setRemarksDrawerDate(null);
    setRemarksDrawerText('');
  };

  const cycleNightDutyOwnership = (dateStr: string) => {
    if (!ownershipEditMode) return;
    const current = ownershipByDate.get(dateStr) ?? null;
    const next =
      current === null ? eastUnitId : current === eastUnitId ? centralSouthUnitId : null;
    upsertNightDutyOwnership.mutate(
      { data: { date: dateStr, unitId: next } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: nightDutyOwnershipKey }) },
    );
  };

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();
  const resetShiftMonth = useResetShiftMonth();

  const shiftsKey = getListShiftsQueryKey({ month: monthStr });

  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const nightDutyBlankCount = daysInMonth.length - nightDutyCircleCount - nightDutyCrossCount;
  const staffListRef = useRef(staffList);
  const daysInMonthRef = useRef(daysInMonth);
  const colWidthRef = useRef(colWidth);
  const rowHeightRef = useRef(rowHeight);
  const selectedStampRef = useRef(selectedStamp);
  useEffect(() => {
    modeRef.current = mode;
    selectedConstraintRef.current = selectedConstraint;
  }, [mode, selectedConstraint]);
  useEffect(() => {
    staffListRef.current = staffList;
    daysInMonthRef.current = daysInMonth;
    colWidthRef.current = colWidth;
    rowHeightRef.current = rowHeight;
    selectedStampRef.current = selectedStamp;
  });

  // Pinch-to-zoom is scoped to the schedule grid only. Native touch
  // listeners are required (not React's passive synthetic handlers) so we
  // can preventDefault and stop the browser from panning/scrolling instead.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 1;
    const getDist = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = getDist(e.touches);
        startZoom = zoomRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        const dist = getDist(e.touches);
        setZoom(clamp(startZoom * (dist / startDist), ZOOM_MIN, ZOOM_MAX));
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // ---- Undo / Redo history (per month view) ----
  // The stacks live in refs (single source of truth for the mutation logic)
  // so rapid, repeated undo/redo taps always read the latest state instead
  // of a stale closure from React state. `undoLen`/`redoLen` just mirror the
  // ref lengths to trigger a re-render for the buttons' disabled state.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const pushUndoEntry = (entry: UndoEntry) => {
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), entry];
    redoStackRef.current = [];
    setUndoLen(undoStackRef.current.length);
    setRedoLen(0);
  };

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoLen(0);
    setRedoLen(0);
  }, [monthStr]);

  // ---- AI undo bridge ----
  // When the user executes an AI plan in AI相談 and navigates back here,
  // aiUndoStore holds a "before" snapshot. Once shifts have loaded we diff
  // before vs after and push one undo entry so 戻る covers AI changes too.
  const [pendingAiBefore, setPendingAiBefore] = useState<Shift[] | null>(null);
  useEffect(() => {
    const pending = aiUndoStore.consumePending();
    if (pending && pending.month === monthStr) {
      setPendingAiBefore(pending.before);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingAiBefore) return;
    const changes = diffShiftLists(pendingAiBefore, shifts);
    if (changes.length > 0) pushUndoEntry({ changes });
    setPendingAiBefore(null);
  // pushUndoEntry is stable (defined in component body with no deps), safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiBefore, shifts]);

  // All mutating actions (single edits, drag-paint finalization, undo, redo)
  // run through this queue so overlapping calls — e.g. rapid taps on the
  // undo/redo buttons — execute strictly one after another instead of racing
  // against each other's reads of the shift list / history stacks.
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueAction = (fn: () => Promise<void>) => {
    const run = actionQueueRef.current.then(fn, fn);
    actionQueueRef.current = run.catch(() => {});
    return run;
  };

  const invalidateAll = async () => {
    captureScrollPosition();
    await queryClient.invalidateQueries({ queryKey: shiftsKey });
    await queryClient.invalidateQueries({ queryKey: getGetMonthlySummaryQueryKey() });
    restoreScrollPosition();
  };

  const prevMonth = () => {
    captureScrollPosition();
    setCurrentMonth((m) => subMonths(m, 1));
  };
  const nextMonth = () => {
    captureScrollPosition();
    setCurrentMonth((m) => addMonths(m, 1));
  };
  useEffect(() => {
    restoreScrollPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  // Runs a single mutation, then records exactly what changed (including any
  // server-side side effects like auto-placed 明け) as one undo entry.
  const runAction = (mutateFn: () => Promise<unknown>) =>
    enqueueAction(async () => {
      const before = queryClient.getQueryData<Shift[]>(shiftsKey) ?? shifts;
      try {
        await mutateFn();
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
        return;
      }
      await invalidateAll();
      const after = queryClient.getQueryData<Shift[]>(shiftsKey) ?? [];
      const changes = diffShiftLists(before, after);
      if (changes.length > 0) pushUndoEntry({ changes });
    });

  const reconcileToState = async (change: CellChange, target: CellState) => {
    const list = queryClient.getQueryData<Shift[]>(shiftsKey) ?? [];
    const existing = list.find((s) => s.staffId === change.staffId && s.date === change.date);
    if (!target) {
      if (existing) await deleteShift.mutateAsync({ id: existing.id });
      return;
    }
    if (!existing) {
      const created = await createShift.mutateAsync({
        data: {
          staffId: change.staffId,
          date: change.date,
          ...(target.constraintType
            ? { constraintType: target.constraintType }
            : { code: target.code ?? undefined }),
        },
      });
      // A constraint's code/locked are set deterministically server-side;
      // only reconcile them further if the captured state differs (e.g. an
      // attendance constraint that already had a shift code painted on it).
      if (target.constraintType === 'attendance' && target.code) {
        await updateShift.mutateAsync({ id: created.id, data: { code: target.code } });
      } else if (!target.constraintType && target.locked) {
        await updateShift.mutateAsync({ id: created.id, data: { locked: true } });
      }
      return;
    }
    // Unlock first whenever the current lock would block the changes below —
    // this also covers the hope_off/attendance-immutability rules, since a
    // constraintType change is always allowed through independently.
    if (existing.locked && (existing.code !== target.code || existing.constraintType !== target.constraintType)) {
      await updateShift.mutateAsync({ id: existing.id, data: { locked: false } });
    }
    if (existing.constraintType !== target.constraintType) {
      await updateShift.mutateAsync({ id: existing.id, data: { constraintType: target.constraintType } });
    }
    if (existing.code !== target.code) {
      await updateShift.mutateAsync({ id: existing.id, data: { code: target.code } });
    }
    if (existing.locked !== target.locked) {
      await updateShift.mutateAsync({ id: existing.id, data: { locked: target.locked } });
    }
  };

  // Undo/redo are enqueued so mashing the buttons never races: each tap
  // waits its turn, then reads the *current* ref stacks (not a stale
  // snapshot from when it was tapped), so a rapid burst of taps reliably
  // walks the history one step at a time.
  const undo = () =>
    enqueueAction(async () => {
      const entry = undoStackRef.current[undoStackRef.current.length - 1];
      if (!entry) return;
      undoStackRef.current = undoStackRef.current.slice(0, -1);
      setUndoLen(undoStackRef.current.length);
      try {
        for (const change of entry.changes) await reconcileToState(change, change.before);
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
      }
      await invalidateAll();
      redoStackRef.current = [...redoStackRef.current.slice(-(MAX_HISTORY - 1)), entry];
      setRedoLen(redoStackRef.current.length);
    });

  const redo = () =>
    enqueueAction(async () => {
      const entry = redoStackRef.current[redoStackRef.current.length - 1];
      if (!entry) return;
      redoStackRef.current = redoStackRef.current.slice(0, -1);
      setRedoLen(redoStackRef.current.length);
      try {
        for (const change of entry.changes) await reconcileToState(change, change.after);
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
      }
      await invalidateAll();
      undoStackRef.current = [...undoStackRef.current.slice(-(MAX_HISTORY - 1)), entry];
      setUndoLen(undoStackRef.current.length);
    });

  const toggleStamp = (code: ShiftCodeType) => {
    setSelectedStamp((prev) => (prev === code ? null : code));
  };

  const toggleConstraintStamp = (code: ConstraintTypeType) => {
    setSelectedConstraint((prev) => (prev === code ? null : code));
  };

  // ---- Drag-paint / drag-delete session (one combined undo entry per gesture) ----
  const dragBeforeRef = useRef<Shift[] | null>(null);
  const dragTouchedRef = useRef<Set<string>>(new Set());

  const startDragSession = () => {
    dragBeforeRef.current = queryClient.getQueryData<Shift[]>(shiftsKey) ?? shifts;
    dragTouchedRef.current = new Set();
  };

  // `isOrigin` marks the very first cell of a drag gesture (the one under
  // the finger at pointerdown). Only that cell can toggle a matching stamp
  // off (or delete on a plain tap) — cells the drag passes over afterward
  // are left alone if they already match / already empty, exactly like
  // before, so a stroke never accidentally erases cells it merely crosses.
  //
  // When no stamp is selected this paints nothing and instead deletes —
  // dragging across cells with no stamp active behaves exactly like drag
  // painting, just erasing instead of stamping.
  const cellDragAction = async (staffId: number, date: string, isOrigin = false) => {
    const key = cellKey(staffId, date);
    if (dragTouchedRef.current.has(key)) return;
    dragTouchedRef.current.add(key);
    const list = queryClient.getQueryData<Shift[]>(shiftsKey) ?? [];
    const existing = list.find((s) => s.staffId === staffId && s.date === date);

    if (modeRef.current === 'constraint') {
      return applyConstraintDragAction(existing, staffId, date, isOrigin);
    }
    return applyShiftDragAction(existing, staffId, date, isOrigin);
  };

  // Phase 1 (制約入力): the manager first picks one of the three constraint
  // modes (📌 出勤固定 / 休み / 有給) from the toolbar, then paints exactly
  // like normal 勤務入力 — tap or drag across cells to apply the selected
  // mode continuously, no picker dialog involved. A cell that already
  // carries ANY constraint is always cleared by a single tap on it,
  // regardless of which mode is currently selected — it is never switched
  // directly to a different constraint in the same gesture, so removal
  // stays predictable ("解除後は制限なしの状態に戻る"); painting a new mode
  // onto that cell is simply a second, separate tap once it's blank. Only
  // the drag's origin cell can trigger this removal; cells a stroke merely
  // passes over are left alone, so a stroke never accidentally wipes out
  // constraints it just crosses.
  const applyConstraintDragAction = async (
    existing: Shift | undefined,
    staffId: number,
    date: string,
    isOrigin: boolean,
  ) => {
    const constraintType = selectedConstraintRef.current;

    if (existing?.constraintType) {
      if (!isOrigin) return;
      try {
        const keepsCode = existing.constraintType === 'attendance' && existing.code;
        let result: Shift | null = null;
        if (keepsCode) {
          result = await updateShift.mutateAsync({ id: existing.id, data: { constraintType: null } });
        } else {
          await deleteShift.mutateAsync({ id: existing.id });
        }
        queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) => {
          const filtered = old.filter((s) => !(s.staffId === staffId && s.date === date));
          return result ? [...filtered, result] : filtered;
        });
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
      }
      return;
    }

    // Manually-locked cells (see ロック menu action, unrelated to a
    // constraint) still block constraint entry — only "ロック解除" frees them.
    if (existing?.locked) return;

    // No mode selected: nothing to paint on a blank cell.
    if (!constraintType) return;

    try {
      let result: Shift;
      if (existing) {
        result = await updateShift.mutateAsync({ id: existing.id, data: { constraintType } });
      } else {
        result = await createShift.mutateAsync({ data: { staffId, date, constraintType } });
      }
      queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) => [
        ...old.filter((s) => !(s.staffId === staffId && s.date === date)),
        result,
      ]);
    } catch {
      toast.error('エラーが発生しました', { position: 'bottom-center' });
    }
  };

  // Phase 2 (勤務入力): normal stamp painting/deleting. A 🚫/🌴 (hope_off/
  // paid_leave) cell is fully immutable and always bails out. A 📌
  // (attendance) cell allows a code to be painted on top despite being
  // locked, but never allows the drag-delete or toggle-off-by-delete paths
  // — those always require the "Remove Constraint" menu action so a
  // constraint is never lost by accident.
  const applyShiftDragAction = async (
    existing: Shift | undefined,
    staffId: number,
    date: string,
    isOrigin: boolean,
  ) => {
    const code = selectedStampRef.current;
    const isAttendance = existing?.constraintType === 'attendance';
    if (existing?.constraintType === 'hope_off' || existing?.constraintType === 'paid_leave') return;
    if (existing?.locked && !isAttendance) return;

    if (!code) {
      // Drag-delete: erase whatever is under each cell the drag touches.
      // Never allowed on a locked cell, or on an attendance-constrained
      // cell (that always requires the explicit "Remove Constraint" menu
      // action, even though attendance no longer sets `locked`).
      if (!existing || existing.locked || isAttendance) return;
      try {
        await deleteShift.mutateAsync({ id: existing.id });
        queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) =>
          old.filter((s) => !(s.staffId === staffId && s.date === date)),
        );
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
      }
      return;
    }

    // Assigning a holiday-category code (e.g. 休み) onto a 📌 cell
    // contradicts the must-work constraint — warn instead of silently
    // applying it. Only intercept the gesture's origin cell; a drag stroke
    // passing over other 📌 cells simply skips them, same as a locked cell.
    if (isAttendance && existing?.code !== code && isHolidayCode(code)) {
      if (isOrigin) setPendingConstraintWarning({ staffId, date });
      return;
    }

    if (existing?.code === code) {
      if (!isOrigin) return;
      // Tapping (or starting a drag on) a cell that already has the
      // selected stamp toggles it off instead of being a no-op. On an
      // attendance-constrained cell this only clears the code, keeping the
      // 📌 marker and lock intact; otherwise it deletes the row entirely.
      try {
        if (isAttendance) {
          const result = await updateShift.mutateAsync({ id: existing.id, data: { code: null } });
          queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) => [
            ...old.filter((s) => !(s.staffId === staffId && s.date === date)),
            result,
          ]);
        } else {
          await deleteShift.mutateAsync({ id: existing.id });
          queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) =>
            old.filter((s) => !(s.staffId === staffId && s.date === date)),
          );
        }
      } catch {
        toast.error('エラーが発生しました', { position: 'bottom-center' });
      }
      return;
    }
    try {
      let result: Shift;
      if (existing) {
        result = await updateShift.mutateAsync({ id: existing.id, data: { code } });
      } else {
        result = await createShift.mutateAsync({ data: { staffId, date, code } });
      }
      queryClient.setQueryData<Shift[]>(shiftsKey, (old = []) => [
        ...old.filter((s) => !(s.staffId === staffId && s.date === date)),
        result,
      ]);
    } catch {
      toast.error('エラーが発生しました', { position: 'bottom-center' });
    }
  };

  const endDragSession = () =>
    enqueueAction(async () => {
      const before = dragBeforeRef.current;
      dragBeforeRef.current = null;
      if (!before) return;
      await invalidateAll();
      const after = queryClient.getQueryData<Shift[]>(shiftsKey) ?? [];
      const changes = diffShiftLists(before, after);
      if (changes.length > 0) pushUndoEntry({ changes });
    });

  // ---- Long-press menu (勤務変更 / ロック / ロック解除) ----
  const [menuCell, setMenuCell] = useState<{ staffId: number; date: string } | null>(null);
  const [menuStep, setMenuStep] = useState<'root' | 'picker'>('root');
  const menuStaff = menuCell ? staffList.find((s) => s.id === menuCell.staffId) : undefined;
  const menuShift = menuCell ? shifts.find((s) => s.staffId === menuCell.staffId && s.date === menuCell.date) : undefined;
  const menuCellRef = useRef(menuCell);
  useEffect(() => {
    menuCellRef.current = menuCell;
  }, [menuCell]);

  const closeMenu = () => {
    setMenuCell(null);
    setMenuStep('root');
    // Belt-and-suspenders: whatever caused the menu to close (item tap, X
    // button, overlay tap, swipe-down, Escape), the gesture that led here
    // must already be fully torn down. Re-running the reset here guards
    // against any residual pointer/drag state so editing resumes cleanly,
    // like dismissing an iOS context menu.
    resetGestureState();
  };

  // The only way a 🚫/📌 constraint (and its automatic lock, for 🚫) is ever
  // removed — deliberately unreachable from any tap/drag/toggle path.
  const removeConstraintFromShift = (shift: Shift) => {
    void runAction(async () => {
      const keepsCode = shift.constraintType === 'attendance' && shift.code;
      if (keepsCode) {
        await updateShift.mutateAsync({ id: shift.id, data: { constraintType: null } });
      } else {
        await deleteShift.mutateAsync({ id: shift.id });
      }
    });
  };

  const applyMenuStamp = (code: ShiftCodeType) => {
    if (!menuCell) return;
    const { staffId, date } = menuCell;
    const list = queryClient.getQueryData<Shift[]>(shiftsKey) ?? shifts;
    const existing = list.find((s) => s.staffId === staffId && s.date === date);

    // Assigning a holiday-category code onto a 📌 cell via the picker menu
    // gets the same warning as the grid gesture — never silently applied.
    if (existing?.constraintType === 'attendance' && existing.code !== code && isHolidayCode(code)) {
      closeMenu();
      setPendingConstraintWarning({ staffId, date });
      return;
    }

    void runAction(async () => {
      if (existing) {
        await updateShift.mutateAsync({ id: existing.id, data: { code } });
      } else {
        await createShift.mutateAsync({ data: { staffId, date, code } });
      }
    });
    closeMenu();
  };

  const removeConstraint = () => {
    if (!menuCell || !menuShift) return;
    removeConstraintFromShift(menuShift);
    closeMenu();
  };

  // ---- Warning shown before a holiday-category code (e.g. 休み) would be
  // painted onto a 📌 (attendance) cell — offers cancel or remove-the-
  // constraint-first, never silently applies the code over the constraint.
  const [pendingConstraintWarning, setPendingConstraintWarning] = useState<{
    staffId: number;
    date: string;
  } | null>(null);

  const resolveConstraintWarning = (action: 'cancel' | 'remove') => {
    const pending = pendingConstraintWarning;
    setPendingConstraintWarning(null);
    if (action !== 'remove' || !pending) return;
    const list = queryClient.getQueryData<Shift[]>(shiftsKey) ?? shifts;
    const existing = list.find((s) => s.staffId === pending.staffId && s.date === pending.date);
    if (!existing) return;
    removeConstraintFromShift(existing);
  };

  const setMenuCellLocked = (locked: boolean) => {
    if (!menuCell) return;
    const { staffId, date } = menuCell;
    const list = queryClient.getQueryData<Shift[]>(shiftsKey) ?? shifts;
    const existing = list.find((s) => s.staffId === staffId && s.date === date);
    if (!existing) return;
    void runAction(async () => {
      await updateShift.mutateAsync({ id: existing.id, data: { locked } });
    });
    closeMenu();
  };

  // ---- Pointer handling for the schedule grid: paint/drag, tap-to-delete,
  // and long-press-to-open-menu. Kept off the header/avatar/toolbar so those
  // regions never zoom, scroll, or respond to painting gestures. ----
  const activePointersRef = useRef<Set<number>>(new Set());
  const pointerStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    staffId: number;
    date: string;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    moved: boolean;
  } | null>(null);

  // Fully tears down whatever gesture is (or was) in flight: cancels any
  // pending long-press timer, releases pointer capture so no stray future
  // events get routed to the grid, clears the tracked pointer set, and
  // finalizes (or discards) any in-progress drag session. Called the
  // instant a long press fires (menu opening must never leave a gesture
  // active), whenever a second finger lands (pinch must never edit), and
  // again whenever the menu closes, so editing always resumes in a clean,
  // neutral state — independent of pinch zoom or stamp selection, which
  // are tracked separately and untouched here.
  //
  // No tap/drag action is ever applied at pointerdown — only once real
  // movement confirms a drag, or on release with no movement confirms a
  // tap — so a cancelled gesture (long press, or a second finger landing)
  // never leaves behind a partial edit to undo.
  const resetGestureState = () => {
    const state = pointerStateRef.current;
    if (state?.longPressTimer) clearTimeout(state.longPressTimer);
    if (state && bodyRef.current) {
      try {
        if (bodyRef.current.hasPointerCapture(state.pointerId)) {
          bodyRef.current.releasePointerCapture(state.pointerId);
        }
      } catch {
        // Pointer may already be released/gone — nothing to clean up.
      }
    }
    pointerStateRef.current = null;
    activePointersRef.current.clear();
    if (dragBeforeRef.current) {
      void endDragSession();
    } else {
      dragTouchedRef.current = new Set();
    }
  };

  const resolveCell = (clientX: number, clientY: number) => {
    const el = bodyRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop;
    const colIndex = Math.floor(x / colWidthRef.current);
    const rowIndex = Math.floor(y / rowHeightRef.current);
    const days = daysInMonthRef.current;
    const staffs = staffListRef.current;
    if (colIndex < 0 || colIndex >= days.length || rowIndex < 0 || rowIndex >= staffs.length) {
      return null;
    }
    return { staffId: staffs[rowIndex].id, date: format(days[colIndex], 'yyyy-MM-dd') };
  };

  // Gesture priority: (1) a second finger landing always wins and cancels
  // everything below; (2) a long press that fires before any movement wins
  // and cancels the pending tap/drag outright — no tap action ever leaks
  // through; (3) real movement before the long-press timer fires commits
  // to a drag; (4) release with no movement and no long press is a plain
  // tap, applied once on release.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (menuCellRef.current) return;
    activePointersRef.current.add(e.pointerId);
    if (activePointersRef.current.size > 1) {
      // A second finger means pinch-zoom, not editing. Cancel whatever the
      // first finger was doing; nothing has been applied yet (see below),
      // so there is nothing to undo.
      resetGestureState();
      return;
    }
    const cell = resolveCell(e.clientX, e.clientY);
    if (!cell) return;
    // Pointer capture is only taken when 連続入力 is ON. Capturing keeps
    // delivering move events to this element even once the finger leaves
    // its bounds, which is exactly what continuous drag-paint needs — but
    // it also defeats native touch scrolling. When OFF, skipping capture
    // lets the browser take over panning as soon as it recognizes a scroll
    // gesture (see the `touchAction` on the grid content below), so the
    // grid scrolls normally and only a plain tap (no capture needed) edits.
    if (continuousInputEnabledRef.current) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Nothing is applied here at pointerdown. We don't yet know whether
    // this gesture will resolve to a long press (open the menu, no tap),
    // a drag (paint/delete along the path), or a plain tap (apply once on
    // release) — applying anything now would let a long press "leak" a
    // tap action before the menu opens.
    const timer = setTimeout(() => {
      // Long press wins outright: no tap or drag action has been applied
      // yet (see above), so cancelling here means the tap truly never
      // executes — only the menu opens.
      setMenuStep('root');
      setMenuCell({ staffId: cell.staffId, date: cell.date });
      resetGestureState();
    }, LONG_PRESS_MS);
    pointerStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      staffId: cell.staffId,
      date: cell.date,
      longPressTimer: timer,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Two or more fingers on the screen means the user is pinch-zooming —
    // editing must be fully suppressed for the whole gesture, even for the
    // pointer that started this one before the second finger landed.
    if (activePointersRef.current.size > 1) return;
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
      state.moved = true;
      // Real movement — before the long-press timer fired — always cancels
      // the long press, regardless of 連続入力. Otherwise a slow drag with
      // 連続入力 OFF (which, below, applies no painting on move) would still
      // let the timer fire mid-drag and pop the long-press menu, which must
      // never happen for a gesture that's already moving.
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
      // Only start a paint/delete drag session when 連続入力 is ON. When
      // OFF, movement still marks the gesture as "moved" (so finishPointer
      // below never treats it as a tap), but nothing is painted — the
      // gesture is left to become a normal scroll instead.
      if (continuousInputEnabledRef.current) {
        startDragSession();
        void cellDragAction(state.staffId, state.date, true);
      }
    }
    if (!state.moved || !continuousInputEnabledRef.current) return;
    const cell = resolveCell(e.clientX, e.clientY);
    if (cell) void cellDragAction(cell.staffId, cell.date);
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    pointerStateRef.current = null;
    if (state.moved) {
      // A real drag happened; finalize whatever was painted/deleted along
      // the path as one undo entry.
      void endDragSession();
    } else {
      // No movement, and the long-press timer never fired first — this is
      // a plain tap. Apply the origin cell's action now, as a one-cell
      // drag session so it goes through the exact same undo/toggle logic.
      startDragSession();
      void cellDragAction(state.staffId, state.date, true).then(() => endDragSession());
    }
  };

  // Fires when the browser cancels the pointer instead of delivering a
  // normal pointerup — most commonly because 連続入力 is OFF and the
  // browser just took over the gesture as a native scroll. Nothing was
  // ever applied for an unmoved/undragged gesture (see handlePointerDown),
  // so a cancel must never be treated as a tap; just tear the gesture down.
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    const state = pointerStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    resetGestureState();
  };

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = e.currentTarget;
    if (headerTrackRef.current) headerTrackRef.current.style.transform = `translateX(-${scrollLeft}px)`;
    if (avatarTrackRef.current) avatarTrackRef.current.style.transform = `translateY(-${scrollTop}px)`;
    if (remarksTrackRef.current) remarksTrackRef.current.style.transform = `translateX(-${scrollLeft}px)`;
  };

  const summaryByStaffId = new Map((summary?.staff ?? []).map((s) => [s.staffId, s]));

  // 月末チェック: 〇マーク（東町担当）の日に夜勤が組まれているかを確認する。
  // eastUnitId が null の場合（東町ユニット未登録）はチェックをスキップ。
  const missingNightShiftDays = useMemo(() => {
    if (!eastUnitId) return [];
    return daysInMonth
      .map((day) => format(day, 'yyyy-MM-dd'))
      .filter((dateStr) => ownershipByDate.get(dateStr) === eastUnitId)
      .filter(
        (dateStr) =>
          !shifts.some((s) => s.date === dateStr && s.code != null && nightShiftCodes.has(s.code)),
      );
  }, [daysInMonth, ownershipByDate, eastUnitId, shifts, nightShiftCodes]);

  const gridWidth = colWidth * daysInMonth.length;
  const gridHeight = rowHeight * staffList.length;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-2 pt-1.5 pb-1 shrink-0 landscape:pt-1 landscape:pb-0.5">
        {/* 1行: 左右固定 + 中央 flex-1 でオーバーラップなし */}
        <div className="flex items-center h-9 gap-0.5">
          {/* 左: 集計・備考 */}
          <div className="flex items-center gap-0.5 flex-none">
            <button
              onClick={() => setSummaryOpen(true)}
              className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg active:scale-95 transition-transform text-gray-600"
              aria-label="月間集計を表示"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setRemarksVisible((v) => !v)}
              aria-label="備考の表示切替"
              aria-pressed={remarksVisible}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-lg active:scale-95 transition-transform',
                remarksVisible ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600',
              )}
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </div>

          {/* 中央: 月ナビ（flex-1 の中でセンター揃え） */}
          <div className="flex-1 flex items-center justify-center gap-0.5 min-w-0">
            <button
              onClick={prevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg active:scale-95 transition-transform text-gray-500 flex-none"
              aria-label="前の月"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h1 className="text-base font-bold text-gray-900 leading-none whitespace-nowrap">
              {format(currentMonth, 'yyyy年M月', { locale: ja })}
            </h1>
            <button
              onClick={nextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg active:scale-95 transition-transform text-gray-500 flex-none"
              aria-label="次の月"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 右: 操作系 */}
          <div className="flex items-center gap-0.5 flex-none">
            <button
              onClick={undo}
              disabled={undoLen === 0}
              aria-label="元に戻す"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 active:scale-95 transition-transform disabled:opacity-30 text-gray-700"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={redo}
              disabled={redoLen === 0}
              aria-label="やり直す"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 active:scale-95 transition-transform disabled:opacity-30 text-gray-700"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setContinuousInputEnabled((v) => !v)}
              aria-label="連続入力"
              aria-pressed={continuousInputEnabled}
              className={cn(
                'h-8 px-1.5 flex items-center justify-center gap-0.5 rounded-lg active:scale-95 transition-transform text-[10px] font-bold',
                continuousInputEnabled ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600',
              )}
            >
              <Move className="w-3 h-3" />
              連続
            </button>
            <button
              onClick={() => setResetConfirmOpen(true)}
              aria-label="シフトをリセット"
              title="シフトをリセット（制約・備考・夜勤担当は保持）"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 active:scale-95 transition-transform text-rose-500"
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>
        </div>

        {continuousInputEnabled && (
          <div className="mt-0.5 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold flex items-center gap-1">
            <Move className="w-3 h-3" />
            連続入力中 — ドラッグで連続して入力・削除します
          </div>
        )}
      </div>

      {/* Frozen-pane grid: header row and avatar column stay fixed; only the
          body (schedule cells) scrolls, pinch-zooms, and handles taps/drags. */}
      <div className="flex-1 relative overflow-hidden bg-gray-50/30">
        {/* Corner (blank, always fixed) */}
        <div
          className="absolute top-0 left-0 z-30 bg-white border-b border-r border-gray-200 flex flex-col"
          style={{ width: AVATAR_COL_WIDTH, height: TOTAL_HEADER_HEIGHT }}
        >
          {/* Upper section — aligns with date header row */}
          <div style={{ height: HEADER_HEIGHT }} />

          {/* Lower section — aligns with night duty ownership row */}
          <div
            className="border-t border-gray-100 flex items-center justify-between"
            style={{ height: OWNERSHIP_ROW_HEIGHT, padding: '1px 2px' }}
          >
            {/* ○ / □ / ❌ counts */}
            <div className="flex flex-col leading-none gap-px" style={{ fontSize: 7 }}>
              <span className="font-bold text-emerald-600">○{nightDutyCircleCount}</span>
              <span className="text-gray-400">□{nightDutyBlankCount}</span>
            </div>
            <div className="flex flex-col items-end leading-none gap-px" style={{ fontSize: 7 }}>
              <span className="text-red-400">❌{nightDutyCrossCount}</span>
              <button
                onClick={() => setOwnershipEditMode((v) => !v)}
                aria-label="夜勤担当編集"
                title="夜勤担当編集"
                className={cn(
                  'w-3 h-3 flex items-center justify-center rounded',
                  ownershipEditMode ? 'bg-indigo-600 text-white' : 'text-gray-400',
                )}
              >
                <Pencil className="w-2 h-2" />
              </button>
            </div>
          </div>
        </div>

        {/* Date header + Night Duty Ownership row — follow horizontal scroll only */}
        <div
          className="absolute top-0 z-20 overflow-hidden bg-white border-b border-gray-200"
          style={{ left: AVATAR_COL_WIDTH, right: 0, height: TOTAL_HEADER_HEIGHT }}
        >
          <div ref={headerTrackRef} className="flex flex-col" style={{ willChange: 'transform' }}>
            <div className="flex" style={{ height: HEADER_HEIGHT }}>
              {daysInMonth.map((day) => {
                const isSunday = day.getDay() === 0;
                const isSaturday = day.getDay() === 6;
                // Understaffed-day coloring: red = critical (0 staff on a
                // required shift), yellow = borderline (short but nonzero,
                // or over a max), derived only from staffing_count facility
                // rules — never from the other rule types.
                const severity = staffingSeverityByDate.get(format(day, 'yyyy-MM-dd'));
                return (
                  <div
                    key={day.toString()}
                    className={cn(
                      'flex-shrink-0 border-r border-gray-200 flex items-center justify-center',
                      severity === 'critical'
                        ? 'bg-red-100'
                        : severity === 'warning'
                          ? 'bg-yellow-100'
                          : '',
                      severity === 'critical'
                        ? 'text-red-700'
                        : severity === 'warning'
                          ? 'text-yellow-800'
                          : isSunday
                            ? 'text-red-500'
                            : isSaturday
                              ? 'text-blue-500'
                              : 'text-gray-600',
                    )}
                    style={{ width: colWidth, height: HEADER_HEIGHT }}
                  >
                    <div className="font-bold text-[10px] leading-tight whitespace-nowrap">
                      {format(day, 'd')}
                      <span className="font-medium opacity-70">
                        {format(day, 'E', { locale: ja })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex border-t border-gray-100" style={{ height: OWNERSHIP_ROW_HEIGHT }}>
              {daysInMonth.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const unitId = ownershipByDate.get(dateStr) ?? null;
                const marker = unitId === null ? '' : unitId === eastUnitId ? '○' : '❌';
                return (
                  <button
                    key={day.toString()}
                    onClick={() => cycleNightDutyOwnership(dateStr)}
                    disabled={!ownershipEditMode}
                    className={cn(
                      'flex-shrink-0 border-r border-gray-100 flex items-center justify-center text-[13px] font-extrabold',
                      ownershipEditMode ? 'bg-indigo-50/60 active:bg-indigo-100' : '',
                      unitId === eastUnitId ? 'text-emerald-600' : 'text-red-500',
                    )}
                    style={{
                      width: colWidth,
                      height: OWNERSHIP_ROW_HEIGHT,
                      WebkitTextStroke: marker === '○' ? '0.5px currentColor' : undefined,
                    }}
                  >
                    {marker}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Avatar column — follows vertical scroll only, never zooms */}
        <div
          className="absolute left-0 z-20 overflow-hidden bg-white border-r border-gray-200"
          style={{ top: TOTAL_HEADER_HEIGHT, bottom: 0, width: AVATAR_COL_WIDTH }}
        >
          <div ref={avatarTrackRef} style={{ willChange: 'transform' }}>
            {staffLoading || staffList.length === 0 ? (
              <div />
            ) : (
              staffList.map((staff) => (
                <div
                  key={staff.id}
                  className="flex items-center justify-center border-b border-gray-200"
                  style={{ height: rowHeight }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: staff.color }}
                    title={staff.name}
                  >
                    {avatarLabels.get(staff.id)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Schedule body — the only scrollable, pinch-zoomable, paintable region */}
        <div
          ref={bodyRef}
          className="absolute overflow-auto"
          style={{
            top: TOTAL_HEADER_HEIGHT,
            left: AVATAR_COL_WIDTH,
            right: 0,
            bottom: 0,
            // Native panning is only ever allowed here as a fallback for a
            // drag that starts outside the actual grid content (see the
            // content wrapper below, sized to gridWidth/gridHeight, which
            // always wins with `touchAction: 'none'` once a drag starts on
            // a real cell). Editing gestures — paint or delete — must
            // always take priority over scrolling.
            touchAction: 'pan-x pan-y',
          }}
          onScroll={handleBodyScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={handlePointerCancel}
        >
          {staffLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">読み込み中...</div>
          ) : staffList.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">スタッフがいません</div>
          ) : (
            <div
              style={{
                width: gridWidth,
                height: gridHeight,
                // 連続入力 ON: block native panning entirely so every move
                // event reaches our drag-paint logic instead of the browser
                // hijacking it as a scroll. OFF: allow the same panning the
                // outer scroller allows, so a real drag becomes a normal
                // scroll instead of getting stuck.
                touchAction: continuousInputEnabled ? 'none' : 'pan-x pan-y',
              }}
            >
              {staffList.map((staff) => (
                <div key={staff.id} className="flex" style={{ height: rowHeight }}>
                  {daysInMonth.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const existing = shifts.find(
                      (s) => s.staffId === staff.id && s.date === dateStr,
                    );
                    return (
                      <div
                        key={day.toString()}
                        className="flex-shrink-0 border-b border-r border-gray-200 bg-white p-0.5 select-none relative"
                        style={{ width: colWidth, height: rowHeight }}
                      >
                        {existing?.code ? (
                          <div
                            className={cn(
                              'w-full h-full rounded flex items-center justify-center font-black transition-transform',
                              existing.constraintType === 'attendance' && 'ring-2 ring-blue-500',
                              (existing.constraintType === 'hope_off' ||
                                existing.constraintType === 'paid_leave') &&
                                OFF_DAY_CONSTRAINT_INFO[existing.constraintType].ringClassName,
                            )}
                            style={{
                              fontSize: cellFontSize,
                              backgroundColor: shiftTypeByCode.get(existing.code)?.bgColor ?? '#e5e7eb',
                              color: shiftTypeByCode.get(existing.code)?.textColor ?? '#000000',
                            }}
                          >
                            {shiftTypeByCode.get(existing.code)?.shortLabel ?? existing.code}
                            {existing.constraintType === 'attendance' ? (
                              <span className="absolute -top-1 -left-1 text-[10px] leading-none drop-shadow">
                                📌
                              </span>
                            ) : existing.constraintType === 'hope_off' || existing.constraintType === 'paid_leave' ? (
                              <span className="absolute -top-1 -left-1 text-[10px] leading-none drop-shadow">
                                {OFF_DAY_CONSTRAINT_INFO[existing.constraintType].emoji}
                              </span>
                            ) : (
                              existing.locked && (
                                <Lock className="absolute top-0 right-0 w-2.5 h-2.5 drop-shadow" />
                              )
                            )}
                          </div>
                        ) : existing?.constraintType === 'attendance' ? (
                          // Blank 出勤 constraint: locked with no shift assigned yet.
                          <div
                            className="w-full h-full rounded flex items-center justify-center font-black transition-transform border-2 border-blue-400 bg-white text-blue-500"
                            style={{ fontSize: cellFontSize }}
                          >
                            📌
                          </div>
                        ) : (
                          <div className="w-full h-full rounded transition-colors flex items-center justify-center">
                            <div className="w-1 h-1 rounded-full bg-gray-100" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 備考 row — one free-text field per date, aligned to the date
          columns above. Purely a display toggle: hiding it never discards
          already-saved text, since the fields keep their saved value and
          simply stop rendering. */}
      {remarksVisible && (
        <div
          className="flex shrink-0 border-t border-gray-100 bg-amber-50/40"
          style={{ height: remarksRowHeight }}
        >
          <div
            className="flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-amber-600"
            style={{ width: AVATAR_COL_WIDTH }}
          >
            備考
          </div>
          <div className="flex-1 overflow-hidden">
            <div ref={remarksTrackRef} className="flex" style={{ willChange: 'transform' }}>
              {daysInMonth.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const value = remarksByDate.get(dateStr) ?? '';
                const entries = remarkEntries(value);
                return (
                  <button
                    key={day.toString()}
                    type="button"
                    onClick={() => openRemarksDrawer(dateStr)}
                    aria-label={`${format(day, 'M月d日')}の備考${entries.length ? `: ${entries.join(' / ')}` : 'を追加'}`}
                    className="flex-shrink-0 flex items-center justify-center gap-[1px] border-r border-amber-100 bg-transparent active:bg-amber-100/60"
                    style={{ width: colWidth, height: remarksRowHeight, padding: '2px 0' }}
                  >
                    {entries.map((entry, i) => (
                      <span
                        key={i}
                        className="text-[10px] leading-none text-gray-700 whitespace-nowrap overflow-y-auto"
                        style={{
                          writingMode: 'vertical-rl',
                          textOrientation: 'upright',
                          maxHeight: remarksRowHeight - 4,
                        }}
                      >
                        {entry}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 備考編集 — タップした日の備考を横書きで入力し、表示時は自動で縦書き
          （最大2列）に変換される。行を改行すると2つ目の列になる。 */}
      <Drawer.Root open={!!remarksDrawerDate} onOpenChange={(open) => !open && closeRemarksDrawer(true)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[70dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-4" />
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-gray-900">
                  {remarksDrawerDate &&
                    format(new Date(`${remarksDrawerDate}T00:00:00`), 'M月d日(E)の備考', { locale: ja })}
                </h2>
                <button
                  onClick={() => closeRemarksDrawer(true)}
                  className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <textarea
                autoFocus
                value={remarksDrawerText}
                onChange={(e) => setRemarksDrawerText(e.target.value)}
                placeholder={'例）ユニット会議\nD残り'}
                rows={3}
                className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-800 outline-none focus:border-amber-400 resize-none"
              />
              <p className="mt-2 text-xs text-gray-400">
                改行すると2つの項目として並べて表示されます（表示は最大2列まで）。
              </p>
              <div className="mt-4 flex gap-2">
                {remarksDrawerText.length > 0 && (
                  <button
                    onClick={() => setRemarksDrawerText('')}
                    className="px-4 py-2.5 rounded-xl bg-red-50 font-bold text-red-600 active:bg-red-100"
                  >
                    削除
                  </button>
                )}
                <button
                  onClick={() => closeRemarksDrawer(true)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 font-bold text-white active:bg-amber-600"
                >
                  保存
                </button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Mode bar — 制約入力 (Phase 1) always precedes 勤務入力 (Phase 2).
          制約入力完了 guides the manager forward once constraints are set. */}
      <div className="px-2 pt-1 shrink-0 border-t border-gray-100">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5 flex-1">
            <button
              onClick={() => switchMode('constraint')}
              className={cn(
                'flex-1 h-6 rounded text-[11px] font-bold transition-colors',
                mode === 'constraint' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
              )}
            >
              1. 制約入力
            </button>
            <button
              onClick={() => switchMode('shift')}
              className={cn(
                'flex-1 h-6 rounded text-[11px] font-bold transition-colors',
                mode === 'shift' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500',
              )}
            >
              2. 勤務入力
            </button>
          </div>
          {mode === 'constraint' && (
            <button
              onClick={() => switchMode('shift')}
              className="h-6 px-2.5 rounded-md bg-[hsl(var(--primary))] text-white text-[11px] font-bold active:scale-95 transition-transform flex-shrink-0"
            >
              制約入力完了
            </button>
          )}
        </div>
      </div>

      {/* Stamp toolbar — fixed, docked above the bottom nav, scrolls
          independently and holds the persistent "paint mode" selection. The
          three constraint modes (📌 出勤固定 / 休み / 有給) show in Phase 1,
          and only the normal shift stamps show in Phase 2, so the wrong
          kind of stamp can never be selected by accident. Once a mode is
          picked, tapping/dragging the grid paints it exactly like Phase
          2 — there is no separate picker dialog. */}
      <div className="px-2 py-1 shrink-0">
        <div className="flex flex-nowrap gap-1 overflow-x-auto">
          {mode === 'constraint'
            ? [
                ...CONSTRAINT_STAMPS.map((stamp) => {
                  const isSelected = selectedConstraint === stamp.code;
                  return (
                    <button
                      key={stamp.code}
                      onClick={() => toggleConstraintStamp(stamp.code)}
                      className={cn(
                        'flex-shrink-0 min-w-[64px] h-7 px-2 rounded-md font-black text-[11px] flex items-center justify-center gap-1 active:scale-95 transition-all',
                        stamp.className,
                        isSelected
                          ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-1 scale-105'
                          : 'opacity-90',
                      )}
                    >
                      <span>{stamp.emoji}</span>
                      <span>{stamp.label}</span>
                    </button>
                  );
                })]
            : shiftTypes.map((stamp) => {
                const isSelected = selectedStamp === stamp.code;
                return (
                  <button
                    key={stamp.code}
                    onClick={() => toggleStamp(stamp.code)}
                    className={cn(
                      'flex-shrink-0 min-w-[30px] h-7 px-1.5 rounded-md font-black text-[11px] flex items-center justify-center active:scale-95 transition-all border border-gray-300',
                      isSelected
                        ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-1 scale-105'
                        : 'opacity-90',
                    )}
                    style={{ backgroundColor: stamp.bgColor, color: stamp.textColor }}
                  >
                    {stamp.shortLabel}
                  </button>
                );
              })}
        </div>
      </div>

      {/* Long-press menu: 勤務変更 / ロック / ロック解除 */}
      <Drawer.Root open={!!menuCell} onOpenChange={(open) => !open && closeMenu()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[70dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-900">
                  {menuStaff?.name} ・{' '}
                  {menuCell && format(new Date(`${menuCell.date}T00:00:00`), 'M月d日(E)', { locale: ja })}
                </h2>
                <button onClick={closeMenu} className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {menuStep === 'root' ? (
                <div className="flex flex-col gap-2">
                  {/* 🚫/🌴 (hope_off/paid_leave) are fully immutable: 勤務変更/
                      ロック are never offered, only the dedicated removal
                      action below. */}
                  {menuShift?.constraintType !== 'hope_off' &&
                    menuShift?.constraintType !== 'paid_leave' &&
                    (!menuShift?.locked || menuShift?.constraintType === 'attendance') && (
                      <button
                        onClick={() => setMenuStep('picker')}
                        className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 font-bold text-gray-800 active:bg-gray-100"
                      >
                        勤務変更
                      </button>
                    )}
                  {menuShift && !menuShift.locked && !menuShift.constraintType && (
                    <button
                      onClick={() => setMenuCellLocked(true)}
                      className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 font-bold text-gray-800 active:bg-gray-100 flex items-center gap-2"
                    >
                      <Lock className="w-4 h-4" /> ロック
                    </button>
                  )}
                  {menuShift?.locked && !menuShift.constraintType && (
                    <button
                      onClick={() => setMenuCellLocked(false)}
                      className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 font-bold text-gray-800 active:bg-gray-100 flex items-center gap-2"
                    >
                      <LockOpen className="w-4 h-4" /> ロック解除
                    </button>
                  )}
                  {/* Once 勤務入力 (Phase 2) begins, every remaining constraint is
                      protected: 🚫/🌴 cannot be edited or removed at all, and 📌
                      cannot be removed (only its code may still be painted on
                      top). Removal is only ever offered back in 制約入力 (Phase 1),
                      and — like the direct one-tap grid gesture — needs no
                      confirmation beyond this deliberate menu action. */}
                  {menuShift?.constraintType && mode === 'constraint' && (
                    <button
                      onClick={removeConstraint}
                      className="w-full text-left px-4 py-3 rounded-xl bg-red-50 font-bold text-red-600 active:bg-red-100 flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      制約を削除（
                      {menuShift.constraintType === 'attendance'
                        ? '📌 出勤'
                        : `${OFF_DAY_CONSTRAINT_INFO[menuShift.constraintType].emoji} ${OFF_DAY_CONSTRAINT_INFO[menuShift.constraintType].label}`}
                      ）
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {shiftTypes.map((stamp) => (
                    <button
                      key={stamp.code}
                      onClick={() => applyMenuStamp(stamp.code)}
                      className="h-12 rounded-xl font-black text-sm flex items-center justify-center active:scale-95 transition-transform border border-gray-300"
                      style={{ backgroundColor: stamp.bgColor, color: stamp.textColor }}
                    >
                      {stamp.shortLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Warning shown when a holiday-category code would land on a 📌 cell —
          never applied silently; the manager must cancel or remove the
          constraint first. */}
      <Drawer.Root
        open={!!pendingConstraintWarning}
        onOpenChange={(open) => !open && resolveConstraintWarning('cancel')}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[70]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[70]">
            <div className="p-5 bg-white rounded-t-[20px] pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-4" />
              <h2 className="text-base font-bold text-gray-900 mb-1">📌 出勤の制約があります</h2>
              <p className="text-sm text-gray-500 mb-5">
                このセルには「出勤」の制約が設定されています。休みのシフトを重ねて設定することはできません。
              </p>
              <div className="flex flex-col gap-2 pb-4">
                <button
                  onClick={() => resolveConstraintWarning('remove')}
                  className="w-full py-3 rounded-xl bg-red-50 font-bold text-red-600 active:bg-red-100"
                >
                  制約を削除する
                </button>
                <button
                  onClick={() => resolveConstraintWarning('cancel')}
                  className="w-full py-3 rounded-xl bg-gray-50 font-bold text-gray-700 active:bg-gray-100"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root open={summaryOpen} onOpenChange={setSummaryOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-white flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-[60] max-h-[85dvh]">
            <div className="p-4 bg-white rounded-t-[20px] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-200 mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  {format(currentMonth, 'yyyy年M月', { locale: ja })}の月間集計
                </h2>
                <button
                  onClick={() => setSummaryOpen(false)}
                  className="p-2 -m-2 text-gray-400 bg-gray-50 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-bold text-gray-400 pb-2 pr-2">
                        スタッフ
                      </th>
                      {SUMMARY_ROWS.map((row) => (
                        <th
                          key={row.key}
                          className="text-center text-xs font-bold text-gray-400 pb-2 px-1"
                        >
                          {row.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staffList.map((staff) => {
                      const staffSummary = summaryByStaffId.get(staff.id);
                      return (
                        <tr key={staff.id} className="border-t border-gray-100">
                          <td className="py-2 pr-2 font-bold text-gray-800 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                                style={{ backgroundColor: staff.color }}
                              >
                                {avatarLabels.get(staff.id)}
                              </div>
                              <span>{staff.name}</span>
                            </div>
                          </td>
                          {SUMMARY_ROWS.map((row) => (
                            <td key={row.key} className="text-center py-2 px-1 text-gray-900">
                              {staffSummary ? staffSummary.shiftCounts[row.key] : 0}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 月末チェック: 〇の日に夜勤が入っているか */}
              {eastUnitId && (
                <div className="mt-5">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                    月末チェック
                  </h3>
                  <div
                    className={cn(
                      'flex items-start gap-2.5 rounded-xl px-3.5 py-3',
                      missingNightShiftDays.length === 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700',
                    )}
                  >
                    {missingNightShiftDays.length === 0 ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span className="text-sm font-medium">
                          〇の全ての日に夜勤が入っています
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <p className="font-medium mb-1">
                            夜勤未入力の〇日が {missingNightShiftDays.length} 日あります
                          </p>
                          <p className="text-xs leading-relaxed text-rose-600">
                            {missingNightShiftDays
                              .map((d) => format(new Date(d + 'T00:00:00'), 'M/d(E)', { locale: ja }))
                              .join('・')}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* リセット確認ダイアログ */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>シフトをリセット</AlertDialogTitle>
            <AlertDialogDescription>
              {format(currentMonth, 'yyyy年M月', { locale: ja })} の入力済みシフトをすべて削除します。
              <br />
              <span className="font-medium text-foreground">
                希望休・有休・固定勤務・夜勤担当・備考は保持されます。
              </span>
              <br />
              この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => {
                resetShiftMonth.mutate(
                  { data: { month: monthStr } },
                  {
                    onSuccess: (result) => {
                      queryClient.invalidateQueries({ queryKey: shiftsKey });
                      toast.success(
                        `${result.deletedCount} 件のシフトをリセットしました`,
                        { position: 'bottom-center' },
                      );
                    },
                    onError: () => {
                      toast.error('リセットに失敗しました', { position: 'bottom-center' });
                    },
                  },
                );
              }}
            >
              リセットする
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
