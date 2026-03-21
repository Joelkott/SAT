# Coding Conventions

**Analysis Date:** 2026-03-21

## Naming Patterns

**Files:**
- React components: PascalCase, e.g., `SongForm.tsx`, `SearchBar.tsx`, `SongList.tsx`
- Utility/library files: camelCase, e.g., `api.ts`, `globals.css`
- Config files: lowercase with dots, e.g., `next.config.js`, `tailwind.config.ts`
- Pages: route-based naming in app directory, e.g., `page.tsx`, `layout.tsx`

**Functions:**
- React component functions: PascalCase (exported as default)
- Helper/utility functions: camelCase, e.g., `loadSongs()`, `handleSearch()`, `reorderByLanguageClient()`
- Event handlers: `handle` prefix, e.g., `handleSubmit`, `handleSearch`, `handleSelectSong`, `handleSendToLive`, `handleDelete`, `handleCreateNew`, `handleEdit`
- Async functions use async/await pattern
- Callback functions prefixed with `on`, e.g., `onSubmit`, `onCancel`, `onSearch`, `onSelectSong`, `onEdit`, `onSendToLive`

**Variables:**
- Local state: camelCase, e.g., `selectedSong`, `isSearching`, `showForm`, `liveSong`
- Boolean flags: `is`/`show`/`has` prefix, e.g., `isLoading`, `showForm`, `showPreviewModal`, `isDragging`, `ppSyncEnabled`
- Refs: `Ref` suffix, e.g., `displayChannelRef`, `splitContainerRef`, `leftWidthRef`, `rafIdRef`
- Constants: UPPER_CASE, e.g., `LANGUAGES = ['english', 'malayalam', 'hindi', 'tamil', 'telugu', 'kannada']`

**Types:**
- Interface names: PascalCase with `Props` suffix for component props, e.g., `SongFormProps`, `SearchBarProps`, `SongListProps`
- Data interfaces: PascalCase without suffix, e.g., `Song`, `SearchResult`, `CreateSongRequest`, `UpdateSongRequest`, `ProPresenterStatus`
- Type definitions follow interface definitions in files

## Code Style

**Formatting:**
- Uses Next.js default ESLint (no custom formatter explicitly configured)
- Line length: No enforced limit visible, code naturally breaks around 80-120 characters
- Indentation: 2 spaces (Next.js standard)
- String quotes: Single quotes for code, double quotes in JSX attributes

**Linting:**
- ESLint enabled via `eslint-config-next` (`eslint: ^8`)
- Run via `npm run lint` (configured in `frontend/package.json`)
- No custom ESLint config file present; uses Next.js defaults

**Quotes:**
- Code: Single quotes (e.g., `'use client'`, `const API_URL = '...'`)
- JSX attributes: Double quotes (e.g., `<label htmlFor="title">`), single quotes in className strings
- Template literals for complex strings

## Import Organization

**Order:**
1. External libraries (React, Next.js, third-party packages)
2. Relative imports from `@/` path aliases
3. Component imports from `@/components/`
4. Library/API imports from `@/lib/`
5. CSS imports last

**Path Aliases:**
- `@/*`: Points to current directory root (configured in `tsconfig.json`)
- Example: `import SongForm from '@/components/SongForm'`
- Used consistently throughout all files

**Example from `app/page.tsx`:**
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { songsApi, Song, SearchResult, propresenterApi, ProPresenterStatus } from '@/lib/api';
import SearchBar from '@/components/SearchBar';
import SongList from '@/components/SongList';
import SongForm from '@/components/SongForm';
import SongFullScreen from '@/components/SongFullScreen';
```

## Error Handling

**Patterns:**
- Try-catch with fallback user messages for API errors
- Error state stored in local component state: `const [error, setError] = useState('')`
- User-friendly error display via alert() for critical failures: `alert('Failed to load songs: ...')`
- Console error logging for debugging: `console.error('Error loading songs:', error)`
- Error details logged with context object:
  ```typescript
  console.error('Error details:', {
    message: error?.message,
    response: error?.response?.data,
    status: error?.response?.status,
    config: error?.config,
  });
  ```
- Axios interceptor for global error logging in `lib/api.ts`
- Graceful degradation: operations set state to neutral state on error (e.g., `setPpStatus({ enabled: false, connected: false, ... })`)

**API Error Handling Pattern:**
```typescript
try {
  setLoading(true);
  const data = await songsApi.getAll();
  setData(data);
} catch (error: any) {
  console.error('Error:', error);
  alert(`Failed: ${error?.response?.data?.error || error?.message}`);
} finally {
  setLoading(false);
}
```

## Logging

**Framework:** `console` (console.error, console.log)

**Patterns:**
- Development only: `if (process.env.NODE_ENV !== 'production') { console.log(...) }`
- Error logging: Always log errors with structured data
- Debug logging: API URL logged in development: `console.log('API URL:', API_URL)`
- API interceptor logs all response errors with method, status, URL, and data
- Success logging: Not used; operations rely on UI state

**When to Log:**
- All errors (catch blocks)
- API calls in development environment
- Significant state changes in complex logic (not required, minimal logging observed)

## Comments

**When to Comment:**
- Section headers before logical blocks:
  ```typescript
  // Load all songs on mount
  useEffect(() => { ... }, []);

  // Check ProPresenter connection status
  const checkProPresenterStatus = async () => { ... };

  // Splitter drag handlers
  useEffect(() => { ... }, [isDragging, leftWidth]);
  ```
- Complex logic explanations: `// If no query and no languages, reset to all songs.`
- TODO/FIXME notes (if needed)

**JSDoc/TSDoc:**
- Not used in component files
- Interface definitions have inline type comments where useful
- Function signatures are self-documenting with TypeScript types

**Example Comments:**
```typescript
// Load splitter width from storage
useEffect(() => {
  const saved = localStorage.getItem('control-splitter-width');
  if (saved) {
    const val = Number(saved);
    if (!Number.isNaN(val) && val > 0.3 && val < 0.8) {
      setLeftWidth(val);
      leftWidthRef.current = val;
    }
  }
}, []);
```

## Function Design

**Size:** Functions are medium to large; complex components like `Home` in `app/page.tsx` contain 600+ lines with multiple useEffect hooks and event handlers. Keep related logic together.

**Parameters:**
- React components receive props as single interface object: `function SongForm({ song, onSubmit, onCancel }: SongFormProps)`
- API methods receive specific arguments: `create: async (data: CreateSongRequest)`
- Event handlers receive event object and derive data: `onChange={(e) => setTitle(e.target.value)}`
- Destructuring in parameters for clarity

**Return Values:**
- Components return JSX directly
- API methods return typed promises: `Promise<Song>`, `Promise<Song[]>`, `Promise<void>`
- Event handlers return void or boolean as needed
- Optional chaining used for nullable values: `song?.id`, `ppStatus?.connected`

## Module Design

**Exports:**
- Components: `export default function ComponentName(props) { ... }`
- API methods: Named exports as objects: `export const songsApi = { create: ..., getAll: ..., ... }`
- Interfaces: Named exports: `export interface Song { ... }`
- Constants: Named exports: `const LANGUAGES = ['english', 'malayalam', ...]`

**Barrel Files:**
- Not used; each component imported directly from its file
- API exports all operations from single `lib/api.ts` file

**Example API Module Structure (`lib/api.ts`):**
```typescript
export interface Song { ... }
export interface CreateSongRequest { ... }
export const songsApi = { create, getAll, getById, update, delete, search };
export const adminApi = { reindex, getBackups, createBackup };
export const propresenterApi = { getStatus, getLibrary, getPlaylists, ... };
export default api;
```

---

*Convention analysis: 2026-03-21*
