# Architecture

## Overview

WealthHabit follows a monorepo architecture with clear separation between frontend and backend.

```
┌─────────────────┐     HTTP/REST      ┌─────────────────┐
│   Frontend      │ ◄────────────────► │   Backend       │
│   (React/Vite)  │                    │   (Express)     │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                ▼
                                        ┌─────────────────┐
                                        │   Prisma ORM    │
                                        └────────┬────────┘
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │   PostgreSQL    │
                                        └─────────────────┘
```

## Frontend (client/)

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS with CSS variables for design tokens
- **Routing**: React Router v6 with centralized route configuration
- **State Management**: React hooks (useState, useContext, custom hooks)
- **Forms**: React Hook Form + Zod validation
- **API**: Axios with centralized client
- **Charts**: Recharts
- **Icons**: Lucide React

### Key Directories
- `src/components/` - Reusable UI components
- `src/components/layout/` - Shared app shell (`AppLayout`, `Header`, `Sidebar`, `navConfig`)
- `src/pages/` - Page components
- `src/routes/` - Route configuration and guards
- `src/services/` - API service layer
- `src/hooks/` - Custom React hooks
- `src/lib/` - Utility libraries and configurations
- `src/types/` - TypeScript type definitions
- `src/utils/` - Helper functions

## Backend (server/)

- **Framework**: Express.js with TypeScript
- **Validation**: Zod schemas
- **Database**: Prisma ORM with PostgreSQL
- **Architecture**: Layered (Routes → Controllers → Services → Repositories → Prisma)

### Key Directories
- `src/config/` - Configuration management
- `src/controllers/` - Request handlers
- `src/middleware/` - Express middleware (error handling, logging, etc.)
- `src/routes/` - Route definitions
- `src/services/` - Business logic
- `src/repositories/` - Data access layer
- `src/schemas/` - Zod validation schemas
- `src/types/` - TypeScript type definitions
- `src/utils/` - Helper functions

## Data Flow

1. **Frontend** makes API request via Axios
2. **Backend** receives request at route
3. **Middleware** processes request (logging, validation, etc.)
4. **Controller** handles request, calls service
5. **Service** contains business logic, calls repository
6. **Repository** interacts with Prisma
7. **Prisma** executes database queries
8. Response flows back through the layers

## Notifications (In-App)

Notifications are **informational only**: generation never creates or mutates
transactions, budgets, bills, subscriptions, or recurring rules, and never
advances due dates or statuses.

- **Model**: `notifications` table with a `NotificationType` enum
  (`BUDGET_THRESHOLD`, `BILL_UPCOMING`, `BILL_OVERDUE`,
  `SUBSCRIPTION_UPCOMING`, `RECURRING_TRANSACTION_UPCOMING`,
  `HABIT_REMINDER`), a nullable `dedupKey` (unique per user), and optional
  `metadata` JSON.
- **Generation is on demand only** — `POST /api/notifications/generate` is
  called by the notification center page, the header bell, and the dashboard
  card. There is no scheduler, cron job, queue, worker, WebSocket, or
  email/push channel, and nothing polls in the background.
- **Endpoints** (all authenticated, user-scoped):
  - `GET /api/notifications` — paginated list (`page`, `pageSize` ≤ 50,
    `unreadOnly`), returns `{ items, page, pageSize, total, unreadCount }`
  - `GET /api/notifications/unread-count`
  - `POST /api/notifications/generate`
  - `PATCH /api/notifications/:id/read` (idempotent, sets `readAt`)
  - `PATCH /api/notifications/read-all`
  - `DELETE /api/notifications/:id`
- **Deduplication**: deterministic keys enforced by
  `@@unique([userId, dedupKey])` + `createMany({ skipDuplicates: true })` —
  e.g. `budget:{id}:{month}:pct80`, `bill:{id}:{dueDate}:upcoming|overdue`,
  `subscription:{id}:{renewalDate}:upcoming`,
  `recurring:{id}:{occurrenceDate}:upcoming`,
  `habit:{id}:{utcDay}:reminder`.
- **Rules (UTC day math)**: current-month budgets at ≥80%/≥100% expense
  progress; bills due within 3 days (upcoming) or past due with
  `PENDING`/`OVERDUE` status; `ACTIVE` subscriptions renewing within 3 days;
  `isActive` recurring transactions occurring within 1 day; active `DAILY`
  habits with no completion recorded for the current UTC day (weekly/monthly
  reminders are deferred; habits outside their start/end window are skipped).
- **Frontend**: `NotificationBell` renders in every page header
  (generate → unread count, badge hidden at zero) and links to
  `/notifications`; the dashboard shows a compact unread-count card.

## Financial Habits

Habits are **informational only**: creating, completing, uncompleting or
deleting a habit never creates or mutates transactions, budgets, bills,
subscriptions, savings goals or recurring rules, and never touches balances
or aggregates. There is no scheduler, cron job, queue, or push/email
channel.

- **Models**: `financial_habits` (`FinancialHabit`: name, description,
  `frequency`, optional `target Decimal(15,2)` + `unit`, `startDate`,
  optional `endDate`, `isActive`) and `habit_completions` (`HabitCompletion`:
  `habitId`, `completionDate`, `completedAt`) with
  `@@unique([habitId, completionDate])`.
- **Frequency**: the API accepts `DAILY`, `WEEKLY`, `MONTHLY` (the shared
  Prisma `Frequency` enum also contains `YEARLY`, which is intentionally not
  exposed). All date math is **UTC calendar** math.
- **Period anchors**: `completionDate` stores the UTC-midnight anchor of the
  occurrence —
  - `DAILY` → the UTC day itself (`2026-09-25`)
  - `WEEKLY` → **Monday of the ISO-8601 week** (`2026-09-21`)
  - `MONTHLY` → the 1st of the UTC month (`2026-09-01`)
  - `YEARLY` → Jan 1 (defensive only; not exposed by the API)
  The existing `@@unique([habitId, completionDate])` constraint therefore
  gives **database-level per-period idempotency** for every frequency; a
  concurrent duplicate completion hits P2002 and is converted into an
  idempotent result.
- **Endpoints** (all authenticated; `userId` always from the JWT):
  - `GET /api/habits` — strict query (`page`, `pageSize` ≤ 50, `active`,
    `frequency`, `includeProgress`); sorted active-first then `createdAt`
    desc; `includeProgress` computes progress for the page from a **single**
    completion query (`habitId` + `completionDate` only, ordered ASC) and
    derives every habit's progress in memory (no per-habit queries, no N+1)
  - `POST /api/habits`, `GET/PATCH/DELETE /api/habits/:id`
  - `POST /api/habits/:id/complete` — server derives the current UTC
    occurrence (clients never send a date). First completion → **201**;
    duplicate within the same period → **200** with
    `alreadyCompleted: true`. Requires `isActive` (`HABIT_INACTIVE`) and
    today within `[startDate, endDate]` (`HABIT_INVALID_DATE_RANGE`);
    unknown/foreign ids → `404 HABIT_NOT_FOUND` (no enumeration).
  - `DELETE /api/habits/:id/complete` — uncompletes the current period
    (idempotent, `{ removed: boolean }`); allowed even when paused.
  - `GET /api/habits/:id/completions` — paginated history (`pageSize` ≤ 50),
    newest first.
  - `GET /api/habits/:id/progress` — `{ habitId, frequency, currentPeriod:
    { completed, period }, streak: { current, longest }, totalCompletions,
    eligiblePeriods, completionRate, active }`.
  - `GET /api/habits/:id/progress/history` — paginated period history
    (`page`, `pageSize` ≤ 50, default 12) newest first; one item per
    **eligible** period (`{ period, completed }`), so daily habits return
    days, weekly habits Monday keys, monthly habits `YYYY-MM` keys. No
    artificial/future periods are ever synthesized; foreign ids → `404`.
- **completionRate** = distinct completed periods ÷ eligible periods × 100,
  where eligible periods run from `startDate` through
  `min(endDate, today)` counted arithmetically (UTC), Decimal-rounded to 2
  places, capped at 100%, never negative (Phase 4A definition unchanged).
- **Habit Streak Architecture (derived data)**:
  - `HabitCompletion` is the **only source of truth**. Streaks are computed
    on demand by the pure utility `server/src/utils/habitStreak.ts` (no
    database access) and **never persisted** — there is no `currentStreak`
    or `longestStreak` column, no streak table, and completing a habit does
    not update any counter. No synchronization problem can occur.
  - Normalization: raw completion dates are re-anchored to the habit's
    current frequency periods (`DAILY` → UTC day, `WEEKLY` → **Monday of
    the ISO-8601 week**, `MONTHLY` → 1st of month), deduplicated
    defensively, sorted ascending, then counted with period-aware
    `previousHabitPeriod`/`isConsecutiveHabitPeriod` helpers — never raw
    millisecond arithmetic, never local timezones.
  - **current streak** = consecutive completed periods ending at the most
    recent completed period. A not-yet-completed current period does **not**
    reset it to 0 (Sep 23 ✓, Sep 24 ✓, Sep 25 ✗ today → current streak 2);
    an earlier gap does break it (Sep 23 ✗ → the later run starts fresh).
  - **longest streak** = the longest run of consecutive completed periods
    anywhere in the history (O(n) after the defensive sort).
  - Only completions inside the eligible window count: nothing before
    `startDate`, nothing after `endDate`, nothing outside
    `min(endDate, today)`. A **future-start** habit reports 0/0/0. An
    **expired** habit keeps its historical streaks (no future periods are
    added after `endDate`). A **deactivated** habit keeps its historical
    statistics — Phase 4A semantics preserved (deactivation only blocks new
    completions; it does not restate the eligible window or history).
  - A **frequency change** reinterprets historical anchors under the new
    frequency for streak purposes; the stored rows themselves are never
    rewritten (no migration logic).
- **Semantics**: historical completions are never rewritten when the
  frequency changes (the stored anchor stays; a later completion for the
  same calendar day may create a second row under the new frequency if the
  anchors differ). Deactivating a habit blocks future completions but does
  not restate history (`active: false` with completions intact). Deleting a
  habit cascades its completions.
- **Reminders**: active `DAILY` habits with no completion for the current
  UTC day produce a `HABIT_REMINDER` notification on the next on-demand
  generation, deduped via `habit:{id}:{utcDay}:reminder`.
- **Frontend**: `/habits` page (create/edit modal, active & paused sections,
  per-period complete button, pause/resume, delete confirmation, pagination),
  a nav item on every page, and a Dashboard summary card
  (`{completed} of {total}` for the current period). Each habit card shows
  the current streak (Flame icon), best streak, a compact completion-rate
  progress bar, and opens a period-history dialog (frequency-aware labels:
  `Sep 25`, `Week of Sep 21`, `September 2026`) fed by the history endpoint.
  The Dashboard habit rows show `{n} streak` for up to 4 habits.

## Financial Challenges

- **Purpose**: time-boxed, admin-created challenges that motivate users to
  complete their financial habits. A challenge is informational by design —
  joining, mapping, progress and leaving have **zero financial side effects**
  (no transactions, budgets, bills, subscriptions, recurring rules or habit
  completions are created or mutated) and there is no XP, points redemption,
  leaderboard, badge, reward, notification or scheduler anywhere in the flow.
- **Data model** (`ChallengeType = HABIT_COMPLETION`):
  - `Challenge` — name, description, category, difficulty, points (display
    only), required `startDate`/`endDate`, `isActive`, `type`, and 1–10
    `ChallengeHabitRequirement` rows (name, optional description, reused
    `Frequency` enum, `target` completions per period, optional unit).
    Requirement metadata is immutable after create (recreate the challenge to
    change it).
  - `ChallengeParticipant` — compound unique `(challengeId, userId)` gives
    DB-level race safety; legacy `progress`/`status`/`completedAt` columns
    exist from the original schema but are **never read or written** by 4C.
  - `ChallengeParticipantHabit` — maps a requirement to one of the
    participant's habits (unique `(participantId, requirementId)`); mapping to
    the same habit is idempotent, a different habit replaces the mapping.
- **Derived state** (nothing persisted):
  - Challenge `status`: `UPCOMING` (`today < start`), `ACTIVE`
    (`start ≤ today ≤ end && isActive`), `ENDED` otherwise (including
    deactivated challenges).
  - Participant `status`: `NOT_JOINED` / `JOINED` / `COMPLETED`, plus
    `progress` — computed by `server/src/utils/challengeProgress.ts` (pure,
    DB-free): eligibility window = intersection of challenge window, habit
    window and today (UTC days); completions are grouped per challenge period
    using the same anchors as habit streaks; a period counts when completions
    reach the requirement's `target`; `completionRate` = completed/eligible
    (2dp, capped at 100). Unmapped requirements contribute eligible periods
    but zero completions.
- **Join window / errors**: joins are only allowed inside the date window and
  while `isActive` — `CHALLENGE_NOT_STARTED` (400), `CHALLENGE_ENDED` (400),
  `CHALLENGE_INACTIVE` (400). Join is idempotent (`201` first time,
  `200 alreadyJoined` after, including on unique-key races); leave always
  returns `200` with `wasJoined`. Mapping validates ownership
  (`CHALLENGE_HABIT_NOT_FOUND`, 404, anti-enumeration), active habit,
  frequency and date overlap (`CHALLENGE_HABIT_MISMATCH`, 400), and requires
  membership (`CHALLENGE_NOT_JOINED`, 400).
- **Authorization**: `requireAdmin` on `POST`/`PATCH`/`DELETE
  /api/challenges`; list/get/join/leave/progress/mapping only need an access
  token. Habit mapping is always scoped to the caller's own habits (IDOR
  tested). There is no admin UI yet — admin creation is API-only; tests and
  E2E promote users via controlled SQL setup.
- **Performance**: list uses a 4-query transaction (page/total/activeCount/
  joinedCount) plus batched mappings/habits/completions (`IN` queries) — no
  N+1; detail/progress ≈ 5 queries.
- **Frontend**: `/challenges` page (Active/Upcoming/Ended sections, join with
  in-flight disable, leave via confirmation dialog, per-requirement habit
  select limited to matching-frequency habits, progress bar with
  `{completed} / {eligible} periods`), a nav item on every page, and a
  Dashboard challenges card (`{n} active · {n} joined` plus progress of up to
  3 joined challenges, empty state links to `/challenges`).

## Savings Goals

- **Purpose**: users track progress toward a savings target by recording
  contributions. Goals and contributions are informational only — they never
  create or mutate transactions, budgets, bills, subscriptions, recurring
  rules or habit completions, and there is no scheduler, XP, rewards or
  notification anywhere in the flow (goal notifications are explicitly future
  work).
- **Data model**:
  - `SavingsGoal` — name, description, `targetAmount` (Decimal > 0),
    `targetDate`, category, priority, optional `monthlyContribution` hint,
    stored status (`ACTIVE`/`PAUSED`/`CANCELLED`/`COMPLETED`). The legacy
    `currentAmount` column exists in the schema but is **never read or
    written** — no migration is required.
  - `GoalContribution` — `amount` (Decimal > 0, ≤ 2dp), optional `note`,
    `contributionDate` (defaults to today, UTC), FK `goalId`
    (`onDelete: Cascade`).
- **Derived state** (nothing extra persisted):
  - `currentAmount` = `SUM(goal_contributions.amount)`, aggregated in memory
    (list meta sums use one SQL `SUM` per page).
  - `progressPercent` = current/target (Decimal, 2dp, capped at 100),
    `remainingAmount` = max(target − current, 0), `contributionCount`.
  - `overdue` = `targetDate < today (UTC)` while status is not
    `COMPLETED`/`CANCELLED` — derived, never stored.
  - Status `COMPLETED` is auto-synced (target met → `COMPLETED`, no longer
    met → `ACTIVE`) after contribution create/update/delete and after goal
    `PATCH`. `PAUSED`/`CANCELLED` are user intent and are never auto-
    overwritten; `PATCH` accepts `ACTIVE`/`PAUSED`/`CANCELLED` only
    (`COMPLETED` → 400 `VALIDATION_ERROR`).
- **Concurrency**: contribution mutations and the status re-sync run inside a
  `prisma.$transaction` holding `SELECT ... FOR UPDATE` on the goal row, then
  re-read the goal under the lock and recompute progress/status. Reads
  (list/progress) are lock-free.
- **API / errors**: shared `amountSchema` validates amounts (`VALIDATION_ERROR`,
  400); ownership is always scoped to the caller — missing or foreign
  goals/contributions return 404 `GOAL_NOT_FOUND` / `CONTRIBUTION_NOT_FOUND`
  (anti-enumeration). List: `page`/`pageSize` (≤50, default 20), `status`
  filter, ordered by `targetDate asc`, flat response
  `{goals, page, pageSize, total, activeCount, totalTargetAmount,
  totalSavedAmount, nearestTargetDate}` (meta scoped to the filtered set).
- **Performance**: list ≈ 5 parallel queries (page/total/activeCount/sums/
  nearest date) — no N+1; detail ≈ 1 read + 1 aggregate.
- **Frontend**: `/goals` page (summary header — active count, saved/target
  totals, nearest target date — sections by status, goal cards with progress
  bars and overdue badges, create/edit/delete modals, per-goal contributions
  dialog with edit/delete), a nav item on every page, and a Dashboard savings
  goals card (active/saved/target totals + up to 3 active goals, empty state
  links to `/goals`).

## Assets & Liabilities

- **Purpose**: users record what they own (assets) and what they owe
  (liabilities). Records are informational only — they never create or mutate
  transactions, notifications, budgets, bills, subscriptions, recurring rules
  or savings-goal contributions, there is no scheduler, and there is no
  transaction reconciliation or auto-transaction flow. These two balances are
  also the only inputs to the live net worth (see *Net Worth & Wealth
  Snapshots* below).
- **Data model** (existing Prisma models, **no migration**):
  - `Asset` — `name`, `type` (string, one of `CASH`, `BANK_ACCOUNT`,
    `FIXED_DEPOSIT`, `PROPERTY`, `VEHICLE`, `GOLD`, `INVESTMENT`, `OTHER`),
    `currentValue` (Decimal ≥ 0, ≤ 2dp) which is the **balance source of
    truth**, optional `notes`. `purchaseValue` and `institution` exist in the
    schema but are intentionally not exposed by the API.
  - `Liability` — `name`, `type` (one of `CREDIT_CARD`, `PERSONAL_LOAN`,
    `HOME_LOAN`, `VEHICLE_LOAN`, `EDUCATION_LOAN`, `OTHER`),
    `outstandingAmount` (Decimal ≥ 0, ≤ 2dp), optional `notes`.
    `originalAmount`, `interestRate` and `dueDate` are out of scope for 5B.
- **Derived state** (never persisted): `status` is computed while
  serializing — assets are always `ACTIVE`, liabilities are `PAID_OFF` only
  when `outstandingAmount` is `0`, otherwise `ACTIVE`. There is no `status`
  column, which is why no migration is required.
- **Money handling**: `nonNegativeAmountSchema` accepts `0` (unlike the
  transaction `amountSchema` which requires `> 0`), caps at
  `9999999999999.99` and allows at most 2 decimals. Totals come from Prisma
  `_sum` aggregates over `Decimal` columns in two parallel queries and are
  serialized with `roundMoney()` — `Number()` is never used for financial
  math (asserted by exact decimal tests: `0.10 + 0.20 + 33.33 = 33.63`).
- **API / errors**: `GET/POST /api/assets`, `GET/PATCH/DELETE /api/assets/:id`,
  `GET/POST /api/liabilities`, `GET/PATCH/DELETE /api/liabilities/:id`,
  `GET /api/assets-liabilities/summary` → `{totalAssets, totalLiabilities,
  netWorth, assetCount, liabilityCount}`. Strict `.strict()` Zod schemas reject
  unknown fields (mass assignment of `userId`/`id`/`createdAt`/`status` → 400
  `VALIDATION_ERROR`), the user id always comes from the access token, and
  lists accept `page`/`pageSize` (≤ 50, default 20) plus a single `type`
  filter, ordered `createdAt desc`. Missing or foreign records return 404
  `ASSET_NOT_FOUND` / `LIABILITY_NOT_FOUND` (anti-enumeration). Plain
  `PATCH` updates balance fields — there are no separate `/value` endpoints.
- **Frontend**: `/assets-liabilities` page (summary tiles for total assets and
  total liabilities with record counts, separate asset and liability sections
  with cards, create/edit/delete modals, paid-off badges, per-section empty
  states), an `Assets & Liabilities` nav item on every page, and a Dashboard
  card showing the same two totals plus counts (links to
  `/assets-liabilities`).

## Net Worth & Wealth Snapshots

- **Purpose**: show what the user is worth **right now**, and let them keep an
  immutable history of days they choose to record. Everything is derived on
  demand — there is no scheduler, job queue, email, push channel, WebSocket or
  forecasting step, and snapshots are created only by an explicit `POST`.
- **Current net worth**: `Total Assets − Total Liabilities`, computed from the
  live `Asset.currentValue` / `Liability.outstandingAmount` sums with
  `Prisma.Decimal.minus()` (never `Number()`). It is never read from a stored
  snapshot, never built from transactions or goal contributions, and **never
  clamped** — liabilities above assets return a negative figure. It is exposed
  by extending the existing `GET /api/assets-liabilities/summary` (no
  duplicate net-worth endpoint).
- **Data model** (existing `WealthSnapshot`, **no migration**): `userId`,
  `snapshotDate` (UTC calendar day), `totalAssets`, `totalLiabilities`,
  `netWorth`, all `Decimal(15,2)` except the date, with
  `@@unique([userId, snapshotDate])`, `@@index([userId])` and
  `onDelete: Cascade` to the user. The model has no `created_at`/`updated_at`
  and the API therefore returns none.
- **Capture**: `POST /api/wealth-snapshots` runs a transaction (aggregate
  assets → aggregate liabilities → insert), stamps today's UTC day and returns
  `201 {snapshot, created: true}`. The same day again returns `200 {snapshot,
  created: false}` with the existing row; a concurrent duplicate hits the
  unique index (`P2002`) and is converted to that same idempotent result, so
  the race never surfaces as a 500. The request body is an empty `.strict()`
  object — `snapshotDate`, `totalAssets`, `netWorth` or `userId` are rejected
  with 400, so no figure can be client supplied.
- **Immutability & deletion**: there is no `PATCH` and no `DELETE` route.
  Changing or deleting a source asset/liability moves the live net worth but
  leaves stored snapshots untouched; snapshots are permanent history.
- **API / errors**: `POST /api/wealth-snapshots` (capture, idempotent),
  `GET /api/wealth-snapshots` (own list, `snapshotDate desc`, `page`/
  `pageSize` ≤ 50), `GET /api/wealth-snapshots/:id`. Foreign or unknown ids
  return 404 `WEALTH_SNAPSHOT_NOT_FOUND` (anti-enumeration); anonymous
  requests return 401. Snapshot rows serialize to exactly `id`,
  `snapshotDate`, `totalAssets`, `totalLiabilities`, `netWorth` (money via
  `roundMoney()`), never `userId`.
- **Frontend**: `/net-worth` page (live total assets / total liabilities /
  current net worth tiles with the value in red when negative, capture button
  with success/idempotent feedback, a Recharts line history of net worth with
  optional assets/liabilities overlays, and a UTC-dated history table), a
  `Net Worth` nav item on every page, and a Dashboard **Net Worth** card
  (totals + current net worth + link to `/net-worth`) fed by the same single
  summary request as the assets & liabilities card.

## Wealth Analytics

- **Purpose**: one read-only place that answers "where do I stand?" by
  combining the sources of truth that earlier phases introduced. Every number
  is derived on demand — there is **no new table, no migration, no write of
  any kind** (a read never creates a snapshot, notification, transaction or
  record), no scheduler, and no forecasting, scoring or financial advice.
- **Endpoints** (all `GET`, mounted at `/api/wealth-analytics`):
  - `/summary` → `{current, goals}` — range independent. `current` is the
    live `Asset.currentValue` / `Liability.outstandingAmount` aggregation
    (`totalAssets`, `totalLiabilities`, `netWorth`, `assetCount`,
    `liabilityCount`) and matches `GET /api/assets-liabilities/summary`
    exactly. `goals` reports `goalCount`/`activeCount`/`completedCount`,
    `totalTargetAmount`/`totalSavedAmount`, overall `progressPercent` and an
    `items` breakdown (≤ 50 rows) with per-goal derived progress.
  - `/net-worth?dateFrom&dateTo` → `{history, change}` — stored
    `WealthSnapshot` rows in range (`snapshotDate ≥ dateFrom`, `≤ dateTo`),
    chronological, each `{snapshotDate, totalAssets, totalLiabilities,
    netWorth}`; `change = {absolute, percentage}` is `latest − earliest` over
    those points, `null` with fewer than two, and `percentage` is `null`
    unless the earliest net worth is positive. Nothing is interpolated
    between stored days. The label is **"Net Worth Change"** only.
  - `/assets` → `{totalAssets, assetCount, byType, assets}` — grouped with
    `currentValue` sums and 2dp share percentages, plus every asset with its
    share.
  - `/liabilities` → `{totalLiabilities, liabilityCount, byType,
    liabilities}` — same shape; balances are named `outstandingBalance`
    (item) / `totalBalance` (by-type group), the documented analytics names
    for the real `Liability.outstandingAmount` column, while assets use
    `currentValue`/`totalValue`.
  - `/cash-flow?dateFrom&dateTo` → `{income, expenses, net,
    transactionCount, incomeByCategory, expenseByCategory}` — only
    `INCOME`/`EXPENSE` transactions in `[dateFrom, dateTo + 1 day)` (so the
    end day is inclusive), grouped via `transaction.groupBy`, categories
    resolved in one `category.findMany`, shares are 2dp percentages of the
    income or expense side. `net` is cash movement in the range and is
    explicitly **not** net worth change.
- **Date range**: `dateFrom`/`dateTo` are UTC calendar days, strictly
  validated — required order, maximum span 1825 days (5 years), defaulting
  to the last 365 days ending today when absent. Reversed, invalid or
  wider-than-max ranges are 400 `VALIDATION_ERROR`; the range never affects
  `/summary`, `/assets` or `/liabilities`.
- **Money & percentages**: values stay `Prisma.Decimal` through every
  computation and are serialized with `roundMoney()`; shares use
  `shareOf()` → `roundRate()` (2dp), returning `0` when the total is zero
  and `null` percentages when a base is not positive. Goal progress reuses
  the Goals algorithm — `goalProgressValues()` extracted from
  `goalController.ts` into `utils/money.ts` — so the page and the goals list
  can never disagree.
- **API / errors**: only `GET` exists — `POST`/`PATCH`/`DELETE` are 404,
  anonymous is 401, and the user id always comes from the access token
  (every query is user-scoped). Range-independent endpoints take an empty
  strict query, so `?userId=` or `?netWorth=` is a 400 (mass-assignment
  protection); unknown or malformed range params are also 400.
- **Frontend**: `/wealth-analytics` page (30/90/180/365-day range buttons and
    six sections — current position, net worth history with Recharts line chart
    and "Net Worth Change", asset allocation pie + table, liability
    composition, savings goal summary, cash flow bars + tables — each with
    independent loading, error-with-Retry and empty state), a `Wealth
    Analytics` nav item on every page, and Dashboard shortcuts from the net
    worth card.

## Financial Reports

- **Purpose**: a read-only export layer that assembles the same authoritative
  figures from Wealth Analytics into portable formats — JSON preview, CSV and
  PDF — without storing or duplicating any financial state.
- **Endpoints** (all `GET`, mounted at `/api/reports`):
  - `/financial` → `FinancialReportData` JSON preview.
  - `/financial.csv` → RFC 4180 CSV with UTF-8 BOM, CRLF line endings,
    formula-injection guard (user text starting with `=`, `+`, `-`, `@`,
    tab, or CR is prefixed with `'`), deterministic filename
    `wealthhabit-financial-report-YYYY-MM-DD.csv`.
  - `/financial.pdf` → server-side PDF via pdfkit (A4, uncompressed content
    streams, explicit page breaks, footers with page numbers), deterministic
    filename `wealthhabit-financial-report-YYYY-MM-DD.pdf`.
- **Data contract**: single `FinancialReportData` object reused by all three
  renderers so JSON, CSV and PDF can never disagree:
  - `period` — UTC calendar-day range, timezone, generated timestamp.
  - `overview` — income, expenses, net cash flow, transaction count,
    current total assets/liabilities/net worth, goal counts, goal totals,
    overall goal progress.
  - `incomeCategories` / `expenseCategories` — category breakdowns with
    totals and share percentages.
  - `assets` / `liabilities` — current positions with type groupings,
    individual items, and 2dp share percentages.
  - `netWorthHistory` — stored `WealthSnapshot` rows in range (no
    interpolation).
  - `goals` — goal summary (counts, totals, progress) and per-goal
    breakdown with derived `currentAmount` from contributions.
- **Date range**: reuses the Wealth Analytics range contract verbatim — UTC
  calendar days, default 365 days, maximum 1825 days (5 years), reversed
  / invalid / wider ranges are 400 `VALIDATION_ERROR`; range never affects
  current-position sections (assets, liabilities, goals).
- **Security**: only `GET` endpoints exist (POST/PATCH/DELETE → 404);
  anonymous → 401; strict Zod schema rejects unknown parameters
  (`?userId=`, `?netWorth=`, etc. → 400 `VALIDATION_ERROR`); user id
  always from authenticated JWT, never from query/body/route.
- **Read-only by construction**: the report builder performs no arithmetic
  of its own — every figure is delegated to existing Phase 5D Wealth
  Analytics functions. A report read never creates a snapshot, notification,
  or mutation of any financial row.
- **Frontend**: `/reports` page with 30d/90d/6m/12m range presets, all
  report sections, loading/error/empty/retry states, CSV/PDF download
  buttons, and a `Reports` nav item on every page.

## App Layout & Navigation

- **Shell**: every authenticated route in `client/src/routes/index.tsx` is
  rendered as `guard → AppLayout → lazy page`, where the guard is
  `ProtectedRoute` for user pages and `RequireAdmin` for admin pages. There
  is exactly one layout component (`client/src/components/layout/AppLayout.tsx`)
  — no page carries its own sidebar or top bar.
- **Sidebar navigation** is a single array-driven structure in
  `client/src/components/layout/navConfig.ts`:
  `primaryNavGroup`, `wealthNavGroup`, `adminNavGroup`, `accountNavGroup`,
  exposed through `getNavGroups(isAdmin)`. `adminNavGroup` lists Admin,
  Admin Users, Admin Challenges, Audit Logs and System Health; it is
  appended **only** when `user.role === 'ADMIN'`, so a `USER` never sees
  admin destinations. No second navigation array exists anywhere else.
- **Active state**: `Sidebar` compares `location.pathname` with each item's
  `href` and sets `aria-current="page"`; `/admin` and `/admin/users` are
  distinct entries, so highlighting is exact rather than prefix-based.
- **Desktop**: the sidebar is either compact (68px, icon-only links with a
  `title` tooltip) or expanded (268px, labels + group headings). The choice
  is persisted in `localStorage` under `wealthhabit.sidebar.open` as the
  string `"true"`/`"false"` only — no user, role or security data is stored,
  and unreadable/invalid values fall back to collapsed.
- **Mobile (< 1024px)**: the sidebar renders as an overlay drawer
  (`translate-x`) with a backdrop (`data-testid="sidebar-backdrop"`), body
  scroll lock, Escape-to-close, backdrop click-to-close and
  close-on-navigate. It always starts closed on mobile regardless of the
  stored desktop preference.
- **Header**: sticky, contains the sidebar toggle
  (`aria-expanded`/`aria-controls="app-sidebar"`), brand link, user name,
  notification bell and sign-out. Content is padded with `lg:pl-[268px]`
  (expanded) or `lg:pl-[68px]` (compact), so the fixed sidebar never
  overlaps page content and no horizontal scrollbar is introduced.
- **Read-only by storage**: nothing security- or finance-related is written
  to `localStorage` by the layout.

## Admin Authorization

- **Role model**: `Role` enum (`USER`, `ADMIN`) in Prisma schema; `User.role` defaults to `USER`.
- **Authorization middleware**: `requireRole(allowedRoles)` / `requireAdmin` / `requireUser` in `server/src/middleware/rbacMiddleware.ts`.
- **Authentication prerequisite**: `authenticate` middleware validates JWT, fetches user from DB, checks `AccountStatus` (`ACTIVE`/`SUSPENDED`/`DEACTIVATED`), attaches `req.user` with role from DB.
- **Access control**:
  - Anonymous → 401 `UNAUTHORIZED`
  - Authenticated `USER` on admin endpoint → 403 `FORBIDDEN`
  - Authenticated `ADMIN` → allowed
  - Suspended/deactivated accounts → 403 `ACCOUNT_SUSPENDED` / `ACCOUNT_DEACTIVATED`
- **Role source**: always from authenticated JWT (validated against DB on each request), never from client headers (`X-User-Role`), body (`role`), query (`?role=`), or arbitrary headers.
- **Self-escalation protection**:
  - Registration: `role` defaults to `USER`, not accepted from input
  - Profile update (`PATCH /api/users/me`): strict Zod schema rejects `role` field
  - No public role-management API; role changes only via the ADMIN-only
    `PATCH /api/admin/users/:id/role` operation (Phase 5F-3); `ADMIN`
    promotion no longer requires raw SQL
- **Admin-only endpoints** (Phase 5F-1 … 5F-6):
  - `POST /api/challenges` — create challenge
  - `PATCH /api/challenges/:id` — update challenge
  - `DELETE /api/challenges/:id` — delete challenge
  - `GET /api/admin/dashboard` — operational dashboard overview (5F-2)
  - `GET /api/admin/users` — user list (5F-3)
  - `GET /api/admin/users/:id` — user detail (5F-3)
  - `PATCH /api/admin/users/:id/status` — account status change (5F-3)
  - `PATCH /api/admin/users/:id/role` — role change (5F-3)
  - `GET /api/admin/audit-logs` — audit-log query, read-only (5F-4)
  - `GET /api/admin/challenges` — challenge list, read-only (5F-5)
  - `GET /api/admin/challenges/:id` — challenge detail, read-only (5F-5)
  - `GET /api/admin/system-health` — operational health report, read-only (5F-6)
- **User-accessible challenge endpoints** (not admin-only):
  - `GET /api/challenges` — list challenges
  - `GET /api/challenges/:id` — get challenge
  - `POST /api/challenges/:id/join` — join challenge
  - `DELETE /api/challenges/:id/leave` — leave challenge
  - `GET /api/challenges/:id/progress` — get progress
  - `POST /api/challenges/:id/requirements/:requirementId/habit` — map requirement habit
- **Frontend**: `RequireAdmin` route guard (`client/src/components/RequireAdmin.tsx`) guards `/admin` (operational dashboard, 5F-2), `/admin/users` (user management, 5F-3), `/admin/audit-logs` (audit log, 5F-4), `/admin/challenges` (challenge administration, 5F-5) and `/admin/system-health` (system health, 5F-6); each route renders inside the shared `AppLayout` and all five are listed in the sidebar's `Admin` group (shown only to `ADMIN` users); backend remains authoritative security boundary.

## Admin Dashboard (Phase 5F-2)

- **Endpoint**: `GET /api/admin/dashboard` in
  `server/src/routes/adminDashboardRoutes.ts` — `authenticate →
  requireAdmin → asyncHandler` (no query or body, so no validation schema),
  mounted as `app.use('/api/admin', adminDashboardRoutes)` in
  `server/src/app.ts`. GET only: `POST`/`PATCH`/`PUT`/`DELETE` → 404.
- **Read-only and unaudited**: the service (`adminDashboardService.ts`)
  performs only `prisma.*.count()` calls; loading the dashboard writes no
  audit row, no notification and no application data.
- **Response**: `{ success, data: { users, financialRecords, application,
  generatedAt } }`.
  - `users` — `{ total, active, suspended, deactivated, admins,
    recentlyRegistered }` (30-day window).
  - `financialRecords` — `{ transactions, savingsGoals, assets,
    liabilities, wealthSnapshots }` **counts only**; no amounts, balances or
    percentages are ever computed or returned.
  - `application` — `{ habits, challenges, notifications }` counts.
- **UI**: `/admin` (lazy route behind `RequireAdmin`) — three metric grids
  (User Overview, Financial Records, Application), a `Last refreshed`
  timestamp, manual Refresh (disabled while loading), loading/error/retry
  states, and shortcut links to Manage users, Manage challenges, Audit log
  and System health (the sidebar already lists the same destinations; the
  dashboard links are retained as shortcuts with distinct labels/test ids).
- **Tests**: `client/src/pages/AdminDashboard.test.tsx` (metric grids,
  zero values, loading/error/retry, refresh disabled while loading, no
  dollar/decimal amounts rendered), plus
  `npm run e2e:admin-dashboard --workspace=server` (26 checks: RBAC 401/403,
  header/query spoofing, suspended/deactivated admins, no financial amounts,
  reads create no records).

## Admin User Management (Phase 5F-3)

- **Page**: `/admin/users` (lazy route behind `RequireAdmin`, linked from the
  Admin dashboard) — debounced search, role/status filters, pagination,
  detail dialog, confirm dialogs, mobile card layout, and self-protection
  disables actions the admin cannot perform on their own account.
- **API**: every endpoint runs `authenticate → requireAdmin → Zod validate →
  controller → service`; registered centrally as
  `app.use('/api/admin', adminUserRoutes)` in `server/src/app.ts`.
  - `GET /api/admin/users` — strict query: `page` ≥ 1 (default 1),
    `pageSize` 1–50 (default 20), `search` ≤ 100 chars, `role` in
    `USER|ADMIN`, `status` in `ACTIVE|SUSPENDED|DEACTIVATED`; unknown
    parameters → 400 `VALIDATION_ERROR`. Returns `{ users, page, pageSize,
    total, totalPages }` with a safe summary per user (`id`, `email`,
    `firstName`, `lastName`, `role`, `status`, `lastLoginAt`, `createdAt`,
    `updatedAt`) — never `passwordHash`, session/refresh hashes or tokens.
  - `GET /api/admin/users/:id` — safe detail: profile fields plus
    operational counts (transactions, goals, assets, liabilities, habits,
    challenge participations) and nothing monetary; missing/malformed id →
    404 `USER_NOT_FOUND` (same anti-enumeration shape as ownership 404s).
  - `PATCH /api/admin/users/:id/status` — body `{ status }` only; strict.
    Transitions: `ACTIVE ↔ SUSPENDED`, `ACTIVE → DEACTIVATED`,
    `SUSPENDED → DEACTIVATED`, `DEACTIVATED → ACTIVE`;
    `DEACTIVATED → SUSPENDED` → 409 `INVALID_STATUS_TRANSITION`;
    same-status is an idempotent no-op (no revocation, no audit row).
  - `PATCH /api/admin/users/:id/role` — body `{ role }` only; strict; role
    changes require no session revocation because `authenticate` re-reads
    role from the DB on every request.
- **Session invalidation**: status changes to `SUSPENDED`/`DEACTIVATED`
  revoke **all** of the target's unrevoked refresh sessions inside the same
  `prisma.$transaction` as the status update and audit row. Afterwards
  login → 403, authenticated API calls → 403, refresh with a revoked token →
  401 (`detectRefreshTokenReuse`); reactivation lets the user log in again
  with a fresh login. Pending one-time auth tokens are left alone — they
  cannot grant access while `status ≠ ACTIVE`.
- **Protections** (all server-side, tested with spoofed headers/query/body):
  - self status change away from `ACTIVE` → 409 `ADMIN_SELF_STATUS_CHANGE`
  - last-active-admin demotion → 409 `LAST_ADMIN_REQUIRED` (counts remaining
    `ACTIVE` admins excluding the target, in-transaction)
  - anonymous → 401, `USER` → 403, spoofed `role`/`X-User-Role`/`?role=`
    parameters → rejected or ignored in favor of the JWT+DB value
- **Audit**: `recordAuditEvent(event, client?)` in
  `server/src/services/auditLogService.ts` writes `ADMIN_USER_STATUS_CHANGED`
  and `ADMIN_USER_ROLE_CHANGED` rows atomically with the mutation (metadata:
  ids, from/to, revoked session count; never credentials or financial
  values). Both actions are queryable through `GET /api/admin/audit-logs`
  and rendered by the Phase 5F-4 audit-log UI.
- **Data safety**: status/role changes touch only `users` rows, sessions and
  audit rows — transactions, goals, assets, liabilities, habits and
  challenge data are never deleted or modified (asserted by tests and
  `e2e:admin-users`).
- **Tests**: `server/tests/adminUser.test.ts` (backend, incl. RBAC,
  transitions, session/refresh behavior, spoofing, sensitive-field
  exclusion), `client/src/pages/AdminUsers.test.tsx` (frontend), and the
  live `npm run e2e:admin-users --workspace=server` script.

## Audit Log Management (Phase 5F-4)

- **Model** (existing, no migration): `AuditLog` in `prisma/schema.prisma`
  maps to `audit_logs` — `id` (cuid), `actorUserId` (nullable FK → `User`,
  `onDelete: SetNull`, relation `actorAuditLogs`), `action` (String),
  `entityType` (String), `entityId` (String, nullable, no FK), `metadata`
  (Json, nullable), `createdAt` (default `now()`). Indexes on `actorUserId`,
  `entityType`, `entityId`, `createdAt`. There is no `target` relation — for
  user-management events `entityType = "User"` and `entityId` is the target
  user id (also duplicated inside `metadata.targetUserId`).
- **Writer (reused, not replaced)**: `recordAuditEvent(event, client?)` in
  `server/src/services/auditLogService.ts` remains the single audit writer.
  `AuditActions` is the authoritative action set:
  - `ADMIN_USER_STATUS_CHANGED` — metadata `{ targetUserId, from, to,
    revokedSessions }`, written inside the same transaction as the status
    update and session revocations (5F-3).
  - `ADMIN_USER_ROLE_CHANGED` — metadata `{ targetUserId, from, to }`,
    written inside the same transaction as the role update (5F-3).
  5F-4 adds no new writers and no reads that write (no recursive
  audit-of-audit entries). Phase 5F-5 appends the three challenge
  actions (`ADMIN_CHALLENGE_CREATED` / `ADMIN_CHALLENGE_UPDATED` /
  `ADMIN_CHALLENGE_DELETED`) to this same set — documented in the
  Challenge Administration section below; because the API's action filter
  enum is derived from `Object.values(AuditActions)`, those actions are
  automatically queryable through `GET /api/admin/audit-logs`.
- **API**: `GET /api/admin/audit-logs` with
  `authenticate → requireAdmin → validate(listAuditLogsSchema) →
  asyncHandler`, mounted in `server/src/app.ts` alongside the other admin
  routers. The router defines GET only — `POST`/`PUT`/`PATCH`/`DELETE` fall
  through to the 404 handler, so audit rows cannot be created, edited or
  deleted through the application.
- **Query contract** (strict Zod — unknown parameters → 400
  `VALIDATION_ERROR`):
  - `page` ≥ 1 (default 1), `pageSize` 1–50 (default 20)
  - `action` — one of the `AuditActions` values (enum derived from those
    constants; `AuditLog.action` itself is a String column)
  - `actorUserId` / `entityId` — cuid-shaped (`/^c[a-z0-9]{10,40}$/`);
    `entityId` filters the target resource id
  - `dateFrom` / `dateTo` — ISO dates coerced to UTC calendar days;
    `createdAt >= startOfUtcDay(dateFrom)` and `< startOfUtcDay(dateTo) + 1
    day` (dateTo inclusive); reversed ranges and ranges over 1825 days are
    rejected; malformed dates are rejected
  - `search` (≤ 100 chars) — case-insensitive match on actor first/last
    name or email (relation filter), action substring, or target id
    resolved through a bounded user lookup (max 1000 matching users).
    Metadata/JSON full-text search is intentionally **not** supported (it
    would require raw SQL or a migration).
  - No client-supplied sort: always `createdAt DESC, id DESC`.
- **Response**: `{ success, data: { auditLogs, page, pageSize, total,
  totalPages } }`. Each entry is
  `{ id, action, entityType, entityId, actor, target, metadata, createdAt }`
  where `actor`/`target` are `{ id, email, firstName, lastName } | null`
  (actor from the FK, target resolved in one batched query from `entityId`;
  a deleted actor or unknown target yields `null` instead of failing the
  page). Actor/target user records are selected by field list — never full
  rows, never `passwordHash` or session/token columns.
- **Metadata sanitization**: before any metadata leaves the server it is
  reshaped by `sanitizeAuditMetadata` — keys matching
  `password|secret|token|hash|cookie|authorization|credential|api[-_]?key|
  private|jwt|bearer` are dropped, depth is capped at 4, strings at 500
  chars, arrays at 50 items and objects at 50 keys. The response contract is
  therefore stable and credential-free even if a future writer stores more
  than the current transition fields. Financial amounts never appear in
  audit metadata.
- **UI**: `/admin/audit-logs` (lazy route behind `RequireAdmin`, linked from
  the Admin dashboard) — debounced search over actor/target names and email,
  action select derived from `AUDIT_ACTIONS` in
  `client/src/types/adminAuditLogs.ts` (kept in sync with the server's
  `AuditActions`, so all five current actions are selectable), actor/target
  id inputs, date
  inputs with explicit Apply/Clear, desktop table and mobile cards
  (Timestamp | Action | Actor | Target | Details), a read-only detail dialog
  (action, formatted + ISO timestamp, actor, target, entity, pretty-printed
  metadata), loading/error/retry/empty/no-results states and Previous/Next
  pagination. The page performs no mutations at all.
- **Tests**: `server/tests/adminAuditLogs.test.ts` (RBAC, spoofing, strict
  validation, pagination/ordering, filters, search, sanitization,
  immutability, live 5F-3 events, missing actor/target robustness),
  `client/src/pages/AdminAuditLogs.test.tsx` (page states, filters,
  pagination, detail dialog, sensitive-field absence, `RequireAdmin`
  access), and `npm run e2e:admin-audit-logs --workspace=server` (71 checks
  against the running API).

## Challenge Administration (Phase 5F-5)

- **Reuses the existing Challenge stack** (no migration, no second model):
  `Challenge` / `ChallengeHabitRequirement` / `ChallengeParticipant` /
  `ChallengeParticipantHabit` in `prisma/schema.prisma` (participant→requirement
  mappings cascade on delete; `FinancialHabit` rows never do), the shared
  domain logic in `server/src/services/prismaChallengeService.ts`, the
  admin-protected `POST/PATCH/DELETE /api/challenges` routes and the
  `deriveChallengeStatus` / `calculateChallengeProgress` derived-status
  machinery.
- **Audit actions**: 5F-5 appends three values to `AuditActions` in
  `server/src/services/auditLogService.ts`:
  - `ADMIN_CHALLENGE_CREATED` — metadata `{ name, type, category,
    startDate, endDate, requirementCount, isActive }` (dates as UTC day
    strings).
  - `ADMIN_CHALLENGE_UPDATED` — metadata `{ name, changedFields }` plus
    `{ previousIsActive, newIsActive }` when the activation flipped.
    Activation is an ordinary PATCH field, so it is audited as `UPDATED`
    rather than a redundant status action.
  - `ADMIN_CHALLENGE_DELETED` — metadata `{ name, type, participants }`.
  Each mutation now runs inside `prisma.$transaction(async tx => { …;
  recordAuditEvent(…, tx) })`, so the row and its audit entry commit
  atomically (same pattern as `adminUserService.ts`); the controller passes
  `getAuthenticatedUserId(req)` as the actor.
- **Read API**: `GET /api/admin/challenges` and `GET /api/admin/challenges/:id`
  in `server/src/routes/adminChallengeRoutes.ts` (GET only, `authenticate →
  requireAdmin → validate → asyncHandler`), mounted centrally as
  `app.use('/api/admin', adminChallengeRoutes)` in `server/src/app.ts`.
  Mutations stay on the existing `/api/challenges` router — there is no
  duplicate CRUD surface.
  - List query (strict Zod, unknown parameters → 400): `page` ≥ 1 (default 1),
    `pageSize` 1–50 (default 20), `search` ≤ 100 chars (case-insensitive
    name/description/category), `type` (Prisma `ChallengeType` values),
    `status` in `UPCOMING|ACTIVE|ENDED` (derived with the exact UTC
    semantics of `deriveChallengeStatus`, so the filter and the returned
    field can never disagree), `active` in `true|false` (persisted
    activation: `true` is the live window, `false` its exact negation),
    `dateFrom`/`dateTo` (UTC calendar days filtering `startDate`, dateTo
    inclusive; reversed ranges and ranges over `ADMIN_CHALLENGE_MAX_RANGE_DAYS`
    = 1825 days rejected). Filters are composed as `where.AND = clauses[]`
    so status/activation OR-groups never clobber each other. Ordering:
    `startDate DESC, createdAt DESC` (matches the public list).
  - List item: the safe base fields (id, name, description, category,
    difficulty, points, type, startDate, endDate, isActive, derived status,
    timestamps) plus `requirementCount` and `participants: { total }` from
    `_count` — never participant rows or credentials.
  - Detail: base fields plus ordered requirements (each with
    `mappedParticipants` from `_count.mappings`) and derived
    `participants: { total, completed }` computed by
    `computeParticipantStats` — 4 flat batched queries (participants,
    mappings, habits, completions) feeding the existing pure
    `calculateChallengeProgress`; nothing is persisted and there is no N+1.
    Missing id → 404 `CHALLENGE_NOT_FOUND`.
- **Mutations (reused routes, now audited)**: create still enforces 1–10
  requirements and the existing validation; requirements are immutable after
  creation (`updateChallengeSchema` is strict and has no `requirements`
  field → 400). Delete cascades only `requirements` and participant
  mappings — the mapped `FinancialHabit` and its completions survive.
- **UI**: `/admin/challenges` (lazy route behind `RequireAdmin`, linked from
  the Admin dashboard) — debounced search, type/status/active filters with
  Apply/Clear, desktop table and mobile cards (Name | Type | Status |
  Participants | Actions), Previous/Next pagination, a detail dialog
  (challenge fields, requirements with mapped participants, `N joined · N
  completed`), an RHF + zodResolver create/edit form with a
  `useFieldArray` requirements editor (1–10 rows, requirements read-only
  when editing), a delete confirmation dialog (separate alertdialog) and
  loading/error/empty/no-results states.
- **Tests**: `server/tests/adminChallenges.test.ts` (RBAC, spoofing, list
  contract, strict validation, filters, detail with derived participant
  stats, create/update/activation/delete with audit rows and cascade
  safety, audit safety, GET-only routes), `client/src/pages/AdminChallenges.test.tsx`
  (page states, search/filters/pagination, create/edit/delete flows,
  validation, `RequireAdmin` access), plus the existing `challenge.test.ts`
  suite (unchanged — it still owns public CRUD, join/leave/progress and
  401/403 coverage). Live: `npm run e2e:admin-challenges --workspace=server`
  (87 checks) — it cleans its challenge audit rows in `finally` (plus
  defensively at start) so the global audit total asserted by
  `e2e:admin-audit-logs` stays stable.

## System Health (Phase 5F-6)

- **Endpoint**: `GET /api/admin/system-health` in
  `server/src/routes/adminSystemHealthRoutes.ts` — `authenticate →
  requireAdmin → asyncHandler` (no query or body exists, so there is no
  validation schema). Mounted centrally as `app.use('/api/admin',
  adminSystemHealthRoutes)` in `server/src/app.ts`. Anonymous → 401,
  `USER` → 403 (header/query/body role spoofing ignored — role always
  comes from the JWT validated against the DB), suspended/deactivated
  admins → 403 by the existing `authenticate` middleware. No new
  authentication mechanism, no public route, no `/debug`, `/env` or
  `/config` endpoint.
- **Response contract** (stable allowlist — `{ success, data }` where
  `data` has exactly `status`, `generatedAt`, `application`, `database`,
  `runtime`):
  - `application` — `{ status, service, environment, uptimeSeconds }`.
    `service` is `"WealthHabit API"`, `environment` is a normalized
    category (`development`/`test`/`production` from the already-configured
    `NODE_ENV` — never the environment itself), and the status is `HEALTHY`
    by construction because serving the request proves the process is up.
  - `database` — `{ status, latencyMs, message }`. The only database
    interaction of the feature is one read-only `SELECT 1` through the
    existing Prisma singleton (`prisma.$queryRaw`), timed as
    `latencyMs` — health-query latency only, not general application
    latency. On failure the check is caught inside
    `checkDatabaseHealth` and returned as
    `{ status: 'UNHEALTHY', latencyMs: null, message: 'Database health
    check failed' }`; the raw driver error (which may contain connection
    strings) is never serialized — only a fixed line is logged
    server-side. A database failure can therefore never crash the API or
    leak through the response.
  - `runtime` — `{ status, nodeVersion, uptimeSeconds, memory }` with
    `nodeVersion` as `major.minor`, and `memory` as rounded one-decimal
    `rssMb`/`heapUsedMb`/`heapTotalMb` summaries. No heap dumps, argv,
    cwd, execPath, file descriptors or environment. Runtime status is
    `DEGRADED` when `heapUsed / heapTotal >= MEMORY_DEGRADED_RATIO`
    (0.95, a documented code constant), otherwise `HEALTHY`.
- **Overall status** (deterministic aggregation in
  `deriveOverallStatus`): any component `UNHEALTHY` → `UNHEALTHY` (the
  database is a critical dependency, so a failed database check marks the
  system unhealthy even though the API process is still serving); no
  unhealthy component but at least one `DEGRADED` → `DEGRADED`; all
  `HEALTHY` → `HEALTHY`.
- **Not a liveness/readiness probe**: the endpoint answers HTTP 200 with
  `status: 'UNHEALTHY'` when only the dependency check fails — it is an
  operational dashboard read for administrators, not a Kubernetes
  liveness/readiness endpoint and not external monitoring/observability.
  No such infrastructure features exist in this project. This is strictly
  application-level operational health: it does not provide Kubernetes
  health probes, Prometheus metrics, Grafana dashboards, external uptime
  monitoring or automatic alerting, and it performs no automatic
  remediation.
- **Components**: only real dependencies are reported — application
  process, PostgreSQL via Prisma, Node runtime. There is no Redis, Kafka,
  S3, email, WebSocket or external-service check, and no financial
  aggregation or user/challenge enumeration: exactly one lightweight
  query plus O(1) process introspection per read.
- **Read-only and unaudited**: health reads write no audit rows (the
  5F-4 no-read-noise rule), no notifications and no application data of
  any kind; the router registers GET only, so `POST`/`PATCH`/`DELETE`
  fall through to the 404 handler.
- **UI**: `/admin/system-health` (lazy route behind `RequireAdmin`, linked
  from the Admin dashboard as "System health") — overall status badge,
  Application/Database/Runtime cards with explicit
  `HEALTHY`/`DEGRADED`/`UNHEALTHY` badges, latency, memory and uptime
  summaries, last-checked timestamp, manual Refresh (no polling), and
  loading/error/retry states. Malformed responses are rejected by a
  structural guard in `client/src/services/adminSystemHealthApi.ts`
  before rendering.
- **Tests**: `server/tests/adminSystemHealth.test.ts` (authorization,
  spoofing, exact response-shape allowlists, live database health,
  injected-runner and HTTP-path failure simulation via a spied
  `$queryRaw`, sensitive-field/path/stack absence, read-only counts,
  runtime fields, aggregation rules) and
  `client/src/pages/AdminSystemHealth.test.tsx` (loading/healthy/
  degraded/unhealthy states, component displays, refresh, error+retry,
  `RequireAdmin` access, out-of-schema values never rendered). Live:
  `npm run e2e:admin-system-health --workspace=server` (67 checks against
  the running API).

## Security Headers & CORS (Phase 5G-2A)

Every response passes through an explicit helmet configuration defined in
`server/src/config/securityHeaders.ts` and applied first in
`server/src/app.ts`, so health, auth, general API and `/api/admin/*`
responses all receive the same headers.

- **Pinned headers**: `X-Powered-By` is removed (`app.disable('x-powered-by')`
  plus helmet's `xPoweredBy`), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`,
  `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`,
  `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`.
  Every helmet option is declared explicitly so a helmet upgrade cannot
  change the emitted headers silently; `Cross-Origin-Embedder-Policy`
  stays disabled.
- **Content-Security-Policy**: built with `useDefaults: false` from an
  explicit directive set (`default-src 'self'`, `base-uri 'self'`,
  `font-src 'self' https: data:`, `form-action 'self'`,
  `frame-ancestors 'self'`, `img-src 'self' data:`, `object-src 'none'`,
  `script-src 'self'`, `script-src-attr 'none'`,
  `style-src 'self' https: 'unsafe-inline'`). Production additionally
  sends `upgrade-insecure-requests`; development and test deliberately
  omit it so plain-HTTP `http://localhost:5000` navigation is never
  rewritten to `https://`. The API only emits JSON, so this policy
  governs documents served from this origin and does not affect the Vite
  client, which runs on its own origin.
- **Strict-Transport-Security**: sent only when `NODE_ENV=production`
  (`max-age=15552000; includeSubDomains`, 180 days). It is never emitted
  in development or test, where the API is served over plain HTTP.
- **CORS**: locked to `CLIENT_URL` with `credentials: true`, methods
  `GET, POST, PUT, PATCH, DELETE, OPTIONS` and allowed headers
  `Content-Type, Authorization`. The origin is supplied as an allowlist,
  so any other origin receives no `Access-Control-Allow-Origin` header at
  all instead of a mismatched one.
- **Tests**: `server/tests/securityHeaders.test.ts` covers the header set
  on normal and `/api/admin/*` responses, the absent `X-Powered-By`, the
  environment-specific CSP and HSTS branches, and CORS preflight,
  actual-response, foreign-origin, credentials and allowed-header
  behaviour. `server/tests/rateLimit.test.ts` asserts the stricter
  `authRateLimit` on every auth route.
- **Out of scope here**: no distributed rate-limit store and no TLS
  termination — both remain deployment concerns. `trust proxy` /
  `X-Forwarded-For` handling is covered by the phase below.

## Trust Proxy & Rate-Limit Trust Boundary (Phase 5G-2B)

Deployment topology (platform, reverse proxy, hop count, TLS termination,
instance count) is still unknown, so Phase 5G-2B adds only the
infrastructure-independent seam: a fail-closed `TRUST_PROXY` resolver and the
restoration of express-rate-limit's proxy safety validations.

- **`TRUST_PROXY` resolver** (`server/src/config/index.ts`,
  `resolveTrustProxy()`, exported as `env.TRUST_PROXY`): unset, empty, `false`
  and `0` all resolve to `false`, preserving the previous behaviour exactly. A
  positive integer resolves to a hop count; comma-separated proxy-addr values
  (symbolic ranges `loopback` / `linklocal` / `uniquelocal`, bare addresses and
  CIDR/netmask ranges) are validated token by token with `node:net` and
  returned as a list. A literal `true` is **never** honoured — permissive trust
  would make `req.ip` the left-most `X-Forwarded-For` entry, which any client
  can forge — and any malformed value falls back to `false` with a startup
  warning rather than throwing at `app.set`.
- **Express wiring**: `app.set('trust proxy', env.TRUST_PROXY)` is the first
  setting applied in `server/src/app.ts`. With the default `false` this is the
  Express default, so `req.ip` continues to come from the TCP socket and
  `X-Forwarded-For` is ignored.
- **X-Forwarded-For trust boundary**: with a hop count or address list,
  Express walks the address chain from the socket outward and stops at the
  first untrusted hop, so a forged left-most entry cannot replace the
  proxy-visible client IP when the hop count matches the real topology. The
  configured value must therefore match the deployment, and clients must be
  prevented from reaching the application directly whenever a numeric hop count
  is used. No production value is chosen in this phase.
- **Rate-limit safety validation**: the custom `keyGenerator` in
  `server/src/middleware/rateLimit.ts` was removed. It produced exactly
  `ipKeyGenerator(req.ip, 56)` — the express-rate-limit default — but by
  replacing the default it silently disabled the library's `ip`,
  `trustProxy`, `xForwardedForHeader` and `forwardedHeader` validations. With
  the default restored, `TRUST_PROXY=true` (should it ever be forced) and an
  unexpected `X-Forwarded-For` are reported instead of being ignored.
  `windowMs`, `max`, `standardHeaders`, `legacyHeaders` and the separation of
  `authRateLimit` / `apiRateLimit` are unchanged.
- **Process-local store**: both limiters still use the library's in-memory
  `MemoryStore`. Counters are per process, so they reset on restart and are not
  shared across instances; a multi-instance deployment would multiply the
  effective limit. No Redis or other distributed store has been added.
- **HTTPS prerequisites**: the production-only `Strict-Transport-Security`
  header and the `upgrade-insecure-requests` CSP directive
  (`server/src/config/securityHeaders.ts`) and the forced `COOKIE_SECURE`
  refresh cookie (`server/src/config/index.ts`) all assume TLS is terminated
  in front of the application. TLS termination is not implemented here.
- **Tests**: `server/tests/config.test.ts` covers `TRUST_PROXY` parsing;
  `server/tests/trustProxy.test.ts` covers `req.ip` with trust disabled,
  `trust proxy = 1`, forged left-most `X-Forwarded-For`, rejection of
  permissive trust and the restored express-rate-limit validations;
  `server/tests/rateLimit.test.ts` covers the six auth routes, limiter
  separation and the process-local store.
- **Deferred until topology is known**: the live `TRUST_PROXY` value, a
  shared/distributed rate-limit store, TLS termination and any reverse-proxy,
  container or CI/CD configuration.

## Design Principles

- Separation of concerns
- Type safety across the stack
- Centralized configuration
- Environment-based configuration
- Consistent error handling
- No hardcoded secrets