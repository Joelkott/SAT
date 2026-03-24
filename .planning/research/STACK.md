# Technology Stack: Bible Scripture Integration

**Project:** SAT — Scripture & Song Display System (Bible milestone)
**Researched:** 2026-03-21
**Overall confidence:** MEDIUM

## Recommended Stack

### Backend — api.bible Client (Go)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `net/http` (stdlib) | Go 1.21+ | HTTP client for api.bible | Simple REST API with JSON responses. 6 endpoints don't justify a third-party HTTP library. | HIGH |
| In-memory cache (sync.Map + TTL) | Go 1.21+ | Response caching | Bible text is immutable. In-memory cache avoids repeated API calls. No Redis needed for single-instance church app. | HIGH |
| `encoding/json` (stdlib) | Go 1.21+ | JSON parsing | api.bible returns JSON. Small payloads, stdlib is sufficient. | HIGH |
| `github.com/gofiber/fiber/v2` | v2.52.0 | HTTP server (existing) | Add new route group `/api/bible/*` alongside existing `/api/songs/*`. | HIGH |

### Frontend — Bible UI Components

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React 18 + Next.js 14 | existing | UI framework | Bible tab is a new component tree within existing app shell. | HIGH |
| axios | ^1.6.8 | API client (existing) | Extend `api.ts` with `bibleApi` following same pattern as `songsApi`. | HIGH |
| Tailwind CSS | ^3.3.0 | Styling (existing) | Multi-column layout uses `grid-cols-1` through `grid-cols-4`. | HIGH |
| BroadcastChannel API | Web API | Control-to-display comms (existing) | Bible display messages follow same channel with different message type. | HIGH |

### Caching Architecture

| Layer | TTL | What's Cached | Why |
|-------|-----|---------------|-----|
| Backend in-memory | 24h | Bible list, book lists, chapter lists | Static reference data. Cache on first request. |
| Backend in-memory | 1h | Verse/passage content | Immutable but memory-bounded. 1h covers a service. |
| Frontend React state | Session | Current selections, fetched content | Avoid re-fetching during same session. |

## api.bible Integration Pattern

**Base URL:** `https://api.scripture.api.bible/v1` (verify — user referenced `rest.api.bible`)
**Auth:** `api-key` header
**Rate limits:** ~5000 requests/day on free tier (generous for church use)

**Key endpoints:**

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `GET /bibles` | List translations | 24h |
| `GET /bibles/{id}/books` | List books | 24h |
| `GET /bibles/{id}/books/{bookId}/chapters` | List chapters | 24h |
| `GET /bibles/{id}/chapters/{chapterId}/verses` | List verses | 24h |
| `GET /bibles/{id}/verses/{verseId}` | Single verse | 1h |
| `GET /bibles/{id}/passages/{passageId}` | Verse range | 1h |
| `GET /bibles/{id}/search` | Full-text search | No cache |

**FUMS:** api.bible has Fair Use Management System tracking. Check current docs for compliance requirements.

### Proxy Pattern

Go backend proxies all api.bible calls — frontend never calls api.bible directly.
- API key stays server-side
- Server-side cache benefits all clients
- Rate limit protection at single point
- Response shaping (strip HTML, normalize)

## New Dependencies

**Backend:** Zero new Go dependencies. stdlib `net/http` + `encoding/json` handles everything.
**Frontend:** Zero new npm dependencies. Existing axios + React + Tailwind covers it.

## Environment Variables

```env
API_BIBLE_KEY=aZVSc70bApyFlDLnFTC2Y
API_BIBLE_BASE_URL=https://api.scripture.api.bible/v1
```

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| Redis | Single-instance app. In-memory cache is simpler and sufficient. |
| GraphQL | 6 REST endpoints don't need a query layer. |
| React Query | Backend already caches. Frontend holds session state only. |
| Redux/Zustand | Bible state is tab-local. BroadcastChannel handles cross-window. |
| WebSockets | Bible content is request-response, not streaming. |
| Separate microservice | One Go binary, one Fiber app. Add a route group. |
