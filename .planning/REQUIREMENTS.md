# Requirements: SAT — Bible Scripture Integration

**Defined:** 2026-03-21
**Core Value:** Worship leaders can instantly find and display Bible scriptures with multiple translations side-by-side

## v1 Requirements

### API Integration

- [x] **API-01**: Backend proxies all api.bible requests (API key never exposed to frontend)
- [x] **API-02**: Backend caches Bible metadata (translations, books, chapters) with 24h TTL
- [x] **API-03**: Backend caches verse/passage content with 1h TTL
- [x] **API-04**: Frontend calls Go backend for all Bible data (bibleApi in api.ts)

### Navigation

- [x] **NAV-01**: User can browse scriptures by Book → Chapter → Verse hierarchy
- [x] **NAV-02**: User can search by typing a reference (e.g., "John 3:16", "Gen 1:1-5")
- [x] **NAV-03**: User can select which Bible translation to view from available translations

### Multi-Translation

- [ ] **MULTI-01**: User can view up to 4 translations of the same passage side-by-side in columns
- [ ] **MULTI-02**: User can add and remove translation columns dynamically

### Display

- [x] **DISP-01**: Scripture displays with verse numbers and reference header (e.g., "John 3:16 (KJV)")
- [ ] **DISP-02**: User can toggle between single-verse and full-passage display modes
- [ ] **DISP-03**: User can step through verses one at a time during live service
- [ ] **DISP-04**: User can adjust font size for scripture display

### Live Service

- [ ] **LIVE-01**: User can send scripture to the existing display window via BroadcastChannel
- [ ] **LIVE-02**: User can clear scripture from the display
- [ ] **LIVE-03**: Display window renders scripture when bible message type received

### Output Tab

- [ ] **OUT-01**: Dedicated output page at /output/bible for browser source capture
- [ ] **OUT-02**: Output tab has dark background suitable for Resolume/ProPresenter keying
- [ ] **OUT-03**: Output tab receives scripture via BroadcastChannel (Bible only, not songs)
- [ ] **OUT-04**: Output tab has no UI chrome (scrollbars, selection, navigation)

### UI Integration

- [x] **UI-01**: Bible tab added to control page alongside existing song management
- [x] **UI-02**: Tab switcher to toggle between Songs and Bible views

## v2 Requirements

### Navigation Enhancements

- **NAV-V2-01**: Recent scriptures history for quick access to previously viewed passages
- **NAV-V2-02**: Keyboard shortcuts for verse navigation during live service

### Display Enhancements

- **DISP-V2-01**: Scripture text formatting options (bold, highlight)
- **DISP-V2-02**: Custom themes/color schemes for output tab

### Integration

- **INT-V2-01**: Song-scripture linking (associate scriptures with songs)
- **INT-V2-02**: Scripture search within verse text content

## Out of Scope

| Feature | Reason |
|---------|--------|
| Offline Bible storage | Adds complexity, api.bible is reliable for live services |
| Bible text editing/annotation | Read-only display tool, not a study app |
| User accounts/bookmarks | Church app used by worship team, no auth needed |
| Commentary/study notes | Display tool, not a study platform |
| Audio Bible playback | Display tool, not a media player |
| Song display on output tab | Output tab is Bible-only; songs already have ProPresenter integration |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 1 | Complete |
| API-02 | Phase 1 | Complete |
| API-03 | Phase 1 | Complete |
| API-04 | Phase 1 | Complete |
| NAV-01 | Phase 1 | Complete |
| NAV-02 | Phase 1 | Complete |
| NAV-03 | Phase 1 | Complete |
| MULTI-01 | Phase 2 | Pending |
| MULTI-02 | Phase 2 | Pending |
| DISP-01 | Phase 1 | Complete |
| DISP-02 | Phase 2 | Pending |
| DISP-03 | Phase 2 | Pending |
| DISP-04 | Phase 2 | Pending |
| LIVE-01 | Phase 3 | Pending |
| LIVE-02 | Phase 3 | Pending |
| LIVE-03 | Phase 3 | Pending |
| UI-01 | Phase 1 | Complete |
| UI-02 | Phase 1 | Complete |
| OUT-01 | Phase 3 | Pending |
| OUT-02 | Phase 3 | Pending |
| OUT-03 | Phase 3 | Pending |
| OUT-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*
