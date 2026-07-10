---
phase: quick-260710-du3
plan: 01
subsystem: frontend-control-ui
tags: [queue, preview, go-live, songlist]
requires:
  - queueApi.add (already existed in frontend/lib/api.ts)
  - handleSendToLive (already existed in SongsPanel)
provides:
  - Per-row "Add to queue" action wired to queueApi.add
  - Immediate QueuePanel refresh on add via refreshToken prop
  - "Go Live" button in the preview overlay
affects:
  - frontend/components/SongList.tsx
  - frontend/components/QueuePanel.tsx
  - frontend/components/SongsPanel.tsx
  - frontend/components/icons.tsx
tech-stack:
  added: []
  patterns:
    - Transient on-button feedback via local state + setTimeout
    - External refresh trigger via incrementing numeric token prop
key-files:
  created: []
  modified:
    - frontend/components/icons.tsx
    - frontend/components/SongList.tsx
    - frontend/components/QueuePanel.tsx
    - frontend/components/SongsPanel.tsx
    - .gitignore
decisions:
  - Used an incrementing numeric refreshToken prop (rather than a callback ref) to trigger QueuePanel refetch, matching existing effect-driven fetch pattern
metrics:
  duration: 3min
  completed: 2026-07-10
---

# Quick Task 260710-du3: Add-to-Queue Buttons on Song Rows and Go Live in Preview Summary

Wired the existing `queueApi.add` into the control UI: every song row now has a leftmost "Add to queue" button with brief on-button "added" feedback, an open Queue panel refreshes immediately on add (no 5s poll wait), and the preview overlay gained a primary "Go Live" button routed through `handleSendToLive`.

## What Was Built

**Task 1 — Add to queue button per row** (commit 14fc248)
- Added `ListPlusIcon` to `frontend/components/icons.tsx` following the shared `base(props)` icon pattern.
- `SongList` now accepts `onAddToQueue?: (song: Song) => void` and renders a third icon button placed FIRST in the per-row action cluster (before Edit), only when the prop is provided.
- Button calls `e.stopPropagation()` then `onAddToQueue(song)`, sets transient `addedId` state, and clears it after ~1200ms. While active it swaps to `border-ok/60 text-ok` and shows `title="Added"`, giving feedback even when the queue panel is closed.
- Existing Edit / Send-to-Live buttons and row click handling unchanged.

**Task 2 — Wire add-to-queue, immediate refresh, and Go Live** (commit 978b426)
- `QueuePanel` accepts `refreshToken?: number`; a new `useEffect` refetches whenever the token changes and the panel is open. Existing initial-fetch and 5s poll effects untouched.
- `SongsPanel` imports `queueApi` and `PlayIcon`, adds `queueRefresh` state, and a `handleAddToQueue` handler that calls `queueApi.add(song.id)` then bumps `queueRefresh`.
- Wired `onAddToQueue={handleAddToQueue}` into `<SongList>` and `refreshToken={queueRefresh}` into `<QueuePanel>`.
- Added a primary "Go Live" button (ok color, `PlayIcon` + label) as the FIRST element in the preview `SongReplica` overlay, calling `handleSendToLive((hoverSong || selectedSong)!)`, followed by a divider before the existing quick-edit pencil.

## Deviations from Plan

**1. [Rule 3 - Blocking] Ignored generated `tsconfig.tsbuildinfo`** (commit f473e1a)
- **Found during:** Post-task untracked-file check after running `npx tsc --noEmit`.
- **Issue:** `frontend/tsconfig.tsbuildinfo` (TypeScript incremental build output) appeared untracked and was not covered by `.gitignore`.
- **Fix:** Added `*.tsbuildinfo` and `frontend/tsconfig.tsbuildinfo` entries to `.gitignore`.
- **Files modified:** `.gitignore`
- **Commit:** f473e1a

Otherwise the plan executed exactly as written.

## Verification

- `npx tsc --noEmit` passes with no type errors after each task.

## Pending Human Verification (Checkpoint — not blocked per task constraints)

Task 3 is a `checkpoint:human-verify` gate. Code is complete; the following require a human to confirm in a running dev server (`cd frontend && npm run dev`):

1. On any song row, click the new leftmost list-plus button and confirm it briefly flashes an "added" state.
2. Open the Queue panel and add a song from a row; confirm it appears immediately (not after ~5s).
3. Hover/select a song so the PREVIEW box shows it, click "Go Live", and confirm it appears in the LIVE monitor and display window.
4. Confirm existing Edit / Send-to-Live row buttons and preview quick-edit + zoom controls still work unchanged.

## Key Files

- `/home/joel/jgm/SAT/frontend/components/icons.tsx` — added `ListPlusIcon`
- `/home/joel/jgm/SAT/frontend/components/SongList.tsx` — `onAddToQueue` prop + per-row button with flash feedback
- `/home/joel/jgm/SAT/frontend/components/QueuePanel.tsx` — `refreshToken` prop + refetch effect
- `/home/joel/jgm/SAT/frontend/components/SongsPanel.tsx` — `handleAddToQueue`, `queueRefresh`, Go Live overlay button

## Self-Check: PASSED

All modified files exist and all three task commits (14fc248, 978b426, f473e1a) are present in git history.
