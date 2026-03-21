# Codebase Concerns

**Analysis Date:** 2026-03-21

## Security Considerations

**CORS Configuration is Too Permissive:**
- Issue: `AllowOrigins: "*"` allows any domain to access the API
- Files: `backend/cmd/server/main.go` (line 115)
- Impact: Exposes API to CSRF attacks and unauthorized cross-origin requests from malicious sites
- Fix approach: Restrict to specific frontend domain(s) - e.g., `AllowOrigins: []string{"http://localhost:3000", "https://yourdomain.com"}`

**Database Connection String Logging:**
- Issue: `DATABASE_URL` is logged directly at startup, potentially exposing credentials
- Files: `backend/cmd/server/main.go` (line 155)
- Impact: Credentials visible in server logs and Docker logs
- Fix approach: Log only the host/database name, never the full DSN with password

**No Input Validation for Song Content:**
- Issue: Song title, lyrics, and content fields accept unlimited text with no size constraints
- Files: `backend/internal/handlers/handlers.go` (lines 40-43)
- Impact: Potential for DoS attacks via large payloads; database bloat from massive entries
- Fix approach: Add maximum length validation (e.g., title ≤ 500 chars, lyrics ≤ 100KB)

**Unencrypted ProPresenter Communication:**
- Issue: ProPresenter client uses hardcoded `http://` (not HTTPS)
- Files: `backend/internal/propresenter/client.go` (line 107)
- Impact: Local network vulnerability if ProPresenter runs on untrusted network
- Fix approach: Support HTTPS via configuration; default to secure protocol

**No Authentication on Admin Endpoints:**
- Issue: `/api/admin/reindex` and `/api/admin/backups` endpoints have no auth mechanism
- Files: `backend/cmd/server/main.go` (lines 136-139)
- Impact: Anyone with access to the API can trigger expensive reindex operations or access backups
- Fix approach: Implement API key validation or JWT authentication for admin operations

## Error Handling Issues

**Typesense Errors Don't Fail Requests:**
- Issue: When Typesense indexing fails, the request succeeds but logs the error (fire-and-forget)
- Files: `backend/internal/handlers/handlers.go` (lines 54-57, 115-117, 141-142)
- Impact: Database and search index diverge silently; users don't know search is broken; no recovery path
- Fix approach: Return error to client on indexing failure OR implement retry queue with monitoring

**Missing Backup Verification:**
- Issue: `CreateBackup()` writes SQL file but never verifies it's readable/valid
- Files: `backend/internal/backup/backup.go` (lines 69-122)
- Impact: Backup files could be corrupted but marked as successful; restore will fail at critical moment
- Fix approach: Add verification step that reads first few lines of backup file to confirm validity

**ProPresenter Connection Errors Swallowed:**
- Issue: ProPresenter client methods ignore errors on deferred `resp.Body.Close()` (lines 333, 350, 372)
- Files: `backend/internal/propresenter/client.go` (multiple locations)
- Impact: Resource leaks in error scenarios; no visibility into connection problems
- Fix approach: Use defer with error capture or check error explicitly

**Database Scan Errors in Loops:**
- Issue: In `GetAllSongs()`, scan errors return immediately without logging partial results
- Files: `backend/internal/database/db.go` (lines 93-99)
- Impact: One corrupted row kills entire load operation; clients get 500 error instead of partial data
- Fix approach: Log and skip corrupted rows, continue scanning, possibly return warning metadata

## Data Integrity Concerns

**Race Condition in Backup Edit Count:**
- Issue: `GetEditCount()` counts total songs, not edit operations; multiple clients can trigger backup simultaneously
- Files: `backend/internal/handlers/handlers.go` (lines 61-64, 120-123), `backend/internal/backup/backup.go` (lines 54-66)
- Impact: Multiple concurrent requests could trigger multiple backups within seconds; threshold logic is unreliable
- Fix approach: Track actual edit count in DB (incrementing counter), not song count; use atomic check-and-swap

**Typesense Out-of-Sync Recovery Missing:**
- Issue: No mechanism to detect or repair when database and Typesense diverge
- Files: `backend/internal/handlers/handlers.go` (lines 283-291)
- Impact: Search results incorrect but unnoticed; manual reindex required as workaround
- Fix approach: Add `/api/admin/verify-sync` endpoint that compares DB and Typesense counts; warn if mismatched

**No Soft Deletes or Audit Trail:**
- Issue: Songs are permanently deleted; no history of changes or deletion log
- Files: `backend/internal/database/db.go` (lines 198-216)
- Impact: Cannot recover accidentally deleted songs; no audit compliance; no recovery from data loss
- Fix approach: Add `deleted_at` timestamp; maintain separate audit log table for all changes

**Language Field Case Sensitivity:**
- Issue: Language field compared case-insensitively in handlers but stored as-is in DB
- Files: `backend/internal/handlers/handlers.go` (lines 213-226), `backend/internal/typesense/client.go` (lines 170-174)
- Impact: "English" and "english" treated as same language but stored/displayed inconsistently
- Fix approach: Normalize language values to lowercase on create/update; enforce via constraint

## Performance Bottlenecks

**GetAllSongs() Unbounded Result Set:**
- Issue: No pagination; `/api/songs` returns all songs without limit
- Files: `backend/internal/database/db.go` (lines 78-103)
- Impact: 10,000 songs = 10MB response; client loading slow; API memory bloat
- Fix approach: Add pagination with `limit` and `offset` query params; default limit 50

**Typesense Search Uses Per-Page 50, No Offset:**
- Issue: Search hardcoded to return 50 results; no pagination support
- Files: `backend/internal/typesense/client.go` (line 143)
- Impact: Large result sets truncated; can't browse beyond first 50 results
- Fix approach: Support `page` and `per_page` query parameters in search endpoint

**Full-Text Search Index Language Hardcoded:**
- Issue: PostgreSQL full-text search index uses 'english' dictionary for all languages
- Files: `backend/migrations/001_create_songs_table.sql` (line 20)
- Impact: Search broken for non-English languages (Malayalam, etc.); index won't work correctly
- Fix approach: Remove the 'english' specific index OR support multiple indices per language OR use simple LIKE search

**No Database Connection Pooling Tuning:**
- Issue: Hardcoded pool settings (25 max, 5 idle) may be too aggressive for single-user deployment
- Files: `backend/internal/database/db.go` (lines 24-26)
- Impact: Under load, connection exhaustion; during idle, resource waste
- Fix approach: Make configurable via env vars with defaults: `DB_MAX_CONNS`, `DB_IDLE_CONNS`

**ProPresenter Requests Block Entire Response:**
- Issue: When sending song to ProPresenter queue, entire request waits for ProPresenter HTTP call
- Files: `backend/internal/handlers/handlers.go` (lines 200-210)
- Impact: UI freezes if ProPresenter is slow/unreachable; 10s timeout blocks frontend
- Fix approach: Queue ProPresenter sync to background worker; respond immediately to client

**Backup Scheduler Runs in Blocking Goroutine:**
- Issue: Daily backup sleep blocks the goroutine for entire day with no early termination on shutdown
- Files: `backend/internal/backup/backup.go` (lines 39-51)
- Impact: Server shutdown delayed; goroutine never truly exits; memory leak on graceful restart
- Fix approach: Add context-based cancellation; use ticker instead of manual sleep calculation

## Fragile Areas

**Frontend Song List Loading State Management:**
- Issue: Multiple loading flags (`loading`, `isSearching`) can get out of sync
- Files: `frontend/app/page.tsx` (lines 19-20)
- Impact: UI shows stale loading spinners; race conditions if user searches then clicks search again
- Fix approach: Use single loading state per operation; cancel previous requests on new request

**ProPresenter Status Not Cached:**
- Issue: Status checked on mount and refresh button, but not auto-refreshed when connection lost
- Files: `frontend/app/page.tsx` (lines 40-48)
- Impact: User thinks ProPresenter is connected when it's actually down; sync silently fails
- Fix approach: Periodically refresh status every 30s or on sync error; warn user of disconnection

**Hardcoded Broadcast Channel Name:**
- Issue: Display window and main window both hardcode `'lyrics-display'` channel name
- Files: `frontend/app/page.tsx` (line 100), `frontend/app/display/page.tsx` (assumed)
- Impact: If user opens multiple instances, they interfere with each other
- Fix approach: Use unique session ID in channel name; validate sender identity

**Frontend API URL Resolution Complex:**
- Issue: API URL resolved via multiple fallback mechanisms with subtle behavior differences
- Files: `frontend/lib/api.ts` (lines 5-10)
- Impact: Confusion during debugging; different behavior in dev/build/production; SSR issues
- Fix approach: Use single env var `NEXT_PUBLIC_API_URL` with clear default; document in README

**Song Form Not Handling Concurrent Edits:**
- Issue: No optimistic locking; two users editing same song simultaneously, last write wins
- Files: `backend/internal/handlers/handlers.go` (lines 96-126)
- Impact: Data loss if team edits same song at same time
- Fix approach: Add version field to songs; check version on update; return conflict error if mismatch

**Database Indexes Not Optimal:**
- Issue: Full-text search index only on English; no composite indices for common queries
- Files: `backend/migrations/001_create_songs_table.sql` (lines 14-20)
- Impact: Search slow for non-English; filtering by language + updated_at doesn't use indices efficiently
- Fix approach: Add composite index `(language, updated_at DESC)` for the common filter+sort pattern

## Scaling Limits

**Single Backup Directory Disk Space:**
- Issue: Backups kept for 7 days; no size limit; if songs grow to 1GB, 7 backups = 7GB
- Files: `backend/internal/backup/backup.go` (lines 118-119)
- Impact: Fills disk; container crashes; no graceful degradation
- Fix approach: Implement size-based cleanup; keep backups only if total < configurable limit (e.g., 10GB)

**Typesense Collection Not Sharded:**
- Issue: Using single Typesense instance with no replication
- Files: `backend/internal/typesense/client.go` (line 22)
- Impact: Single point of failure; no high availability; indexing blocks on network latency
- Fix approach: Deploy Typesense cluster; implement fallback to DB search if Typesense unavailable

**ProPresenter HTTP Client Uses Single 10s Timeout:**
- Issue: All ProPresenter requests share same 10s timeout
- Files: `backend/internal/propresenter/client.go` (lines 111-113)
- Impact: Slow networks timeout unnecessarily; large library searches slow
- Fix approach: Implement per-request timeout with smarter defaults (search 30s, trigger 5s)

## Test Coverage Gaps

**No Tests for Database Layer:**
- Issue: Database functions untested; no test migrations
- Files: `backend/internal/database/db.go`
- Risk: SQL errors discovered in production; migration failures undetected
- Priority: High - database is critical path

**No Tests for Backup Creation:**
- Issue: Backup Manager untested; no verification that backups are restorable
- Files: `backend/internal/backup/backup.go`
- Risk: Backup system fails when actually needed; silent data loss
- Priority: Critical - backups are recovery mechanism

**No Tests for Typesense Sync:**
- Issue: Index/delete/search operations untested; no mock Typesense
- Files: `backend/internal/typesense/client.go`
- Risk: Index corruption undetected; search broken in production
- Priority: High - search is user-facing

**No Frontend Component Tests:**
- Issue: React components have no unit tests; manual testing only
- Files: `frontend/app/page.tsx`, `frontend/components/*`
- Risk: Regressions undetected; refactoring dangerous
- Priority: Medium - but important for maintainability

**No API Integration Tests:**
- Issue: No end-to-end tests of handlers; no validation of error responses
- Files: `backend/internal/handlers/handlers.go`
- Risk: Error message changes break clients; edge cases undetected
- Priority: Medium - but important for stability

## Missing Critical Features

**No Rate Limiting:**
- Problem: API endpoints unprotected from brute force or DoS
- Blocks: Cannot safely expose to untrusted networks
- Implementation: Add middleware using `golang.org/x/time/rate` or similar

**No Request Logging/Audit:**
- Problem: No visibility into who accessed what; no forensics for data issues
- Blocks: Cannot debug user reports; no compliance audit trail
- Implementation: Add structured logging to every handler; include user/IP/timestamp

**No Song Metadata Versioning:**
- Problem: Lyrics changed, but no way to see old versions or blame
- Blocks: Users can't compare versions; content history lost
- Implementation: Add song versions table; timestamp every change

**No Batch Operations:**
- Problem: Updating 100 songs requires 100 API calls; slow and error-prone
- Blocks: Mass updates impossible without custom tooling
- Implementation: Add `/api/songs/batch` endpoints for create/update/delete

**No Search Analytics:**
- Problem: No visibility into what users search for
- Blocks: Cannot optimize search OR identify missing songs
- Implementation: Log searches (excluding sensitive queries) with result count

## Dependencies at Risk

**PostgreSQL Compatibility:**
- Risk: Using `gen_random_uuid()` (PostgreSQL 13+); breaks on older versions
- Impact: Cannot upgrade to PostgreSQL 12 or earlier
- Migration plan: Create wrapper function or generate UUIDs in app layer

**go.mod Version Constraints Unknown:**
- Risk: Go dependency versions not visible; potential security issues or incompatibilities
- Impact: Cannot assess if using vulnerable dependencies
- Action: Commit `go.mod` and `go.sum` to repo; run `go list -u -m all` to check updates

**ProPresenter API Assumptions:**
- Risk: Code assumes specific ProPresenter API version; no version checking
- Impact: Breaking changes silently fail; unclear which version is required
- Fix approach: Add version check endpoint; fail fast if incompatible

## Known Bugs & Workarounds

**Search Filter Ordering Inconsistent:**
- Symptoms: When searching with language filter, order sometimes changes between DB and Typesense paths
- Files: `backend/internal/handlers/handlers.go` (lines 173-204)
- Cause: Two code paths (DB search vs Typesense search) use different sorting logic; DB path reorders after fetch
- Workaround: Always use language filter to force DB path (slower but consistent)
- Root fix: Consolidate to single code path; ensure both database and Typesense return same order

**ProPresenter FindSongByTitle Fallback Issue:**
- Symptoms: If song not found by exact title, returns first result instead of error
- Files: `backend/internal/propresenter/client.go` (lines 189-191)
- Cause: Designed for fuzzy matching but unclear in documentation
- Impact: User intends to send "Amazing Grace" but gets "Grace (Outro)" if exact match fails
- Fix: Change to `return nil, fmt.Errorf(...)` for no match; require explicit fuzzy mode

**Frontend Scroll Sync Race Condition:**
- Symptoms: Preview pane scroll position doesn't match display pane if user scrolls fast
- Files: `frontend/app/page.tsx` (lines 578-596)
- Cause: No rate limiting on scroll events; BroadcastChannel.postMessage() can queue messages
- Workaround: Scroll slowly; refresh display window
- Fix: Throttle scroll events to max 60fps; drop intermediate values

---

*Concerns audit: 2026-03-21*
