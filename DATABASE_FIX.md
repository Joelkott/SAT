# Database Configuration Fix

## The Problem

Your data was imported using:
- **Port**: 5432
- **Password**: `teleprompter_pass_2024`

But Docker is configured with:
- **Port**: 5433 (mapped from container port 5432)
- **Password**: `teleprompter_pass` (default)

These are **two different databases**, so your imported songs are in the database on port 5432, but Docker is connecting to a new database on port 5433.

## Solution: Use the Same Database

You have two options:

### Option 1: Point Docker to Your Existing Database (Recommended)

Update your `.env` file in `audience-stage-teleprompter/` to use the same credentials:

```env
# Use the SAME credentials as pro-file-generator
POSTGRES_USER=teleprompter_user
POSTGRES_PASSWORD=teleprompter_pass_2024
POSTGRES_DB=teleprompter

# Typesense Configuration
TYPESENSE_API_KEY=your_typesense_api_key_here
TYPESENSE_HOST=https://your-cluster.a1.typesense.net

# API URL
API_URL=http://localhost:8080/api

# ProPresenter
PROPRESENTER_ENABLED=false
```

**Then update docker-compose.yml** to use port 5432 instead of 5433:

Change line 15 in `docker-compose.yml`:
```yaml
ports:
  - "5432:5432"  # Changed from "5433:5432"
```

**Important:** Make sure the database on port 5432 is running and accessible.

### Option 2: Import Data into Docker Database

If you want to keep Docker on port 5433, you need to:

1. Update your `pro-file-generator/.env` to use Docker's database:
```env
DATABASE_URL=postgres://teleprompter_user:teleprompter_pass@localhost:5433/teleprompter?sslmode=disable
```

2. Re-run the batch import script to import data into the Docker database.

## Recommended Steps (Option 1)

### 1. Check which database has your data

```bash
# Check database on port 5432
    psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT COUNT(*) FROM songs;"

# Check database on port 5433 (Docker)
psql postgres://teleprompter_user:teleprompter_pass@localhost:5433/teleprompter -c "SELECT COUNT(*) FROM songs;"
```

### 2. Update Docker Configuration

**Update `.env` file:**
```bash
cd /home/joelvw/church/audience-stage-teleprompter
cat > .env << EOF
POSTGRES_USER=teleprompter_user
POSTGRES_PASSWORD=teleprompter_pass_2024
POSTGRES_DB=teleprompter
TYPESENSE_API_KEY=your_typesense_api_key_here
TYPESENSE_HOST=https://your-cluster.a1.typesense.net
API_URL=http://localhost:8080/api
PROPRESENTER_ENABLED=false
EOF
```

**Update docker-compose.yml port mapping:**
Change line 15 from `"5433:5432"` to `"5432:5432"`

### 3. Restart Docker Services

```bash
docker-compose down
docker-compose up -d
```

### 4. Verify Connection

```bash
# Check backend logs
docker-compose logs backend

# Test API
curl http://localhost:8080/api/health
curl http://localhost:8080/api/songs
```

## Alternative: If Database is Running Outside Docker

If your database on port 5432 is running outside Docker (not in a container), you can:

1. **Remove the postgres service from docker-compose.yml** (comment it out)
2. **Update backend DATABASE_URL** to point to `localhost:5432` instead of `postgres:5432`

Update `docker-compose.yml` backend environment:
```yaml
environment:
  DATABASE_URL: postgres://teleprompter_user:teleprompter_pass_2024@host.docker.internal:5432/teleprompter?sslmode=disable
```

Or if on Linux/WSL, use:
```yaml
environment:
  DATABASE_URL: postgres://teleprompter_user:teleprompter_pass_2024@172.17.0.1:5432/teleprompter?sslmode=disable
```

## Verify Your Data

After fixing the configuration, verify songs are visible:

```bash
# Via API
curl http://localhost:8080/api/songs | jq '. | length'

# Or check in browser
# Open http://localhost:3000 and check if songs appear
```

