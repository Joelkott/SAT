# Research Summary: Bible Scripture Integration

**Project:** SAT — Scripture & Song Display System
**Synthesized:** 2026-03-21

## Key Findings

### Stack
- **Zero new dependencies** — existing Go stdlib + Fiber handles api.bible client; existing axios + React + Tailwind handles frontend
- **Proxy pattern** — Go backend mediates all api.bible calls (key security, caching, rate limiting)
- **In-memory caching** — sync.Map with TTL, no Redis needed for single-instance church app
- **New package** — `internal/bible/` following existing `internal/propresenter/` pattern

### Table Stakes Features
- Book/chapter/verse browser with hierarchical navigation
- Reference search (type "John 3:16" to jump)
- Translation selector from api.bible available translations
- Clean verse display with verse numbers and reference headers
- Single-verse stepping and full-passage display modes
- Send to display via existing BroadcastChannel

### Multi-Translation (Key Feature)
- Up to 4 side-by-side translation columns using Tailwind grid
- Parallel API calls for each translation (backend caches independently)
- Align by passage ID, not verse number (avoids numbering differences across translations)
- Debounce navigation to prevent rate limit hits during rapid browsing

### Output Tab
- New route `/output/bible` — dedicated browser source for Resolume/ProPresenter
- Black background, white text, no UI chrome
- No CSS animations (frame tearing risk)
- Receives display commands via BroadcastChannel

### Architecture
- Backend: `internal/bible/` package with client, cache, handlers, models
- Frontend: `components/bible/` directory with tab, browser, search, multiview components
- BroadcastChannel extended with `bible`, `bible-clear`, `bible-verse` message types
- Build order: API client → routes → basic navigation → multi-translation → display → output tab

## Critical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| api.bible base URL confusion | HIGH | Test with curl before coding — verify `rest.api.bible` vs `api.scripture.api.bible` |
| HTML content in API responses | HIGH | Strip HTML server-side in Go, never render raw |
| FUMS compliance | MEDIUM | Read api.bible docs for tracking requirements before launch |
| Rate limiting with 4 translations | MEDIUM | Aggressive caching + debounce navigation |
| Verse alignment across translations | MEDIUM | Align by passage, not individual verse numbers |
| Output tab video capture quality | MEDIUM | Test with actual Resolume/ProPresenter before shipping |

## Recommendations for Roadmap

1. **Phase 1:** Backend api.bible client with caching + basic frontend Bible tab (navigation + single translation)
2. **Phase 2:** Multi-translation multiview + reference search
3. **Phase 3:** Display integration (BroadcastChannel) + output tab for browser source capture

This maps to the coarse granularity setting (3-5 phases, 1-3 plans each).
