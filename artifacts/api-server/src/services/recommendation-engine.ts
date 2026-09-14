import { and, asc, gte, lt } from "drizzle-orm";
import {
  db,
  scheduleSettingsTable,
  shiftsTable,
  shiftTypesTable,
  staffTable,
  type ScheduleSettings,
  type Shift,
  type Staff,
} from "@workspace/db";
import { computeFacilityRuleRecommendations } from "./facility-rule-engine";

// Heuristic, prototype-quality recommendation engine. It only *reads* the
// schedule and settings and returns structured findings — it never edits a
// shift or auto-fixes anything (that's explicitly out of scope for this
// phase). Each `evaluate*` function is independent and pure-ish (only
// reads its arguments/DB), so new rules can be added without touching the
// existing ones.

export type RecommendationSeverity = "info" | "warning" | "critical";
export type RecommendationType =
  | "consecutive_work"
  | "days_off"
  | "night_balance"
  | "shift_balance"
  | "required_work_pending"
  | "facility_rule"
  | "available_shift_violation";

export interface Recommendation {
  severity: RecommendationSeverity;
  type: RecommendationType;
  message: string;
  staffId?: number;
  // Set on "facility_rule" findings.
  date?: string;
  ruleId?: number;
}

function monthBounds(month: string): { start: Date; end: Date; daysInMonth: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { start, end, daysInMonth };
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface ShiftTypeMeta {
  id: number;
  code: string;
  category: string;
  countsAsConsecutiveWork: boolean;
  canAiAutoAssign: boolean;
  includeInMonthlyStats: boolean;
  constraintOnly: boolean;
  balanceTolerance: number;
}

/**
 * Returns true when a staff member is eligible for a given shift type.
 * null/empty availableShiftTypeIds means "no restriction — all shifts OK".
 */
function staffCanDoShiftType(staff: Staff, shiftTypeId: number): boolean {
  const allowed = staff.availableShiftTypeIds;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(shiftTypeId);
}

function evaluateConsecutiveWork(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
  shiftTypeByCode: Map<string, ShiftTypeMeta>,
  settings: ScheduleSettings,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  const isWorkDay = (shift: Shift | undefined): boolean => {
    if (!shift?.code) return false;
    const type = shiftTypeByCode.get(shift.code);
    if (!type) return false;
    if (type.category === "after_night" && !settings.countNightAfterAsConsecutive) return false;
    return type.countsAsConsecutiveWork;
  };

  for (const member of staff) {
    const shifts = shiftsByStaff.get(member.id) ?? [];
    const byDate = new Map(shifts.map((s) => [s.date, s]));
    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) continue;

    let runStart: string | null = null;
    let runLength = 0;
    let prevDate: string | null = null;

    const flushRun = (endDate: string) => {
      if (runStart && runLength > settings.maxConsecutiveWorkDays) {
        recommendations.push({
          severity: runLength - settings.maxConsecutiveWorkDays >= 2 ? "critical" : "warning",
          type: "consecutive_work",
          staffId: member.id,
          message: `${member.name}さんが${runStart}〜${endDate}の${runLength}連勤になっています（上限${settings.maxConsecutiveWorkDays}日）。`,
        });
      }
      runStart = null;
      runLength = 0;
    };

    for (const date of dates) {
      const shift = byDate.get(date);
      const working = isWorkDay(shift);
      if (working) {
        if (prevDate && isConsecutiveDay(prevDate, date) && runStart) {
          runLength += 1;
        } else {
          runStart = date;
          runLength = 1;
        }
      } else if (prevDate) {
        flushRun(prevDate);
      }
      prevDate = date;
    }
    if (prevDate) flushRun(prevDate);
  }

  return recommendations;
}

function isConsecutiveDay(prev: string, next: string): boolean {
  const prevDate = new Date(`${prev}T00:00:00Z`);
  const nextDate = new Date(`${next}T00:00:00Z`);
  return nextDate.getTime() - prevDate.getTime() === 86_400_000;
}

function evaluateDaysOff(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
  shiftTypeByCode: Map<string, ShiftTypeMeta>,
  settings: ScheduleSettings,
  daysInMonth: number,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  const isDayOff = (shift: Shift | undefined): boolean => {
    if (!shift?.code) return true;
    const type = shiftTypeByCode.get(shift.code);
    if (!type) return true;
    return type.category === "holiday";
  };

  for (const member of staff) {
    const shifts = shiftsByStaff.get(member.id) ?? [];
    const byDate = new Map(shifts.map((s) => [s.date, s]));
    // Days with no shift row at all count as days off too, same as a
    // holiday-category shift.
    const daysOff =
      [...byDate.values()].filter(isDayOff).length + (daysInMonth - byDate.size);

    if (daysOff < settings.minDaysOffPerMonth) {
      recommendations.push({
        severity: settings.minDaysOffPerMonth - daysOff >= 3 ? "critical" : "warning",
        type: "days_off",
        staffId: member.id,
        message: `${member.name}さんの今月の休日数が${daysOff}日です（目安${settings.minDaysOffPerMonth}日以上）。`,
      });
    }
  }

  return recommendations;
}

function evaluateNightBalance(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
  shiftTypeByCode: Map<string, ShiftTypeMeta>,
  settings: ScheduleSettings,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const includedIds = settings.nightBalanceStaffIds;

  // Collect all night_shift type IDs so we can check staff availability
  const nightShiftTypeIds = [...shiftTypeByCode.values()]
    .filter((t) => t.category === "night_shift")
    .map((t) => t.id);

  for (const member of staff) {
    // Skip if excluded by the manual nightBalanceStaffIds setting
    if (includedIds && !includedIds.includes(member.id)) continue;

    // Skip if this staff member is not eligible for any night shift type
    const canDoNightShift = nightShiftTypeIds.some((id) => staffCanDoShiftType(member, id));
    if (!canDoNightShift) continue;

    const shifts = shiftsByStaff.get(member.id) ?? [];
    const nightCount = shifts.filter((s) => {
      if (!s.code) return false;
      return shiftTypeByCode.get(s.code)?.category === "night_shift";
    }).length;

    const diff = nightCount - settings.nightShiftTarget;
    if (Math.abs(diff) > settings.nightShiftTolerance) {
      recommendations.push({
        severity: Math.abs(diff) >= settings.nightShiftTolerance + 2 ? "critical" : "warning",
        type: "night_balance",
        staffId: member.id,
        message: `${member.name}さんの夜勤回数が${nightCount}回です（目標${settings.nightShiftTarget}回 ±${settings.nightShiftTolerance}）。`,
      });
    }
  }

  return recommendations;
}

function evaluateShiftBalance(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
  shiftTypes: ShiftTypeMeta[],
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  const balanceableTypes = shiftTypes.filter(
    (t) => t.canAiAutoAssign && t.includeInMonthlyStats && !t.constraintOnly,
  );

  for (const type of balanceableTypes) {
    // Only include staff who are eligible for this shift type in the average.
    // Staff with no restriction (null/empty availableShiftTypeIds) are always
    // eligible; those with a specific list must have this type's ID in it.
    const eligibleStaff = staff.filter((member) => staffCanDoShiftType(member, type.id));
    if (eligibleStaff.length === 0) continue;

    const counts = eligibleStaff.map((member) => {
      const shifts = shiftsByStaff.get(member.id) ?? [];
      const count = shifts.filter((s) => s.code === type.code).length;
      return { member, count };
    });

    const average = counts.reduce((sum, c) => sum + c.count, 0) / counts.length;

    for (const { member, count } of counts) {
      const diff = count - average;
      if (Math.abs(diff) > type.balanceTolerance) {
        recommendations.push({
          severity: "info",
          type: "shift_balance",
          staffId: member.id,
          message: `${member.name}さんの「${type.code}」回数が${count}回で、対応可能スタッフ平均(${average.toFixed(1)}回)から大きく外れています（許容差±${type.balanceTolerance}）。`,
        });
      }
    }
  }

  return recommendations;
}

function evaluateRequiredWorkPending(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const member of staff) {
    const shifts = shiftsByStaff.get(member.id) ?? [];
    const pending = shifts.filter((s) => s.constraintType === "attendance" && !s.code);
    if (pending.length > 0) {
      recommendations.push({
        severity: "warning",
        type: "required_work_pending",
        staffId: member.id,
        message: `${member.name}さんの出勤希望（📌）が${pending.length}件、まだシフトが割り当てられていません。`,
      });
    }
  }

  return recommendations;
}

/**
 * Checks whether any assigned shifts violate a staff member's
 * availableShiftTypeIds restriction. Only flagged when the staff has an
 * explicit (non-null, non-empty) list, because null means "no restriction".
 */
function evaluateAvailabilityViolations(
  staff: Staff[],
  shiftsByStaff: Map<number, Shift[]>,
  shiftTypeByCode: Map<string, ShiftTypeMeta>,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const member of staff) {
    const allowed = member.availableShiftTypeIds;
    // null or empty = no restriction, nothing to check
    if (!allowed || allowed.length === 0) continue;

    const shifts = shiftsByStaff.get(member.id) ?? [];
    const violations: string[] = [];

    for (const shift of shifts) {
      if (!shift.code) continue;
      const meta = shiftTypeByCode.get(shift.code);
      if (!meta) continue;
      // Skip constraint-only types (hope_off, attendance markers, etc.)
      if (meta.constraintOnly) continue;
      if (!allowed.includes(meta.id)) {
        if (!violations.includes(shift.code)) violations.push(shift.code);
      }
    }

    if (violations.length > 0) {
      recommendations.push({
        severity: "warning",
        type: "available_shift_violation",
        staffId: member.id,
        message: `${member.name}さんに対応不可のシフト（${violations.join("、")}）が割り当てられています。`,
      });
    }
  }

  return recommendations;
}

export async function computeRecommendations(month: string): Promise<Recommendation[]> {
  const bounds = monthBounds(month);
  if (!bounds) {
    throw new Error("month must be in YYYY-MM format");
  }

  const [settings] = await db.select().from(scheduleSettingsTable);
  const effectiveSettings: ScheduleSettings =
    settings ??
    ({
      id: 0,
      maxConsecutiveWorkDays: 5,
      countNightAfterAsConsecutive: true,
      minDaysOffPerMonth: 9,
      nightShiftTarget: 4,
      nightShiftTolerance: 1,
      nightBalanceStaffIds: null,
      updatedAt: new Date(),
    } satisfies ScheduleSettings);

  const staff = await db.select().from(staffTable).orderBy(asc(staffTable.sortOrder));
  const shiftTypeRows = await db.select().from(shiftTypesTable);
  const shiftTypeMetas: ShiftTypeMeta[] = shiftTypeRows.map((t) => ({
    id: t.id,
    code: t.code,
    category: t.category,
    countsAsConsecutiveWork: t.countsAsConsecutiveWork,
    canAiAutoAssign: t.canAiAutoAssign,
    includeInMonthlyStats: t.includeInMonthlyStats,
    constraintOnly: t.constraintOnly,
    balanceTolerance: t.balanceTolerance,
  }));
  const shiftTypeByCode = new Map<string, ShiftTypeMeta>(
    shiftTypeMetas.map((t) => [t.code, t]),
  );

  // Look back far enough before month start to correctly detect a
  // consecutive-work run that began in the previous month and crosses
  // into this one.
  const lookback = new Date(bounds.start);
  lookback.setUTCDate(lookback.getUTCDate() - 14);

  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, toDateString(lookback)), lt(shiftsTable.date, toDateString(bounds.end))));

  const shiftsInMonth = shifts.filter((s) => s.date >= toDateString(bounds.start));
  const shiftsByStaffAll = new Map<number, Shift[]>();
  const shiftsByStaffInMonth = new Map<number, Shift[]>();
  for (const shift of shifts) {
    const list = shiftsByStaffAll.get(shift.staffId) ?? [];
    list.push(shift);
    shiftsByStaffAll.set(shift.staffId, list);
  }
  for (const shift of shiftsInMonth) {
    const list = shiftsByStaffInMonth.get(shift.staffId) ?? [];
    list.push(shift);
    shiftsByStaffInMonth.set(shift.staffId, list);
  }

  const facilityRuleRecommendations = await computeFacilityRuleRecommendations(month);

  return [
    ...evaluateConsecutiveWork(staff, shiftsByStaffAll, shiftTypeByCode, effectiveSettings),
    ...evaluateDaysOff(staff, shiftsByStaffInMonth, shiftTypeByCode, effectiveSettings, bounds.daysInMonth),
    ...evaluateNightBalance(staff, shiftsByStaffInMonth, shiftTypeByCode, effectiveSettings),
    ...evaluateShiftBalance(staff, shiftsByStaffInMonth, shiftTypeMetas),
    ...evaluateRequiredWorkPending(staff, shiftsByStaffInMonth),
    ...evaluateAvailabilityViolations(staff, shiftsByStaffInMonth, shiftTypeByCode),
    ...facilityRuleRecommendations,
  ];
}
