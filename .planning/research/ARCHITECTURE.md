# Architecture: Bible Scripture Integration

**Project:** SAT — Scripture & Song Display System
**Researched:** 2026-03-21

## Component Overview

### New Components

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                          │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Bible Tab    │  │ Display Page │  │ Output Tab       │  │
│  │  (Control)    │──│ (existing)   │  │ (Browser Source) │  │
│  │              │  │              │  │                  │  │
│  │ - Browse     │  │ + Scripture  │  │ - Bible only     │  │
│  │ - Search     │  │   display    │  │ - Clean/no chrome│  │
│  │ - Multiview  │  │   (new)      │  │ - Dark bg        │  │
│  │ - Send       │  │              │  │                  │  │
│  └──────┬───────┘  └──────▲───────┘  └──────▲───────────┘  │
│         │   BroadcastChannel│                │               │
│         └──────────────────┘────────────────┘               │
│                                                              │
│  ┌──────────────────┐                                       │
│  │  lib/api.ts       │ ← bibleApi added alongside songsApi  │
│  └────────┬─────────┘                                       │
└───────────┼─────────────────────────────────────────────────┘
            │ HTTP (axios)
┌───────────┼─────────────────────────────────────────────────┐
│  Backend (Go/Fiber)                                          │
│           │                                                  │
│  ┌────────▼─────────┐                                       │
│  │  /api/bible/*     │ ← new route group                    │
│  │  handlers         │                                       │
│  └────────┬─────────┘                                       │
│           │                                                  │
│  ┌────────▼─────────┐     ┌──────────────┐                 │
│  │  bible.Client     │────▶│ In-memory    │                 │
│  │  (api.bible proxy)│     │ Cache (TTL)  │                 │
│  └────────┬─────────┘     └──────────────┘                 │
└───────────┼─────────────────────────────────────────────────┘
            │ HTTPS
┌───────────▼─────────────────────────────────────────────────┐
│  api.bible (External)                                        │
│  https://api.scripture.api.bible/v1                          │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Scripture Lookup Flow

1. User navigates Bible Tab → selects book → chapter → verse(s)
2. Frontend calls `bibleApi.getPassage(bibleId, passageId)` via axios
3. Go backend checks in-memory cache → hit? return cached
4. Cache miss → Go backend calls api.bible with API key in header
5. Response cached with TTL, returned to frontend
6. Frontend renders verse(s) in Bible Tab

### Multi-Translation Flow

1. User has 2-4 translations selected in Bible Tab
2. User navigates to a passage (e.g., "John 3:16-18")
3. Frontend fires N parallel requests: `bibleApi.getPassage(bibleId1, passage)`, `bibleApi.getPassage(bibleId2, passage)`, etc.
4. Go backend handles each independently (cache helps if same passage already fetched in another translation)
5. Frontend renders N columns side-by-side, same passage aligned

### Send to Display Flow

1. User clicks "Send" in Bible Tab
2. Frontend posts message to BroadcastChannel: `{ type: 'bible', passage: {...}, translations: [...] }`
3. Display window receives message, renders scripture (replaces current content)
4. Output tab (if open) receives same message, renders for browser source capture

### Output Tab Flow

1. Operator opens `/output/bible` in a browser window
2. Window listens on BroadcastChannel for `type: 'bible'` messages
3. Renders scripture with dark/transparent background, large text, no UI chrome
4. Resolume/ProPresenter captures this browser window as source

## Backend Package Structure

```
backend/internal/
├── bible/
│   ├── client.go       # api.bible HTTP client, auth header injection
│   ├── cache.go        # In-memory TTL cache (sync.Map based)
│   ├── handlers.go     # Fiber route handlers for /api/bible/*
│   └── models.go       # Go structs for api.bible JSON responses
├── handlers/           # Existing — gets bible.Client injected
├── database/           # Existing — no changes
├── typesense/          # Existing — no changes
├── propresenter/       # Existing — no changes
└── backup/             # Existing — no changes
```

Follows existing pattern: each external integration gets its own package.

## Frontend Component Structure

```
frontend/
├── app/
│   ├── page.tsx              # Existing control page — add Bible tab
│   ├── output/
│   │   └── bible/
│   │       └── page.tsx      # New — browser source output page
│   └── ...
├── components/
│   ├── bible/
│   │   ├── BibleTab.tsx      # Main Bible tab container
│   │   ├── BibleBrowser.tsx  # Book/chapter/verse navigation
│   │   ├── BibleSearch.tsx   # Reference search input
│   │   ├── ScriptureView.tsx # Single translation verse display
│   │   ├── MultiView.tsx     # Side-by-side translation columns
│   │   └── TranslationPicker.tsx  # Add/remove translations
│   ├── SearchBar.tsx         # Existing
│   ├── SongList.tsx          # Existing
│   └── ...
├── lib/
│   └── api.ts               # Existing — add bibleApi object
└── ...
```

## BroadcastChannel Message Types

Extend existing channel with new message types:

```typescript
// Existing
{ type: 'song', song: Song, languages: string[] }

// New
{ type: 'bible', passage: Passage, translations: Translation[] }
{ type: 'bible-clear' }
{ type: 'bible-verse', verseIndex: number }  // For verse-by-verse stepping
```

## Build Order (Suggested)

| Order | Component | Why First |
|-------|-----------|-----------|
| 1 | Backend bible client + cache | Everything depends on getting data from api.bible |
| 2 | Backend API routes | Frontend needs endpoints to call |
| 3 | Frontend Bible Tab (basic navigation) | Core user interaction |
| 4 | Multi-translation view | Key differentiator, builds on basic navigation |
| 5 | Send to display (BroadcastChannel) | Connects Bible to existing display infrastructure |
| 6 | Output tab (browser source) | Final piece, depends on display message format |

## Integration Points with Existing System

| Existing Component | Integration | Impact |
|-------------------|-------------|--------|
| `page.tsx` (control) | Add tab switcher (Songs / Bible) | MEDIUM — refactor page layout to support tabs |
| `lib/api.ts` | Add `bibleApi` exports | LOW — additive |
| `SongFullScreen` / display | Handle bible message type | LOW — add condition for message type |
| `docker-compose.yml` | Add API_BIBLE_* env vars | LOW — config only |
| `backend/cmd/server/main.go` | Add bible route group | LOW — additive |
| `backend/cmd/server/main.go` | Initialize bible client | LOW — follows ProPresenter pattern |
