import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { staffTable } from "./staff";

// A single persisted turn in the AI相談 chat. Stores the recognized
// "intent" (if any) alongside the raw text so a future recommendation
// engine can consult accumulated staff preferences without re-parsing
// free text. No real AI/LLM is involved yet — intent recognition is
// pattern-matched against a small set of example phrasings.
export const aiConsultRoleValues = ["user", "assistant"] as const;

export const aiConsultIntentTypeValues = [
  "reduce_night_shifts",
  "fixed_shift_code",
  "weekend_off",
  "reduce_consecutive_work",
  "facility_rule_status",
  // Partial AI Execution: the user asked Shift Sensei to fill in some
  // blank cells. The *user* message just records that a request was
  // recognized; the concrete change-set ("plan") lives in the paired
  // *assistant* message's intentPayload so the chat UI can render a
  // preview with an explicit Execute button (never applied automatically).
  "execute_plan_request",
  // Teach Shift Sensei: the user stated a standing preference for a staff
  // member. Same pattern — the proposed facility-rule shape lives in the
  // assistant message's intentPayload with Save/Cancel buttons.
  "teach_candidate",
] as const;

export const aiConsultMessagesTable = pgTable("ai_consult_messages", {
  id: serial("id").primaryKey(),
  role: text("role", { enum: aiConsultRoleValues }).notNull(),
  content: text("content").notNull(),
  // Set only on "user" messages where a recognizable request pattern
  // matched. Null means either an "assistant" message or unrecognized
  // input.
  staffId: integer("staff_id").references(() => staffTable.id, { onDelete: "set null" }),
  intentType: text("intent_type", { enum: aiConsultIntentTypeValues }),
  // Free-form structured detail for the matched intent (e.g. the shift
  // code for "fixed_shift_code"). Reserved for the future recommendation
  // engine to consult; not enforced anywhere yet.
  intentPayload: jsonb("intent_payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiConsultMessageSchema = createInsertSchema(aiConsultMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiConsultMessage = z.infer<typeof insertAiConsultMessageSchema>;
export type AiConsultMessage = typeof aiConsultMessagesTable.$inferSelect;
