import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { unitsTable } from "./units";

// Facility rules are stored as *data*, not hardcoded if/else logic, so new
// rules can be added, edited, and toggled from the Facility Rules settings
// screen without a code change. `ruleType` selects which evaluator in
// facility-rule-engine.ts (api-server) interprets `config`:
//  - "staffing_count": require a minimum/maximum number of staff on a given
//    shift code that day, optionally only when another shift code is
//    present/absent that day (the original six 東町 rules).
//  - "staff_day_restriction": a specific staff member should never receive
//    one of `disallowedCodes` on a given day-of-week. Produced by "Teach
//    Shift Sensei" from phrasing like "山本さんは土曜日は夜勤を入れません".
//  - "staff_fixed_shift": a specific staff member should only ever receive
//    one of `allowedCodes` (holiday/paid-leave codes are always allowed).
//    Produced by "Teach Shift Sensei" from phrasing like "松村さんは基本B2だけ".
// New rule types can keep being registered the same way, each with its own
// `config` shape, without another migration.
export const facilityRuleTypeValues = [
  "staffing_count",
  "staff_day_restriction",
  "staff_fixed_shift",
] as const;
export type FacilityRuleType = (typeof facilityRuleTypeValues)[number];

// Where a rule came from — shown as a separate "学習ルール" section in the
// Facility Rules screen so the manager can tell house rules apart from
// rules Shift Sensei picked up from AI相談 conversation ("Teach Shift
// Sensei").
export const facilityRuleSourceValues = ["facility", "learned"] as const;

// A condition gating when a "staffing_count" rule applies that day, based
// on whether any of `codes` was assigned to *any* staff member that day.
// Used to express e.g. "A勤務が最低1人必要（明けがいない日）".
export interface FacilityRuleCondition {
  codes: string[];
  mode: "present" | "absent";
}

// Every field is optional because which ones are meaningful depends on
// `ruleType` (see comment above) — evaluators in facility-rule-engine.ts
// read only the fields relevant to their own type and fall back sensibly
// (empty array / 0) if a field the type needs is absent, rather than the
// schema forcing every rule type to populate fields it doesn't use.
export interface FacilityRuleConfig {
  // ---- staffing_count ----
  // Shift codes counted toward satisfying the rule (e.g. ["A"], or
  // ["2夜", "特2夜"] to treat both night-shift variants as one group).
  targetCodes?: string[];
  comparison?: "min" | "max";
  count?: number;
  condition?: FacilityRuleCondition | null;
  // ---- staff_day_restriction / staff_fixed_shift ----
  staffId?: number;
  // 0 = Sunday ... 6 = Saturday (staff_day_restriction only).
  dayOfWeek?: number;
  disallowedCodes?: string[];
  allowedCodes?: string[];
}

export const facilityRulesTable = pgTable("facility_rules", {
  id: serial("id").primaryKey(),
  // Which unit (e.g. 東町) this rule belongs to. Nullable so a rule can
  // eventually apply facility-wide once multiple units exist.
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  ruleType: text("rule_type", { enum: facilityRuleTypeValues })
    .notNull()
    .default("staffing_count"),
  // "facility" = configured directly on the Facility Rules screen.
  // "learned" = accepted from a "Teach Shift Sensei" suggestion in AI相談.
  source: text("source", { enum: facilityRuleSourceValues }).notNull().default("facility"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<FacilityRuleConfig>().notNull(),
  // Drives display order in the rule list.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFacilityRuleSchema = createInsertSchema(facilityRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFacilityRule = z.infer<typeof insertFacilityRuleSchema>;
export type FacilityRule = typeof facilityRulesTable.$inferSelect;
