<!-- GSD:project-start source:PROJECT.md -->
## Project

**SAT — Scripture & Song Display System**

A church worship display system with a Go/Fiber backend and Next.js frontend. It manages song lyrics in multiple languages, integrates with ProPresenter for live display, and uses Typesense for search. The app has a control window and a display window connected via BroadcastChannel. We're adding Bible scripture support with multi-translation viewing and a dedicated output tab for Resolume/ProPresenter browser source capture.

**Core Value:** Worship leaders can instantly find and display Bible scriptures alongside songs during live services, with multiple translations visible side-by-side.

### Constraints

- **API:** Must use api.bible REST API — no local Bible database
- **Tech stack:** Must stay within existing Go + Next.js stack
- **Translations:** Up to 4 simultaneous translations in multiview
- **Docker:** Must work within existing docker-compose deployment
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- Go 1.21 - Backend API server
- TypeScript 5 - Frontend React application
- JavaScript - Next.js configuration and tooling
- SQL (PostgreSQL dialect) - Database queries and migrations
## Runtime
- Go 1.21 (backend)
- Node.js 18 (frontend, from Docker image `node:18-alpine`)
- npm 10+ (inferred from package-lock.json) - Frontend dependencies
- Go Modules - Backend dependencies
## Frameworks
- Fiber v2.52.0 - HTTP framework and router (backend)
- Next.js 14.2.0 - React framework with built-in routing and SSR (frontend)
- React 18 - UI component library (frontend)
- React DOM 18 - React browser bindings (frontend)
- Tailwind CSS 3.3.0 - Utility-first CSS framework
- PostCSS 8 - CSS transformation tool
- Autoprefixer 10.0.1 - Vendor prefix management
- ESLint 8 - JavaScript/TypeScript linter
- eslint-config-next 14.2.0 - Next.js ESLint configuration
## Key Dependencies
- `github.com/lib/pq` v1.10.9 - PostgreSQL driver for Go
- `github.com/typesense/typesense-go` v1.0.0 - Typesense search client
- `axios` 1.6.8 - HTTP client for frontend API calls
- `github.com/gofiber/fiber/v2` v2.52.0 - Web framework
- `github.com/joho/godotenv` v1.5.1 - Load .env files
- Fiber middleware: `cors`, `logger`, `recover` - Request handling
- `@types/react` 18 - React TypeScript definitions
- `@types/react-dom` 18 - React DOM TypeScript definitions
- `@types/node` 20 - Node.js TypeScript definitions
## Configuration
- `.env` file - Environment variable configuration (see git status - file present)
- Database connection: `DATABASE_URL` environment variable (PostgreSQL DSN)
- API configuration: `TYPESENSE_API_KEY`, `TYPESENSE_HOST` environment variables
- Server port: `PORT` environment variable (default: 8080 backend, 3000 frontend)
- ProPresenter integration: `PROPRESENTER_ENABLED`, `PROPRESENTER_HOST`, `PROPRESENTER_PORT`, `PROPRESENTER_PLAYLIST` environment variables
- Backup directory: `BACKUP_DIR` environment variable (default: `/app/backups`)
- `next.config.js` - Next.js build configuration at `/home/joel/jgm/SAT/frontend/next.config.js`
- `tsconfig.json` - TypeScript compiler options at `/home/joel/jgm/SAT/frontend/tsconfig.json`
## Platform Requirements
- Go 1.21+ installed
- Node.js 18+ installed
- npm installed
- PostgreSQL 14+ (for database)
- Typesense search server accessible
- Optional: ProPresenter software running on network for integration testing
- Docker and Docker Compose for containerization
- PostgreSQL 14 (Alpine Linux variant)
- Typesense search service (external or containerized)
- Next.js standalone server
## Docker Images
- Build: golang:1.21-alpine
- Runtime: alpine:latest
- Single binary: `/app/server`
- Build: node:18-alpine (3-stage build)
- Runtime: node:18-alpine
- Standalone Next.js server
- postgres:14-alpine
- Volume: `postgres_data:/var/lib/postgresql/data`
- Health check: `pg_isready` command
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React components: PascalCase, e.g., `SongForm.tsx`, `SearchBar.tsx`, `SongList.tsx`
- Utility/library files: camelCase, e.g., `api.ts`, `globals.css`
- Config files: lowercase with dots, e.g., `next.config.js`, `tailwind.config.ts`
- Pages: route-based naming in app directory, e.g., `page.tsx`, `layout.tsx`
- React component functions: PascalCase (exported as default)
- Helper/utility functions: camelCase, e.g., `loadSongs()`, `handleSearch()`, `reorderByLanguageClient()`
- Event handlers: `handle` prefix, e.g., `handleSubmit`, `handleSearch`, `handleSelectSong`, `handleSendToLive`, `handleDelete`, `handleCreateNew`, `handleEdit`
- Async functions use async/await pattern
- Callback functions prefixed with `on`, e.g., `onSubmit`, `onCancel`, `onSearch`, `onSelectSong`, `onEdit`, `onSendToLive`
- Local state: camelCase, e.g., `selectedSong`, `isSearching`, `showForm`, `liveSong`
- Boolean flags: `is`/`show`/`has` prefix, e.g., `isLoading`, `showForm`, `showPreviewModal`, `isDragging`, `ppSyncEnabled`
- Refs: `Ref` suffix, e.g., `displayChannelRef`, `splitContainerRef`, `leftWidthRef`, `rafIdRef`
- Constants: UPPER_CASE, e.g., `LANGUAGES = ['english', 'malayalam', 'hindi', 'tamil', 'telugu', 'kannada']`
- Interface names: PascalCase with `Props` suffix for component props, e.g., `SongFormProps`, `SearchBarProps`, `SongListProps`
- Data interfaces: PascalCase without suffix, e.g., `Song`, `SearchResult`, `CreateSongRequest`, `UpdateSongRequest`, `ProPresenterStatus`
- Type definitions follow interface definitions in files
## Code Style
- Uses Next.js default ESLint (no custom formatter explicitly configured)
- Line length: No enforced limit visible, code naturally breaks around 80-120 characters
- Indentation: 2 spaces (Next.js standard)
- String quotes: Single quotes for code, double quotes in JSX attributes
- ESLint enabled via `eslint-config-next` (`eslint: ^8`)
- Run via `npm run lint` (configured in `frontend/package.json`)
- No custom ESLint config file present; uses Next.js defaults
- Code: Single quotes (e.g., `'use client'`, `const API_URL = '...'`)
- JSX attributes: Double quotes (e.g., `<label htmlFor="title">`), single quotes in className strings
- Template literals for complex strings
## Import Organization
- `@/*`: Points to current directory root (configured in `tsconfig.json`)
- Example: `import SongForm from '@/components/SongForm'`
- Used consistently throughout all files
## Error Handling
- Try-catch with fallback user messages for API errors
- Error state stored in local component state: `const [error, setError] = useState('')`
- User-friendly error display via alert() for critical failures: `alert('Failed to load songs: ...')`
- Console error logging for debugging: `console.error('Error loading songs:', error)`
- Error details logged with context object:
- Axios interceptor for global error logging in `lib/api.ts`
- Graceful degradation: operations set state to neutral state on error (e.g., `setPpStatus({ enabled: false, connected: false, ... })`)
## Logging
- Development only: `if (process.env.NODE_ENV !== 'production') { console.log(...) }`
- Error logging: Always log errors with structured data
- Debug logging: API URL logged in development: `console.log('API URL:', API_URL)`
- API interceptor logs all response errors with method, status, URL, and data
- Success logging: Not used; operations rely on UI state
- All errors (catch blocks)
- API calls in development environment
- Significant state changes in complex logic (not required, minimal logging observed)
## Comments
- Section headers before logical blocks:
- Complex logic explanations: `// If no query and no languages, reset to all songs.`
- TODO/FIXME notes (if needed)
- Not used in component files
- Interface definitions have inline type comments where useful
- Function signatures are self-documenting with TypeScript types
## Function Design
- React components receive props as single interface object: `function SongForm({ song, onSubmit, onCancel }: SongFormProps)`
- API methods receive specific arguments: `create: async (data: CreateSongRequest)`
- Event handlers receive event object and derive data: `onChange={(e) => setTitle(e.target.value)}`
- Destructuring in parameters for clarity
- Components return JSX directly
- API methods return typed promises: `Promise<Song>`, `Promise<Song[]>`, `Promise<void>`
- Event handlers return void or boolean as needed
- Optional chaining used for nullable values: `song?.id`, `ppStatus?.connected`
## Module Design
- Components: `export default function ComponentName(props) { ... }`
- API methods: Named exports as objects: `export const songsApi = { create: ..., getAll: ..., ... }`
- Interfaces: Named exports: `export interface Song { ... }`
- Constants: Named exports: `const LANGUAGES = ['english', 'malayalam', ...]`
- Not used; each component imported directly from its file
- API exports all operations from single `lib/api.ts` file
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Layered backend with handlers → services → database abstraction
- Frontend state management via React hooks with localStorage for persistence
- BroadcastChannel for cross-window communication between control and display windows
- Async search and indexing with fallback to database queries
- ProPresenter and Typesense as optional external integrations
## Layers
- Purpose: Expose RESTful endpoints for CRUD operations, search, admin tasks, and integrations
- Location: `backend/cmd/server/main.go` (route setup)
- Contains: Route definitions, middleware configuration (CORS, logging, recovery)
- Depends on: Handlers layer, Fiber framework
- Used by: Frontend client library
- Purpose: Process HTTP requests, coordinate between database and search services, manage business logic
- Location: `backend/internal/handlers/handlers.go`
- Contains: Handler methods for songs CRUD, search, admin operations, ProPresenter integration
- Depends on: Database, Typesense, Backup manager, ProPresenter client
- Used by: HTTP router via function references
- Purpose: Persistent storage using PostgreSQL, provides query interface for songs
- Location: `backend/internal/database/db.go`
- Contains: SQL query execution, connection pool management, song CRUD methods
- Depends on: database/sql standard library, pq driver
- Used by: Handlers for create/read/update/delete/search operations
- Purpose: Fast full-text search and faceted filtering via Typesense
- Location: `backend/internal/typesense/client.go`
- Contains: Typesense client initialization, indexing, searching, schema management
- Depends on: Typesense external service, models
- Used by: Handlers for search queries and reindexing
- Purpose: Automated and manual database backups using PostgreSQL dump
- Location: `backend/internal/backup/backup.go`
- Contains: Backup scheduling (daily + on edit threshold), file management
- Depends on: PostgreSQL CLI (pg_dump), file system
- Used by: Main.go (started on boot), handlers (manual trigger)
- Purpose: Optional two-way communication with ProPresenter for presentation synchronization
- Location: `backend/internal/propresenter/client.go`
- Contains: HTTP client for ProPresenter REST API, library/playlist queries, item triggering
- Depends on: External ProPresenter REST API
- Used by: Handlers for library queries and song queue management
- Purpose: Abstract HTTP communication, type safety, error handling
- Location: `frontend/lib/api.ts`
- Contains: axios instance with interceptors, TypeScript interfaces, exported service objects (songsApi, propresenterApi, adminApi)
- Depends on: axios library
- Used by: All React components
- Purpose: Presentation and user interaction
- Location: `frontend/components/` and `frontend/app/`
- Contains: Controlled form components, display components, search interface, split-pane lyrics view
- Depends on: API client, React hooks, TailwindCSS
- Used by: Page components
## Data Flow
- **Frontend component state:** React `useState` for UI state (selected song, modal visibility, zoom level)
- **Cross-window state:** localStorage persists current song, splitter width; BroadcastChannel syncs zoom/scroll between windows
- **Backend session state:** None - stateless request handling
- **Backend persistent state:** Database (songs, timestamps) and search index (Typesense)
- **Backup metadata:** Stored in backup files with JSON manifests
## Key Abstractions
- Purpose: Represents a lyric document with metadata
- Examples: `backend/internal/models/song.go`, `frontend/lib/api.ts` (Song interface)
- Pattern: Struct with JSON tags for serialization, optional fields for artist
- Purpose: Encapsulate request/response logic and dependency injection
- Examples: Handler struct holds db, ts, backupManager, propresenter; each handler method takes Fiber context
- Pattern: Receiver methods on Handler struct with `(h *Handler) MethodName(c *fiber.Ctx) error`
- Purpose: Group related endpoints with shared axios instance
- Examples: `songsApi`, `adminApi`, `propresenterApi` in `frontend/lib/api.ts`
- Pattern: Object with async methods returning typed promises, request body validation
- Purpose: Standardize search response including metadata
- Examples: `SearchResult` interface with songs, total_found, search_time_ms
- Pattern: Shared interface between backend and frontend for consistency
- Purpose: Track split-screen layout in display window
- Examples: `SplitLyricsView` panes array with id and heightPercent
- Pattern: Immutable state updates via array mapping during drag operations
## Entry Points
- Location: `backend/cmd/server/main.go`
- Triggers: `go run ./cmd/server` or docker container startup
- Responsibilities: Load environment config, initialize database/Typesense/ProPresenter, register routes, start Fiber server on configured port
- Location: `frontend/app/page.tsx` (Next.js root page)
- Triggers: Browser navigation to `/` (default route)
- Responsibilities: Load songs list, manage search, coordinate live display, handle song CRUD operations, manage zoom/scroll sync
- Location: `frontend/app/display/page.tsx` (Next.js display route)
- Triggers: `window.open('/display')` from control window
- Responsibilities: Receive song via BroadcastChannel, render full-screen lyrics, sync zoom/scroll with control window, handle keyboard shortcuts
## Error Handling
- **Backend API errors:** Handler returns JSON error map with status code and error message; frontend axios interceptor logs error details and shows alert to user
- **Database failures:** Handler logs error, returns 500 status; frontend shows generic error message
- **Typesense failures:** Handler logs but continues (non-critical path); search falls back to database if indexing fails
- **Missing integrations:** Optional integrations (ProPresenter, Typesense) return status responses without failing core operations
- **Backup failures:** Logged but don't interrupt request handling; next scheduled or manual backup attempt may succeed
- **Frontend async operations:** Try-catch in useEffect, errors logged to console and show user-friendly alerts
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
