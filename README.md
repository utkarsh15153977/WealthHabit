# WealthHabit

WealthHabit is a web application that helps users build better financial habits, track income and expenses, manage savings goals, monitor wealth growth, and understand their financial progress.

## Features (Planned)

- **Dashboard** - Overview of financial health
- **Transactions** - Income and expense tracking
- **Budgets** - Category-based budgeting
- **Financial Habits** - Habit building for financial wellness
- **Challenges** - Gamified financial challenges
- **Savings Goals** - Goal-based savings tracking
- **Wealth Analytics** - Net worth, investments, assets/liabilities
- **Bills & Subscriptions** - Recurring payment management
- **Reports** - Financial reports and insights
- **Notifications** - Smart alerts and reminders
- **Profile & Settings** - User preferences

> ✅ Implemented: **Dashboard, Transactions, Budgets, Bills & Subscriptions, Recurring Transactions, Profile, and the in-app Notifications center.** The remaining features above are **planned** and not implemented yet.

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

## Current Status

**Core money-management features are implemented: authentication, categories,
transactions, budgets, recurring transactions, bills & subscriptions, dashboard
analytics, and the in-app notifications center.**

Implemented:

- ✅ Auth (register/login/refresh/logout, sessions, profiles)
- ✅ Categories and transaction tracking with filtering/pagination
- ✅ Monthly budgets with Decimal-based progress and thresholds
- ✅ Recurring transactions with on-demand occurrence generation
- ✅ Bills & Subscriptions with due-state tracking and renewal advancement
- ✅ Dashboard summary with budgets, recurring rules and upcoming obligations
- ✅ **In-app notifications** — budget thresholds (80%/100%), bill reminders
  (≤3 days) and overdue alerts, subscription renewal reminders (≤3 days), and
  recurring transaction due reminders (≤1 day). Notifications are generated
  on demand only (`POST /api/notifications/generate`), deduplicated per user,
  and never create or modify financial records. No scheduler, queue, email,
  or push channel is involved.
- ✅ Server test suite (372 tests) + client unit tests (13 tests)

Next milestone: **Phase 4 planning**