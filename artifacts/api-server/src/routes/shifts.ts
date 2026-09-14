import { Router, type IRouter } from "express";
import { and, asc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db, shiftsTable, shiftTypesTable } from "@workspace/db";
import {
  ListShiftsQueryParams,
  CreateShiftBody,
  CreateShiftResponse,
  UpdateShiftParams,
  UpdateShiftBody,
  UpdateShiftResponse,
  DeleteShiftParams,
  ListShiftsResponse,
  ListShiftMonthsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// The set of valid shift codes is defined by the shift_types table (editable
// in Settings), not a fixed Postgres enum, so any code an operation touches
// must be checked against it directly.
export async function isKnownShiftCode(code: string): Promise<boolean> {
  const [match] = await db
    .select({ id: shiftTypesTable.id })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.code, code));
  return !!match;
}

// "hope_off" (休み固定) and "paid_leave" (有給固定) each always force their
// shift's code to the current "holiday"/"paid_leave"-category shift type's
// code (originally "休み"/"有休" respectively). Looked up dynamically —
// like the night-shift auto-placement below — so renaming that shift
// type's code in Settings never breaks this logic.
async function getFixedOffConstraintCode(
  constraintType: "hope_off" | "paid_leave",
): Promise<string | null> {
  const category = constraintType === "hope_off" ? "holiday" : "paid_leave";
  const [shiftType] = await db
    .select({ code: shiftTypesTable.code })
    .from(shiftTypesTable)
    .where(eq(shiftTypesTable.category, category));
  return shiftType?.code ?? null;
}

// Night-shift codes automatically place the "after night" code (e.g. "明け")
// on the following day. Driven by category rather than a hardcoded code list
// so renaming a shift type's code never breaks this behavior.
export async function getNightAndAfterNightCodes(): Promise<{
  nightCodes: Set<string>;
  afterNightCode: string | null;
}> {
  const shiftTypes = await db
    .select({ code: shiftTypesTable.code, category: shiftTypesTable.category })
    .from(shiftTypesTable);
  const nightCodes = new Set(
    shiftTypes.filter((t) => t.category === "night_shift").map((t) => t.code),
  );
  const afterNightCode = shiftTypes.find((t) => t.category === "after_night")?.code ?? null;
  return { nightCodes, afterNightCode };
}

function monthBounds(month: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function nextDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export async function autoPlaceFollowingDayOff(staffId: number, date: string, code: string) {
  const { nightCodes, afterNightCode } = await getNightAndAfterNightCodes();
  if (!nightCodes.has(code) || !afterNightCode) return;

  const followingDate = nextDate(date);
  const [existing] = await db
    .select()
    .from(shiftsTable)
    .where(and(eq(shiftsTable.staffId, staffId), eq(shiftsTable.date, followingDate)));

  // Respect manual locks: never overwrite a cell the manager has locked.
  if (existing?.locked) return;

  if (existing) {
    await db
      .update(shiftsTable)
      .set({ code: afterNightCode })
      .where(eq(shiftsTable.id, existing.id));
  } else {
    await db.insert(shiftsTable).values({
      staffId,
      date: followingDate,
      code: afterNightCode,
    });
  }
}

// Powers シフト表出力's month picker: only months that actually have saved
// shift data are selectable, so the export flow never opens a preview for
// an empty month. Derives distinct months directly from `shifts.date`
// rather than requiring a separate "months with data" table.
router.get("/shifts/months", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ month: sql<string>`substring(${shiftsTable.date}::text, 1, 7)`.as("month") })
    .from(shiftsTable)
    .orderBy(sql`month`);

  res.json(ListShiftMonthsResponse.parse(rows.map((r) => r.month)));
});

router.get("/shifts", async (req, res): Promise<void> => {
  const query = ListShiftsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const bounds = query.data.month ? monthBounds(query.data.month) : null;
  if (query.data.month && !bounds) {
    res.status(400).json({ error: "Invalid month format, expected YYYY-MM" });
    return;
  }

  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(
      and(
        query.data.staffId
          ? eq(shiftsTable.staffId, query.data.staffId)
          : undefined,
        bounds ? gte(shiftsTable.date, bounds.start) : undefined,
        bounds ? lt(shiftsTable.date, bounds.end) : undefined,
      ),
    )
    .orderBy(asc(shiftsTable.date));

  res.json(ListShiftsResponse.parse(shifts));
});

router.post("/shifts", async (req, res): Promise<void> => {
  const parsed = CreateShiftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.constraintType === undefined && parsed.data.code === undefined) {
    res.status(400).json({ error: "Either code or constraintType must be provided" });
    return;
  }

  if (parsed.data.code !== undefined && !(await isKnownShiftCode(parsed.data.code))) {
    res.status(400).json({ error: `Unknown shift code "${parsed.data.code}"` });
    return;
  }

  const [existing] = await db
    .select()
    .from(shiftsTable)
    .where(
      and(
        eq(shiftsTable.staffId, parsed.data.staffId),
        eq(shiftsTable.date, parsed.data.date),
      ),
    );

  if (existing?.locked) {
    res.status(409).json({ error: "Shift is locked" });
    return;
  }

  let fixedOffCode: string | null = null;
  if (parsed.data.constraintType === "hope_off" || parsed.data.constraintType === "paid_leave") {
    fixedOffCode = await getFixedOffConstraintCode(parsed.data.constraintType);
    if (!fixedOffCode) {
      const categoryLabel = parsed.data.constraintType === "hope_off" ? "holiday" : "paid_leave";
      res
        .status(400)
        .json({ error: `No "${categoryLabel}"-category shift type is configured; this constraint requires one` });
      return;
    }
  }

  // A constraint fully determines its own code/locked — never trust
  // whatever the client happened to send for those fields.
  //
  // "hope_off" (休み固定) and "paid_leave" (有給固定) both still fully lock
  // the cell — they must stay immutable except via the one-tap removal
  // gesture. "attendance" (📌) is deliberately left unlocked: it only marks
  // the day as must-work and must not block a normal shift code from being
  // painted on top of it, or block the cell from being freely
  // painted/toggled like any other cell. The 📌 marker itself is still
  // protected from ordinary delete/toggle gestures purely because
  // `constraintType` is set — never because of the lock flag — so only the
  // one-tap removal gesture can ever clear it (see shifts UI).
  const values =
    parsed.data.constraintType === "hope_off" || parsed.data.constraintType === "paid_leave"
      ? { code: fixedOffCode, constraintType: parsed.data.constraintType, locked: true }
      : parsed.data.constraintType === "attendance"
        ? { code: null, constraintType: "attendance" as const, locked: false }
        : { code: parsed.data.code ?? null, constraintType: null };

  let shift;
  if (existing) {
    [shift] = await db
      .update(shiftsTable)
      .set(values)
      .where(eq(shiftsTable.id, existing.id))
      .returning();
  } else {
    [shift] = await db
      .insert(shiftsTable)
      .values({ staffId: parsed.data.staffId, date: parsed.data.date, ...values })
      .returning();
  }

  if (values.code) {
    await autoPlaceFollowingDayOff(parsed.data.staffId, parsed.data.date, values.code);
  }

  res.status(201).json(CreateShiftResponse.parse(shift));
});

router.patch("/shifts/:id", async (req, res): Promise<void> => {
  const params = UpdateShiftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateShiftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (
    parsed.data.code === undefined &&
    parsed.data.locked === undefined &&
    parsed.data.constraintType === undefined
  ) {
    res
      .status(400)
      .json({ error: "At least one of code, constraintType, or locked must be provided" });
    return;
  }

  if (
    parsed.data.code !== undefined &&
    parsed.data.code !== null &&
    !(await isKnownShiftCode(parsed.data.code))
  ) {
    res.status(400).json({ error: `Unknown shift code "${parsed.data.code}"` });
    return;
  }

  const [existing] = await db
    .select()
    .from(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Shift not found" });
    return;
  }

  // "hope_off" (休み固定) and "paid_leave" (有給固定) are both fully
  // immutable outright — the only way to change either is to remove the
  // constraint entirely (constraintType: null), which is handled below.
  if (
    (existing.constraintType === "hope_off" || existing.constraintType === "paid_leave") &&
    parsed.data.constraintType === undefined
  ) {
    res.status(409).json({ error: "Shift has a fixed-off constraint and cannot be edited" });
    return;
  }

  // An "attendance" (📌) constraint's automatic lock is only meant to block
  // deletion — a normal shift is still allowed to be assigned on top of it,
  // so its code change bypasses the lock. Every other locked cell (manual
  // locks, and hope_off/paid_leave above) blocks code changes outright.
  const codeChangeBlocked = existing.locked && existing.constraintType !== "attendance";
  if (codeChangeBlocked && parsed.data.code !== undefined) {
    res.status(409).json({ error: "Shift is locked" });
    return;
  }

  // Setting constraintType to "hope_off"/"paid_leave" via PATCH (e.g.
  // painting that mode directly onto a cell that already has a plain shift
  // code) must force the same code+lock as creation — never trust a
  // client-sent `code` for these, and never leave a stale unrelated code in
  // place. Mirrors the POST handler's derivation above.
  let forcedFixedOff: { code: string; locked: true } | null = null;
  if (parsed.data.constraintType === "hope_off" || parsed.data.constraintType === "paid_leave") {
    const fixedOffCode = await getFixedOffConstraintCode(parsed.data.constraintType);
    if (!fixedOffCode) {
      const categoryLabel = parsed.data.constraintType === "hope_off" ? "holiday" : "paid_leave";
      res
        .status(400)
        .json({ error: `No "${categoryLabel}"-category shift type is configured; this constraint requires one` });
      return;
    }
    forcedFixedOff = { code: fixedOffCode, locked: true };
  }

  // Removing a constraint (constraintType: null) always drops its automatic
  // lock too, regardless of what the client passed for `locked` — this is
  // the only server-enforced way a hope_off/attendance cell's lock ever
  // clears, so it must not depend on the client remembering to ask for it.
  const removingConstraint = parsed.data.constraintType === null && existing.constraintType !== null;

  const [shift] = await db
    .update(shiftsTable)
    .set({
      ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      ...(parsed.data.constraintType !== undefined
        ? { constraintType: parsed.data.constraintType }
        : {}),
      ...(removingConstraint
        ? { locked: false }
        : parsed.data.locked !== undefined
          ? { locked: parsed.data.locked }
          : {}),
      // Forced last so it always wins over any client-provided code/locked
      // above when switching a cell to hope_off/paid_leave.
      ...(forcedFixedOff ? forcedFixedOff : {}),
    })
    .where(eq(shiftsTable.id, params.data.id))
    .returning();

  if (parsed.data.code !== undefined && parsed.data.code !== null) {
    await autoPlaceFollowingDayOff(shift.staffId, shift.date, parsed.data.code);
  }

  res.json(UpdateShiftResponse.parse(shift));
});

router.post("/shifts/reset-month", async (req, res): Promise<void> => {
  const { month } = req.body as { month?: unknown };
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month must be in YYYY-MM format" });
    return;
  }
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10); // last day of month

  // Delete only shifts without a constraint — preserves hope_off, paid_leave, attendance
  const deleted = await db
    .delete(shiftsTable)
    .where(
      and(
        gte(shiftsTable.date, firstDay),
        lte(shiftsTable.date, lastDay),
        isNull(shiftsTable.constraintType),
      ),
    )
    .returning({ id: shiftsTable.id });

  res.json({ deletedCount: deleted.length });
});

router.delete("/shifts/:id", async (req, res): Promise<void> => {
  const params = DeleteShiftParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [shift] = await db
    .delete(shiftsTable)
    .where(eq(shiftsTable.id, params.data.id))
    .returning();

  if (!shift) {
    res.status(404).json({ error: "Shift not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
