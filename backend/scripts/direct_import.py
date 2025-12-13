#!/usr/bin/env python3
"""
Direct PostgreSQL Import Script
Bypasses REST API for maximum speed
"""

import sys
import os
from pathlib import Path
import subprocess
from datetime import datetime
import csv
import psycopg2
from psycopg2.extras import execute_values
import uuid
from docx import Document

# Configuration
SONG_DIRS = {
    'english': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua English Slides',
    'malayalam': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Malayalam Slides',
    'hindi': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Hindi Slides',
    'tamil': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Tamil Slides'
}

DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'teleprompter',
    'user': 'teleprompter_user',
    'password': 'teleprompter_pass_2024'
}

def check_antiword():
    """Check if antiword is installed"""
    try:
        subprocess.run(['antiword'], capture_output=True)
        print("✓ antiword found (for .doc files)\n")
        return True
    except FileNotFoundError:
        print("✗ antiword not found. Please install: sudo apt-get install antiword")
        return False

def extract_text_from_doc(filepath):
    """Extract text from .doc file using antiword"""
    try:
        result = subprocess.run(
            ['antiword', '-w', '0', filepath],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except Exception as e:
        print(f"Warning: Could not read {filepath}: {e}")
        return None

def extract_text_from_docx(filepath):
    """Extract text from .docx file using python-docx"""
    try:
        doc = Document(filepath)
        text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"Warning: Could not read {filepath}: {e}")
        return None

def extract_text_from_file(filepath):
    """Extract text from .doc or .docx file"""
    filepath = Path(filepath)
    if filepath.suffix.lower() == '.doc':
        return extract_text_from_doc(str(filepath))
    elif filepath.suffix.lower() == '.docx':
        return extract_text_from_docx(str(filepath))
    else:
        return None

def scan_song_files():
    """Scan all song directories and return list of files"""
    song_files = []

    for language, directory in SONG_DIRS.items():
        dir_path = Path(directory)
        if not dir_path.exists():
            print(f"Warning: Directory not found: {directory}")
            continue

        # Scan for both .doc and .docx files
        doc_files = list(dir_path.glob('*.doc'))
        docx_files = list(dir_path.glob('*.docx'))
        files = doc_files + docx_files

        for file in files:
            song_files.append((str(file), language))

        print(f"Found {len(files)} {language} songs ({len(doc_files)} .doc, {len(docx_files)} .docx)")

    return song_files

def connect_db():
    """Connect to PostgreSQL database"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def process_song(filepath, language):
    """Process a single song file and return data tuple for insertion"""
    try:
        # Extract filename without extension
        filename = Path(filepath).stem
        title = filename

        # Extract lyrics from .doc or .docx file
        lyrics = extract_text_from_file(filepath)

        if not lyrics or not lyrics.strip():
            return None, "EMPTY_CONTENT", "Empty content after extraction"

        # Generate UUID
        song_id = str(uuid.uuid4())

        # Prepare data tuple (id, title, artist, lyrics, language, content, created_at, updated_at)
        return (song_id, title, '', lyrics, language, lyrics, datetime.now(), datetime.now()), None, None

    except Exception as e:
        return None, "PROCESSING_ERROR", str(e)

def bulk_insert_songs(conn, songs_data):
    """Bulk insert songs into database"""
    if not songs_data:
        return 0

    try:
        cursor = conn.cursor()

        insert_query = """
        INSERT INTO songs (id, title, artist, lyrics, language, content, created_at, updated_at)
        VALUES %s
        ON CONFLICT (id) DO NOTHING
        """

        execute_values(cursor, insert_query, songs_data)
        conn.commit()

        rows_inserted = cursor.rowcount
        cursor.close()

        return rows_inserted

    except Exception as e:
        conn.rollback()
        print(f"Error during bulk insert: {e}")
        return 0

def main():
    print("=" * 70)
    print("DIRECT POSTGRESQL IMPORT - AUDIENCE STAGE TELEPROMPTER")
    print("=" * 70)
    print()

    # Check dependencies
    if not check_antiword():
        return

    # Scan for song files
    print("Scanning directories...")
    song_files = scan_song_files()

    if not song_files:
        print("No song files found!")
        return

    print(f"\nFound {len(song_files)} total song files\n")

    # Confirm
    response = input(f"Import {len(song_files)} songs directly to PostgreSQL? (yes/no): ").lower()
    if response != 'yes':
        print("Import cancelled")
        return

    # Connect to database
    print("\nConnecting to PostgreSQL...")
    conn = connect_db()
    print("✓ Connected to database\n")

    # Create error log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    error_log_path = f"direct_import_errors_{timestamp}.csv"
    error_log = open(error_log_path, 'w', newline='', encoding='utf-8')
    error_writer = csv.writer(error_log)
    error_writer.writerow(['Timestamp', 'Filename', 'Language', 'Full Path', 'Error Type', 'Error Message'])

    print("Starting direct import...")
    print("-" * 70)

    imported = 0
    failed = 0
    batch_size = 100
    batch_data = []

    try:
        for i, (filepath, language) in enumerate(song_files, 1):
            filename = Path(filepath).name

            # Process song
            song_data, error_type, error_msg = process_song(filepath, language)

            if song_data:
                batch_data.append(song_data)

                # Insert batch when full
                if len(batch_data) >= batch_size:
                    rows = bulk_insert_songs(conn, batch_data)
                    imported += rows
                    batch_data = []
                    print(f"[{i}/{len(song_files)}] Imported batch: {imported} total", end='\r')
            else:
                failed += 1
                error_writer.writerow([
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    filename,
                    language,
                    filepath,
                    error_type,
                    error_msg
                ])
                error_log.flush()

        # Insert remaining songs
        if batch_data:
            rows = bulk_insert_songs(conn, batch_data)
            imported += rows

        print(f"\n\n{'=' * 70}")
        print(f"Import completed!")
        print(f"{'=' * 70}")
        print(f"Successfully imported: {imported}")
        print(f"Failed: {failed}")
        print(f"Total processed: {len(song_files)}")
        print(f"Error log: {error_log_path}")
        print()

    finally:
        error_log.close()
        conn.close()

    # Prompt for reindex
    print("\n" + "=" * 70)
    print("NEXT STEP: Reindex songs to Typesense")
    print("=" * 70)
    print("\nRun the following command to index all songs in Typesense:")
    print("  curl -X POST http://localhost:8080/api/admin/reindex")
    print()

if __name__ == '__main__':
    main()
