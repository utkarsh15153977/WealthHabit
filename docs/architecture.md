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
or aggregates. There is no scheduler, cron job, queue, streak calculation, or
push/email channel.

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
    desc; `includeProgress` computes progress for the page with grouped
    aggregates (no per-habit queries)
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
  - `GET /api/habits/:id/progress` — `{ habitId, currentPeriod:
    { completed, period }, totalCompletions, completionRate, active }`.
- **completionRate** = distinct completed periods ÷ eligible periods × 100,
  where eligible periods run from `startDate` through
  `min(endDate, today)` counted arithmetically (UTC), capped at 100%.
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
  (`{completed} of {total}` for the current period).

## Design Principles

- Separation of concerns
- Type safety across the stack
- Centralized configuration
- Environment-based configuration
- Consistent error handling
- No hardcoded secrets