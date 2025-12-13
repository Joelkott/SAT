# Audience Stage Teleprompter

Ultra-low latency multilingual lyrics search and display system built with Go and Next.js.

## Features

- **Ultra-fast search** (<20ms) using Typesense
- **Multilingual support** (English, Malayalam, Hindi, Tamil, Telugu, Kannada)
- **Real-time updates** - changes reflect instantly
- **Automated backups** - Daily backups + every 100 edits
- **PostgreSQL + Typesense** architecture for reliability and speed
- **Beautiful UI** with dark mode support
- **ProPresenter Integration** - Sync songs to ProPresenter via Tailscale
- **Split View** - View multiple parts of lyrics simultaneously

## Quick Start with Docker (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/audience-stage-teleprompter.git
cd audience-stage-teleprompter

# 2. Create environment file
cp .env.example .env
# Edit .env with your settings (see below)

# 3. Start everything
docker-compose up -d

# 4. Open http://localhost:3000
```

### Environment Variables (.env)

```bash
# Database (auto-configured with Docker)
POSTGRES_USER=teleprompter_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=teleprompter

# Typesense (get from https://cloud.typesense.org)
TYPESENSE_API_KEY=your_api_key
TYPESENSE_HOST=https://your-cluster.a1.typesense.net

# API URL (change for production)
API_URL=http://localhost:8080/api

# ProPresenter (optional - via Tailscale)
PROPRESENTER_ENABLED=true
PROPRESENTER_HOST=100.x.x.x    # Tailscale IP
PROPRESENTER_PORT=62683
PROPRESENTER_PLAYLIST=Live Queue
```

### Docker Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose up -d --build

# Reset database (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d
```

---

## Architecture

```
Frontend (Next.js 14)
    ↓
Backend (Go + Fiber) ← 5-15ms latency
    ↓
PostgreSQL (source of truth)
    ↓
Typesense (search index) ← <10ms search
    ↓
Automated Backups
```

## Prerequisites

### Required:
- **Go 1.21+** - [Install Go](https://go.dev/doc/install)
- **Node.js 18+** - [Install Node.js](https://nodejs.org/)
- **PostgreSQL 14+** - [Install PostgreSQL](https://www.postgresql.org/download/)
- **Typesense Cloud account** - [Sign up](https://cloud.typesense.org/) (14-day free trial)

### Installation Commands:

**Ubuntu/Debian:**
```bash
# Install Go
wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**macOS:**
```bash
# Install Go
brew install go

# Install PostgreSQL
brew install postgresql@14
brew services start postgresql@14

# Install Node.js
brew install node
```

## Setup Instructions

### 1. Clone and Setup

```bash
cd audience-stage-teleprompter
```

### 2. Setup PostgreSQL Database

```bash
# Create database
sudo -u postgres psql
```

In PostgreSQL shell:
```sql
CREATE DATABASE teleprompter;
CREATE USER teleprompter_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE teleprompter TO teleprompter_user;
\q
```

Run migrations:
```bash
cd backend
psql postgres://teleprompter_user:your_secure_password@localhost:5432/teleprompter < migrations/001_create_songs_table.sql
```

### 3. Setup Typesense Cloud

1. Sign up at [https://cloud.typesense.org/](https://cloud.typesense.org/)
2. Create a new cluster
3. Copy your API key and host URL

### 4. Configure Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```bash
DATABASE_URL=postgres://teleprompter_user:your_secure_password@localhost:5432/teleprompter?sslmode=disable
TYPESENSE_API_KEY=your_typesense_api_key_here
TYPESENSE_HOST=https://your-cluster.a1.typesense.net
PORT=8080
BACKUP_DIR=./backups
```

Install Go dependencies:
```bash
go mod download
```

### 5. Configure Frontend

```bash
cd ../frontend
cp .env.local.example .env.local
```

Edit `.env.local` (default is usually fine):
```bash
API_URL=http://localhost:8080/api
```

Install Node dependencies:
```bash
npm install
```

## Running the Application

### Terminal 1 - Backend:
```bash
cd backend
go run cmd/server/main.go
```

You should see:
```
Database connection established
Typesense client initialized
Backup manager started
Server starting on port 8080
```

### Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

You should see:
```
▲ Next.js 14.2.0
- Local:        http://localhost:3000
```

### Access the Application

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Adding Songs

1. Click "Add New Song" button
2. Fill in:
   - **Title** (required)
   - **Artist** (optional)
   - **Language** (required)
   - **Lyrics** (required)
3. Click "Create Song"

### Searching

- Type in the search box (searches title, artist, and lyrics)
- Filter by language using the dropdown
- Results appear in real-time (200ms debounce)
- Search latency: **5-20ms**

### Editing/Deleting

1. Click on a song from the list
2. Click "Edit Song" or "Delete Song"
3. Changes reflect immediately

## API Endpoints

### Songs
- `GET /api/songs` - Get all songs
- `GET /api/songs/:id` - Get song by ID
- `POST /api/songs` - Create new song
- `PUT /api/songs/:id` - Update song
- `DELETE /api/songs/:id` - Delete song

### Search
- `GET /api/search?q=query&language=english` - Search songs

### Admin
- `POST /api/admin/reindex` - Rebuild Typesense index from database
- `GET /api/admin/backups` - List all backups
- `POST /api/admin/backups` - Create manual backup

### Health
- `GET /api/health` - Server health check

## Backup System

### Automatic Backups

1. **Daily backups** at 2:00 AM
2. **Edit threshold** - Every 100 edits
3. **Retention** - 7 days

### Backup Location

Backups are stored in: `backend/backups/`

Files:
- `backup_daily_2024-01-15_02-00-00.sql` - PostgreSQL dump
- `backup_daily_2024-01-15_02-00-00.json` - Metadata

### Manual Backup

```bash
# Via API
curl -X POST http://localhost:8080/api/admin/backups

# Or using pg_dump directly
pg_dump postgres://teleprompter_user:password@localhost:5432/teleprompter > backup.sql
```

### Restoring from Backup

```bash
psql postgres://teleprompter_user:password@localhost:5432/teleprompter < backup.sql

# Then rebuild Typesense index
curl -X POST http://localhost:8080/api/admin/reindex
```

## Performance Benchmarks

### Expected Latencies

- **Search**: 5-20ms (Typesense)
- **API Response**: 5-15ms (Go backend)
- **Database Query**: 2-5ms (PostgreSQL)
- **Total**: **10-30ms end-to-end**

### Testing Performance

```bash
# Search performance
curl -w "@curl-format.txt" "http://localhost:8080/api/search?q=test"

# Create curl-format.txt:
echo "time_total: %{time_total}s\n" > curl-format.txt
```

## Development

### Backend Development

```bash
cd backend

# Run with auto-reload (install air first)
go install github.com/cosmtrek/air@latest
air

# Run tests
go test ./...

# Build binary
make build
./bin/server
```

### Frontend Development

```bash
cd frontend

# Development mode
npm run dev

# Build for production
npm run build
npm start

# Lint
npm run lint
```

## Production Deployment

### Backend

```bash
cd backend
go build -o bin/server cmd/server/main.go

# Run with systemd or supervisor
./bin/server
```

### Frontend

```bash
cd frontend
npm run build
npm start
# Or deploy to Vercel/Netlify
```

### Recommended Setup

- **Backend**: Deploy on VPS (Hetzner, DigitalOcean, Linode)
- **Frontend**: Vercel or Netlify
- **Database**: Managed PostgreSQL (Supabase, Neon, RDS)
- **Search**: Typesense Cloud
- **Backups**: S3 or Backblaze B2

## Troubleshooting

### Backend won't start

```bash
# Check PostgreSQL
sudo systemctl status postgresql
sudo systemctl start postgresql

# Check connection
psql postgres://teleprompter_user:password@localhost:5432/teleprompter

# Check Go installation
go version
```

### Frontend won't start

```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run dev
```

### Search not working

```bash
# Check Typesense connection
curl https://your-cluster.a1.typesense.net/health

# Rebuild index
curl -X POST http://localhost:8080/api/admin/reindex
```

### Slow search

- Check Typesense Cloud cluster status
- Verify network latency to Typesense
- Consider self-hosting Typesense for <5ms latency

## Project Structure

```
audience-stage-teleprompter/
├── backend/
│   ├── cmd/server/          # Main application
│   ├── internal/
│   │   ├── backup/          # Backup system
│   │   ├── database/        # PostgreSQL operations
│   │   ├── handlers/        # HTTP handlers
│   │   ├── models/          # Data models
│   │   └── typesense/       # Typesense client
│   ├── migrations/          # Database migrations
│   ├── .env.example
│   ├── go.mod
│   └── Makefile
├── frontend/
│   ├── app/                 # Next.js app router
│   ├── components/          # React components
│   ├── lib/                 # API client
│   ├── .env.local.example
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

## Tech Stack

- **Backend**: Go 1.21, Fiber, PostgreSQL, Typesense
- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Search**: Typesense Cloud
- **Database**: PostgreSQL 14+

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
