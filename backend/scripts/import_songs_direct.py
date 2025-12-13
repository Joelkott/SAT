#!/usr/bin/env python3
"""
Direct PostgreSQL song import script
Bypasses REST API for fast bulk import
"""

import os
import sys
from pathlib import Path
import subprocess
from docx import Document
import psycopg2
from psycopg2.extras import execute_batch
import csv
from datetime import datetime
import uuid

# Database configuration
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "teleprompter"
DB_USER = "teleprompter_user"
DB_PASSWORD = "teleprompter_pass_2024"

# Song directories
SONG_DIRS = {
    'english': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua English Slides',
    'malayalam': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Malayalam Slides',
    'hindi': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Hindi Slides',
    'tamil': '/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024/Joshua Tamil Slides',
}


def check_antiword():
    """Check if antiword is available"""
    try:
        subprocess.run(['antiword', '-v'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def read_doc_file(filepath):
    """Read content from .doc file using antiword"""
    try:
        result = subprocess.run(
            ['antiword', '-t', str(filepath)],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except Exception as e:
        print(f"Error reading .doc file {filepath}: {e}")
        return None


def read_docx_file(filepath):
    """Read content from .docx file using python-docx"""
    try:
        doc = Document(filepath)
        text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except Exception as e:
        print(f"Error reading .docx file {filepath}: {e}")
        return None


def read_song_file(filepath):
    """Read song content from file"""
    filepath = Path(filepath)

    if filepath.suffix.lower() == '.doc':
        return read_doc_file(filepath)
    elif filepath.suffix.lower() == '.docx':
        return read_docx_file(filepath)
    else:
        return None


def scan_songs():
    """Scan all song directories and return list of song files"""
    songs = []

    for language, directory in SONG_DIRS.items():
        dir_path = Path(directory)
        if not dir_path.exists():
            print(f"Warning: Directory not found: {directory}")
            continue

        for filepath in dir_path.glob('*'):
            if filepath.suffix.lower() in ['.doc', '.docx'] and filepath.is_file():
                songs.append({
                    'filepath': str(filepath),
                    'filename': filepath.name,
                    'language': language
                })

    return songs


def import_songs_batch(songs, batch_size=100):
    """Import songs directly to PostgreSQL in batches"""

    # Connect to database
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

    # Create error log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    error_log_path = f"import_errors_direct_{timestamp}.csv"
    error_log = open(error_log_path, 'w', newline='', encoding='utf-8')
    error_writer = csv.writer(error_log)
    error_writer.writerow(['Timestamp', 'Filename', 'Language', 'Full Path', 'Error Type', 'Error Message'])

    try:
        cursor = conn.cursor()

        # Prepare batch data
        batch = []
        imported = 0
        failed = 0
        skipped = 0

        print("\n" + "="*70)
        print("DIRECT POSTGRESQL SONG IMPORT")
        print("="*70)
        print(f"\nProcessing {len(songs)} songs...")
        print(f"Batch size: {batch_size}")
        print(f"Error log: {error_log_path}\n")

        for i, song_info in enumerate(songs, 1):
            filepath = song_info['filepath']
            filename = song_info['filename']
            language = song_info['language']

            # Read song content
            content = read_song_file(filepath)

            if content is None:
                error_writer.writerow([
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    filename, language, filepath,
                    "FILE_READ_ERROR", "Could not read file"
                ])
                error_log.flush()
                failed += 1
                print(f"[{i}/{len(songs)}] ✗ {filename} (read error)")
                continue

            if not content.strip():
                error_writer.writerow([
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    filename, language, filepath,
                    "EMPTY_CONTENT", "File has no content"
                ])
                error_log.flush()
                skipped += 1
                print(f"[{i}/{len(songs)}] - {filename} (empty)")
                continue

            # Extract title from filename (remove extension)
            title = Path(filename).stem

            # Prepare data for batch insert
            song_id = str(uuid.uuid4())
            batch.append((
                song_id,
                title,
                content,
                language,
                "",  # author (empty for now)
                "no"  # translation
            ))

            # Insert batch when it reaches batch_size
            if len(batch) >= batch_size:
                try:
                    execute_batch(cursor, """
                        INSERT INTO songs (id, title, lyrics, language, author, translation, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                    """, batch)
                    conn.commit()
                    imported += len(batch)
                    print(f"[{i}/{len(songs)}] ✓ Batch inserted ({len(batch)} songs)")
                    batch = []
                except Exception as e:
                    conn.rollback()
                    # Log all songs in failed batch
                    for song_data in batch:
                        error_writer.writerow([
                            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "Batch", language, "",
                            "DB_ERROR", str(e)
                        ])
                    error_log.flush()
                    failed += len(batch)
                    print(f"[{i}/{len(songs)}] ✗ Batch failed: {e}")
                    batch = []
            else:
                print(f"[{i}/{len(songs)}] + {filename}")

        # Insert remaining songs in batch
        if batch:
            try:
                execute_batch(cursor, """
                    INSERT INTO songs (id, title, lyrics, language, author, translation, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
                """, batch)
                conn.commit()
                imported += len(batch)
                print(f"\n✓ Final batch inserted ({len(batch)} songs)")
            except Exception as e:
                conn.rollback()
                for song_data in batch:
                    error_writer.writerow([
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "Batch", language, "",
                        "DB_ERROR", str(e)
                    ])
                error_log.flush()
                failed += len(batch)
                print(f"\n✗ Final batch failed: {e}")

        # Update edit count
        cursor.execute("UPDATE edit_count SET count = count + %s", (imported,))
        conn.commit()

        cursor.close()

    finally:
        conn.close()
        error_log.close()

    return imported, failed, skipped


def main():
    print("\n" + "="*70)
    print("AUDIENCE STAGE TELEPROMPTER - DIRECT POSTGRESQL IMPORT")
    print("="*70)

    # Check antiword
    if not check_antiword():
        print("\n✗ antiword not found")
        print("Please install antiword: sudo apt-get install antiword")
        sys.exit(1)
    print("\n✓ antiword found")

    # Scan songs
    print("\nScanning directories...")
    songs = scan_songs()
    print(f"Found {len(songs)} song files")

    if not songs:
        print("\nNo songs found!")
        sys.exit(1)

    # Show breakdown
    by_language = {}
    for song in songs:
        lang = song['language']
        by_language[lang] = by_language.get(lang, 0) + 1

    print("\nBreakdown by language:")
    for lang, count in sorted(by_language.items()):
        print(f"  {lang}: {count}")

    # Confirm import
    response = input(f"\nImport {len(songs)} songs directly to PostgreSQL? (yes/no): ")
    if response.lower() != 'yes':
        print("Import cancelled")
        sys.exit(0)

    # Import songs
    print("\nStarting direct import...")
    imported, failed, skipped = import_songs_batch(songs, batch_size=100)

    # Summary
    print("\n" + "="*70)
    print("IMPORT COMPLETE")
    print("="*70)
    print(f"Imported: {imported}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")
    print(f"Total: {len(songs)}")
    print(f"\nSuccess rate: {imported/len(songs)*100:.1f}%")
    print("\nNext step: Reindex songs to Typesense")
    print("  curl -X POST http://localhost:8080/api/admin/reindex")


if __name__ == '__main__':
    main()
