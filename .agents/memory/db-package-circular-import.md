---
name: DB package circular import
description: Avoid circular imports when adding server-side seed/utility modules to lib/db that need the db client.
---

In `lib/db` (or similar shared DB packages), the Drizzle `db`/`pool` instances are often created directly in `src/index.ts` alongside `export * from "./schema"`. If you add a new module in the same package (e.g. a seed script) that needs `db` and is itself re-exported from `index.ts`, importing `db` from `"./index"` creates a circular import.

**Why:** `index.ts` re-exporting a module that imports back from `index.ts` works in some bundlers but is fragile and can produce `undefined` bindings depending on evaluation order.

**How to apply:** Move the `db`/`pool` construction into its own file (e.g. `src/client.ts`), have `index.ts` do `export * from "./client"`, and have any other in-package module import `db` from `"./client"` directly instead of `"./index"`.
