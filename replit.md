# シフト先生 (Shift Sensei)

A mobile-first, Japanese-language shift scheduling app for small shop/restaurant teams: staff clock in/out with one tap, managers build a monthly shift table, and everyone can see worked-vs-scheduled hours in a monthly summary.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/shift-sensei run dev` — run the frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter routing, TanStack Query, shadcn/radix UI, Tailwind, `vite-plugin-pwa`
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source-of-truth API contract (staff, shifts, shift types, stamps, summary)
- `lib/db/src/schema/` — Drizzle tables: `staff.ts`, `shifts.ts`, `shift-types.ts`, `stamps.ts`
- `lib/db/src/seed.ts` — `ensureShiftTypesSeeded()`, run at api-server startup; self-heals the 10 original shift types into `shift_types` only if that table is empty
- `artifacts/api-server/src/routes/` — Express routes: `staff.ts`, `shifts.ts`, `shift-types.ts`, `stamps.ts`, `summary.ts` (aggregates scheduled vs. worked hours per staff per month)
- `artifacts/shift-sensei/src/pages/` — the 4 screens: `stamp` (打刻, home `/`), `shifts` (シフト表 `/shifts`), `summary` (月次サマリー `/summary`), `staff` (スタッフ管理 `/staff`); plus `settings/shift-types.tsx` (シフト種別 `/settings/shift-types`) for managing shift stamps
- `artifacts/shift-sensei/public/icons/` — generated app icon exported at multiple sizes for the PWA manifest and iOS home screen

## Architecture decisions

- No authentication/login — single shared staff roster, intended for one manager/team to run on a shared or personal device (e.g. a tablet at the front counter). Revisit if multi-shop or multi-account support is ever needed.
- Worked hours in the monthly summary are derived by pairing chronological `clock_in`/`clock_out` stamps per staff member — unrelated to the shift table below; 打刻 (stamps) is the *actual*, シフト表 (shift codes) is the *plan*.
- Shift table cells are a **code** per (staff, date) — a free-text string that must match some `shift_types.code` row (editable in Settings > シフト種別), not a fixed enum — not a time range. `shifts` has a unique `(staff_id, date)` constraint, so `POST /shifts` always upserts: placing a stamp on an occupied cell overwrites it. Clearing a cell is a `DELETE`, decided client-side (tap the already-placed stamp again).
- Shift types (`shift_types` table) hold each stamp's `code`, `name`, `shortLabel`, colors, optional start/end time, `workingHours`, `category` (`day_shift`/`night_shift`/`after_night`/`holiday`/`paid_leave`/`other`), and `sortOrder` (drag-reorderable in Settings, persisted via `POST /shift-types/reorder`). The API validates any `shifts.code` write against this table.
- Placing any `night_shift`-category code server-side auto-upserts the first `after_night`-category code (originally `明け`) on the following calendar day (see `getNightAndAfterNightCodes`/`autoPlaceFollowingDayOff` in `artifacts/api-server/src/routes/shifts.ts`) — driven by category, not a hardcoded code list, so renaming codes in Settings never breaks it. This is a one-way forward rule only — changing/removing the night shift afterward does not retract the auto-placed code.
- Constraints (制約入力 phase): 🚫 (`hope_off`) forces code to 休み and fully locks the cell (immutable except via "制約を削除"). 📌 (`attendance`) only marks the day as must-work — it never sets `locked`, so a normal code can be freely painted/toggled on top of it; the 📌 marker itself is protected from ordinary delete/toggle purely because `constraintType` is set, not because of the lock flag. Assigning a `holiday`-category code (e.g. 休み) onto a 📌 cell is intercepted client-side with a warning (cancel or remove-the-constraint-first) instead of silently applying.
- Shift dates are stored as `date` (calendar-only) columns, stamps as `timestamp with time zone` — see `lib/db/src/schema/shifts.ts` vs `stamps.ts`.
- PWA (manifest, icons, iOS meta tags, service worker via `vite-plugin-pwa`) was wired up by hand after the design pass; the API is excluded from the service worker's cache (`NetworkOnly` for `/api/*`) so shift/stamp data is never served stale.

## Product

- **打刻 (`/`)**: today's staff list with live status (出勤中/未出勤 etc.); tap a staff card to open a bottom drawer and stamp 出勤/退勤/休憩開始/休憩終了.
- **シフト表 (`/shifts`)**: monthly shift-code matrix — staff column fixed left, dates scroll horizontally, monthly count summary fixed right. Two phases: 1. 制約入力 (🚫希望休 / 📌出勤), 2. 勤務入力 — select a stamp from the palette (loaded from シフト種別, color-coded per shift type), then tap cells to place it; tap the placed stamp's cell again to clear; tap the selected palette stamp again to deselect. Placing a night-category shift auto-fills the after-night code the next day.
- **月次サマリー**: per-staff monthly rollup — actual worked hours, days worked, plus counts of the original 8 fixed shift codes (still hardcoded by literal string in `summary.ts`, out of scope for the シフト種別 editability work).
- **スタッフ管理 (`/staff`)**: add/rename/recolor/remove staff members.
- **シフト種別 (`/settings/shift-types`)**: add/edit/delete shift stamps and drag-reorder their display order; each stamp has a code, name, short label, bg/text color, optional start/end time, working hours, and category.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- When filtering the `shifts.date` column by month, compute real calendar bounds (first day of this month → first day of next month) rather than string tricks like `date < '2026-07-32'` — Postgres validates date literals and rejects invalid days.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
