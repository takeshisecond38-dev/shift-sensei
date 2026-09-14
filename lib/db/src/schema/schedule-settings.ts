import { boolean, integer, jsonb, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton table (always exactly one row, id=1) holding the "Month-End
// Check Settings" thresholds the recommendation engine evaluates against.
// A row is created lazily with defaults the first time it's read/updated —
// see the schedule-settings route.
export const scheduleSettingsTable = pgTable("schedule_settings", {
  id: serial("id").primaryKey(),
  maxConsecutiveWorkDays: integer("max_consecutive_work_days").notNull().default(5),
  countNightAfterAsConsecutive: boolean("count_night_after_as_consecutive")
    .notNull()
    .default(true),
  minDaysOffPerMonth: integer("min_days_off_per_month").notNull().default(9),
  nightShiftTarget: integer("night_shift_target").notNull().default(4),
  nightShiftTolerance: integer("night_shift_tolerance").notNull().default(1),
  // Staff ids included in night-shift balancing. Null means "all staff are
  // included" (the default until the user narrows it down in Settings).
  nightBalanceStaffIds: jsonb("night_balance_staff_ids").$type<number[]>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduleSettingsSchema = createInsertSchema(scheduleSettingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertScheduleSettings = z.infer<typeof insertScheduleSettingsSchema>;
export type ScheduleSettings = typeof scheduleSettingsTable.$inferSelect;
