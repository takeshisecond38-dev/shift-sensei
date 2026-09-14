import {
  boolean,
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";

// Constraints are entered in a dedicated "制約入力" phase, before normal
// shifts are assigned in "勤務入力":
//   - "hope_off" (休み固定): forces code to the current "holiday"-category
//     shift type's code (originally "休み", looked up dynamically so
//     renaming it in Settings never breaks this) and locks the cell
//     completely — it can never be edited or deleted except via the
//     one-tap removal gesture.
//   - "paid_leave" (有給固定): same full-lock behavior as "hope_off", but
//     forces code to the current "paid_leave"-category shift type's code
//     (originally "有休") instead.
//   - "attendance" (📌 出勤): marks the day as must-work only. It leaves
//     `code` null (and `locked` false) until a normal shift is assigned on
//     top of it later — it never auto-locks the cell, so ordinary painting
//     works normally. The 📌 marker itself is still only ever removable via
//     the one-tap removal gesture, purely because `constraintType` is set,
//     independent of the lock flag.
export const constraintTypeValues = ["hope_off", "attendance", "paid_leave"] as const;

export const shiftsTable = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staffTable.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    // Nullable: a "attendance" (出勤) constraint can exist with no shift
    // assigned yet — the cell stays blank (aside from the 📌 marker) until
    // a normal shift code is painted on top of it in Phase 2.
    //
    // Free text rather than a fixed enum: the set of valid codes is now
    // defined by the shift_types table (editable in Settings), not by a
    // hardcoded Postgres constraint. The API layer validates `code` against
    // the current shift types before writing.
    code: text("code"),
    constraintType: text("constraint_type", { enum: constraintTypeValues }),
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("shifts_staff_date_unique").on(table.staffId, table.date)],
);

export const insertShiftSchema = createInsertSchema(shiftsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shiftsTable.$inferSelect;
