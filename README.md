# WealthHabit

WealthHabit is a web application that helps users build better financial habits, track income and expenses, manage savings goals, monitor wealth growth, and understand their financial progress.

## Features (Planned)

- **Dashboard** - Overview of financial health
- **Transactions** - Income and expense tracking
- **Budgets** - Category-based budgeting
- **Financial Habits** - Habit building for financial wellness
- **Challenges** - Gamified financial challenges (admin-created, habit-based)
- **Savings Goals** - Goal-based savings tracking
- **Assets & Liabilities** - Track what you own and what you owe
- **Net Worth & Snapshots** - Live net worth with a captured history
- **Wealth Analytics** - Read-only analytics over your wealth data
- **Bills & Subscriptions** - Recurring payment management
- **Reports** - Financial reports and insights
- **Notifications** - Smart alerts and reminders
- **Profile & Settings** - User preferences

> ✅ Implemented: **Dashboard, Transactions, Budgets, Financial Habits, Challenges, Savings Goals, Assets & Liabilities, Net Worth & Snapshots, Wealth Analytics, Bills & Subscriptions, Recurring Transactions, Profile, Reports, and the in-app Notifications center.** The remaining features above are **planned** and not implemented yet.

## Tech Stack

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Axios
- React Hook Form
- Zod
- Recharts
- Lucide React

### Backend
- Node.js
- Express.js
- TypeScript
- Zod
- Prisma ORM
- PostgreSQL

### Development
- ESLint
- Prettier
- Git
- Docker
- Docker Compose

## Project Structure

```
WealthHabit/
├── client/          # React frontend
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
│
├── server/          # Express backend
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── schemas/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── tsconfig.json
│
├── docs/            # Documentation
│   ├── architecture.md
│   ├── development.md
│   └── roadmap.md
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md
```

## Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker
- Docker Compose

## Installation

1. **Clone the project**
   ```bash
   git clone <repository-url>
   cd WealthHabit
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start PostgreSQL**
   ```bash
   npm run db:up
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Generate Prisma client**
   ```bash
   npm run db:generate
   ```

6. **Run database migrations**
   ```bash
   npm run db:migrate
   ```

7. **Seed default categories**
   ```bash
   npm run db:seed
   ```

8. **Start development servers**
   ```bash
   npm run dev
   ```

## Development URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| Health Check | http://localhost:5000/api/health |

## Environment Variables

### Root (.env)
| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection string | postgresql://wealthhabit:wealthhabit@localhost:5433/wealthhabit |
| PORT | Backend server port | 5000 |
| NODE_ENV | Environment mode | development |
| CLIENT_URL | Frontend URL for CORS | http://localhost:5173 |
| VITE_API_BASE_URL | Frontend API base URL | http://localhost:5000/api |

### Client (client/.env)
| Variable | Description |
|----------|-------------|
| VITE_API_BASE_URL | Backend API base URL |

### Server (server/.env)
| Variable | Description |
|----------|-------------|
| PORT | Server port |
| NODE_ENV | Environment mode |
| DATABASE_URL | PostgreSQL connection string |
| CLIENT_URL | Frontend URL for CORS |

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend and backend concurrently |
| `npm run client` | Start frontend only |
| `npm run server` | Start backend only |
| `npm run build` | Build all workspaces |
| `npm run lint` | Run ESLint on all workspaces |
| `npm run format` | Format code with Prettier |
| `npm run db:up` | Start PostgreSQL container |
| `npm run db:down` | Stop PostgreSQL container |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed default income/expense categories |
| `npm run db:test:setup` | Create/prepare the dedicated test database |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run all tests (client unit tests + backend tests against the test database) |
| `npm run e2e:assets --workspace=server` | Live end-to-end check for assets & liabilities (API must be running) |
| `npm run e2e:net-worth --workspace=server` | Live end-to-end check for net worth & snapshots (API must be running) |
| `npm run e2e:wealth-analytics --workspace=server` | Live end-to-end check for the read-only wealth analytics API (API must be running) |
| `npm run e2e:reports --workspace=server` | Live end-to-end check for the read-only financial reports API (API must be running) |
| `npm run e2e:admin-dashboard --workspace=server` | Live end-to-end check for the admin operational dashboard (API must be running) |
| `npm run e2e:admin-users --workspace=server` | Live end-to-end check for ADMIN user management (API must be running) |
| `npm run e2e:admin-audit-logs --workspace=server` | Live end-to-end check for ADMIN audit-log management (API must be running) |
| `npm run e2e:admin-challenges --workspace=server` | Live end-to-end check for ADMIN challenge management (API must be running) |

## Testing

`npm test` runs the **client unit tests** (Vitest + Testing Library, jsdom) and the
**backend tests** (Vitest + Supertest).

Backend tests run against a **dedicated test database** and never touch development data.

| Database | Purpose |
|----------|---------|
| `wealthhabit` | Development (`server/.env` → `DATABASE_URL`) |
| `wealthhabit_test` | Automated tests (derived automatically by `server/vitest.config.ts`) |

The test database name is derived from `DATABASE_URL` by appending `_test`
(e.g. `.../wealthhabit` → `.../wealthhabit_test`). To use a different one, set
`TEST_DATABASE_URL`. As a safety net, `server/tests/setup.ts` refuses to run
unless the resolved database name ends with `_test`.

First-time setup:

```bash
npm run db:test:setup   # creates wealthhabit_test and applies migrations
npm test
```

Live end-to-end checks (require the API running on `http://localhost:5000`,
`E2E_BASE_URL` to override):

```bash
npm run e2e:assets --workspace=server            # 37 checks
npm run e2e:net-worth --workspace=server         # 40 checks
npm run e2e:wealth-analytics --workspace=server  # 81 checks
npm run e2e:reports --workspace=server           # 72 checks
npm run e2e:admin-dashboard --workspace=server   # 26 checks
npm run e2e:admin-users --workspace=server       # 79 checks
npm run e2e:admin-audit-logs --workspace=server  # 71 checks
npm run e2e:admin-challenges --workspace=server  # 87 checks
```

All of these register throwaway users, exercise the API over HTTP and remove
those users afterwards. `e2e:assets` covers asset/liability CRUD, balance updates,
derived `PAID_OFF` status, the summary (totals, counts and derived net worth),
ownership 404s, and asserts that transactions and savings goals are untouched.
`e2e:net-worth` covers the live net worth calculation (including a negative
result and the transaction/goal decoys), snapshot capture, idempotent and
concurrent same-day capture, immutability, listing/paging, ownership 404s and
mass-assignment rejection. `e2e:wealth-analytics` seeds assets, liabilities,
transactions, categories, goals and two snapshots (one backfilled), then checks
the current position, the goal summary, net-worth history and change, asset and
liability composition, cash flow and category breakdowns, date-range filtering
and rejection, per-user isolation, a negative net worth, and that reading
analytics never writes a snapshot, notification, transaction, asset, goal or
stored snapshot value — plus 404s for every write method and 400s for
client-supplied financial values. `e2e:admin-dashboard` covers the read-only
admin operational overview (RBAC 401/403, spoofing, suspended/deactivated
admins, no financial amounts exposed, no records created by reads).
`e2e:admin-users` covers ADMIN user management end to end: list/search/filter,
safe detail views, status transitions, session revocation and refresh
rejection, role management, self-protection, last-admin protection, header and
query spoofing, credential/financial-amount exclusion, financial records
intact after status changes, plus cleanup of its throwaway users and audit
entries. `e2e:admin-audit-logs` generates real status/role audit events,
then verifies RBAC, strict validation, newest-first pagination, action/actor/
target/date/search filters, actor and target resolution, sanitized metadata,
credential and financial-amount exclusion, and that the audit-log API is
strictly read-only (DELETE/PUT/PATCH/POST all 404, row counts unchanged).
`e2e:admin-challenges` creates two controlled challenges, then verifies
RBAC/spoofing, strict create and query validation, the admin list/detail
contract (safe fields, search, type/status/activation/startDate filters,
derived status), the participant flow (join, habit mapping and completion
reflected as derived `{total, completed}` stats), the activation round-trip,
requirement immutability after creation, `ADMIN_CHALLENGE_CREATED/UPDATED/
DELETED` audit events with their metadata, challenge deletion cascading only
to mappings (financial habits and their completions survive), and cleanup of
its throwaway challenges, users and audit entries so the global audit-log
total asserted by `e2e:admin-audit-logs` stays stable.

## Current Status

**Core money-management features are implemented: authentication, categories,
transactions, budgets, recurring transactions, bills & subscriptions, financial
habits, financial challenges, savings goals, assets & liabilities, net worth &
wealth snapshots, read-only wealth analytics, dashboard analytics, and the
in-app notifications center.**

Implemented:

- ✅ Auth (register/login/refresh/logout, sessions, profiles)
- ✅ Categories and transaction tracking with filtering/pagination
- ✅ Monthly budgets with Decimal-based progress and thresholds
- ✅ Recurring transactions with on-demand occurrence generation
- ✅ Bills & Subscriptions with due-state tracking and renewal advancement
- ✅ Dashboard summary with budgets, recurring rules, upcoming obligations, a
  financial-habits summary card (completed this period + per-habit streaks),
  a challenges card (active/joined counts + progress of up to 3 joined
  challenges) and a savings goals card (active/saved/target totals + up to 3
  active goals), an assets & liabilities card (total assets, total liabilities
  and record counts) and a **net worth card** (total assets, total liabilities
  and current net worth, flagged red when negative)
- ✅ **Financial habits** — CRUD + activation, idempotent completion
  (`POST/DELETE /api/habits/:id/complete`), completion history, progress and
  **streaks** (`current`/`longest` + `completionRate` over elapsed periods,
  derived on demand from `HabitCompletion` — no streak columns, tables or
  counters are persisted). A period-history endpoint
  (`GET /api/habits/:id/progress/history`) backs the in-page history dialog.
  Completions are informational only: they never create or mutate
  transactions, budgets, bills, subscriptions or recurring rules, and there
  is no scheduler. Weekly periods anchor to Monday (ISO-8601 UTC weeks),
  monthly to the 1st.
- ✅ **In-app notifications** — budget thresholds (80%/100%), bill reminders
  (≤3 days) and overdue alerts, subscription renewal reminders (≤3 days),
  recurring transaction due reminders (≤1 day), and daily habit reminders
  (`HABIT_REMINDER`, deduped per habit + UTC day, skipped when already
  completed or inactive). Notifications are generated on demand only
  (`POST /api/notifications/generate`), deduplicated per user, and never
  create or modify financial records. No scheduler, queue, email, or push
  channel is involved.
- ✅ **Financial challenges** — admin-managed challenges
  (`POST/PATCH/DELETE /api/challenges` require the `ADMIN` role; list/get,
  join/leave/progress are open to signed-in users) with **habit requirements**
  (frequency + per-period target, 1–10 per challenge). Participants map each
  requirement to one of their own habits (ownership, active, frequency and
  date-overlap validated; same habit is idempotent, a different habit
  replaces the mapping). **Progress is derived on demand** from
  `HabitCompletion` over the challenge window (`GET /api/challenges/:id/progress`)
  and never persisted — challenge status (`UPCOMING`/`ACTIVE`/`ENDED`) and
  participant status (`NOT_JOINED`/`JOINED`/`COMPLETED`) are derived too; the
  legacy `progress`/`status`/`completedAt` participant columns are unused.
  Joining is idempotent and race-safe (compound unique key → `201` first join,
  `200 alreadyJoined` after). Challenges are informational only: no XP,
  leaderboards, rewards, notifications or scheduler, and they never create or
  mutate transactions, budgets, bills, subscriptions, recurring rules or habit
  completions. Admin creation/management is API-only for now (no admin UI);
  tests promote users to `ADMIN` via controlled SQL setup.
- ✅ **Savings goals** — goal CRUD with per-goal contributions
  (`GET/POST /api/goals`, `GET/PATCH/DELETE /api/goals/:id`,
  `GET /api/goals/:id/progress`, `GET/POST /api/goals/:id/contributions`,
  `PATCH/DELETE /api/goals/:id/contributions/:contributionId`; list supports
  `status` filter + pagination and returns list-level meta totals).
  **`currentAmount` is derived on demand** from
  `SUM(goal_contributions.amount)` — the legacy `savings_goals.currentAmount`
  column is never read or written (no migration needed). Derived fields:
  `progressPercent` (2dp, capped at 100), `remainingAmount`,
  `contributionCount`, and `overdue` (target date passed while not
  completed/cancelled). Status stores user intent (`ACTIVE`/`PAUSED`/
  `CANCELLED`) while `COMPLETED` is auto-synced after contribution and target
  changes — never auto-overwritten for paused/cancelled goals, and `PATCH`
  cannot set `COMPLETED` directly (400). Contribution mutations and status
  re-sync run in a transaction holding a goal row lock. Errors:
  `GOAL_NOT_FOUND`/`CONTRIBUTION_NOT_FOUND` (404, anti-enumeration).
  Contributions are informational only: they never create transactions or
  notifications (goal notifications are future work), and there is no
  scheduler.
- ✅ **Assets & liabilities** — separate CRUD for what you own and what you owe
  (`GET/POST /api/assets`, `GET/PATCH/DELETE /api/assets/:id`,
  `GET/POST /api/liabilities`, `GET/PATCH/DELETE /api/liabilities/:id`, plus
  `GET /api/assets-liabilities/summary`). Balance source of truth is
  `Asset.currentValue` and `Liability.outstandingAmount`; money is handled as
  `Prisma.Decimal` end to end and serialized with `roundMoney()` (exact
  `0.10 + 0.20 + 33.33` arithmetic in tests). The summary returns
  `totalAssets`, `totalLiabilities`, `netWorth`, `assetCount` and
  `liabilityCount` — one aggregation endpoint, no separate net-worth API.
  `status` is derived at
  serialization time and never persisted: assets are always `ACTIVE`,
  liabilities are `PAID_OFF` only when the outstanding balance is `0`
  (no migration, no status column). Lists support `type` filter + pagination
  (`page`, `pageSize` ≤ 50). Errors: `ASSET_NOT_FOUND`/`LIABILITY_NOT_FOUND`
  (404, anti-enumeration); strict Zod schemas reject unknown fields (mass
  assignment of `userId`/`id`/`createdAt` is a 400). Assets/liabilities are
  informational only: they never create transactions, notifications, budgets,
  bills, subscriptions or recurring rules, they never link to savings goals,
  and there is no scheduler or reconciliation.
- ✅ **Net worth & wealth snapshots** — current net worth is derived on demand
  as **Total Assets − Total Liabilities** from the live `Asset.currentValue`
  and `Liability.outstandingAmount` sums (`GET /api/assets-liabilities/summary`
  now also returns `netWorth`), never from transactions, savings-goal
  contributions or a stored snapshot, and never clamped: a negative result is
  reported as is. **Snapshots** (`POST/GET /api/wealth-snapshots`,
  `GET /api/wealth-snapshots/:id`) capture today's UTC calendar day inside a
  transaction, storing `totalAssets`, `totalLiabilities` and `netWorth` as
  immutable `Prisma.Decimal` values. One snapshot per user per day is
  enforced by the existing `@@unique([userId, snapshotDate])` constraint: a
  repeat capture returns `200` with the existing row (`created: false`) and a
  concurrent race resolves to a single row instead of a 500. There is no
  update or delete route, no client-supplied field (the create body is an
  empty strict object, so `snapshotDate`/`netWorth`/`userId` are a 400), and
  no scheduler. Lists are `snapshotDate DESC` with `page`/`pageSize` ≤ 50;
  `WEALTH_SNAPSHOT_NOT_FOUND` (404) hides other users' snapshots. Deleting an
  asset or liability changes the live net worth but never alters or removes a
  captured snapshot.
- ✅ **Wealth analytics** — five read-only endpoints under
  `GET /api/wealth-analytics` (`/summary`, `/net-worth`, `/assets`,
  `/liabilities`, `/cash-flow`) that derive everything on demand from the
  existing sources of truth: live `Asset.currentValue`/`Liability.outstandingAmount`
  sums, stored `WealthSnapshot` history, goal contributions and
  `Transaction` records. No new tables or migrations, no writes of any kind
  (a read never creates a snapshot, notification or record), no scheduler, no
  forecast or advice. The two range-dependent endpoints take `dateFrom`/
  `dateTo` (UTC calendar days, defaulting to the last 365 days, maximum span
  1825 days; reversed, invalid or wider ranges are a 400 `VALIDATION_ERROR`);
  the range-independent endpoints accept an empty query only. Money stays
  `Prisma.Decimal` until serialization, shares are 2dp percentages of the
  total (a non-positive base yields a null percentage), net-worth change is
  `latest − earliest` over the snapshots in range (`null` with fewer than two
  points) and cash flow is never reported as net worth change. Goal totals
  reuse the goals list meta and the same capped `progressPercent` algorithm
  (now shared as `goalProgressValues`). Strict queries reject client-supplied
  values (`userId`/`netWorth`/`income` → 400), only GET exists (write methods
  → 404) and anonymous requests are 401. Frontend: `/wealth-analytics` page
  with 30/90/180/365-day range buttons and six sections — current position,
  net worth history + "Net Worth Change", asset allocation, liability
  composition, savings goal summary, cash flow — each with its own loading,
  error-with-Retry and empty state, plus a `Wealth Analytics` nav item on
  every page and Dashboard links from the net worth card.
- ✅ **Financial Reports** — read-only report endpoints at `GET /api/reports`:
  `/financial` (JSON preview), `/financial.csv`, `/financial.pdf`. Built on the
  same `FinancialReportData` contract that powers Wealth Analytics, ensuring
  JSON, CSV and PDF can never disagree. Contains: report period, financial
  overview (income, expenses, net cash flow, assets, liabilities, net worth),
  income/expense category breakdowns, current asset/liability positions with
  type breakdowns, net worth history from stored snapshots (no interpolation),
  and savings goals with progress. Date range uses the same UTC calendar-day
  semantics (default 365 days, max 1825 days). CSV is RFC 4180-compliant with
  formula-injection protection and UTF-8 BOM. PDF is generated server-side via
  pdfkit with explicit page breaks and footers. Strict validation rejects
  unknown query parameters (`?userId=`, `?netWorth=` → 400). No write routes
  (POST/PATCH/DELETE → 404), anonymous → 401. Frontend: `/reports` page with
  range presets, all sections, loading/error/empty/retry states, CSV/PDF
  download buttons, and a `Reports` nav item on every page.
  - ✅ Server test suite (876 tests) + client unit tests (140 tests)
- ✅ **Admin Authorization** — centralized RBAC with `USER`/`ADMIN` roles:
  - `requireAdmin` middleware protects admin-only endpoints
  - Anonymous requests → 401
  - Authenticated `USER` on admin endpoints → 403
  - Authenticated `ADMIN` → allowed
  - Role sourced from authenticated JWT (validated against DB), never from client headers/body/query
  - Self-escalation prevented: registration defaults to `USER`, profile updates cannot modify role
  - Suspended/deactivated accounts blocked at auth layer (403)
  - **Admin-only endpoints**: `POST/PATCH/DELETE /api/challenges` (challenge management)
  - Frontend: `RequireAdmin` route guard for future admin pages
- ✅ **Admin Dashboard** — `GET /api/admin/dashboard` (ADMIN-only operational
  overview: user counts, record counts and application metrics) with the
  `/admin` page behind `RequireAdmin` (loading/error/retry states, no
  individual financial amounts exposed).
- ✅ **Admin user management** — `/admin/users` page (behind `RequireAdmin`,
  linked from the Admin dashboard) plus ADMIN-only API:
  - `GET /api/admin/users` — paginated list (`page` ≥ 1, `pageSize` ≤ 50)
    with `search` (name/email), `role` and `status` filters; strict query
    validation rejects unknown parameters
  - `GET /api/admin/users/:id` — safe detail with operational record counts
    (transactions, goals, assets, liabilities, habits, challenges) and no
    financial values
  - `PATCH /api/admin/users/:id/status` — `ACTIVE`/`SUSPENDED`/`DEACTIVATED`
    with supported-transition enforcement; suspending/deactivating revokes all
    refresh sessions in the same transaction (login, API access and refresh
    are all blocked afterwards; reactivation re-enables login)
  - `PATCH /api/admin/users/:id/role` — dedicated role management
    (`USER`/`ADMIN`) only; the profile API still rejects `role`
  - Protections: anonymous → 401, `USER` → 403, self-suspension/self-
    deactivation → 409, last-admin demotion → 409 (server-side count), header
   /query/body spoofing → rejected, unknown fields → 400
  - Credentials (`passwordHash`, refresh/session hashes, tokens) are never
    returned; status/role changes never delete financial records; sensitive
    mutations write `ADMIN_USER_STATUS_CHANGED`/`ADMIN_USER_ROLE_CHANGED`
    audit entries (full audit-log UI remains Phase 5F-4)
- ✅ **Audit log management** — `/admin/audit-logs` page (behind
  `RequireAdmin`, linked from the Admin dashboard) plus the ADMIN-only,
  read-only API `GET /api/admin/audit-logs`:
  - Strict query: `page` ≥ 1, `pageSize` ≤ 50, `action` (only the known
    `AuditActions` values), `actorUserId`/`entityId` (cuid-shaped ids),
    `dateFrom`/`dateTo` (UTC calendar days, inclusive, ≤ 1825 days, no
    reversed ranges), `search` (actor/target name or email, action
    substring); unknown parameters → 400
  - Newest-first ordering (`createdAt` DESC, `id` DESC), `findMany + count`
    with a single batched target lookup — no N+1 queries
  - Safe response: id/action/entityType/entityId/createdAt, `actor` and
    `target` (`id`/`email`/`firstName`/`lastName`, `null` when deleted or
    unknown) and **sanitized metadata** (credential-shaped keys stripped,
    depth/size bounded) — no passwords, hashes, tokens, cookies or
    financial values
  - Strictly immutable: no POST/PUT/PATCH/DELETE endpoints exist and reads
    never write audit entries (no recursive audit-of-audit)
  - UI: search, action select (derived from the known action set), actor/
    target id and date filters with Apply/Clear, desktop table + mobile
    cards, detail dialog (action, timestamp, actor, target, formatted
    metadata), loading/error/retry/empty/no-results states and pagination
- ✅ **Challenge administration** — `/admin/challenges` page (behind
  `RequireAdmin`, linked from the Admin dashboard) plus the ADMIN-only,
  read-only API for challenge data:
  - `GET /api/admin/challenges` — paginated list (`page` ≥ 1, `pageSize` ≤ 50)
    with `search` (name/description/category), `type`, derived `status`
    (`UPCOMING`/`ACTIVE`/`ENDED`), persisted `active` and
    `dateFrom`/`dateTo` startDate filters (UTC calendar days, inclusive,
    ≤ 1825 days, no reversed ranges); strict query rejects unknown
    parameters; newest-startDate ordering matches the public list
  - `GET /api/admin/challenges/:id` — detail with ordered requirements
    (including per-requirement `mappedParticipants`) and derived participant
    stats `{ total, completed }` computed by the existing batched
    progress machinery (4 flat queries, nothing persisted)
  - Mutations reuse the existing admin-protected `POST/PATCH/DELETE
    /api/challenges` routes; each now writes `ADMIN_CHALLENGE_CREATED` /
    `ADMIN_CHALLENGE_UPDATED` / `ADMIN_CHALLENGE_DELETED` audit entries in
    the same transaction (activation is audited as `UPDATED` with
    `previousIsActive`/`newIsActive`); requirements remain immutable after
    creation (1–10 on create)
  - Protections: anonymous → 401, `USER` → 403 (including header/query
    spoofing), unknown ids → 404, unknown query parameters → 400
  - UI: search, filters, desktop table + mobile cards, pagination, detail
    dialog (requirements, participant counts), RHF create/edit form with a
    requirements editor, delete confirmation and
    loading/error/empty/no-results states

Next milestone: **to be planned** (Phases 1, 2, 3A–3C, 4A, 4B, 4C, 5A, 5B, 5C, 5D, 5F-1, 5F-2, 5F-3, 5F-4 and 5F-5 delivered)