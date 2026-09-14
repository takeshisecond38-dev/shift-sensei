import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, facilityRulesTable, shiftsTable, staffTable, shiftTypesTable, type FacilityRule } from "@workspace/db";
import type { Recommendation } from "./recommendation-engine";

// Generic, data-driven facility rule engine. Rules live in the
// `facility_rules` table (see lib/db/src/schema/facility-rules.ts) — this
// file has no per-rule if/else; it only has one evaluator per `ruleType`,
// looked up in `RULE_EVALUATORS`. Adding a new rule (even a materially
// different kind of rule) means adding a new entry to that config-driven
// table via the Facility Rules screen (or "Teach Shift Sensei" in AI相談
// for staff_day_restriction/staff_fixed_shift) — never touching the
// existing rules' logic. For a genuinely new rule *type*, add one new
// evaluator function here.

function daysInMonthList(month: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("month must be in YYYY-MM format");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return Array.from({ length: daysInMonth }, (_, i) => `${monthPrefix}-${String(i + 1).padStart(2, "0")}`);
}

interface RuleEvalContext {
  date: string;
  codeCountsThatDay: Map<string, number>;
  shiftCodeFor: (staffId: number) => string | null;
  staffNameById: Map<number, string>;
  holidayOrPaidLeaveCodes: Set<string>;
}

type RuleEvaluator = (rule: FacilityRule, ctx: RuleEvalContext) => Recommendation | null;

function evaluateStaffingCount(rule: FacilityRule, ctx: RuleEvalContext): Recommendation | null {
  const { config } = rule;
  const targetCodes = config.targetCodes ?? [];
  const comparison = config.comparison ?? "min";
  const count = config.count ?? 0;

  if (config.condition) {
    const conditionCodePresent = config.condition.codes.some(
      (code) => (ctx.codeCountsThatDay.get(code) ?? 0) > 0,
    );
    const conditionApplies =
      config.condition.mode === "present" ? conditionCodePresent : !conditionCodePresent;
    if (!conditionApplies) return null;
  }

  const actualCount = targetCodes.reduce((sum, code) => sum + (ctx.codeCountsThatDay.get(code) ?? 0), 0);
  const targetLabel = targetCodes.join("/");
  const day = Number(ctx.date.slice(-2));

  if (comparison === "min" && actualCount < count) {
    return {
      severity: actualCount === 0 ? "critical" : "warning",
      type: "facility_rule",
      ruleId: rule.id,
      date: ctx.date,
      message: `${day}日は${targetLabel}勤務が不足しています（現在${actualCount}人、最低${count}人必要）。${targetLabel}勤務を追加してください。`,
    };
  }

  if (comparison === "max" && actualCount > count) {
    return {
      severity: "warning",
      type: "facility_rule",
      ruleId: rule.id,
      date: ctx.date,
      message: `${day}日は${targetLabel}勤務が多すぎます（現在${actualCount}人、最大${count}人まで）。${targetLabel}勤務を減らしてください。`,
    };
  }

  return null;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// "山本さんは土曜日は夜勤を入れません" — learned via Teach Shift Sensei.
function evaluateStaffDayRestriction(rule: FacilityRule, ctx: RuleEvalContext): Recommendation | null {
  const { config } = rule;
  if (config.staffId === undefined || config.dayOfWeek === undefined) return null;

  const [year, month, day] = ctx.date.split("-").map(Number);
  const actualDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (actualDayOfWeek !== config.dayOfWeek) return null;

  const code = ctx.shiftCodeFor(config.staffId);
  if (!code) return null;
  if (!(config.disallowedCodes ?? []).includes(code)) return null;

  const name = ctx.staffNameById.get(config.staffId) ?? "スタッフ";
  const dayLabel = `${WEEKDAY_LABELS[config.dayOfWeek]}曜日`;
  return {
    severity: "warning",
    type: "facility_rule",
    ruleId: rule.id,
    staffId: config.staffId,
    date: ctx.date,
    message: `${day}日（${dayLabel}）に${name}さんへ「${code}」が入っていますが、学習ルール『${rule.name}』では${dayLabel}に夜勤を入れないことになっています。`,
  };
}

// "松村さんは基本B2だけ" — learned via Teach Shift Sensei. Holiday/paid-leave
// codes are always allowed regardless of `allowedCodes`.
function evaluateStaffFixedShift(rule: FacilityRule, ctx: RuleEvalContext): Recommendation | null {
  const { config } = rule;
  if (config.staffId === undefined) return null;

  const code = ctx.shiftCodeFor(config.staffId);
  if (!code) return null;
  if ((config.allowedCodes ?? []).includes(code)) return null;
  if (ctx.holidayOrPaidLeaveCodes.has(code)) return null;

  const name = ctx.staffNameById.get(config.staffId) ?? "スタッフ";
  const day = Number(ctx.date.slice(-2));
  const allowedLabel = (config.allowedCodes ?? []).join("/");
  return {
    severity: "warning",
    type: "facility_rule",
    ruleId: rule.id,
    staffId: config.staffId,
    date: ctx.date,
    message: `${day}日に${name}さんへ「${code}」が入っていますが、学習ルール『${rule.name}』では基本${allowedLabel}固定になっています。`,
  };
}

const RULE_EVALUATORS: Record<FacilityRule["ruleType"], RuleEvaluator> = {
  staffing_count: evaluateStaffingCount,
  staff_day_restriction: evaluateStaffDayRestriction,
  staff_fixed_shift: evaluateStaffFixedShift,
};

export async function computeFacilityRuleRecommendations(month: string): Promise<Recommendation[]> {
  const dates = daysInMonthList(month);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  if (!firstDay || !lastDay) return [];

  const rules = await db
    .select()
    .from(facilityRulesTable)
    .where(eq(facilityRulesTable.enabled, true))
    .orderBy(asc(facilityRulesTable.sortOrder), asc(facilityRulesTable.id));
  if (rules.length === 0) return [];

  const needsStaffContext = rules.some((r) => r.ruleType !== "staffing_count");

  const shifts = await db
    .select({ staffId: shiftsTable.staffId, date: shiftsTable.date, code: shiftsTable.code })
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, firstDay), lte(shiftsTable.date, lastDay)));

  const codeCountsByDate = new Map<string, Map<string, number>>();
  const shiftByStaffAndDate = new Map<string, string | null>();
  for (const shift of shifts) {
    shiftByStaffAndDate.set(`${shift.staffId}|${shift.date}`, shift.code);
    if (!shift.code) continue;
    const counts = codeCountsByDate.get(shift.date) ?? new Map<string, number>();
    counts.set(shift.code, (counts.get(shift.code) ?? 0) + 1);
    codeCountsByDate.set(shift.date, counts);
  }

  const staffNameById = new Map<number, string>();
  const holidayOrPaidLeaveCodes = new Set<string>();
  if (needsStaffContext) {
    const staffRows = await db.select({ id: staffTable.id, name: staffTable.name }).from(staffTable);
    for (const s of staffRows) staffNameById.set(s.id, s.name);
    const shiftTypeRows = await db
      .select({ code: shiftTypesTable.code, category: shiftTypesTable.category })
      .from(shiftTypesTable);
    for (const t of shiftTypeRows) {
      if (t.category === "holiday" || t.category === "paid_leave") holidayOrPaidLeaveCodes.add(t.code);
    }
  }

  const recommendations: Recommendation[] = [];
  for (const date of dates) {
    const codeCountsThatDay = codeCountsByDate.get(date) ?? new Map<string, number>();
    const ctx: RuleEvalContext = {
      date,
      codeCountsThatDay,
      shiftCodeFor: (staffId) => shiftByStaffAndDate.get(`${staffId}|${date}`) ?? null,
      staffNameById,
      holidayOrPaidLeaveCodes,
    };
    for (const rule of rules) {
      const evaluator = RULE_EVALUATORS[rule.ruleType];
      if (!evaluator) continue;
      const recommendation = evaluator(rule, ctx);
      if (recommendation) recommendations.push(recommendation);
    }
  }

  return recommendations;
}

// Per-day understaffing signal for the shift grid's date-header coloring.
// Deliberately restricted to `staffing_count` rules only (the "required
// headcount" rules) — `staff_day_restriction`/`staff_fixed_shift` findings
// are per-staff preference violations, not staffing shortages, and must
// never turn a date header red/yellow. Returns the worst severity found
// for each date that has at least one finding; dates with no finding are
// omitted (caller treats "absent" as normal/no-color).
export async function computeDailyStaffingSeverity(
  month: string,
): Promise<Map<string, "critical" | "warning">> {
  const dates = daysInMonthList(month);
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];
  const result = new Map<string, "critical" | "warning">();
  if (!firstDay || !lastDay) return result;

  const rules = await db
    .select()
    .from(facilityRulesTable)
    .where(and(eq(facilityRulesTable.enabled, true), eq(facilityRulesTable.ruleType, "staffing_count")));
  if (rules.length === 0) return result;

  const shifts = await db
    .select({ staffId: shiftsTable.staffId, date: shiftsTable.date, code: shiftsTable.code })
    .from(shiftsTable)
    .where(and(gte(shiftsTable.date, firstDay), lte(shiftsTable.date, lastDay)));

  const codeCountsByDate = new Map<string, Map<string, number>>();
  for (const shift of shifts) {
    if (!shift.code) continue;
    const counts = codeCountsByDate.get(shift.date) ?? new Map<string, number>();
    counts.set(shift.code, (counts.get(shift.code) ?? 0) + 1);
    codeCountsByDate.set(shift.date, counts);
  }

  for (const date of dates) {
    const codeCountsThatDay = codeCountsByDate.get(date) ?? new Map<string, number>();
    const ctx: RuleEvalContext = {
      date,
      codeCountsThatDay,
      shiftCodeFor: () => null,
      staffNameById: new Map(),
      holidayOrPaidLeaveCodes: new Set(),
    };
    let worst: "critical" | "warning" | null = null;
    for (const rule of rules) {
      const finding = evaluateStaffingCount(rule, ctx);
      if (!finding) continue;
      if (finding.severity === "critical") worst = "critical";
      else if (worst !== "critical") worst = "warning";
    }
    if (worst) result.set(date, worst);
  }

  return result;
}

// Used by AI相談 to answer "施設ルールを守っていますか？"-style questions with
// a compact, actionable summary rather than the full per-day list.
export async function summarizeFacilityRuleStatus(month: string): Promise<string> {
  const findings = await computeFacilityRuleRecommendations(month);
  if (findings.length === 0) {
    return `${month}は施設ルールを満たしています。`;
  }

  const lines = findings.slice(0, 5).map((f) => `・${f.message}`);
  const more = findings.length > 5 ? `\n他${findings.length - 5}件の指摘があります。` : "";
  return `${month}の施設ルールの確認結果です。\n${lines.join("\n")}${more}`;
}
