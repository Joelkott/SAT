# Reset Database and Fresh Import Guide

## Overview
This guide will help you:
1. Clear the old database
2. Create a fresh database with the new UUID-based schema
3. Run batch import of .pro files

## Step 1: Reset Database Schema

Run the migration to drop old tables and create the new schema:

```bash
cd /home/joelvw/church/audience-stage-teleprompter/backend
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -f migrations/001_create_songs_table.sql
```

This will:
- Drop existing `songs` and `settings` tables
- Create new schema with UUID fields (`id`, `pro_uuid`)
- Create indexes and triggers
- Insert default settings

**Verify the reset:**
```bash
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT COUNT(*) FROM songs;"
# Should return: 0
```

## Step 2: Prepare Your Files

Make sure you have:
- **Cleaned folder**: Contains cleaned txt files (for display_lyrics and .pro conversion)
- **Original folder**: Contains original txt files (for music_ministry_lyrics)
- **Pro output folder**: Where generated .pro files will be saved

Example structure:
```
/path/to/your/files/
├── cleaned/          # Cleaned txt files
│   ├── song1.txt
│   └── song2.txt
├── original/         # Original txt files
│   ├── song1.txt
│   └── song2.txt
└── pro_files/        # Output folder (will be created)
```

## Step 3: Configure batch_import_to_db.py

Make sure your `.env` file in `pro-file-generator/` directory has:

```env
DATABASE_URL=postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter?sslmode=disable
TEMPLATE_PATH=/mnt/c/Users/joelv/Downloads/No One Like The Lord.proBundle/No One Like The Lord.pro
```

**Update `TEMPLATE_PATH`** to your actual template .pro file location.

## Step 4: Run Batch Import

```bash
cd /home/joelvw/church/pro-file-generator

# Activate virtual environment
source venv/bin/activate

# Run batch import
python batch_import_to_db.py \
  /path/to/cleaned/folder \
  /path/to/original/folder \
  /path/to/pro_output/folder
```

**Example:**
```bash
python batch_import_to_db.py \
  /home/joelvw/church/word-to-txt-converter/cleaned \
  /home/joelvw/church/word-to-txt-converter/output \
  /home/joelvw/church/word-to-txt-converter/pro_files
```

The script will:
1. Find all cleaned txt files
2. Match them with original txt files
3. Convert cleaned txt → .pro file (extracts UUID)
4. Insert into database with:
   - `display_lyrics` from cleaned folder
   - `music_ministry_lyrics` from original folder
   - `pro_uuid` from generated .pro file
   - Auto-detected `library` and `language` from folder structure

## Step 5: Verify Import

```bash
# Check song count
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT COUNT(*) FROM songs;"

# Check a sample song
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT title, library, language, pro_uuid FROM songs LIMIT 5;"

# Check UUIDs are populated
psql postgres://teleprompter_user:teleprompter_pass_2024@localhost:5432/teleprompter -c "SELECT COUNT(*) FROM songs WHERE pro_uuid IS NOT NULL;"
```

## Step 6: Start Docker Services

Once import is complete, start the website:

```bash
cd /home/joelvw/church/audience-stage-teleprompter

# Make sure .env file has correct password
cat > .env << EOF
POSTGRES_USER=teleprompter_user
POSTGRES_PASSWORD=teleprompter_pass_2024
POSTGRES_DB=teleprompter
TYPESENSE_API_KEY=your_typesense_api_key_here
TYPESENSE_HOST=https://your-cluster.a1.typesense.net
API_URL=http://localhost:8080/api
PROPRESENTER_ENABLED=false
EOF

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f backend
```

## Step 7: Access Website

Open: **http://localhost:3000**

Your imported songs should now appear with:
- UUID-based IDs
- ProPresenter UUIDs
- Display lyrics and music ministry lyrics
- Library and language information

## Troubleshooting

### Import Errors

**"Original file not found"**
- Make sure cleaned and original folders have matching filenames
- Check file paths are correct

**"Conversion to .pro failed"**
- Verify TEMPLATE_PATH points to a valid .pro template file
- Check txt file format is correct

**"Database connection failed"**
- Verify DATABASE_URL in .env matches your database
- Check database is running: `psql $DATABASE_URL -c "SELECT 1;"`

### Website Not Showing Songs

**Check backend logs:**
```bash
docker-compose logs backend
```

**Test API:**
```bash
curl http://localhost:8080/api/songs
```

**Rebuild Typesense index:**
```bash
curl -X POST http://localhost:8080/api/admin/reindex
```

## Schema Reference

The new schema includes:
- `id` (UUID) - Primary key, auto-generated
- `pro_uuid` (UUID) - ProPresenter file UUID, unique
- `title` (TEXT) - Song title
- `file_name` (TEXT) - Original filename
- `library` (TEXT) - Library name (e.g., "Joshua English Slides")
- `language` (VARCHAR) - Language code (e.g., "english", "malayalam")
- `display_lyrics` (TEXT) - Cleaned lyrics for display
- `music_ministry_lyrics` (TEXT) - Original lyrics for music ministry
- `artist` (TEXT) - Optional artist name
- `created_at`, `updated_at` - Timestamps

