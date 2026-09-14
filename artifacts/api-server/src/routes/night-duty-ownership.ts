import { Router, type IRouter } from "express";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db, nightDutyOwnershipTable } from "@workspace/db";
import {
  ListNightDutyOwnershipQueryParams,
  ListNightDutyOwnershipResponse,
  UpsertNightDutyOwnershipBody,
  UpsertNightDutyOwnershipResponse,
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

router.get("/night-duty-ownership", async (req, res): Promise<void> => {
  const query = ListNightDutyOwnershipQueryParams.safeParse(req.query);
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
    .from(nightDutyOwnershipTable)
    .where(
      bounds
        ? and(
            gte(nightDutyOwnershipTable.date, bounds.start),
            lt(nightDutyOwnershipTable.date, bounds.end),
          )
        : undefined,
    )
    .orderBy(asc(nightDutyOwnershipTable.date));

  res.json(ListNightDutyOwnershipResponse.parse(records));
});

router.post("/night-duty-ownership", async (req, res): Promise<void> => {
  const parsed = UpsertNightDutyOwnershipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .insert(nightDutyOwnershipTable)
    .values({ date: parsed.data.date, unitId: parsed.data.unitId ?? null })
    .onConflictDoUpdate({
      target: nightDutyOwnershipTable.date,
      set: { unitId: parsed.data.unitId ?? null, updatedAt: new Date() },
    })
    .returning();

  res.json(UpsertNightDutyOwnershipResponse.parse(record));
});

export default router;
