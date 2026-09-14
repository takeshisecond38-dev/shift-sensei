---
name: orval/zod codegen pitfall
description: Why a freeform `type: object` field in openapi.yaml breaks orval-generated zod schemas in this project.
---

A freeform OpenAPI schema (`type: object` with no `properties`, meant to hold
arbitrary JSON) makes orval emit `zod.looseObject()` in the generated
`@workspace/api-zod` output. The pinned zod version in this project (v3.25)
does not have `looseObject` (that's a zod v4 API), so the generated file
fails to typecheck/build.

**Why:** orval's zod plugin assumes a zod version that supports
`looseObject`; this project's zod version doesn't.

**How to apply:** never model a "structured but variable" API field as bare
`type: object` in openapi.yaml. Either give it a concrete schema with named
properties (preferred — see `AiConsultIntentPayload`, `FacilityRuleConfig`),
or a `oneOf` of concrete variants. Re-run `pnpm --filter @workspace/api-spec
run codegen` after any schema edit to catch this early.
