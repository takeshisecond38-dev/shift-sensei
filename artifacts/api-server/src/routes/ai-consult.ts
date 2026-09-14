import { Router, type IRouter } from "express";
import { asc, and, eq } from "drizzle-orm";
import {
  db,
  aiConsultMessagesTable,
  facilityRulesTable,
  shiftsTable,
  type AiConsultMessage,
} from "@workspace/db";
import {
  ListAiConsultMessagesResponse,
  SendAiConsultMessageBody,
  SendAiConsultMessageResponse,
  ExecuteAiConsultPlanParams,
  ExecuteAiConsultPlanResponse,
  SaveAiConsultProposedRuleParams,
  SaveAiConsultProposedRuleResponse,
  DismissAiConsultSuggestionParams,
  DismissAiConsultSuggestionResponse,
} from "@workspace/api-zod";
import { matchIntent, fallbackReply } from "../services/ai-consult-intent-matcher";
import { isKnownShiftCode, autoPlaceFollowingDayOff } from "./shifts";

const router: IRouter = Router();

async function loadPendingSuggestion(id: number): Promise<AiConsultMessage | null> {
  const [message] = await db.select().from(aiConsultMessagesTable).where(eq(aiConsultMessagesTable.id, id));
  return message ?? null;
}

router.get("/ai-consult/messages", async (_req, res): Promise<void> => {
  const messages = await db
    .select()
    .from(aiConsultMessagesTable)
    .orderBy(asc(aiConsultMessagesTable.createdAt), asc(aiConsultMessagesTable.id));
  res.json(ListAiConsultMessagesResponse.parse(messages));
});

router.post("/ai-consult/messages", async (req, res): Promise<void> => {
  const parsed = SendAiConsultMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Use the month the manager has open in the shift table when provided;
  // fall back to the current calendar month only as a last resort.
  const currentMonth = parsed.data.month ?? new Date().toISOString().slice(0, 7);
  const matched = await matchIntent(parsed.data.content, currentMonth);

  const [userMessage] = await db
    .insert(aiConsultMessagesTable)
    .values({
      role: "user",
      content: parsed.data.content,
      staffId: matched?.staffId ?? null,
      intentType: matched?.intentType ?? null,
      intentPayload: matched?.intentPayload ?? null,
    })
    .returning();

  const [assistantMessage] = await db
    .insert(aiConsultMessagesTable)
    .values({
      role: "assistant",
      content: matched?.reply ?? fallbackReply(),
      intentType: matched?.assistantPayload ? matched.intentType : null,
      intentPayload: matched?.assistantPayload ?? null,
    })
    .returning();

  res.status(201).json(SendAiConsultMessageResponse.parse({ userMessage, assistantMessage }));
});

// Partial AI Execution: apply the change-set carried in an assistant
// message's intentPayload.plan. Re-verifies every planned cell right
// before writing it — anything the manager touched since the preview was
// shown (now has a code, is now hope_off, or got locked) is skipped
// rather than overwritten.
router.post("/ai-consult/messages/:id/execute", async (req, res): Promise<void> => {
  const params = ExecuteAiConsultPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const message = await loadPendingSuggestion(params.data.id);
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const plan = message.intentPayload?.["plan"] as
    | { changeCount: number; reason: string; changes: Array<{ staffId: number; date: string; code: string }> }
    | undefined;
  if (!plan) {
    res.status(400).json({ error: "This message has no execution plan" });
    return;
  }
  if (message.intentPayload?.["status"] !== "pending") {
    res.status(409).json({ error: "This plan has already been resolved" });
    return;
  }

  let appliedCount = 0;
  let skippedCount = 0;
  for (const change of plan.changes) {
    if (!(await isKnownShiftCode(change.code))) {
      skippedCount++;
      continue;
    }

    const [existing] = await db
      .select()
      .from(shiftsTable)
      .where(and(eq(shiftsTable.staffId, change.staffId), eq(shiftsTable.date, change.date)));

    if (existing) {
      if (existing.code || existing.constraintType === "hope_off" || existing.locked) {
        skippedCount++;
        continue;
      }
      await db.update(shiftsTable).set({ code: change.code }).where(eq(shiftsTable.id, existing.id));
    } else {
      await db.insert(shiftsTable).values({ staffId: change.staffId, date: change.date, code: change.code });
    }
    await autoPlaceFollowingDayOff(change.staffId, change.date, change.code);
    appliedCount++;
  }

  const [updated] = await db
    .update(aiConsultMessagesTable)
    .set({
      intentPayload: { ...message.intentPayload, status: "applied", appliedCount, skippedCount },
    })
    .where(eq(aiConsultMessagesTable.id, message.id))
    .returning();

  res.json(ExecuteAiConsultPlanResponse.parse(updated));
});

// Teach Shift Sensei: save the facility rule proposed in an assistant
// message's intentPayload.proposedRule as a new "learned" rule.
router.post("/ai-consult/messages/:id/save-rule", async (req, res): Promise<void> => {
  const params = SaveAiConsultProposedRuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const message = await loadPendingSuggestion(params.data.id);
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const proposedRule = message.intentPayload?.["proposedRule"] as
    | { ruleType: "staffing_count" | "staff_day_restriction" | "staff_fixed_shift"; name: string; description: string; config: Record<string, unknown> }
    | undefined;
  if (!proposedRule) {
    res.status(400).json({ error: "This message has no proposed rule" });
    return;
  }
  if (message.intentPayload?.["status"] !== "pending") {
    res.status(409).json({ error: "This suggestion has already been resolved" });
    return;
  }

  const all = await db.select().from(facilityRulesTable);
  const sortOrder = all.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;

  const [rule] = await db
    .insert(facilityRulesTable)
    .values({
      unitId: null,
      ruleType: proposedRule.ruleType,
      source: "learned",
      name: proposedRule.name,
      description: proposedRule.description,
      enabled: true,
      config: proposedRule.config as never,
      sortOrder,
    })
    .returning();

  const [updated] = await db
    .update(aiConsultMessagesTable)
    .set({
      intentPayload: { ...message.intentPayload, status: "saved", savedRuleId: rule?.id ?? null },
    })
    .where(eq(aiConsultMessagesTable.id, message.id))
    .returning();

  res.json(SaveAiConsultProposedRuleResponse.parse(updated));
});

// Dismiss a pending plan or proposed rule without applying/saving it.
router.post("/ai-consult/messages/:id/dismiss", async (req, res): Promise<void> => {
  const params = DismissAiConsultSuggestionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const message = await loadPendingSuggestion(params.data.id);
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (!message.intentPayload?.["plan"] && !message.intentPayload?.["proposedRule"]) {
    res.status(400).json({ error: "This message has nothing to dismiss" });
    return;
  }
  if (message.intentPayload?.["status"] !== "pending") {
    res.status(409).json({ error: "This suggestion has already been resolved" });
    return;
  }

  const [updated] = await db
    .update(aiConsultMessagesTable)
    .set({ intentPayload: { ...message.intentPayload, status: "dismissed" } })
    .where(eq(aiConsultMessagesTable.id, message.id))
    .returning();

  res.json(DismissAiConsultSuggestionResponse.parse(updated));
});

export default router;
