# Phase 1: Bible Browsing Foundation - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend api.bible proxy with caching, Bible tab in the control UI, book/chapter/verse hierarchical navigation, reference search (e.g., "John 3:16"), translation selector, and single-translation scripture display with verse numbers and reference header. No multi-translation, no display sending, no output tab — those are Phase 2 and 3.

</domain>

<decisions>
## Implementation Decisions

### Tab Integration
- **D-01:** Add a tab bar to page.tsx to switch between Songs and Bible views
- **D-02:** Extract existing song management into a SongsPanel component (page.tsx is ~625 lines and needs splitting)
- **D-03:** Bible tab is a new BiblePanel component mounted when Bible tab is active

### Backend API Proxy
- **D-04:** Go backend proxies all api.bible calls — frontend never calls api.bible directly (API key stays server-side)
- **D-05:** New `internal/bible/` package following the existing `internal/propresenter/` pattern
- **D-06:** In-memory TTL cache in Go (sync.Map based) — 24h for metadata, 1h for verse content
- **D-07:** API key and base URL via environment variables (`API_BIBLE_KEY`, `API_BIBLE_BASE_URL`)

### Frontend API Client
- **D-08:** Add `bibleApi` object to `lib/api.ts` following the `songsApi`/`propresenterApi` pattern

### Claude's Discretion
- Tab bar visual design and placement
- Scripture navigation UX (dropdowns, breadcrumbs, sidebar — whatever works best)
- Reference search input design and parsing approach
- Verse display formatting and typography
- Loading states and error handling
- Component decomposition within BiblePanel

</decisions>

<specifics>
## Specific Ideas

- api.bible API key: `aZVSc70bApyFlDLnFTC2Y`
- api.bible base URL: `https://rest.api.bible` (verify actual endpoint — may be `https://api.scripture.api.bible/v1`)
- api.bible returns HTML content — strip server-side before sending to frontend
- User wants the output tab for Resolume/ProPresenter browser source capture — note for Phase 3

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing patterns
- `frontend/app/page.tsx` — Current control page to refactor (extract SongsPanel, add tab bar)
- `frontend/lib/api.ts` — API client pattern to follow for bibleApi
- `backend/cmd/server/main.go` — Route setup pattern for new /api/bible/* group
- `backend/internal/propresenter/client.go` — External API client pattern to follow
- `backend/internal/handlers/handlers.go` — Handler struct pattern (add bible client field)

### Configuration
- `docker-compose.yml` — Add API_BIBLE_* environment variables to backend service

### Research
- `.planning/research/STACK.md` — Technology recommendations and caching architecture
- `.planning/research/ARCHITECTURE.md` — Component boundaries and data flow
- `.planning/research/PITFALLS.md` — api.bible gotchas (base URL, HTML content, FUMS)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SearchBar.tsx` — Pattern for search input (Bible reference search can follow same style)
- `SongList.tsx` — Pattern for list-based navigation (book/chapter lists)
- `SplitLyricsView.tsx` — Multi-pane display pattern (may inform multi-translation later in Phase 2)
- BroadcastChannel setup in page.tsx — Will be extended in Phase 3

### Established Patterns
- API client objects in `lib/api.ts` with axios base URL
- Handler struct in Go with injected dependencies
- State management via React hooks + localStorage persistence
- Tailwind CSS for all styling

### Integration Points
- `page.tsx` — Main entry point, needs tab bar added
- `lib/api.ts` — Add bibleApi exports
- `backend/cmd/server/main.go` — Add bible route group and client initialization
- `docker-compose.yml` — Add environment variables

</code_context>

<deferred>
## Deferred Ideas

- Output tab for Resolume/ProPresenter browser source capture — Phase 3
- Multi-translation side-by-side display — Phase 2
- Send to display via BroadcastChannel — Phase 3
- Verse-by-verse stepping during live service — Phase 2

</deferred>

---

*Phase: 01-bible-browsing-foundation*
*Context gathered: 2026-03-24*
