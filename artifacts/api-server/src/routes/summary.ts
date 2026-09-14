import { Router, type IRouter } from "express";
import { and, gte, lt } from "drizzle-orm";
import { db, shiftsTable, staffTable } from "@workspace/db";
import {
  GetMonthlySummaryQueryParams,
  GetMonthlySummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function monthRange(month: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { start, end };
}

router.get("/summary", async (req, res): Promise<void> => {
  const query = GetMonthlySummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const range = monthRange(query.data.month);
  if (!range) {
    res.status(400).json({ error: "Invalid month format, expected YYYY-MM" });
    return;
  }

  const staffList = await db.select().from(staffTable);

  const shiftMonthStart = range.start.toISOString().slice(0, 10);
  const shiftMonthEnd = range.end.toISOString().slice(0, 10);

  const shifts = await db
    .select()
    .from(shiftsTable)
    .where(
      and(
        gte(shiftsTable.date, shiftMonthStart),
        lt(shiftsTable.date, shiftMonthEnd),
      ),
    );

  const summary = staffList.map((staff) => {
    const staffShifts = shifts.filter((shift) => shift.staffId === staff.id);

    const shiftCounts = {
      A: 0,
      B2: 0,
      C3: 0,
      D: 0,
      E2: 0,
      nightShift: 0,
      yasumi: 0,
      yuukyuu: 0,
    };

    for (const shift of staffShifts) {
      switch (shift.code) {
        case "A":
          shiftCounts.A += 1;
          break;
        case "B2":
          shiftCounts.B2 += 1;
          break;
        case "C3":
          shiftCounts.C3 += 1;
          break;
        case "D":
          shiftCounts.D += 1;
          break;
        case "E2":
          shiftCounts.E2 += 1;
          break;
        case "2夜":
        case "特2夜":
          shiftCounts.nightShift += 1;
          break;
        case "休み":
          shiftCounts.yasumi += 1;
          break;
        case "有休":
          shiftCounts.yuukyuu += 1;
          break;
        default:
          break;
      }
    }

    return {
      staffId: staff.id,
      staffName: staff.name,
      staffColor: staff.color,
      shiftCounts,
    };
  });

  res.json(
    GetMonthlySummaryResponse.parse({
      month: query.data.month,
      staff: summary,
    }),
  );
});

export default router;
