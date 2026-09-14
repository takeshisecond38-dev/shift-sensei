import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Short (1-3 char) label rendered on the schedule grid's avatar column.
  // Manually entered by the user — never auto-derived from `name`, since
  // simple prefix-of-name logic collides for names sharing a first
  // character/kanji (e.g. 山本 vs 山田) and can't handle transliterated
  // foreign names well (e.g. トゥーサン -> トゥ).
  shortLabel: text("short_label").notNull().default(""),
  color: text("color").notNull().default("#6366f1"),
  // Marks a unit leader. Not surfaced/enforced anywhere else yet — storage
  // only, for future leader-specific permissions/UI.
  isLeader: boolean("is_leader").notNull().default(false),
  // Reserved for a future "which shift types can this staff member be
  // assigned" restriction. Stores shift_types.id values; null/empty means
  // no restriction. Not enforced anywhere yet.
  availableShiftTypeIds: jsonb("available_shift_type_ids").$type<number[]>(),
  // Reserved for a future night-shift eligibility rule.
  nightShiftAvailable: boolean("night_shift_available").notNull().default(true),
  // Reserved for a future per-staff monthly shift-count cap.
  maxShifts: integer("max_shifts"),
  // Drives the exact row order on the schedule grid; also the
  // drag-reorder position in Staff Management.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertStaffSchema = createInsertSchema(staffTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
