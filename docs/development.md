# Development Guide

## Local Setup

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0
- Docker & Docker Compose
- Git

### Initial Setup

```bash
# Clone repository
git clone <repository-url>
cd WealthHabit

# Install all dependencies
npm install

# Start PostgreSQL
npm run db:up

# Copy environment files
cp .env.example .env
cp client/.env.example client/.env
cp server/.env.example server/.env

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Start development
npm run dev
```

### Environment Files

Create these files from examples:
- `.env` (root)
- `client/.env`
- `server/.env`

### Database Commands

```bash
# Start database
npm run db:up

# Stop database
npm run db:down

# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Open Prisma Studio
npm run db:studio

# Reset database (careful!)
cd server && npx prisma migrate reset

# Prepare the test database (creates <db>_test and applies migrations)
npm run db:test:setup
```

### Testing

Tests run against a dedicated test database so development data is never touched:

- `server/vitest.config.ts` derives the test URL from `DATABASE_URL` by appending `_test`
  (e.g. `wealthhabit` → `wealthhabit_test`). Set `TEST_DATABASE_URL` to override.
- `server/tests/setup.ts` refuses to run unless the resolved database name ends with `_test`.
- First-time setup: `npm run db:test:setup`, then `npm test`.

```bash
# Run all backend tests (root or server workspace)
npm test

# Run a single file
npx vitest run tests/transaction.test.ts   # from server/
```

### Development Workflow

1. Make changes to code
2. Frontend: Hot reload via Vite
3. Backend: Auto-restart via tsx watch mode
4. Run lint: `npm run lint`
5. Format code: `npm run format`
6. Type check: `npm run build` (includes TypeScript compilation)

### Ports

| Service | Port |
|---------|------|
| Frontend (Vite) | 5173 |
| Backend (Express) | 5000 |
| PostgreSQL | 5433 (host) → 5432 (container) |

### Common Issues

**Port already in use:**
```bash
# Find process using port
netstat -ano | findstr :5000
# Kill process
taskkill /PID <PID> /F
```

**Database connection refused:**
- Ensure Docker is running
- Run `npm run db:up`
- Check `docker ps` for postgres container

**Prisma client not generated:**
```bash
npm run db:generate
```

**TypeScript errors:**
```bash
npm run build
```

### IDE Setup (VS Code)

Recommended extensions:
- ESLint
- Prettier
- Prisma
- Tailwind CSS IntelliSense
- TypeScript Vue Language Features (Volar)

Settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```