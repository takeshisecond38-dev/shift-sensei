---
name: Drizzle date-only column range filters
description: How to safely build month/day range queries against date(mode:"string") columns in Drizzle/Postgres.
---

When filtering a `date(..., { mode: "string" })` column by a calendar month (or any day range), compute real calendar boundaries in JS — e.g. `new Date(Date.UTC(year, monthIndex, 1))` for the start and `new Date(Date.UTC(year, monthIndex + 1, 1))` for the exclusive end — then format each to `YYYY-MM-DD` and use `gte`/`lt`.

**Why:** A tempting shortcut is a string range like `date >= '2026-07-01' AND date < '2026-07-32'`. Postgres validates date literals strictly, so `'2026-07-32'` (and any day that doesn't exist, e.g. `'2026-02-30'`) throws a query error instead of silently working like it would with plain string/LIKE comparison. This bug only shows up once you query a month, so it's easy to miss until a real API call is made.

**How to apply:** Any time you filter, aggregate, or paginate by month/week on a Postgres `date` column (Drizzle or raw SQL), derive the exclusive end boundary from actual calendar math, not from padding the day number.
