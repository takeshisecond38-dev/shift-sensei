import { Router, type IRouter } from "express";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db, dayRemarksTable } from "@workspace/db";
import {
  ListDayRemarksQueryParams,
  ListDayRemarksResponse,
  UpsertDayRemarkBody,
  UpsertDayRemarkResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

router.get("/day-remarks", async (req, res): Promise<void> => {
  const query = ListDayRemarksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let bounds: { start: string; end: string } | null = null;
  if (query.data.month) {
    bounds = monthBounds(query.data.month);
    if (!bounds) {
      res.status(400).json({ error: "month must be in YYYY-MM format" });
      return;
    }
  }

  const records = await db
    .select()
    .from(dayRemarksTable)
    .where(
      bounds ? and(gte(dayRemarksTable.date, bounds.start), lt(dayRemarksTable.date, bounds.end)) : undefined,
    )
    .orderBy(asc(dayRemarksTable.date));

  res.json(ListDayRemarksResponse.parse(records));
});

// Setting the text to an empty string deletes the row entirely rather than
// storing an empty remark — clearing 備考 and never having typed one should
// look identical, and the row is never needed to preserve a hidden value
// (hiding the row is a pure display toggle, not tied to whether a record
// exists).
router.post("/day-remarks", async (req, res): Promise<void> => {
  const parsed = UpsertDayRemarkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { date, text } = parsed.data;

  if (text.trim() === "") {
    await db.delete(dayRemarksTable).where(eq(dayRemarksTable.date, date));
    res.json(UpsertDayRemarkResponse.parse(null));
    return;
  }

  const [record] = await db
    .insert(dayRemarksTable)
    .values({ date, text })
    .onConflictDoUpdate({
      target: dayRemarksTable.date,
      set: { text, updatedAt: new Date() },
    })
    .returning();

  res.json(UpsertDayRemarkResponse.parse(record));
});

export default router;
