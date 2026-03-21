# Technology Stack

**Analysis Date:** 2026-03-21

## Languages

**Primary:**
- Go 1.21 - Backend API server
- TypeScript 5 - Frontend React application
- JavaScript - Next.js configuration and tooling

**Secondary:**
- SQL (PostgreSQL dialect) - Database queries and migrations

## Runtime

**Environment:**
- Go 1.21 (backend)
- Node.js 18 (frontend, from Docker image `node:18-alpine`)

**Package Managers:**
- npm 10+ (inferred from package-lock.json) - Frontend dependencies
- Go Modules - Backend dependencies

## Frameworks

**Core:**
- Fiber v2.52.0 - HTTP framework and router (backend)
- Next.js 14.2.0 - React framework with built-in routing and SSR (frontend)
- React 18 - UI component library (frontend)
- React DOM 18 - React browser bindings (frontend)

**Styling:**
- Tailwind CSS 3.3.0 - Utility-first CSS framework
- PostCSS 8 - CSS transformation tool
- Autoprefixer 10.0.1 - Vendor prefix management

**Linting/Code Quality:**
- ESLint 8 - JavaScript/TypeScript linter
- eslint-config-next 14.2.0 - Next.js ESLint configuration

## Key Dependencies

**Critical:**
- `github.com/lib/pq` v1.10.9 - PostgreSQL driver for Go
- `github.com/typesense/typesense-go` v1.0.0 - Typesense search client
- `axios` 1.6.8 - HTTP client for frontend API calls

**Infrastructure:**
- `github.com/gofiber/fiber/v2` v2.52.0 - Web framework
- `github.com/joho/godotenv` v1.5.1 - Load .env files
- Fiber middleware: `cors`, `logger`, `recover` - Request handling

**Development:**
- `@types/react` 18 - React TypeScript definitions
- `@types/react-dom` 18 - React DOM TypeScript definitions
- `@types/node` 20 - Node.js TypeScript definitions

## Configuration

**Environment:**
- `.env` file - Environment variable configuration (see git status - file present)
- Database connection: `DATABASE_URL` environment variable (PostgreSQL DSN)
- API configuration: `TYPESENSE_API_KEY`, `TYPESENSE_HOST` environment variables
- Server port: `PORT` environment variable (default: 8080 backend, 3000 frontend)
- ProPresenter integration: `PROPRESENTER_ENABLED`, `PROPRESENTER_HOST`, `PROPRESENTER_PORT`, `PROPRESENTER_PLAYLIST` environment variables
- Backup directory: `BACKUP_DIR` environment variable (default: `/app/backups`)

**Build:**
- `next.config.js` - Next.js build configuration at `/home/joel/jgm/SAT/frontend/next.config.js`
  - Output mode: `standalone` for Docker compatibility
  - Environment: NEXT_PUBLIC_API_URL embedded in client bundle at build time
- `tsconfig.json` - TypeScript compiler options at `/home/joel/jgm/SAT/frontend/tsconfig.json`
  - Target: ES5
  - Module resolution: bundler
  - Path alias: `@/*` maps to frontend root
  - JSX: preserve for Next.js

## Platform Requirements

**Development:**
- Go 1.21+ installed
- Node.js 18+ installed
- npm installed
- PostgreSQL 14+ (for database)
- Typesense search server accessible
- Optional: ProPresenter software running on network for integration testing

**Production:**
- Docker and Docker Compose for containerization
- PostgreSQL 14 (Alpine Linux variant)
- Typesense search service (external or containerized)
- Next.js standalone server

## Docker Images

**Backend:**
- Build: golang:1.21-alpine
- Runtime: alpine:latest
- Single binary: `/app/server`

**Frontend:**
- Build: node:18-alpine (3-stage build)
- Runtime: node:18-alpine
- Standalone Next.js server

**Database:**
- postgres:14-alpine
- Volume: `postgres_data:/var/lib/postgresql/data`
- Health check: `pg_isready` command

---

*Stack analysis: 2026-03-21*
