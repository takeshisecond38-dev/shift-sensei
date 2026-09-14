import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, scheduleSettingsTable } from "@workspace/db";
import { UpdateScheduleSettingsBody, GetScheduleSettingsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Singleton settings row (id=1), created lazily with defaults on first read
// so there's nothing to seed and no migration-order dependency.
async function getOrCreateSettings() {
  const [existing] = await db.select().from(scheduleSettingsTable);
  if (existing) return existing;

  const [created] = await db.insert(scheduleSettingsTable).values({}).returning();
  return created;
}

router.get("/schedule-settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(GetScheduleSettingsResponse.parse(settings));
});

router.patch("/schedule-settings", async (req, res): Promise<void> => {
  const parsed = UpdateScheduleSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const settings = await getOrCreateSettings();
  const [updated] = await db
    .update(scheduleSettingsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(scheduleSettingsTable.id, settings.id))
    .returning();

  res.json(GetScheduleSettingsResponse.parse(updated));
});

export default router;
