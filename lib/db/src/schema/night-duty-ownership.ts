import { date, integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { unitsTable } from "./units";

// Internal data model only (no dedicated UI yet). Records which unit owns a
// given night's shift BEFORE an individual staff member is assigned to it —
// step 2 of the future workflow:
//   1. Constraint input
//   2. Night ownership assignment (this table)   <-- prepared now
//   3. Choose which staff member works each owned night
//   4. Fill day shifts
//   5. AI recommendations
export const nightDutyOwnershipTable = pgTable(
  "night_duty_ownership",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("night_duty_ownership_date_unique").on(table.date)],
);

export const insertNightDutyOwnershipSchema = createInsertSchema(nightDutyOwnershipTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNightDutyOwnership = z.infer<typeof insertNightDutyOwnershipSchema>;
export type NightDutyOwnership = typeof nightDutyOwnershipTable.$inferSelect;
