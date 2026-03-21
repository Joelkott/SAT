# External Integrations

**Analysis Date:** 2026-03-21

## APIs & External Services

**Search & Indexing:**
- Typesense - Full-text search engine
  - SDK/Client: `github.com/typesense/typesense-go` v1.0.0
  - Configuration: `TYPESENSE_API_KEY`, `TYPESENSE_HOST` environment variables
  - Collection name: `songs` (created automatically on init)
  - Indexed fields: id, title, artist, lyrics, language, content, updated_at
  - Implementation: `backend/internal/typesense/client.go`

**Presentation Software:**
- ProPresenter - Slide/presentation management software (optional, configurable)
  - SDK/Client: Custom HTTP client in `backend/internal/propresenter/client.go`
  - Configuration: `PROPRESENTER_ENABLED`, `PROPRESENTER_HOST`, `PROPRESENTER_PORT`, `PROPRESENTER_PLAYLIST` environment variables
  - Default port: 1025
  - API version: v1 (ProPresenter API v1)
  - Endpoints:
    - `GET /v1/library` - Fetch all library items
    - `GET /v1/library?q=query` - Search library
    - `GET /v1/playlists` - Fetch all playlists
    - `POST /v1/playlists` - Create playlist
    - `POST /v1/playlist/{id}` - Add item to playlist
    - `GET /v1/trigger/library/{uuid}` - Trigger item display
    - `GET /v1/trigger/next` - Advance slide
    - `GET /v1/trigger/previous` - Previous slide
    - `GET /v1/clear/layer/{name}` - Clear layer
    - `GET /v1/status` - Health check
  - Integration points: Backend handlers in `backend/internal/handlers/handlers.go`

## Data Storage

**Databases:**
- PostgreSQL 14 (Alpine)
  - Connection: `DATABASE_URL` environment variable (format: `postgres://user:pass@host:port/db?sslmode=disable`)
  - Container: `teleprompter-db` (docker-compose.yml)
  - Default credentials: User `teleprompter_user`, password `teleprompter_pass`, database `teleprompter`
  - Client: `github.com/lib/pq` (native PostgreSQL driver)
  - Schema location: `backend/migrations/` mounted in Docker
  - Connection pool: Max 25 open connections, 5 idle, 5 minute lifetime
  - Tables: `songs` (id, title, artist, lyrics, language, content, created_at, updated_at)

**File Storage:**
- Local filesystem backups
  - Backup directory: `BACKUP_DIR` environment variable (default: `/app/backups`)
  - Volume mount: `backups_data:/app/backups` in docker-compose.yml
  - Backup trigger: Automatic after every 100 edits/changes
  - Implementation: `backend/internal/backup/backup.go`

**Caching:**
- None configured - Direct queries to PostgreSQL and Typesense

## Authentication & Identity

**Auth Provider:**
- None - No built-in authentication system
- CORS enabled with wildcard: `AllowOrigins: "*"` in `backend/cmd/server/main.go`
- All endpoints publicly accessible without auth tokens
- No API key validation on endpoint access

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, Rollbar, or similar integration

**Logs:**
- Standard library logging
  - Backend: Go `log` package to stdout
  - Frontend: `console.log()` and `console.error()` in browser
  - Fiber logger middleware configured with format: `[${time}] ${status} - ${latency} ${method} ${path}`
  - Backend logs: Database connection status, Typesense initialization, ProPresenter setup, migrations
  - Frontend logs: API URL on startup (development only), API errors with details (status, method, URL, data)

**Health Checks:**
- Backend endpoint: `GET /api/health` in `backend/cmd/server/main.go`
- PostgreSQL health check: `pg_isready` command in docker-compose.yml
- ProPresenter health check: `GET /v1/status` endpoint via client in `backend/internal/propresenter/client.go`

## CI/CD & Deployment

**Hosting:**
- Docker Compose for local/development deployment
- Containerization: Multi-stage builds for both backend and frontend
- No external CI/CD platform detected (no GitHub Actions, GitLab CI, Jenkins config)

**Build Process:**
- Backend: Go binary compilation in Alpine
- Frontend: Next.js standalone output mode for Docker compatibility
- Environment variables injected at runtime

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string (required, no default)
- `TYPESENSE_API_KEY` - Typesense API key (required, no default)
- `TYPESENSE_HOST` - Typesense server address (required, no default)
- `PORT` - Backend server port (optional, default: 8080)
- `BACKUP_DIR` - Backup storage directory (optional, default: ./backups)
- `SKIP_TYPESENSE` - Skip Typesense indexing during import (optional, default: false)
- `PROPRESENTER_ENABLED` - Enable ProPresenter integration (optional, default: false)
- `PROPRESENTER_HOST` - ProPresenter server address (optional if disabled)
- `PROPRESENTER_PORT` - ProPresenter port (optional, default: 1025)
- `PROPRESENTER_PLAYLIST` - Default playlist name (optional, default: "Live Queue")
- `API_URL` - Backend API URL for frontend (optional, default: http://localhost:8080/api)
- `NEXT_PUBLIC_API_URL` - Public API URL embedded in frontend (optional, uses API_URL)
- `POSTGRES_USER` - Database user (optional, default: teleprompter_user)
- `POSTGRES_PASSWORD` - Database password (optional, default: teleprompter_pass)
- `POSTGRES_DB` - Database name (optional, default: teleprompter)
- `NODE_ENV` - Set to `production` in Docker runtime

**Secrets location:**
- `.env` file in project root (git ignored)
- Docker environment variables in docker-compose.yml
- Environment variables injected at container runtime

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- ProPresenter API calls (synchronous HTTP requests only, no webhooks)
  - Triggered by frontend user actions
  - Examples: Queue songs, trigger slides, navigate slides

---

*Integration audit: 2026-03-21*
