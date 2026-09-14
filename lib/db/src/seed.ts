import { eq } from "drizzle-orm";
import { db } from "./client";
import { shiftTypesTable } from "./schema/shift-types";
import { unitsTable } from "./schema/units";
import { facilityRulesTable, type FacilityRuleConfig } from "./schema/facility-rules";

// The 10 shift codes that existed before shift types became editable.
// Seeded once (only if the table is empty) so existing data keeps working
// with identical stamps, colors, and order after the migration.
const DEFAULT_SHIFT_TYPES = [
  {
    code: "A",
    name: "Aシフト",
    shortLabel: "A",
    bgColor: "#fb923c",
    textColor: "#000000",
    startTime: "07:00",
    endTime: "16:00",
    workingHours: 8,
    category: "day_shift" as const,
  },
  {
    code: "B2",
    name: "B2シフト",
    shortLabel: "B2",
    bgColor: "#fb923c",
    textColor: "#000000",
    startTime: "09:00",
    endTime: "18:00",
    workingHours: 8,
    category: "day_shift" as const,
  },
  {
    code: "C3",
    name: "C3シフト",
    shortLabel: "C3",
    bgColor: "#fb923c",
    textColor: "#000000",
    startTime: "11:00",
    endTime: "20:00",
    workingHours: 8,
    category: "day_shift" as const,
  },
  {
    code: "D",
    name: "Dシフト",
    shortLabel: "D",
    bgColor: "#fb923c",
    textColor: "#000000",
    startTime: "13:00",
    endTime: "22:00",
    workingHours: 8,
    category: "day_shift" as const,
  },
  {
    code: "E2",
    name: "E2シフト",
    shortLabel: "E2",
    bgColor: "#fb923c",
    textColor: "#000000",
    startTime: "16:00",
    endTime: "01:00",
    workingHours: 8,
    category: "day_shift" as const,
  },
  {
    code: "2夜",
    name: "夜勤",
    shortLabel: "2夜",
    bgColor: "#0f1f4d",
    textColor: "#ffffff",
    startTime: "17:00",
    endTime: "09:00",
    workingHours: 16,
    category: "night_shift" as const,
  },
  {
    code: "特2夜",
    name: "特別夜勤",
    shortLabel: "特2夜",
    bgColor: "#0f1f4d",
    textColor: "#ffffff",
    startTime: "17:00",
    endTime: "09:00",
    workingHours: 16,
    category: "night_shift" as const,
  },
  {
    code: "明け",
    name: "明け",
    shortLabel: "明け",
    bgColor: "#bae6fd",
    textColor: "#000000",
    startTime: null,
    endTime: null,
    workingHours: 0,
    category: "after_night" as const,
  },
  {
    code: "休み",
    name: "休み",
    shortLabel: "休み",
    bgColor: "#ffffff",
    textColor: "#000000",
    startTime: null,
    endTime: null,
    workingHours: 0,
    category: "holiday" as const,
    countsAsConsecutiveWork: false,
  },
  {
    code: "有休",
    name: "有給休暇",
    shortLabel: "有休",
    bgColor: "#ffffff",
    textColor: "#000000",
    startTime: null,
    endTime: null,
    workingHours: 8,
    category: "paid_leave" as const,
    countsAsConsecutiveWork: false,
  },
];

export async function ensureShiftTypesSeeded(): Promise<void> {
  const existing = await db.select({ id: shiftTypesTable.id }).from(shiftTypesTable).limit(1);
  if (existing.length > 0) return;

  await db.insert(shiftTypesTable).values(
    DEFAULT_SHIFT_TYPES.map((shiftType, index) => ({
      ...shiftType,
      sortOrder: index,
    })),
  );
}

// The six 東町 facility rules described in the Phase 7 spec. All six use
// the same "staffing_count" evaluator with different config — no per-rule
// code, so adding a 7th rule (or a 西町/南町 rule set later) is purely a
// data change.
function eastTownRules(unitId: number): Array<{
  ruleType: "staffing_count";
  name: string;
  description: string;
  config: FacilityRuleConfig;
  unitId: number;
}> {
  return [
    {
      ruleType: "staffing_count",
      name: "明けがいる日はA勤務不要",
      description: "明けの職員がいる日は、A勤務を配置する必要はありません。",
      unitId,
      config: {
        targetCodes: ["A"],
        comparison: "min",
        count: 0,
        condition: { codes: ["明け"], mode: "present" },
      },
    },
    {
      ruleType: "staffing_count",
      name: "明けがいない日はA勤務が最低1人",
      description: "明けの職員がいない日は、A勤務を最低1人配置してください。",
      unitId,
      config: {
        targetCodes: ["A"],
        comparison: "min",
        count: 1,
        condition: { codes: ["明け"], mode: "absent" },
      },
    },
    {
      ruleType: "staffing_count",
      name: "B2勤務は毎日最低1人",
      description: "B2勤務は毎日最低1人配置してください。",
      unitId,
      config: {
        targetCodes: ["B2"],
        comparison: "min",
        count: 1,
        condition: null,
      },
    },
    {
      ruleType: "staffing_count",
      name: "夜勤がいる日はD勤務不要",
      description: "夜勤（2夜・特2夜）の職員がいる日は、D勤務を配置する必要はありません。",
      unitId,
      config: {
        targetCodes: ["D"],
        comparison: "min",
        count: 0,
        condition: { codes: ["2夜", "特2夜"], mode: "present" },
      },
    },
    {
      ruleType: "staffing_count",
      name: "夜勤がいない日はD勤務が最低1人",
      description: "夜勤（2夜・特2夜）の職員がいない日は、D勤務を最低1人配置してください。",
      unitId,
      config: {
        targetCodes: ["D"],
        comparison: "min",
        count: 1,
        condition: { codes: ["2夜", "特2夜"], mode: "absent" },
      },
    },
    {
      ruleType: "staffing_count",
      name: "E2勤務は毎日最低1人",
      description: "E2勤務は毎日最低1人配置してください。",
      unitId,
      config: {
        targetCodes: ["E2"],
        comparison: "min",
        count: 1,
        condition: null,
      },
    },
  ];
}

async function getOrCreateUnit(name: string) {
  let [unit] = await db.select().from(unitsTable).where(eq(unitsTable.name, name)).limit(1);
  if (!unit) {
    const all = await db.select().from(unitsTable);
    const sortOrder = all.reduce((max, u) => Math.max(max, u.sortOrder), -1) + 1;
    [unit] = await db.insert(unitsTable).values({ name, sortOrder }).returning();
  }
  return unit ?? null;
}

// Night Duty Ownership (シフト先生's per-night "which unit is on the hook"
// row above the schedule grid) cycles blank → ○ → ❌, where blank = 西町
// (no dedicated row, the default/no-ownership state), ○ = 東町, and
// ❌ = 中央・南町 combined (a night where East/West don't need to provide
// night duty). Only 東町 and 中央・南町 need a real `units` row since
// blank/西町 never needs to be looked up by id.
export async function ensureUnitsSeeded(): Promise<void> {
  await getOrCreateUnit("東町");
  await getOrCreateUnit("中央・南町");
}

export async function ensureFacilityRulesSeeded(): Promise<void> {
  const existing = await db.select({ id: facilityRulesTable.id }).from(facilityRulesTable).limit(1);
  if (existing.length > 0) return;

  const eastTown = await getOrCreateUnit("東町");
  if (!eastTown) return;

  await db.insert(facilityRulesTable).values(
    eastTownRules(eastTown.id).map((rule, index) => ({
      ...rule,
      sortOrder: index,
    })),
  );
}
