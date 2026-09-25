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
- `src/layouts/` - Page layouts (auth, dashboard, etc.)
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

## Design Principles

- Separation of concerns
- Type safety across the stack
- Centralized configuration
- Environment-based configuration
- Consistent error handling
- No hardcoded secrets