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

## Design Principles

- Separation of concerns
- Type safety across the stack
- Centralized configuration
- Environment-based configuration
- Consistent error handling
- No hardcoded secrets