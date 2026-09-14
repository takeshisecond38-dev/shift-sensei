---
name: Facility rule engine pattern (シフト先生)
description: How 施設ルール (facility staffing rules) are stored and evaluated so new rules never require code changes.
---

Facility rules are DB rows (`facility_rules` table: `ruleType` + jsonb
`config`), not hardcoded if/else. One pure evaluator function per
`ruleType` is registered in a small `Record<ruleType, evaluator>` map in
`facility-rule-engine.ts`; adding a rule is a data insert, adding a
genuinely new *kind* of rule is one new evaluator + config shape.

**Why:** the product requirement was that staffing rules (e.g. "if nobody
is on 明け that day, need at least 1 on A") must be addable/editable/
toggleable from a settings screen without an engineer touching code, and
must be usable uniformly by 月末チェック, おすすめ, and AI相談 (all three just
consume the same `Recommendation[]` / summary string).

**How to apply:** when adding a new facility-rule kind, avoid modeling its
`config` as freeform `type: object` in openapi.yaml — that breaks zod
codegen (see orval-zod-codegen.md). Give every field in the config schema
including optional ones like `condition` a concrete required shape (use
`oneOf: [Schema, {type: "null"}]` for nullable-but-required fields) so the
generated zod type doesn't include `undefined` where the DB column doesn't
allow it.
