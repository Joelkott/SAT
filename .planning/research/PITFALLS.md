# Pitfalls: Bible Scripture Integration

**Project:** SAT — Scripture & Song Display System
**Researched:** 2026-03-21

## Critical Pitfalls

### 1. api.bible Base URL Confusion

**Risk:** HIGH
**Phase:** 1 (API client)

The user referenced `https://rest.api.bible` but training data suggests `https://api.scripture.api.bible/v1`. Using the wrong base URL means all API calls fail silently or with confusing errors.

**Warning signs:** 401/404 errors on first API call.
**Prevention:** Test the actual API key against both URLs before writing any client code. Use `curl` to verify:
```bash
curl -H "api-key: aZVSc70bApyFlDLnFTC2Y" https://api.scripture.api.bible/v1/bibles
```

### 2. api.bible HTML Content

**Risk:** HIGH
**Phase:** 1 (API client)

api.bible returns verse content as HTML with semantic markup (`<span>`, `<p>`, verse number annotations), not plain text. Rendering raw HTML in the UI creates XSS risk and ugly display.

**Warning signs:** Raw HTML tags visible in verse display, or scripture text missing entirely.
**Prevention:**
- Request `?content-type=text` if supported
- Otherwise, strip HTML server-side in Go before returning to frontend
- Never use `dangerouslySetInnerHTML` with api.bible responses

### 3. FUMS Compliance

**Risk:** MEDIUM
**Phase:** 1 (API client)

api.bible's Fair Use Management System (FUMS) requires tracking content views. Non-compliance may result in API access being revoked.

**Warning signs:** API key disabled, warning emails from api.bible.
**Prevention:** Read current api.bible FUMS docs before implementation. May require:
- Including a FUMS tracking script on display pages
- Server-side FUMS reporting call
- Specific attribution text near displayed scripture

### 4. Rate Limiting During Multi-Translation Fetches

**Risk:** MEDIUM
**Phase:** 2 (multi-translation)

Requesting 4 translations of a passage = 4 concurrent API calls. During navigation (flipping through chapters), this multiplies quickly. A worship leader browsing rapidly could hit rate limits.

**Warning signs:** 429 responses during rehearsal/service, intermittent translation loading failures.
**Prevention:**
- Aggressive caching (24h for reference data, 1h for content)
- Debounce navigation in the UI (200ms delay before fetching)
- Sequential fallback: if cache misses on all 4, don't fire 4 simultaneous external calls — queue them

### 5. Verse Alignment Across Translations

**Risk:** MEDIUM
**Phase:** 2 (multi-translation)

Different Bible translations sometimes have different verse numbering. Psalm numbering varies between traditions. Some translations merge or split verses differently.

**Warning signs:** Columns show different verses for the same "verse number," misaligned multi-view.
**Prevention:**
- Use the passage ID format from api.bible (e.g., `JHN.3.16-JHN.3.18`) which is consistent
- Don't try to align verse-by-verse across translations — align by passage
- For single-verse display, accept that translations may render slightly differently

### 6. BroadcastChannel Message Conflicts

**Risk:** LOW
**Phase:** 3 (display integration)

Adding bible messages to the existing BroadcastChannel used for songs. If message types aren't distinct, song display could try to render Bible data or vice versa.

**Warning signs:** Display shows wrong content type, flickering between song and Bible.
**Prevention:**
- Use explicit `type` field: `'song'` vs `'bible'` vs `'bible-clear'`
- Display component checks type before rendering
- Consider: should sending Bible clear the current song, or are they independent layers?

### 7. Output Tab Styling for Video Capture

**Risk:** MEDIUM
**Phase:** 3 (output tab)

Resolume and ProPresenter browser source capture is sensitive to:
- Background color (must be solid black or transparent for keying)
- Font rendering (anti-aliasing, subpixel rendering)
- Animation (CSS transitions can cause frame tearing)
- Page chrome (scrollbars, selection highlights)

**Warning signs:** Text looks jagged on projection, background bleeds through key, unwanted UI elements visible.
**Prevention:**
- Pure black background (`#000000`), white text
- No CSS animations/transitions on text
- `overflow: hidden` on body
- `user-select: none` to prevent selection highlighting
- Test with actual Resolume/ProPresenter capture before calling it done
- Consider: provide font size control via URL parameter for easy adjustment

### 8. Bible Translation Availability

**Risk:** LOW
**Phase:** 1 (API client)

api.bible has many translations, but not all popular ones (e.g., NIV may have restricted access). The user's API key tier determines which translations are available.

**Warning signs:** Expected translation missing from list, some translations return 403.
**Prevention:**
- Fetch available bibles list first, only show what's accessible
- Filter to English translations by default (or user's language)
- Don't hardcode translation IDs — always fetch dynamically

## Non-Obvious Gotchas

### Scripture Reference Parsing

Parsing user-typed references ("John 3:16", "1 Cor 13:4-7", "Gen 1:1-2:3") is harder than it looks. Book names have abbreviations, numbers, and cultural variations.

**Prevention:** Start with a simple regex for common formats. Use api.bible's search endpoint as fallback for anything the parser can't handle. Don't try to build a perfect parser — iterate based on actual worship team usage.

### Docker Environment Variables

The api.bible key needs to be in docker-compose.yml for the backend container. Be careful not to commit the key to a public repo.

**Prevention:** Use `.env` file referenced by docker-compose, ensure `.env` is in `.gitignore`. The existing codebase already has environment variable patterns to follow.
