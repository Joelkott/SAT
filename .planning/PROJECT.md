# SAT — Scripture & Song Display System

## What This Is

A church worship display system with a Go/Fiber backend and Next.js frontend. It manages song lyrics in multiple languages, integrates with ProPresenter for live display, and uses Typesense for search. The app has a control window and a display window connected via BroadcastChannel. We're adding Bible scripture support with multi-translation viewing and a dedicated output tab for Resolume/ProPresenter browser source capture.

## Core Value

Worship leaders can instantly find and display Bible scriptures alongside songs during live services, with multiple translations visible side-by-side.

## Requirements

### Validated

- ✓ Song CRUD with multi-language lyrics — existing
- ✓ Full-text search via Typesense — existing
- ✓ ProPresenter integration for song display — existing
- ✓ Fullscreen display window via BroadcastChannel — existing
- ✓ Splittable control/display layout — existing
- ✓ Database backup system — existing

### Active

- [ ] Bible tab in the control UI for browsing and searching scriptures
- [ ] Browse scriptures by book/chapter and search by reference (e.g. "John 3:16")
- [ ] Multi-translation view with up to 4 side-by-side columns
- [ ] Send scripture to existing display window via BroadcastChannel
- [ ] Toggle between single-verse and full-passage display modes
- [ ] New dedicated output tab (separate route/page) for Resolume/ProPresenter browser source capture — Bible only
- [ ] api.bible integration using REST API (https://rest.api.bible)

### Out of Scope

- Song display on the new output tab — it's Bible-only for now
- Offline Bible caching — rely on api.bible for now
- User accounts/authentication — not needed
- Bible text editing or annotation — read-only display

## Context

- **Existing stack:** Go 1.21 backend (Fiber), Next.js 14, React 18, PostgreSQL, Typesense, Tailwind CSS
- **api.bible:** REST API at https://rest.api.bible — provides multiple Bible translations, book/chapter/verse lookup
- **API key:** aZVSc70bApyFlDLnFTC2Y (api.bible)
- **Display pattern:** App already uses BroadcastChannel to communicate between control and display windows — Bible will follow same pattern
- **Output tab:** New page that Resolume or ProPresenter captures via browser source — needs clean, minimal chrome, transparent/dark background suitable for keying
- **ProPresenter integration:** Existing integration sends songs to ProPresenter playlists; the new output tab is a separate approach (browser source capture)

## Constraints

- **API:** Must use api.bible REST API — no local Bible database
- **Tech stack:** Must stay within existing Go + Next.js stack
- **Translations:** Up to 4 simultaneous translations in multiview
- **Docker:** Must work within existing docker-compose deployment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| api.bible as Bible data source | User-specified, provides multiple translations via REST | — Pending |
| Separate output tab for Resolume capture | Keeps Bible output independent from song display | — Pending |
| Up to 4 translation columns | Balances readability with multi-translation needs | — Pending |
| Bible-only output tab | Simplifies initial scope, songs already have ProPresenter integration | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after initialization*
