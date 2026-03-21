# Architecture

**Analysis Date:** 2026-03-21

## Pattern Overview

**Overall:** Monorepo with separate backend (Go/Fiber REST API) and frontend (Next.js React app) communicating via HTTP. Backend manages data persistence, search, and external integrations; frontend handles UI and display coordination.

**Key Characteristics:**
- Layered backend with handlers → services → database abstraction
- Frontend state management via React hooks with localStorage for persistence
- BroadcastChannel for cross-window communication between control and display windows
- Async search and indexing with fallback to database queries
- ProPresenter and Typesense as optional external integrations

## Layers

**HTTP API Layer:**
- Purpose: Expose RESTful endpoints for CRUD operations, search, admin tasks, and integrations
- Location: `backend/cmd/server/main.go` (route setup)
- Contains: Route definitions, middleware configuration (CORS, logging, recovery)
- Depends on: Handlers layer, Fiber framework
- Used by: Frontend client library

**Handlers Layer:**
- Purpose: Process HTTP requests, coordinate between database and search services, manage business logic
- Location: `backend/internal/handlers/handlers.go`
- Contains: Handler methods for songs CRUD, search, admin operations, ProPresenter integration
- Depends on: Database, Typesense, Backup manager, ProPresenter client
- Used by: HTTP router via function references

**Database Layer:**
- Purpose: Persistent storage using PostgreSQL, provides query interface for songs
- Location: `backend/internal/database/db.go`
- Contains: SQL query execution, connection pool management, song CRUD methods
- Depends on: database/sql standard library, pq driver
- Used by: Handlers for create/read/update/delete/search operations

**Search Layer:**
- Purpose: Fast full-text search and faceted filtering via Typesense
- Location: `backend/internal/typesense/client.go`
- Contains: Typesense client initialization, indexing, searching, schema management
- Depends on: Typesense external service, models
- Used by: Handlers for search queries and reindexing

**Backup Layer:**
- Purpose: Automated and manual database backups using PostgreSQL dump
- Location: `backend/internal/backup/backup.go`
- Contains: Backup scheduling (daily + on edit threshold), file management
- Depends on: PostgreSQL CLI (pg_dump), file system
- Used by: Main.go (started on boot), handlers (manual trigger)

**ProPresenter Integration Layer:**
- Purpose: Optional two-way communication with ProPresenter for presentation synchronization
- Location: `backend/internal/propresenter/client.go`
- Contains: HTTP client for ProPresenter REST API, library/playlist queries, item triggering
- Depends on: External ProPresenter REST API
- Used by: Handlers for library queries and song queue management

**Frontend API Client Layer:**
- Purpose: Abstract HTTP communication, type safety, error handling
- Location: `frontend/lib/api.ts`
- Contains: axios instance with interceptors, TypeScript interfaces, exported service objects (songsApi, propresenterApi, adminApi)
- Depends on: axios library
- Used by: All React components

**Frontend UI Components:**
- Purpose: Presentation and user interaction
- Location: `frontend/components/` and `frontend/app/`
- Contains: Controlled form components, display components, search interface, split-pane lyrics view
- Depends on: API client, React hooks, TailwindCSS
- Used by: Page components

## Data Flow

**Song Creation Flow:**

1. User fills `SongForm` in control window (`frontend/app/page.tsx`)
2. Form submission calls `songsApi.create()` → POST `/api/songs`
3. Handler validates request and calls `db.CreateSong()`
4. Database inserts song, returns ID and metadata
5. If `skipTypesense` not set, handler indexes song via `ts.IndexSong()`
6. Handler checks backup threshold via `backupManager.CheckEditThreshold()`
7. Response returned with created song data
8. Frontend reloads song list via `loadSongs()` which calls `songsApi.getAll()`

**Song Display Flow:**

1. User selects song in control window (`frontend/app/page.tsx`)
2. Control window calls `handleSendToLive(song)`
3. Song data stored to localStorage key `lyrics-display-current`
4. BroadcastChannel sends message type `song` to display window (`frontend/app/display/page.tsx`)
5. Display window receives message on `BroadcastChannel('lyrics-display')`
6. Display window renders lyrics in `SplitLyricsView` component
7. If ProPresenter sync enabled, handler sends song to queue via `propresenterApi.sendToQueue()`

**Search Flow:**

1. User types query or selects languages in `SearchBar` component
2. Debounced search triggers `handleSearch()` callback with query + language array
3. Frontend calls `songsApi.search(query, languages)` → GET `/api/search?q=...&languages=...`
4. Backend handler receives query and language filters
5. If languages selected, queries database directly (`db.SearchSongs()`) for guaranteed filtering
6. If text query only, uses Typesense (`ts.Search()`) for fast full-text search
7. Handler reorders results by language preference using `reorderByLanguage()`
8. Results returned as `SearchResult` type with songs array and search time
9. Frontend reorders results client-side using `reorderByLanguageClient()` for language preference
10. Results displayed in left pane of split layout

**State Management:**

- **Frontend component state:** React `useState` for UI state (selected song, modal visibility, zoom level)
- **Cross-window state:** localStorage persists current song, splitter width; BroadcastChannel syncs zoom/scroll between windows
- **Backend session state:** None - stateless request handling
- **Backend persistent state:** Database (songs, timestamps) and search index (Typesense)
- **Backup metadata:** Stored in backup files with JSON manifests

## Key Abstractions

**Song Model:**
- Purpose: Represents a lyric document with metadata
- Examples: `backend/internal/models/song.go`, `frontend/lib/api.ts` (Song interface)
- Pattern: Struct with JSON tags for serialization, optional fields for artist

**Handler Pattern:**
- Purpose: Encapsulate request/response logic and dependency injection
- Examples: Handler struct holds db, ts, backupManager, propresenter; each handler method takes Fiber context
- Pattern: Receiver methods on Handler struct with `(h *Handler) MethodName(c *fiber.Ctx) error`

**API Service Objects:**
- Purpose: Group related endpoints with shared axios instance
- Examples: `songsApi`, `adminApi`, `propresenterApi` in `frontend/lib/api.ts`
- Pattern: Object with async methods returning typed promises, request body validation

**Search Result Type:**
- Purpose: Standardize search response including metadata
- Examples: `SearchResult` interface with songs, total_found, search_time_ms
- Pattern: Shared interface between backend and frontend for consistency

**Pane State:**
- Purpose: Track split-screen layout in display window
- Examples: `SplitLyricsView` panes array with id and heightPercent
- Pattern: Immutable state updates via array mapping during drag operations

## Entry Points

**Backend Server:**
- Location: `backend/cmd/server/main.go`
- Triggers: `go run ./cmd/server` or docker container startup
- Responsibilities: Load environment config, initialize database/Typesense/ProPresenter, register routes, start Fiber server on configured port

**Frontend Control Window:**
- Location: `frontend/app/page.tsx` (Next.js root page)
- Triggers: Browser navigation to `/` (default route)
- Responsibilities: Load songs list, manage search, coordinate live display, handle song CRUD operations, manage zoom/scroll sync

**Frontend Display Window:**
- Location: `frontend/app/display/page.tsx` (Next.js display route)
- Triggers: `window.open('/display')` from control window
- Responsibilities: Receive song via BroadcastChannel, render full-screen lyrics, sync zoom/scroll with control window, handle keyboard shortcuts

## Error Handling

**Strategy:** Graceful degradation with logging and user-facing error alerts.

**Patterns:**

- **Backend API errors:** Handler returns JSON error map with status code and error message; frontend axios interceptor logs error details and shows alert to user
- **Database failures:** Handler logs error, returns 500 status; frontend shows generic error message
- **Typesense failures:** Handler logs but continues (non-critical path); search falls back to database if indexing fails
- **Missing integrations:** Optional integrations (ProPresenter, Typesense) return status responses without failing core operations
- **Backup failures:** Logged but don't interrupt request handling; next scheduled or manual backup attempt may succeed
- **Frontend async operations:** Try-catch in useEffect, errors logged to console and show user-friendly alerts

## Cross-Cutting Concerns

**Logging:** Backend uses standard `log` package with Printf; frontend uses `console.error/log` in development. No centralized logging configured.

**Validation:** Backend validates required fields (title, lyrics, language) before database operations. Frontend form submission validates via SongForm component state management.

**Authentication:** None - all endpoints publicly accessible via CORS wildcard. Assumes trusted network environment.

**Search Indexing:** Songs automatically indexed to Typesense on create/update unless `SKIP_TYPESENSE=true`. Admin endpoint `/api/admin/reindex` can rebuild index from database.

---

*Architecture analysis: 2026-03-21*
