import { db, staffTable, shiftTypesTable } from "@workspace/db";
import type { aiConsultIntentTypeValues, FacilityRuleType, FacilityRuleConfig } from "@workspace/db";
import { summarizeFacilityRuleStatus } from "./facility-rule-engine";
import {
  computeFillPlan,
  computeNightDutyDistributionPlan,
  computeMinRestPlan,
  resolveDefaultCode,
  type PlannedChange,
} from "./ai-execution-planner";

// Prototype-quality intent recognizer for the AI相談 chat. No real AI/LLM
// is involved: it just pattern-matches a small set of example Japanese
// phrasings against keywords, so the chat has *something* functional to
// show while the data model (see ai-consult-messages.ts) and a real
// recommendation/preference pipeline are prepared behind it. Easy to
// extend with more patterns, or to swap for a real LLM call later without
// changing the API surface.

export type IntentType = (typeof aiConsultIntentTypeValues)[number];

export interface ExecutionPlanPreview {
  changeCount: number;
  reason: string;
  changes: PlannedChange[];
}

export interface ProposedRulePreview {
  ruleType: FacilityRuleType;
  name: string;
  description: string;
  config: FacilityRuleConfig;
}

export interface MatchedIntent {
  intentType: IntentType;
  staffId: number | null;
  intentPayload: { staffName?: string; shiftCode?: string } | null;
  reply: string;
  // Only set for execute_plan_request / teach_candidate — carried on the
  // *assistant* message so the chat UI can render a Preview/Save-Cancel
  // card. Never applied/saved automatically.
  assistantPayload?: {
    plan?: ExecutionPlanPreview;
    proposedRule?: ProposedRulePreview;
    status: "pending";
  };
}

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"] as const;

async function findMentionedStaffName(content: string): Promise<{ id: number; name: string } | null> {
  const staff = await db.select({ id: staffTable.id, name: staffTable.name }).from(staffTable);
  const match = staff.find((s) => content.includes(s.name));
  return match ?? null;
}

async function findMentionedShiftCode(content: string): Promise<string | null> {
  const shiftTypes = await db.select({ code: shiftTypesTable.code }).from(shiftTypesTable);
  const match = shiftTypes.find((t) => content.includes(t.code));
  return match?.code ?? null;
}

function findMentionedWeekday(content: string): number | null {
  const index = WEEKDAY_NAMES.findIndex((name) => content.includes(`${name}曜`));
  return index === -1 ? null : index;
}

// ---- Teach Shift Sensei: recognizes a staff-specific standing
// preference and proposes it as a "learned" facility rule for the
// manager to confirm. ----
async function matchTeachCandidate(content: string): Promise<MatchedIntent | null> {
  const mentionedStaff = await findMentionedStaffName(content);
  if (!mentionedStaff) return null;

  // "松村さんは基本B2だけ" / "...はB2固定で" (without an explicit weekday)
  const weekday = findMentionedWeekday(content);
  if (/(基本|だけ)/.test(content) && weekday === null) {
    const shiftCode = await findMentionedShiftCode(content);
    if (!shiftCode) return null;
    const config: FacilityRuleConfig = {
      staffId: mentionedStaff.id,
      allowedCodes: [shiftCode],
    };
    return {
      intentType: "teach_candidate",
      staffId: mentionedStaff.id,
      intentPayload: { staffName: mentionedStaff.name, shiftCode },
      reply: `承知しました。「${mentionedStaff.name}さんは基本${shiftCode}だけ」という設定を施設ルールとして保存できます。よろしいですか？`,
      assistantPayload: {
        proposedRule: {
          ruleType: "staff_fixed_shift",
          name: `${mentionedStaff.name}さんは${shiftCode}固定`,
          description: `AI相談で学習: ${mentionedStaff.name}さんは基本的に${shiftCode}のみ（希望休・有休は除く）。`,
          config,
        },
        status: "pending",
      },
    };
  }

  return null;
}

// ---- Partial AI Execution: recognizes a "fill in the blanks" request
// and computes a previewable change-set. ----
async function matchExecutePlanRequest(content: string, currentMonth: string): Promise<MatchedIntent | null> {
  if (!/(埋めて|配置してください|入力して)/.test(content)) return null;

  const mentionedStaff = await findMentionedStaffName(content);
  const mentionedCode = await findMentionedShiftCode(content);

  let code: string | null = mentionedCode;
  let reason: string;
  if (mentionedStaff && code) {
    reason = `${mentionedStaff.name}さんの${currentMonth}の空欄（希望休を除く）を「${code}」で埋めます。`;
  } else if (/夜勤/.test(content)) {
    code = code ?? (await resolveDefaultCode("night"));
    if (!code) return null;
    reason = `${currentMonth}の空欄（希望休を除く）を夜勤「${code}」で埋めます。`;
  } else if (/空欄/.test(content)) {
    code = code ?? (await resolveDefaultCode("day"));
    if (!code) return null;
    reason = `${currentMonth}の空欄（希望休を除く）を「${code}」で埋めます。`;
  } else if (code) {
    reason = `${currentMonth}の空欄（希望休を除く）を「${code}」で埋めます。`;
  } else {
    return null;
  }

  const { changes } = await computeFillPlan({
    month: currentMonth,
    code,
    staffId: mentionedStaff?.id ?? null,
  });

  const reply =
    changes.length > 0
      ? `${reason}\n対象は${changes.length}件です。内容を確認して「実行する」を押してください。`
      : `${reason}\n該当する空欄が見つかりませんでした（希望休・既存のシフト・ロックされたセルは対象外です）。`;

  return {
    intentType: "execute_plan_request",
    staffId: mentionedStaff?.id ?? null,
    intentPayload: {
      ...(mentionedStaff ? { staffName: mentionedStaff.name } : {}),
      ...(code ? { shiftCode: code } : {}),
    },
    reply,
    assistantPayload: {
      plan: { changeCount: changes.length, reason, changes },
      status: "pending",
    },
  };
}

// ---- Night Duty Distribution: assigns night shifts to 〇-marked dates
// with optional per-person cap for regular (non-leader) staff. ----
async function matchNightDutyDistribution(content: string, currentMonth: string): Promise<MatchedIntent | null> {
  // Trigger on: ○/〇 + 夜勤、または ○/〇 + 均等/割り当て系キーワード
  // (シフトコード名「特2夜」など「夜勤」を含まない表記にも対応)
  const isNightDistribution =
    (/(○|〇)/.test(content) && /夜勤/.test(content)) ||
    (/(○|〇)/.test(content) && /(均等|自動割|割り?当て|配分|分配|配置)/.test(content)) ||
    /夜勤.*(均等|自動割|割り?当て|配分|分配|配置|埋め)/.test(content) ||
    /(均等|自動割).*(夜勤)/.test(content);

  if (!isNightDistribution) return null;

  // Parse an optional numeric cap for regular (non-leader) staff.
  // Matches patterns like "4回上限", "4回まで", "リーダー以外4回", "一般4回".
  const capMatch = content.match(/(\d+)\s*回/);
  const regularStaffCap = capMatch ? Number(capMatch[1]) : undefined;

  // Parse an optional target shift code (e.g. "特2夜で割り当て").
  const nightShiftCode = await findMentionedShiftCode(content) ?? undefined;

  const { changes, nightDates, eligibleStaffCount, leaderStaffCount, regularStaffCount } =
    await computeNightDutyDistributionPlan({ month: currentMonth, regularStaffCap, nightShiftCode });

  if (nightDates.length === 0) {
    return {
      intentType: "execute_plan_request",
      staffId: null,
      intentPayload: null,
      reply: `${currentMonth}のシフト表に○マークが付いている日付が見つかりませんでした。シフト表の夜勤担当行で○を付けてから再度お試しください。`,
    };
  }

  if (eligibleStaffCount === 0) {
    return {
      intentType: "execute_plan_request",
      staffId: null,
      intentPayload: null,
      reply: `夜勤対応可能なスタッフが見つかりませんでした。スタッフ管理の「対応可能なシフト」で夜勤を有効にしてください。`,
    };
  }

  const codeLabel = nightShiftCode ?? "夜勤";
  let reason: string;
  if (regularStaffCap && regularStaffCap > 0 && leaderStaffCount > 0) {
    reason =
      `${currentMonth}のシフト表の○日（${nightDates.length}日）に「${codeLabel}」を割り当てます。\n` +
      `一般スタッフ${regularStaffCount}名は${regularStaffCap}回上限、` +
      `リーダー${leaderStaffCount}名が残りを担当します。`;
  } else {
    reason =
      `${currentMonth}のシフト表の○日（${nightDates.length}日）に「${codeLabel}」を均等に割り当てます。` +
      `対象スタッフ${eligibleStaffCount}名で公平に分配します。`;
  }

  const reply =
    changes.length > 0
      ? `${reason}\n割り当て案${changes.length}件を作成しました。内容を確認して「実行する」を押してください。`
      : `○マークの日付（${nightDates.length}日）はすでに夜勤が割り当て済みか、対応可能なスタッフが希望休のため、新たに割り当てる枠がありませんでした。`;

  return {
    intentType: "execute_plan_request",
    staffId: null,
    intentPayload: null,
    reply,
    assistantPayload: {
      plan: { changeCount: changes.length, reason, changes },
      status: "pending",
    },
  };
}

// ---- Minimum Rest Days: ensures every staff reaches a minimum number of
// rest days per month, counting hope_off / paid_leave / existing holiday codes. ----
async function matchMinRestDays(content: string, currentMonth: string): Promise<MatchedIntent | null> {
  const isMinRest =
    /(最低|少なくとも|最小).{0,8}(休み|休日|オフ)/.test(content) ||
    /(休み|休日).{0,8}(最低|少なくとも|最小|確保|振り分け)/.test(content) ||
    /(全員).{0,10}(休み|休日).{0,10}(振り分け|確保|割り当て|配分)/.test(content);
  if (!isMinRest) return null;

  const countMatch = content.match(/(\d+)\s*回/);
  const minCount = countMatch ? Number(countMatch[1]) : 9;

  const { changes, staffSummary } = await computeMinRestPlan({ month: currentMonth, minCount });

  const shortfallStaff = staffSummary.filter((s) => s.added > 0);
  const reason =
    `${currentMonth}の休み日数が${minCount}回未満のスタッフ（${shortfallStaff.length}名）に休みを追加します。\n` +
    `希望休・有給はすでに休みとしてカウントしています。`;

  const reply =
    changes.length > 0
      ? `${reason}\n割り当て案${changes.length}件を作成しました。内容を確認して「実行する」を押してください。`
      : `全スタッフがすでに${minCount}回以上の休みを確保しています。追加の割り当ては不要です。`;

  return {
    intentType: "execute_plan_request",
    staffId: null,
    intentPayload: null,
    reply,
    assistantPayload: {
      plan: { changeCount: changes.length, reason, changes },
      status: "pending",
    },
  };
}

export async function matchIntent(content: string, currentMonth: string): Promise<MatchedIntent | null> {
  if (/(施設ルール|ルール違反|ルールを守|ルール通り)/.test(content)) {
    const reply = await summarizeFacilityRuleStatus(currentMonth);
    return {
      intentType: "facility_rule_status",
      staffId: null,
      intentPayload: null,
      reply,
    };
  }

  // Night duty distribution check before generic fill, because "夜勤を均等割り"
  // would otherwise get caught by the generic "埋めて" pattern.
  const nightDuty = await matchNightDutyDistribution(content, currentMonth);
  if (nightDuty) return nightDuty;

  // Minimum rest days check before generic fill so "休みを振り分け" is
  // caught here rather than falling through to matchExecutePlanRequest.
  const minRest = await matchMinRestDays(content, currentMonth);
  if (minRest) return minRest;

  const executePlan = await matchExecutePlanRequest(content, currentMonth);
  if (executePlan) return executePlan;

  const teachCandidate = await matchTeachCandidate(content);
  if (teachCandidate) return teachCandidate;

  const mentionedStaff = await findMentionedStaffName(content);

  if (/夜勤/.test(content) && /(減|少なく|なし)/.test(content)) {
    return {
      intentType: "reduce_night_shifts",
      staffId: mentionedStaff?.id ?? null,
      intentPayload: mentionedStaff ? { staffName: mentionedStaff.name } : null,
      reply: mentionedStaff
        ? `承知しました。${mentionedStaff.name}さんの夜勤回数を減らす希望として記録しました。今後の「おすすめ」チェックの参考情報として活用します。`
        : "承知しました。夜勤を減らしたいというご希望として記録しました。対象スタッフ名も伝えていただけると、より具体的に反映できます。",
    };
  }

  if (/連勤/.test(content) && /(減|短く|少なく)/.test(content)) {
    return {
      intentType: "reduce_consecutive_work",
      staffId: mentionedStaff?.id ?? null,
      intentPayload: mentionedStaff ? { staffName: mentionedStaff.name } : null,
      reply: mentionedStaff
        ? `承知しました。${mentionedStaff.name}さんの連勤日数を減らす希望として記録しました。`
        : "承知しました。連勤を減らしたいというご希望として記録しました。",
    };
  }

  if (/(土日|週末)/.test(content) && /休/.test(content)) {
    return {
      intentType: "weekend_off",
      staffId: mentionedStaff?.id ?? null,
      intentPayload: mentionedStaff ? { staffName: mentionedStaff.name } : null,
      reply: mentionedStaff
        ? `承知しました。${mentionedStaff.name}さんの週末休みの希望として記録しました。`
        : "承知しました。週末を休みにしたいというご希望として記録しました。",
    };
  }

  if (/固定/.test(content)) {
    const shiftCode = await findMentionedShiftCode(content);
    return {
      intentType: "fixed_shift_code",
      staffId: mentionedStaff?.id ?? null,
      intentPayload: {
        ...(mentionedStaff ? { staffName: mentionedStaff.name } : {}),
        ...(shiftCode ? { shiftCode } : {}),
      },
      reply:
        mentionedStaff && shiftCode
          ? `承知しました。${mentionedStaff.name}さんを「${shiftCode}」固定にする希望として記録しました。`
          : "承知しました。シフトの固定に関するご希望として記録しました。対象スタッフとシフトの種類も伝えていただけると助かります。",
    };
  }

  return null;
}

export function fallbackReply(): string {
  return (
    "まだ試作段階のため、あらかじめ用意した返答にのみ対応しています。\n" +
    "以下のテンプレートを参考に話しかけてみてください：\n\n" +
    "・「○の日に夜勤を均等に割り当ててください」\n" +
    "・「施設ルールを守っていますか？」\n" +
    "・「全員の空欄を日勤で埋めてください」\n" +
    "・「○○さんを希望休以外△△で埋めてください」\n" +
    "・「○○さんの夜勤を減らしてください」\n" +
    "・「○○さんは基本△△だけ」"
  );
}
