import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Broad buckets a shift type can belong to. Not enforced against any
// scheduling rule today (e.g. consecutive-work limits) — this only shapes
// the data so category-specific rules can be added later without another
// migration.
export const shiftTypeCategoryValues = [
  "day_shift",
  "night_shift",
  "after_night",
  "holiday",
  "paid_leave",
  "other",
] as const;

export const shiftTypesTable = pgTable(
  "shift_types",
  {
    id: serial("id").primaryKey(),
    // The value stored in `shifts.code` — must stay unique so a shift row
    // can always be traced back to exactly one shift type.
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Short (1-3 char) label rendered on the stamp toolbar/grid cell.
    shortLabel: text("short_label").notNull(),
    bgColor: text("bg_color").notNull().default("#ffffff"),
    textColor: text("text_color").notNull().default("#000000"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    workingHours: doublePrecision("working_hours"),
    category: text("category", { enum: shiftTypeCategoryValues })
      .notNull()
      .default("other"),
    // Drives display/toolbar order; also the drag-reorder position.
    sortOrder: integer("sort_order").notNull().default(0),
    // ---- AI Settings (internal properties, edited via the Shift Type
    // editor's "AI Settings" section). None of these are enforced by any
    // scheduling/generation logic yet — they only shape the data so future
    // Shift Sensei features (consecutive-work calculations, automatic
    // scheduling, monthly balance stats) can reuse it without another
    // migration. ----
    //
    // Whether a day stamped with this shift type counts toward
    // consecutive-work-day calculations. Defaults to true; rest days
    // (休み/有休) are false. Used today by Shift Sensei's consecutive-work
    // calculations.
    countsAsConsecutiveWork: boolean("counts_as_consecutive_work").notNull().default(true),
    // Whether an automated scheduler is allowed to assign this shift type
    // on its own, as opposed to only being placed manually.
    canAiAutoAssign: boolean("can_ai_auto_assign").notNull().default(true),
    // Whether this shift type is counted in monthly workload/balance
    // statistics (e.g. shift-count summaries).
    includeInMonthlyStats: boolean("include_in_monthly_stats").notNull().default(true),
    // Marks a shift type that only ever represents a constraint (e.g. a
    // hope-off/must-work marker) and is never itself a real, assignable
    // work shift.
    constraintOnly: boolean("constraint_only").notNull().default(false),
    // Acceptable difference (±) from the per-staff average count of this
    // shift type in a month, edited on the Month-End Check Settings page.
    // Used by the recommendation engine's shift-balance check.
    balanceTolerance: integer("balance_tolerance").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("shift_types_code_unique").on(table.code)],
);

export const insertShiftTypeSchema = createInsertSchema(shiftTypesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShiftType = z.infer<typeof insertShiftTypeSchema>;
export type ShiftType = typeof shiftTypesTable.$inferSelect;
