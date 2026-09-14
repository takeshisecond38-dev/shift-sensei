---
name: AI相談 suggestion confirm/dismiss pattern
description: How シフト先生's AI相談 chat proposes changes (fill-plans, learned rules) without ever auto-applying them.
---

When AI相談 (keyword/regex intent matching, not a real LLM) detects a
"do something" request (Partial AI Execution) or a "remember this"
request (Teach Shift Sensei), it never writes anything directly. Instead:

- The computed preview (`plan` or `proposedRule`) is embedded in the
  **assistant** message's `intentPayload`, with `status: "pending"`.
- Three dedicated no-request-body endpoints act on that message id:
  `execute` (re-verifies each planned cell is still blank/unlocked right
  before writing — never trusts the snapshot from when the plan was
  computed), `save-rule` (inserts a facility rule with `source: "learned"`),
  and `dismiss`. Each flips `status` to `applied`/`saved`/`dismissed` and
  is rejected with 409 if already resolved.

**Why:** keeps "AI suggests" and "user confirms" as two clearly separate,
auditable steps — matches the user's explicit choice of keyword-matching
over a real LLM, and avoids ever silently mutating the schedule or rule set.

**How to apply:** any future AI相談-driven feature that changes data
should follow the same shape — compute a preview, attach it to the
assistant message, require an explicit confirm action — rather than
adding new ad hoc auto-apply logic.
