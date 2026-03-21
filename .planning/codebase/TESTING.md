# Testing Patterns

**Analysis Date:** 2026-03-21

## Test Framework

**Runner:**
- Not configured - No test runner detected
- No Jest, Vitest, or other testing framework installed

**Assertion Library:**
- Not applicable - No testing library installed

**Run Commands:**
- No test scripts configured in `frontend/package.json`
- Available scripts: `dev`, `build`, `start`, `lint`
- Testing not integrated into current development workflow

## Test File Organization

**Location:**
- No test files found in codebase (excluding node_modules)
- Search for `*.test.*` and `*.spec.*` files returns no results in source directories

**Naming:**
- Convention would follow Next.js pattern: `[component].test.tsx` or `[module].spec.ts`
- Recommended co-location with source files for components

**Structure:**
- Would follow Jest/Vitest convention if implemented:
```
frontend/
├── components/
│   ├── SearchBar.tsx
│   └── SearchBar.test.tsx
├── lib/
│   ├── api.ts
│   └── api.test.ts
└── app/
    └── page.test.tsx
```

## Test Structure

**Suite Organization:**
- No existing test suites to reference
- Recommended structure based on codebase patterns:

```typescript
// Example: components/SongForm.test.tsx
describe('SongForm', () => {
  describe('rendering', () => {
    it('should render create form when song is null', () => {
      // test
    });

    it('should render edit form when song is provided', () => {
      // test
    });
  });

  describe('form submission', () => {
    it('should create a new song with valid input', async () => {
      // test
    });

    it('should update existing song', async () => {
      // test
    });

    it('should show error on failed submission', async () => {
      // test
    });
  });

  describe('validation', () => {
    it('should require title, lyrics, and language', () => {
      // test
    });
  });
});
```

**Patterns:**
- Would use standard AAA pattern (Arrange, Act, Assert)
- Setup: Mock songsApi for API tests, initialize component state
- Teardown: Clean up refs, cancel async operations, clear mocks
- Assertions: Verify DOM changes, callback invocations, API calls

## Mocking

**Framework:**
- Would use Jest or Vitest mocking
- No mocking currently in use

**Patterns (Recommended based on code structure):**
```typescript
// Mock API responses
jest.mock('@/lib/api', () => ({
  songsApi: {
    getAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    search: jest.fn(),
  },
}));

// Mock useEffect and state
// Example test setup
const mockSongs: Song[] = [
  { id: '1', title: 'Test Song', lyrics: '...', language: 'english', ... }
];

// Use with API mock
(songsApi.getAll as jest.Mock).mockResolvedValue(mockSongs);
```

**What to Mock:**
- API calls via `songsApi`, `propresenterApi`, `adminApi`
- External services (ProPresenter connection)
- BroadcastChannel for display window communication
- localStorage operations
- setTimeout/debounce operations
- axios interceptors

**What NOT to Mock:**
- React hooks (useState, useEffect, useRef, useCallback) - use React Testing Library defaults
- Component rendering behavior
- User interactions (clicks, form inputs)
- Conditional logic that determines what renders

## Fixtures and Factories

**Test Data:**
- No test fixtures currently exist
- Recommended factory pattern for Song data:

```typescript
// lib/test-utils.ts
export const songFactory = (overrides: Partial<Song> = {}): Song => ({
  id: '1',
  title: 'Test Song',
  artist: 'Test Artist',
  lyrics: 'Test lyrics...',
  language: 'english',
  content: 'Test lyrics...',
  created_at: '2026-03-21T00:00:00Z',
  updated_at: '2026-03-21T00:00:00Z',
  ...overrides,
});

export const searchResultFactory = (overrides = {}) => ({
  songs: [songFactory()],
  total_found: 1,
  search_time_ms: 10,
  ...overrides,
});
```

**Location:**
- Recommended: `frontend/lib/test-utils.ts`
- Could also use `frontend/__tests__/fixtures/` directory
- Import in test files: `import { songFactory } from '@/lib/test-utils'`

## Coverage

**Requirements:**
- No coverage requirements enforced
- No coverage configuration present

**View Coverage (Recommended setup):**
```bash
npm test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual React components and utility functions
- Approach: Test component rendering with different props, user interactions, state changes
- Examples:
  - `SearchBar.test.tsx`: Test debounced search, language filtering, clearing
  - `SongList.test.tsx`: Test rendering empty/loading states, song selection, edit/live buttons
  - `SongForm.test.tsx`: Test form validation, creation, update flows
  - `lib/api.test.ts`: Test API client initialization, method signatures, error handling

**Integration Tests:**
- Scope: Multiple components interacting, API integration
- Approach: Test flows like "search for song → select → send to live → ProPresenter sync"
- Examples:
  - Main page flow: render → load songs → search → select → display live
  - Form submission triggering song reload
  - ProPresenter status check and sync toggle

**E2E Tests:**
- Not used
- Would benefit from: Cypress or Playwright for testing full user flows
- Candidates: Complete lyrics display flow, search & send to live, ProPresenter sync

## Common Patterns

**Async Testing:**
- Components use async functions in useEffect and event handlers
- Pattern for testing async operations:

```typescript
// Test async API call
it('should load songs on mount', async () => {
  const mockSongs = [songFactory()];
  (songsApi.getAll as jest.Mock).mockResolvedValue(mockSongs);

  render(<Home />);

  await waitFor(() => {
    expect(screen.getByText(mockSongs[0].title)).toBeInTheDocument();
  });
});

// Test async form submission
it('should create song and reload', async () => {
  (songsApi.create as jest.Mock).mockResolvedValue(songFactory());
  (songsApi.getAll as jest.Mock).mockResolvedValue([...]);

  const { getByText, getByRole } = render(<SongForm onSubmit={jest.fn()} />);

  fireEvent.change(getByRole('textbox', { name: /title/i }), { target: { value: 'New Song' } });
  fireEvent.click(getByText('Create Song'));

  await waitFor(() => {
    expect(songsApi.create).toHaveBeenCalled();
  });
});
```

**Error Testing:**
- Handle try-catch error scenarios from API calls
- Pattern for testing error states:

```typescript
// Test error handling
it('should display error message on failed load', async () => {
  const error = new Error('Network error');
  (songsApi.getAll as jest.Mock).mockRejectedValue(error);

  // Mock window.alert
  jest.spyOn(window, 'alert').mockImplementation();

  render(<Home />);

  await waitFor(() => {
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
  });
});

// Test form validation errors
it('should show validation error when fields are empty', async () => {
  const { getByText } = render(<SongForm onSubmit={jest.fn()} />);

  fireEvent.click(getByText(/Create Song/i));

  expect(getByText('Title, lyrics, and language are required')).toBeInTheDocument();
});
```

## Setup/Teardown

**Test Setup (Recommended):**
```typescript
// setupTests.ts or in beforeEach of test file
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  jest.useFakeTimers(); // For debounced search
});

afterEach(() => {
  jest.useRealTimers();
});
```

**Cleanup:**
- React Testing Library handles DOM cleanup automatically
- Clear axios interceptor mocks
- Close BroadcastChannel mocks
- Restore setTimeout/setInterval

---

*Testing analysis: 2026-03-21*
