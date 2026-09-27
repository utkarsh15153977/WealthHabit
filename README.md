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
- **Wealth Analytics** - Advanced investment analytics (planned)
- **Bills & Subscriptions** - Recurring payment management
- **Reports** - Financial reports and insights
- **Notifications** - Smart alerts and reminders
- **Profile & Settings** - User preferences

> ✅ Implemented: **Dashboard, Transactions, Budgets, Financial Habits, Challenges, Savings Goals, Assets & Liabilities, Net Worth & Snapshots, Bills & Subscriptions, Recurring Transactions, Profile, and the in-app Notifications center.** The remaining features above are **planned** and not implemented yet.

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
npm run e2e:assets --workspace=server     # 37 checks
npm run e2e:net-worth --workspace=server  # 40 checks
```

Both register throwaway users, exercise the API over HTTP and remove those
users afterwards. `e2e:assets` covers asset/liability CRUD, balance updates,
derived `PAID_OFF` status, the summary (totals, counts and derived net worth),
ownership 404s, and asserts that transactions and savings goals are untouched.
`e2e:net-worth` covers the live net worth calculation (including a negative
result and the transaction/goal decoys), snapshot capture, idempotent and
concurrent same-day capture, immutability, listing/paging, ownership 404s and
mass-assignment rejection.

## Current Status

**Core money-management features are implemented: authentication, categories,
transactions, budgets, recurring transactions, bills & subscriptions, financial
habits, financial challenges, savings goals, assets & liabilities, net worth &
wealth snapshots, dashboard analytics, and the in-app notifications center.**

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
- ✅ Server test suite (743 tests) + client unit tests (104 tests)

Next milestone: **Phase 5D planning** (Phases 1, 2, 3A–3C, 4A, 4B, 4C, 5A, 5B and 5C delivered)