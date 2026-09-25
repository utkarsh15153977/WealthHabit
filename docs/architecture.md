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
  `SUBSCRIPTION_UPCOMING`, `RECURRING_TRANSACTION_UPCOMING`), a nullable
  `dedupKey` (unique per user), and optional `metadata` JSON.
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
  `recurring:{id}:{occurrenceDate}:upcoming`.
- **Rules (UTC day math)**: current-month budgets at ≥80%/≥100% expense
  progress; bills due within 3 days (upcoming) or past due with
  `PENDING`/`OVERDUE` status; `ACTIVE` subscriptions renewing within 3 days;
  `isActive` recurring transactions occurring within 1 day.
- **Frontend**: `NotificationBell` renders in every page header
  (generate → unread count, badge hidden at zero) and links to
  `/notifications`; the dashboard shows a compact unread-count card.

## Design Principles

- Separation of concerns
- Type safety across the stack
- Centralized configuration
- Environment-based configuration
- Consistent error handling
- No hardcoded secrets