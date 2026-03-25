# Roadmap: SAT — Bible Scripture Integration

## Overview

This roadmap delivers Bible scripture support for the SAT worship display system in three phases. Phase 1 builds the api.bible backend proxy and a browsable Bible tab with single-translation viewing. Phase 2 adds multi-translation side-by-side columns and display refinements (verse stepping, display modes, font control). Phase 3 connects scripture to the live display window via BroadcastChannel and adds the dedicated output tab for Resolume/ProPresenter browser source capture.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Bible Browsing Foundation** - Backend api.bible proxy with caching, Bible tab UI, book/chapter/verse navigation, reference search, single-translation display
- [ ] **Phase 2: Multi-Translation and Display Modes** - Side-by-side translation columns, verse stepping, passage/single-verse toggle, font sizing
- [ ] **Phase 3: Live Service and Output Tab** - BroadcastChannel scripture display, clear controls, dedicated /output/bible page for browser source capture

## Phase Details

### Phase 1: Bible Browsing Foundation
**Goal**: Worship leaders can browse and read Bible scriptures in a single translation from within the control UI
**Depends on**: Nothing (first phase)
**Requirements**: API-01, API-02, API-03, API-04, NAV-01, NAV-02, NAV-03, DISP-01, UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. User can switch to a Bible tab alongside the existing Songs tab in the control UI
  2. User can navigate Book, then Chapter, then see verses for that chapter
  3. User can type a reference like "John 3:16" and jump directly to that passage
  4. User can pick a Bible translation from a list of available translations
  5. Scripture text displays with verse numbers and a reference header (e.g., "John 3:16 (KJV)")
**Plans:** 4 plans (3 complete + 1 gap closure)

Plans:
- [x] 01-01-PLAN.md — Backend bible proxy (api.bible client, cache, handlers, routes)
- [x] 01-02-PLAN.md — Frontend API client, SongsPanel extraction, tab bar
- [x] 01-03-PLAN.md — Bible navigation UI (book list, chapter grid, verse display, reference search)
- [ ] 01-04-PLAN.md — Fix reference search race condition, add click-to-isolate verse (gap closure)

### Phase 2: Multi-Translation and Display Modes
**Goal**: Worship leaders can compare translations side-by-side and control how scripture appears on screen
**Depends on**: Phase 1
**Requirements**: MULTI-01, MULTI-02, DISP-02, DISP-03, DISP-04
**Success Criteria** (what must be TRUE):
  1. User can view up to 4 translations of the same passage in side-by-side columns
  2. User can add and remove translation columns without losing their place in the passage
  3. User can toggle between showing a single highlighted verse and the full passage
  4. User can step forward and backward through verses one at a time
  5. User can increase or decrease the scripture font size
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

### Phase 3: Live Service and Output Tab
**Goal**: Worship leaders can send scripture to the congregation display and to Resolume/ProPresenter via browser source capture
**Depends on**: Phase 2
**Requirements**: LIVE-01, LIVE-02, LIVE-03, OUT-01, OUT-02, OUT-03, OUT-04
**Success Criteria** (what must be TRUE):
  1. User can send the current scripture to the existing display window and see it appear
  2. User can clear scripture from the display window
  3. The /output/bible page renders scripture on a dark background with no UI chrome, suitable for video keying
  4. The output tab receives scripture updates via BroadcastChannel independently of the main display window
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bible Browsing Foundation | 3/4 | Gap closure | - |
| 2. Multi-Translation and Display Modes | 0/? | Not started | - |
| 3. Live Service and Output Tab | 0/? | Not started | - |
