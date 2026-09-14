import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, nightDutyOwnershipTable, shiftsTable, shiftTypesTable, staffTable, unitsTable } from "@workspace/db";

// Partial AI Execution: computes a concrete, previewable change-set for a
// "fill in the blanks" request from AI相談 (e.g. "松村さんを希望休以外B2で
// 埋めて", "空欄だけ埋めて"). Never writes anything itself — the caller
// (intent matcher) only shows the preview; actually applying it happens in
// POST /ai-consult/messages/:id/execute, which re-verifies each cell here
// again right before writing so nothing changed in between overwrites the
// manager's own edits.

export interface PlannedChange {
  staffId: number;
  staffName: string;
  date: string;
  code: string;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInMonthList(month: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("month must be in YYYY-MM format");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return Array.from({ length: daysInMonth }, (_, i) => `${monthPrefix}-${String(i + 1).padStart(2, "0")}`);
}

// A cell counts as "blank" (fillable) when it has no code yet and isn't a
// hope_off constraint (🚫 is always immutable) or a manual lock. An
// "attendance" (📌) constraint with no code yet still counts as blank —
// filling it in is exactly what 📌 exists for.
export async function computeFillPlan(options: {
  month: string;
  code: string;
  staffId?: number | null;
}): Promise<{ changes: PlannedChange[] }> {
  const dates = daysInMonthList(options.month);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  if (!firstDay || !lastDay) return { changes: [] };

  const staffList = await db
    .select({ id: staffTable.id, name: staffTable.name, availableShiftTypeIds: staffTable.availableShiftTypeIds })
    .from(staffTable)
    .where(options.staffId ? eq(staffTable.id, options.staffId) : undefined);

  // Resolve the shift type ID for the requested code so we can check staff
  // eligibility (availableShiftTypeIds). null/empty = no restriction.
  const [targetShiftType] = await db
    .select({ id: shiftTypesTable.id })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.code, options.code));
  const targetShiftTypeId = targetShiftType?.id ?? null;

  const shifts = await db
    .select({
      staffId: shiftsTable.staffId,
      date: shiftsTable.date,
      code: shiftsTable.code,
      constraintType: shiftsTable.constraintType,
      locked: shiftsTable.locked,
    })
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, firstDay), lte(shiftsTable.date, lastDay)));

  const shiftByStaffDate = new Map(shifts.map((s) => [`${s.staffId}|${s.date}`, s]));

  const changes: PlannedChange[] = [];
  for (const staff of staffList) {
    // Skip staff who are not eligible for this shift type.
    // null/empty availableShiftTypeIds means no restriction (all shifts OK).
    if (targetShiftTypeId !== null) {
      const allowed = staff.availableShiftTypeIds;
      if (allowed && allowed.length > 0 && !allowed.includes(targetShiftTypeId)) {
        continue;
      }
    }

    for (const date of dates) {
      const existing = shiftByStaffDate.get(`${staff.id}|${date}`);
      if (!existing) {
        changes.push({ staffId: staff.id, staffName: staff.name, date, code: options.code });
        continue;
      }
      if (existing.code) continue; // already assigned, never overwrite
      if (existing.constraintType === "hope_off") continue; // 🚫 is immutable
      if (existing.locked) continue;
      changes.push({ staffId: staff.id, staffName: staff.name, date, code: options.code });
    }
  }

  return { changes };
}

// Resolves "夜勤" in a request to this facility's primary night-shift code
// (the first night_shift-category shift type by sort order), and a bare
// "空欄"/no code mention to the primary day-shift code, since a concrete
// code is always required to compute a plan.
export async function resolveDefaultCode(kind: "night" | "day"): Promise<string | null> {
  const category = kind === "night" ? "night_shift" : "day_shift";
  const [shiftType] = await db
    .select({ code: shiftTypesTable.code })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.category, category))
    .orderBy(shiftTypesTable.sortOrder)
    .limit(1);
  return shiftType?.code ?? null;
}

export async function isHolidayOrPaidLeaveCode(code: string): Promise<boolean> {
  const [shiftType] = await db
    .select({ category: shiftTypesTable.category })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.code, code));
  return shiftType?.category === "holiday" || shiftType?.category === "paid_leave";
}

// Day classification used by computeMinRestPlan for consecutive-run analysis.
// 'rest'  — hope_off constraint or holiday-category code (counts toward minCount).
// 'night' — night_shift-category code (non-rest, special limit applies).
// 'work'  — any other non-rest status: after_night code, attendance constraint,
//            paid_leave constraint, other assigned code, or locked blank cell.
// 'blank' — no record yet, or a record with no code + no binding constraint.
type MinRestDayStatus = "rest" | "night" | "work" | "blank";

/**
 * Ensures every staff member has at least `minCount` rest days in the month.
 *
 * Counting rules:
 *  - hope_off constraint and holiday-category codes count as rest.
 *  - paid_leave (有給) does NOT count — it is treated as additional leave
 *    and does not reduce the regular rest requirement.
 *
 * Consecutive-work limits (observed when choosing which blank cells to fill):
 *  - General limit : max 5 consecutive non-rest days.
 *  - Night-shift limit : if the last day of a run is a night shift (夜勤),
 *    max 3 non-night days may precede it, so the total run is ≤ 4 days.
 *
 * Blank cells are scored by how much the run they belong to exceeds these
 * limits; high-pressure blanks are chosen first so that rest days are placed
 * where they relieve consecutive-work violations before filling the remainder
 * of the shortfall randomly.
 */
export async function computeMinRestPlan(options: {
  month: string;
  minCount: number;
}): Promise<{ changes: PlannedChange[]; staffSummary: { name: string; before: number; added: number }[] }> {
  const dates = daysInMonthList(options.month);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  if (!firstDay || !lastDay) return { changes: [], staffSummary: [] };

  // ── Shift type lookups ──────────────────────────────────────────────────
  const [holidayType] = await db
    .select({ code: shiftTypesTable.code })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.category, "holiday"))
    .orderBy(shiftTypesTable.sortOrder)
    .limit(1);
  if (!holidayType) return { changes: [], staffSummary: [] };
  const restCode = holidayType.code; // code to assign for new rest days

  const [holidayTypes, nightTypes] = await Promise.all([
    db.select({ code: shiftTypesTable.code }).from(shiftTypesTable).where(eq(shiftTypesTable.category, "holiday")),
    db.select({ code: shiftTypesTable.code }).from(shiftTypesTable).where(eq(shiftTypesTable.category, "night_shift")),
  ]);
  const restCodes = new Set(holidayTypes.map((t) => t.code));
  const nightCodes = new Set(nightTypes.map((t) => t.code));

  // ── Staff & shifts ──────────────────────────────────────────────────────
  const staffList = await db
    .select({ id: staffTable.id, name: staffTable.name })
    .from(staffTable)
    .orderBy(staffTable.sortOrder);

  const shifts = await db
    .select({
      staffId: shiftsTable.staffId,
      date: shiftsTable.date,
      code: shiftsTable.code,
      constraintType: shiftsTable.constraintType,
      locked: shiftsTable.locked,
    })
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, firstDay), lte(shiftsTable.date, lastDay)));

  const shiftByStaffDate = new Map(shifts.map((s) => [`${s.staffId}|${s.date}`, s]));

  // ── Per-date status classifier ──────────────────────────────────────────
  function classifyDay(staffId: number, date: string): MinRestDayStatus {
    const s = shiftByStaffDate.get(`${staffId}|${date}`);
    if (!s) return "blank";
    if (s.constraintType === "hope_off") return "rest";
    if (s.code && restCodes.has(s.code)) return "rest";
    if (s.code && nightCodes.has(s.code)) return "night";
    // paid_leave constraint, attendance constraint, any other code, locked cell → work
    if (s.constraintType !== null || s.code || s.locked) return "work";
    return "blank";
  }

  // ── Consecutive-run pressure scorer for a blank date ───────────────────
  // Returns how many days the run containing `idx` exceeds its limit (0 = no pressure).
  // Treats blank days as non-rest for the worst-case analysis.
  function runPressure(statuses: MinRestDayStatus[], idx: number): number {
    // Expand run left
    let lo = idx;
    while (lo > 0 && statuses[lo - 1] !== "rest") lo--;
    // Expand run right
    let hi = idx;
    while (hi < statuses.length - 1 && statuses[hi + 1] !== "rest") hi++;

    const runLen = hi - lo + 1;
    // Determine limit: if the rightmost day is a night shift, apply the
    // stricter "3 day shifts + 1 night = 4" limit; otherwise general 5.
    const limit = statuses[hi] === "night" ? 4 : 5;
    return Math.max(0, runLen - limit);
  }

  // ── Main loop ───────────────────────────────────────────────────────────
  const changes: PlannedChange[] = [];
  const staffSummary: { name: string; before: number; added: number }[] = [];

  for (const staff of staffList) {
    // Build status array for the month
    const statuses: MinRestDayStatus[] = dates.map((d) => classifyDay(staff.id, d));

    // Count existing rest days and collect blank indices
    let restCount = 0;
    const blankIndices: number[] = [];
    for (let i = 0; i < dates.length; i++) {
      if (statuses[i] === "rest") { restCount++; }
      else if (statuses[i] === "blank") { blankIndices.push(i); }
    }

    const shortfall = Math.max(0, options.minCount - restCount);
    staffSummary.push({ name: staff.name, before: restCount, added: shortfall });
    if (shortfall === 0) continue;

    // Score each blank by run pressure, shuffle within equal scores for variety,
    // then pick the top `shortfall` blanks.
    const scored = blankIndices
      .map((i) => ({ i, score: runPressure(statuses, i), rand: Math.random() }))
      .sort((a, b) => b.score - a.score || b.rand - a.rand);

    const picks = scored.slice(0, shortfall);

    for (const { i } of picks) {
      const date = dates[i]!;
      changes.push({ staffId: staff.id, staffName: staff.name, date, code: restCode });
      // Mark chosen date as rest in the local statuses array so that
      // subsequent pressure calculations within the same staff are accurate.
      statuses[i] = "rest";
    }
  }

  return { changes, staffSummary };
}

/**
 * Distributes night shifts across 〇-marked dates (nightDutyOwnership rows
 * belonging to the east unit) for the given month.
 *
 * When regularStaffCap is provided (>0):
 *   Phase 1 — assign 〇 dates to regular (non-leader) eligible staff, up to
 *             the cap per person, using lowest-count-first greedy allocation.
 *   Phase 2 — assign remaining unassigned 〇 dates to leader staff (no cap),
 *             again lowest-count-first.
 * Without a cap, all eligible staff compete equally (original behaviour).
 *
 * "2夜" (after_night) shifts are NOT counted separately; only the primary
 * night_shift code on a 〇 date counts as one occurrence.
 */
export async function computeNightDutyDistributionPlan(options: {
  month: string;
  /** Max night shifts for non-leader staff. 0 / undefined = no cap (all staff equal). */
  regularStaffCap?: number;
  /** Specific night shift code to assign (e.g. "特2夜"). Falls back to the first night_shift type by sort order. */
  nightShiftCode?: string;
}): Promise<{
  changes: PlannedChange[];
  nightDates: string[];
  eligibleStaffCount: number;
  leaderStaffCount: number;
  regularStaffCount: number;
}> {
  const empty = { changes: [], nightDates: [], eligibleStaffCount: 0, leaderStaffCount: 0, regularStaffCount: 0 };

  const dates = daysInMonthList(options.month);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  if (!firstDay || !lastDay) return empty;

  // 1. Get east unit
  const [eastUnit] = await db
    .select({ id: unitsTable.id })
    .from(unitsTable)
    .where(eq(unitsTable.name, "東町"));
  if (!eastUnit) return empty;

  // 2. Get 〇 dates for this unit in the month
  const ownershipRows = await db
    .select({ date: nightDutyOwnershipTable.date })
    .from(nightDutyOwnershipTable)
    .where(
      and(
        eq(nightDutyOwnershipTable.unitId, eastUnit.id),
        gte(nightDutyOwnershipTable.date, firstDay),
        lte(nightDutyOwnershipTable.date, lastDay),
      ),
    )
    .orderBy(asc(nightDutyOwnershipTable.date));

  const nightDates = ownershipRows.map((r) => r.date);
  if (nightDates.length === 0) return { ...empty, nightDates };

  // 3. Get night shift types (only night_shift category; after_night is excluded from count)
  const nightShiftTypes = await db
    .select({ id: shiftTypesTable.id, code: shiftTypesTable.code })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.category, "night_shift"))
    .orderBy(shiftTypesTable.sortOrder);

  if (nightShiftTypes.length === 0) return { ...empty, nightDates };
  const nightShiftTypeIds = new Set(nightShiftTypes.map((t) => t.id));
  const nightShiftCodes = new Set(nightShiftTypes.map((t) => t.code));
  // Use the caller-specified code if it's a valid night_shift code; otherwise fall back to first by sort order.
  const defaultNightCode = nightShiftTypes[0]!.code;
  const assignCode =
    options.nightShiftCode && nightShiftCodes.has(options.nightShiftCode)
      ? options.nightShiftCode
      : defaultNightCode;

  // Also fetch after_night codes so we can block 夜勤 on the day after 明け
  const afterNightShiftTypes = await db
    .select({ code: shiftTypesTable.code })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.category, "after_night"));
  const afterNightCodes = new Set(afterNightShiftTypes.map((t) => t.code));

  // 4. Get all staff in sort order, including isLeader flag
  const allStaff = await db
    .select({
      id: staffTable.id,
      name: staffTable.name,
      isLeader: staffTable.isLeader,
      availableShiftTypeIds: staffTable.availableShiftTypeIds,
    })
    .from(staffTable)
    .orderBy(asc(staffTable.sortOrder));

  // Filter to staff eligible for night shifts
  const eligibleStaff = allStaff.filter((s) => {
    const allowed = s.availableShiftTypeIds;
    if (!allowed || allowed.length === 0) return true;
    return allowed.some((id) => nightShiftTypeIds.has(id));
  });

  if (eligibleStaff.length === 0) return { ...empty, nightDates };

  const leaderStaff = eligibleStaff.filter((s) => s.isLeader);
  const regularStaff = eligibleStaff.filter((s) => !s.isLeader);

  // 5. Get existing shifts for the month
  const existingShifts = await db
    .select({
      staffId: shiftsTable.staffId,
      date: shiftsTable.date,
      code: shiftsTable.code,
      constraintType: shiftsTable.constraintType,
      locked: shiftsTable.locked,
    })
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, firstDay), lte(shiftsTable.date, lastDay)));

  const shiftByStaffDate = new Map(existingShifts.map((s) => [`${s.staffId}|${s.date}`, s]));

  // Count existing night_shift occurrences per eligible staff
  // (after_night shifts are intentionally not counted here)
  const nightCountByStaff = new Map<number, number>(eligibleStaff.map((s) => [s.id, 0]));
  for (const shift of existingShifts) {
    if (shift.code && nightShiftCodes.has(shift.code) && nightCountByStaff.has(shift.staffId)) {
      nightCountByStaff.set(shift.staffId, (nightCountByStaff.get(shift.staffId) ?? 0) + 1);
    }
  }

  // Helper: can a staff member take a shift on this date?
  // Blocked when: already has a shift code, has any constraint (hope_off /
  // paid_leave / attendance), or is manually locked.
  // Note: attendance (出勤固定) has constraintType="attendance" with code=null
  // and locked=false, so it must be checked explicitly.
  const isAvailableOnDate = (staffId: number, date: string): boolean => {
    const existing = shiftByStaffDate.get(`${staffId}|${date}`);
    if (!existing) return true;
    if (existing.code) return false;
    if (existing.constraintType !== null) return false; // hope_off / paid_leave / attendance
    if (existing.locked) return false;
    return true;
  };

  // Helper: would placing a night shift on `nightDate` create a sequence
  // conflict for `staffId`?  Checks three surrounding days:
  //
  //   D-1 (前日): if D-1 is 明け (after_night), placing 夜勤 on D would put
  //               夜勤 immediately after 明け — not allowed.
  //   D+1 (明け): any constraint blocks it — 出勤固定/希望休/有給 all mean the
  //               day is spoken for and 明け cannot fill it.
  //   D+2 (休み): only 出勤固定 (attendance) blocks it; 希望休 and 有給 are
  //               compatible with 休み so they do NOT block.
  //
  // Days outside the loaded month range are absent from `shiftByStaffDate`
  // and treated as "no constraint → safe".
  const wouldConflictWithFollowingDays = (staffId: number, nightDate: string): boolean => {
    // --- D-1 check: 明けの翌日に夜勤は不可 ---
    const dm1 = addDaysToDateStr(nightDate, -1);
    const sm1 = shiftByStaffDate.get(`${staffId}|${dm1}`);
    if (sm1?.code && afterNightCodes.has(sm1.code)) return true;

    // --- D+1 check: 明けが入る日に制約があれば不可 ---
    const d1 = addDaysToDateStr(nightDate, 1);
    const s1 = shiftByStaffDate.get(`${staffId}|${d1}`);
    if (
      s1?.constraintType === "attendance" ||
      s1?.constraintType === "hope_off" ||
      s1?.constraintType === "paid_leave"
    ) return true;
    if (s1?.locked) return true;

    // --- D+2 check: 休みが入る日に attendance があれば不可 ---
    const d2 = addDaysToDateStr(nightDate, 2);
    const s2 = shiftByStaffDate.get(`${staffId}|${d2}`);
    if (s2?.constraintType === "attendance") return true;
    // hope_off / paid_leave on D+2 are OK (休み is compatible)
    if (s2?.locked && s2.constraintType !== "hope_off" && s2.constraintType !== "paid_leave") return true;

    return false;
  };

  // Helper: pick the staff member with the lowest current count among candidates
  const pickLowest = (candidates: typeof eligibleStaff) =>
    candidates.reduce((best, s) =>
      (nightCountByStaff.get(s.id) ?? 0) < (nightCountByStaff.get(best.id) ?? 0) ? s : best,
    );

  const cap = options.regularStaffCap && options.regularStaffCap > 0 ? options.regularStaffCap : null;
  const changes: PlannedChange[] = [];

  for (const date of nightDates) {
    // Skip dates that already have a night shift assigned to anyone
    const alreadyAssigned = eligibleStaff.some((s) => {
      const ex = shiftByStaffDate.get(`${s.id}|${date}`);
      return ex?.code && nightShiftCodes.has(ex.code);
    });
    if (alreadyAssigned) continue;

    let chosen: (typeof eligibleStaff)[number] | undefined;

    if (cap !== null) {
      // Phase 1: prefer regular staff who haven't hit the cap yet
      const regularAvail = regularStaff.filter(
        (s) =>
          isAvailableOnDate(s.id, date) &&
          !wouldConflictWithFollowingDays(s.id, date) &&
          (nightCountByStaff.get(s.id) ?? 0) < cap,
      );
      if (regularAvail.length > 0) {
        chosen = pickLowest(regularAvail);
      } else {
        // Phase 2: fall back to leaders (no cap)
        const leaderAvail = leaderStaff.filter(
          (s) => isAvailableOnDate(s.id, date) && !wouldConflictWithFollowingDays(s.id, date),
        );
        if (leaderAvail.length > 0) chosen = pickLowest(leaderAvail);
      }
    } else {
      // No cap: all eligible staff compete equally
      const avail = eligibleStaff.filter(
        (s) => isAvailableOnDate(s.id, date) && !wouldConflictWithFollowingDays(s.id, date),
      );
      if (avail.length > 0) chosen = pickLowest(avail);
    }

    if (!chosen) continue;
    changes.push({ staffId: chosen.id, staffName: chosen.name, date, code: assignCode });
    nightCountByStaff.set(chosen.id, (nightCountByStaff.get(chosen.id) ?? 0) + 1);

    // Speculatively mark D+1 (明け) and D+2 (休み) in the local map so that
    // later iterations in this same loop don't assign 夜勤→明け→夜勤.
    // These are planning-time markers only — nothing is written to the DB here.
    const syntheticAfterNight = afterNightCodes.values().next().value ?? "__after_night__";
    const planD1 = addDaysToDateStr(date, 1);
    const planD2 = addDaysToDateStr(date, 2);
    shiftByStaffDate.set(`${chosen.id}|${planD1}`, {
      staffId: chosen.id, date: planD1,
      code: syntheticAfterNight, constraintType: null, locked: false,
    });
    shiftByStaffDate.set(`${chosen.id}|${planD2}`, {
      staffId: chosen.id, date: planD2,
      code: "__rest__", constraintType: null, locked: true,
    });
  }

  return {
    changes,
    nightDates,
    eligibleStaffCount: eligibleStaff.length,
    leaderStaffCount: leaderStaff.length,
    regularStaffCount: regularStaff.length,
  };
}
