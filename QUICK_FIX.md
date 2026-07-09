# Quick Fix: Use Existing Database

## Problem
Port 5432 is already in use by your existing database (with your imported songs).

## Solution
I've updated `docker-compose.yml` to:
1. **Comment out the postgres service** - No longer creates a new database
2. **Point backend to your existing database** on the host using `host.docker.internal`

## Steps

### 1. Make sure your `.env` file has the correct password:

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

### 2. Make sure your existing database is running:

```bash
# Check if database is accessible
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT COUNT(*) FROM songs;"
```

### 3. Start Docker services:

```bash
docker-compose up -d
```

### 4. Verify it's working:

```bash
# Check backend logs
docker-compose logs backend

# Test API
curl http://localhost:8080/api/health
curl http://localhost:8080/api/songs | head -20
```

### 5. Open the website:

http://localhost:3000

## If `host.docker.internal` doesn't work (Linux/WSL)

If you get connection errors, try using the host's IP address instead. Update `docker-compose.yml` line 33:

```yaml
DATABASE_URL: postgres://${POSTGRES_USER:-teleprompter_user}:${POSTGRES_PASSWORD:-teleprompter_pass_2024}@172.17.0.1:5432/${POSTGRES_DB:-teleprompter}?sslmode=disable
```

Or find your host IP:
```bash
# Get Docker bridge IP
ip addr show docker0 | grep "inet " | awk '{print $2}' | cut -d/ -f1
```

Then use that IP in the DATABASE_URL.

