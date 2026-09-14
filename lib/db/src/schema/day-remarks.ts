import { date, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One free-text 備考 (remarks) field per calendar date, independent of any
// staff member — unlike `shiftsTable`, which is keyed by (staffId, date).
// The grid's 備考 row shows/hides purely on the client; hiding never
// discards data, since the row is only a display toggle over this table.
export const dayRemarksTable = pgTable(
  "day_remarks",
  {
    id: serial("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("day_remarks_date_unique").on(table.date)],
);

export const insertDayRemarkSchema = createInsertSchema(dayRemarksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDayRemark = z.infer<typeof insertDayRemarkSchema>;
export type DayRemark = typeof dayRemarksTable.$inferSelect;
