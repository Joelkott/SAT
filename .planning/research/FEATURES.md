# Features: Bible Scripture Display in Worship Apps

**Project:** SAT — Scripture & Song Display System
**Researched:** 2026-03-21

## Table Stakes (must have)

Features users expect from any Bible display tool in worship software.

### Scripture Navigation
- **Book/Chapter/Verse browser** — hierarchical navigation: Bible → Book → Chapter → Verse
  - Complexity: LOW
  - Dependencies: api.bible client
- **Reference search** — type "John 3:16" or "Gen 1:1-5" and jump directly
  - Complexity: MEDIUM (parsing reference strings)
  - Dependencies: api.bible search endpoint + reference parser
- **Translation selector** — pick which Bible translation to view (KJV, NIV, ESV, etc.)
  - Complexity: LOW
  - Dependencies: api.bible bibles list endpoint

### Display
- **Clean verse display** — readable, properly formatted scripture text with verse numbers
  - Complexity: LOW
  - Dependencies: HTML stripping from api.bible responses
- **Verse-by-verse navigation** — step through verses one at a time during live service
  - Complexity: MEDIUM
  - Dependencies: Verse list, keyboard/click navigation
- **Full passage display** — show entire passage at once (e.g., John 3:16-18)
  - Complexity: LOW
  - Dependencies: api.bible passages endpoint
- **Scripture reference header** — always show "John 3:16 (KJV)" so audience knows what they're reading
  - Complexity: LOW
  - Dependencies: None beyond existing data

### Live Service Integration
- **Send to display** — push scripture to the display window for congregation
  - Complexity: LOW (BroadcastChannel already exists)
  - Dependencies: Existing display infrastructure
- **Clear display** — remove scripture from display
  - Complexity: LOW

## Differentiators (competitive advantage)

### Multi-Translation (User requested — promote to table stakes for this project)
- **Side-by-side translations** — up to 4 translations of same passage in columns
  - Complexity: MEDIUM (synchronized fetching, column layout, verse alignment)
  - Dependencies: Multiple concurrent api.bible calls
- **Add/remove translation columns** — dynamically adjust number of visible translations
  - Complexity: LOW
  - Dependencies: Multi-translation state management

### Output
- **Dedicated browser source output** — clean page for Resolume/ProPresenter capture
  - Complexity: MEDIUM (new route, styling for keying, no chrome)
  - Dependencies: BroadcastChannel or similar for receiving display commands
- **Dark/transparent background** — suitable for chroma keying in Resolume
  - Complexity: LOW

### UX Enhancements
- **Recent scriptures** — quick access to recently viewed passages
  - Complexity: LOW (localStorage)
  - Dependencies: None
- **Keyboard shortcuts** — arrow keys to navigate verses during live service
  - Complexity: LOW
  - Dependencies: None

## Anti-Features (deliberately NOT building)

| Feature | Why Not |
|---------|---------|
| Bible text editing/annotation | Read-only display tool, not a study app |
| Offline Bible storage | Adds complexity, api.bible is reliable enough for services |
| Commentary/study notes | Out of scope — this is a display tool |
| User accounts/bookmarks | Church app used by worship team, no auth needed |
| Bible reading plans | Not a devotional app |
| Song-scripture linking | Cool but premature — get basic Bible working first |
| Audio Bible playback | Display tool, not a media player |

## Feature Dependencies

```
Translation selector ──→ Book browser ──→ Chapter browser ──→ Verse display
                                                              ↓
                                                    Multi-translation view
                                                              ↓
                                                    Send to display
                                                              ↓
                                                    Output tab (browser source)
```

Build order follows the dependency chain: API client → navigation → display → multi-translation → output.
