# Repository Analysis: Audience Stage Teleprompter

## Executive Summary

**Audience Stage Teleprompter** is a multilingual lyrics management and display system designed for church worship services. It provides ultra-fast search capabilities, real-time updates, and integration with ProPresenter presentation software.

**Tech Stack:**
- **Backend**: Go 1.21 + Fiber (HTTP framework)
- **Frontend**: Next.js 14 + React 18 + TypeScript
- **Database**: PostgreSQL 14+ (primary data store)
- **Search**: Typesense Cloud (search index)
- **Integration**: ProPresenter REST API (via Tailscale)
- **Deployment**: Docker Compose

---

## 1. Architecture Overview

### System Flow
```
Frontend (Next.js 14) → Backend (Go + Fiber) → PostgreSQL (source of truth)
                                              ↓
                                         Typesense (search index)
                                              ↓
                                         Automated Backups
```

### Key Design Decisions
- **Dual Storage**: PostgreSQL for persistence, Typesense for fast search (<20ms)
- **Hybrid Search**: Uses Typesense for text queries, falls back to PostgreSQL for language-only filtering
- **Real-time Sync**: Changes immediately update both database and search index
- **Backup Strategy**: Daily backups + every 100 edits with 7-day retention

---

## 2. Database Schema Analysis

### Tables

#### `songs` Table
```sql
- id: UUID (PRIMARY KEY, auto-generated)
- title: TEXT (NOT NULL)
- file_name: TEXT (nullable)
- library: TEXT (NOT NULL)
- language: VARCHAR(50) (NOT NULL, default 'english')
- pro_uuid: UUID (UNIQUE, nullable) - Links to ProPresenter
- display_lyrics: TEXT (NOT NULL)
- music_ministry_lyrics: TEXT (NOT NULL)
- artist: TEXT (nullable)
- created_at: TIMESTAMPTZ (auto-set)
- updated_at: TIMESTAMPTZ (auto-updated via trigger)
```

**Indexes:**
- `idx_songs_title` - GIN index for full-text search on title
- `idx_songs_library` - B-tree index on library
- `idx_songs_language` - B-tree index on language
- `idx_songs_pro_uuid` - B-tree index on pro_uuid
- `idx_songs_updated_at` - B-tree index (DESC) for sorting

**Observations:**
- ✅ Well-indexed for common query patterns
- ✅ Full-text search support via PostgreSQL GIN index
- ✅ Automatic timestamp management via triggers
- ⚠️ No foreign key constraints (intentional - standalone table)
- ⚠️ No soft delete mechanism (hard deletes only)

#### `settings` Table
```sql
- id: INTEGER (PRIMARY KEY, constrained to 1)
- laptop_b_ip: VARCHAR(45) (default: '100.112.76.20')
- laptop_b_port: INTEGER (default: 62683)
- live_playlist_uuid: UUID (default: all zeros)
- updated_at: TIMESTAMPTZ (auto-updated)
```

**Purpose**: Stores ProPresenter configuration for "Laptop B" integration

---

## 3. Code Structure Analysis

### Backend Structure (`backend/`)

```
backend/
├── cmd/server/          # Application entry point
├── internal/
│   ├── backup/         # Automated backup system
│   ├── database/       # PostgreSQL operations (CRUD)
│   ├── handlers/       # HTTP request handlers
│   ├── models/         # Data models (Song, Settings)
│   ├── propresenter/   # ProPresenter API client
│   └── typesense/      # Typesense search client
├── migrations/         # Database schema migrations
├── scripts/            # Import utilities (Python)
└── backups/            # Backup storage directory
```

### Key Components

#### Database Layer (`internal/database/db.go`)
- **Connection Pooling**: 25 max connections, 5 idle, 5min lifetime
- **CRUD Operations**: Full Create, Read, Update, Delete
- **Search**: Hybrid approach - ILIKE queries with language filtering
- **Error Handling**: Proper error wrapping and logging

**Notable Methods:**
- `CreateSong()` - Inserts with RETURNING clause
- `SearchSongs()` - Dynamic query building with optional filters
- `UpdateSong()` - Dynamic UPDATE with only changed fields
- `GetEditCount()` - Used for backup threshold checking

#### Handlers (`internal/handlers/handlers.go`)
- **RESTful API**: Standard CRUD endpoints
- **Search**: Dual-mode (Typesense for text, DB for language-only)
- **ProPresenter Integration**: 8 endpoints for control/status
- **Backup Management**: Manual trigger and listing

**Search Logic:**
- If languages specified → Query PostgreSQL directly (guarantees language filtering)
- If text query → Use Typesense (faster, better relevance)
- Language reordering: Prioritizes selected languages while preserving relative order

#### Models (`internal/models/song.go`)
- **Song**: Main entity with all fields
- **CreateSongRequest**: Input validation structure
- **UpdateSongRequest**: Partial update support (all fields optional)
- **Settings**: ProPresenter configuration

### Frontend Structure (`frontend/`)

```
frontend/
├── app/                # Next.js app router
│   ├── page.tsx        # Main application page
│   ├── display/        # Display view route
│   └── layout.tsx      # Root layout
├── components/         # React components
│   ├── SearchBar.tsx
│   ├── SongList.tsx
│   ├── SongDetail.tsx
│   ├── SongForm.tsx
│   ├── SongFullScreen.tsx
│   └── SplitLyricsView.tsx
└── lib/
    └── api.ts          # API client functions
```

**Key Features:**
- Real-time search with 200ms debounce
- Full-screen display mode
- Split lyrics view (side-by-side)
- ProPresenter sync integration
- Language filtering

---

## 4. Import System Analysis

### Import Scripts (`backend/scripts/`)

1. **`direct_import.py`** - Direct PostgreSQL import (bypasses API)
   - Uses `psycopg2` for bulk inserts
   - Extracts text from `.doc` (antiword) and `.docx` (python-docx)
   - Error logging to CSV files
   - Batch processing (100 songs at a time)

2. **`import_songs_direct.py`** - Similar to direct_import.py
3. **`import_songs_sql.py`** - Generates SQL files for manual execution
4. **`import_songs.py`** - Original API-based import

### Import Error Analysis

From `direct_import_errors_20251208_183901.csv`:

**Error Pattern**: All 9 errors are `EMPTY_CONTENT` - "Empty content after extraction"

**Affected Files:**
- 7 English songs (`.doc` and `.docx`)
- 1 Malayalam song (`.doc`)
- 1 Hindi song (`.doc`)

**Root Causes (Likely):**
1. **Corrupted files** - Files may be empty or corrupted
2. **Format issues** - Old `.doc` format may not be readable by antiword
3. **Encoding problems** - Special characters or encoding mismatches
4. **Protected documents** - Password-protected or read-only files

**Recommendations:**
- Add file validation before processing
- Implement retry logic with different extraction methods
- Add file size checks (reject 0-byte files)
- Log file metadata (size, modification date) for debugging

---

## 5. Features & Functionality

### Core Features
✅ **Song Management**
- Create, read, update, delete songs
- Dual lyrics fields (display + music ministry)
- Multi-language support (6 languages)
- Artist attribution

✅ **Search**
- Full-text search across title, artist, lyrics
- Language filtering
- Real-time results (<20ms)
- Hybrid search (Typesense + PostgreSQL)

✅ **Display**
- Full-screen mode
- Split view (side-by-side lyrics)
- Zoom controls
- Text alignment options
- BroadcastChannel for multi-tab sync

✅ **ProPresenter Integration**
- Library browsing
- Playlist management
- Send songs to "Live Queue"
- Slide control (next/previous)
- Layer clearing
- Status monitoring

✅ **Backup System**
- Daily automated backups (2:00 AM)
- Edit-based backups (every 100 edits)
- 7-day retention policy
- Manual backup trigger
- SQL + JSON backup formats

### API Endpoints

**Songs:**
- `POST /api/songs` - Create
- `GET /api/songs` - List all
- `GET /api/songs/:id` - Get one
- `PUT /api/songs/:id` - Update
- `DELETE /api/songs/:id` - Delete

**Search:**
- `GET /api/search?q=query&languages=eng,malayalam` - Search

**Admin:**
- `POST /api/admin/reindex` - Rebuild Typesense index
- `GET /api/admin/backups` - List backups
- `POST /api/admin/backups` - Create backup

**ProPresenter:**
- `GET /api/propresenter/status` - Connection status
- `GET /api/propresenter/library` - Browse library
- `GET /api/propresenter/playlists` - List playlists
- `POST /api/propresenter/queue` - Send to queue
- `POST /api/propresenter/trigger` - Trigger item
- `POST /api/propresenter/next` - Next slide
- `POST /api/propresenter/previous` - Previous slide
- `POST /api/propresenter/clear` - Clear layer

---

## 6. Technology Stack Deep Dive

### Backend (Go)
- **Fiber v2.52.0**: Fast HTTP framework (Express.js alternative)
- **lib/pq**: PostgreSQL driver
- **typesense-go v1.0.0**: Typesense client
- **godotenv**: Environment variable management

**Performance Characteristics:**
- Connection pooling: 25 max connections
- Low latency: 5-15ms API response time
- Efficient memory usage (Go's GC)

### Frontend (Next.js)
- **Next.js 14**: App Router architecture
- **React 18**: Client components
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first styling

**Performance:**
- Server-side rendering capability
- Client-side interactivity
- Real-time search with debouncing

### Database (PostgreSQL)
- **Version**: 14+
- **Extensions**: `uuid-ossp` for UUID generation
- **Full-text Search**: GIN indexes for title search
- **Triggers**: Auto-update `updated_at` timestamps

### Search (Typesense)
- **Cloud-hosted**: Managed service
- **Schema**: Custom fields for songs
- **Performance**: <10ms search latency
- **Fallback**: PostgreSQL search when Typesense unavailable

---

## 7. Security & Best Practices

### ✅ Good Practices
- Environment variable configuration
- Parameterized queries (SQL injection prevention)
- CORS configuration
- Error logging
- Connection pooling limits

### ⚠️ Areas for Improvement
1. **CORS**: Currently allows all origins (`*`) - should restrict in production
2. **Authentication**: No authentication/authorization system
3. **Rate Limiting**: No rate limiting on API endpoints
4. **Input Validation**: Basic validation, could be more comprehensive
5. **Error Messages**: Some errors may leak internal details
6. **Password Storage**: Database credentials in environment (acceptable, but ensure .env is gitignored)

---

## 8. Deployment & Operations

### Docker Setup
- **PostgreSQL**: Port 5433 (host) → 5432 (container)
- **Backend**: Port 8080
- **Frontend**: Port 3000
- **Volumes**: Persistent data for database and backups

### Environment Variables Required
```bash
# Database
DATABASE_URL=postgres://user:pass@host:port/db

# Typesense
TYPESENSE_API_KEY=...
TYPESENSE_HOST=https://...

# Optional
PROPRESENTER_ENABLED=true
PROPRESENTER_HOST=100.x.x.x
PROPRESENTER_PORT=4031
SKIP_TYPESENSE=false  # For bulk imports
```

### Backup Strategy
- **Location**: `backend/backups/`
- **Formats**: `.sql` (PostgreSQL dump) + `.json` (metadata)
- **Naming**: `backup_daily_YYYY-MM-DD_HH-MM-SS.*`
- **Retention**: 7 days (automatic cleanup)

---

## 9. Issues & Observations

### Critical Issues
1. **Import Failures**: 9 files failed with empty content extraction
   - Need better error handling and file validation
   - Consider alternative extraction methods

### Medium Priority
1. **No Authentication**: API is completely open
2. **CORS Too Permissive**: Allows all origins
3. **No Rate Limiting**: Vulnerable to abuse
4. **Hard Deletes**: No soft delete or audit trail
5. **Error Logging**: CSV files accumulate (no cleanup)

### Low Priority / Enhancements
1. **Search**: Could add fuzzy matching, typo tolerance
2. **UI**: Could add bulk operations (bulk delete, bulk edit)
3. **Analytics**: No usage tracking or metrics
4. **Export**: No export functionality (only import)
5. **Versioning**: No song version history

---

## 10. Recommendations

### Immediate Actions
1. **Fix Import Errors**
   - Add file size validation (reject 0-byte files)
   - Implement fallback extraction methods
   - Add detailed error logging with file metadata

2. **Security Hardening**
   - Restrict CORS to specific origins
   - Add rate limiting (e.g., 100 req/min per IP)
   - Consider basic authentication for admin endpoints

3. **Error Log Cleanup**
   - Implement automatic cleanup of old error CSV files
   - Or move to structured logging (JSON logs)

### Short-term Improvements
1. **Add Soft Deletes**
   - Add `deleted_at` column to songs table
   - Filter deleted songs from queries
   - Add restore functionality

2. **Enhanced Search**
   - Add fuzzy search support
   - Implement search result highlighting
   - Add search history

3. **Better Error Handling**
   - Structured error responses
   - Error codes for client handling
   - Retry logic for external services

### Long-term Enhancements
1. **User Management**
   - Multi-user support
   - Role-based access control
   - Activity logging

2. **Advanced Features**
   - Song versioning/history
   - Bulk operations
   - Export functionality (CSV, JSON)
   - Analytics dashboard

3. **Performance Optimization**
   - Add Redis caching layer
   - Implement pagination for large result sets
   - Database query optimization

---

## 11. Code Quality Assessment

### Strengths
✅ Clean architecture with separation of concerns
✅ Well-structured Go code following conventions
✅ TypeScript for type safety in frontend
✅ Comprehensive error handling
✅ Good use of database indexes
✅ Proper connection pooling

### Weaknesses
⚠️ No unit tests visible
⚠️ Limited input validation
⚠️ Some hardcoded values (e.g., backup threshold: 100)
⚠️ No API versioning
⚠️ Mixed error handling styles

---

## 12. Statistics & Metrics

### Database Schema
- **Tables**: 2 (songs, settings)
- **Indexes**: 5 on songs table
- **Triggers**: 2 (auto-update timestamps)
- **Extensions**: 1 (uuid-ossp)

### API Endpoints
- **Total**: 18 endpoints
- **Songs**: 5 endpoints
- **Search**: 1 endpoint
- **Admin**: 3 endpoints
- **ProPresenter**: 8 endpoints
- **Health**: 1 endpoint

### Import System
- **Scripts**: 4 Python import utilities
- **Supported Formats**: `.doc`, `.docx`
- **Languages**: English, Malayalam, Hindi, Tamil
- **Error Rate**: 9 failures in latest import (need to investigate)

---

## Conclusion

This is a **well-architected** application with a clear separation of concerns, good performance characteristics, and useful features for its intended use case (church worship services). The dual-storage approach (PostgreSQL + Typesense) provides both reliability and speed.

**Key Strengths:**
- Fast search performance
- Clean code structure
- Comprehensive ProPresenter integration
- Automated backup system

**Areas for Improvement:**
- Security (authentication, CORS, rate limiting)
- Import error handling
- Testing coverage
- Error log management

The system appears production-ready for internal use but would benefit from security hardening before public deployment.

---

**Analysis Date**: 2025-12-08
**Repository**: audience-stage-teleprompter
**Analyzer**: Auto (Cursor AI)

