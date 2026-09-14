import { Router, type IRouter } from "express";
import { and, gte, isNotNull, isNull, lte } from "drizzle-orm";
import {
  db,
  shiftsTable,
  nightDutyOwnershipTable,
  dayRemarksTable,
} from "@workspace/db";
import { WipeMonthDataBody, WipeMonthDataResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function monthBounds(month: string): { firstDay: string; lastDay: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const firstDay = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
  return { firstDay, lastDay };
}

// POST /data-management/wipe
// Deletes selected categories of data for a given month.
// targets: one or more of "shifts" | "constraints" | "nightDutyOwnership" | "dayRemarks"
router.post("/data-management/wipe", async (req, res): Promise<void> => {
  const parsed = WipeMonthDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { month, targets } = parsed.data;
  const bounds = monthBounds(month);
  if (!bounds) {
    res.status(400).json({ error: "month must be in YYYY-MM format" });
    return;
  }
  const { firstDay, lastDay } = bounds;

  let deletedShifts = 0;
  let deletedConstraints = 0;
  let deletedNightDutyOwnership = 0;
  let deletedDayRemarks = 0;

  if (targets.includes("shifts")) {
    const rows = await db
      .delete(shiftsTable)
      .where(
        and(
          gte(shiftsTable.date, firstDay),
          lte(shiftsTable.date, lastDay),
          isNull(shiftsTable.constraintType),
        ),
      )
      .returning({ id: shiftsTable.id });
    deletedShifts = rows.length;
  }

  if (targets.includes("constraints")) {
    const rows = await db
      .delete(shiftsTable)
      .where(
        and(
          gte(shiftsTable.date, firstDay),
          lte(shiftsTable.date, lastDay),
          isNotNull(shiftsTable.constraintType),
        ),
      )
      .returning({ id: shiftsTable.id });
    deletedConstraints = rows.length;
  }

  if (targets.includes("nightDutyOwnership")) {
    const rows = await db
      .delete(nightDutyOwnershipTable)
      .where(
        and(
          gte(nightDutyOwnershipTable.date, firstDay),
          lte(nightDutyOwnershipTable.date, lastDay),
        ),
      )
      .returning({ id: nightDutyOwnershipTable.id });
    deletedNightDutyOwnership = rows.length;
  }

  if (targets.includes("dayRemarks")) {
    const rows = await db
      .delete(dayRemarksTable)
      .where(
        and(
          gte(dayRemarksTable.date, firstDay),
          lte(dayRemarksTable.date, lastDay),
        ),
      )
      .returning({ id: dayRemarksTable.id });
    deletedDayRemarks = rows.length;
  }

  res.json(
    WipeMonthDataResponse.parse({
      deletedShifts,
      deletedConstraints,
      deletedNightDutyOwnership,
      deletedDayRemarks,
    }),
  );
});

export default router;
