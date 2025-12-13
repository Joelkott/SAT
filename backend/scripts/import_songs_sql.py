#!/usr/bin/env python3
"""
Direct SQL song import script using psql
Generates SQL statements and executes them via psql
"""

import os
import sys
from pathlib import Path
import subprocess
from docx import Document
import csv
from datetime import datetime
import uuid
import tempfile

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
        return None


def read_docx_file(filepath):
    """Read content from .docx file using python-docx"""
    try:
        doc = Document(filepath)
        text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
        return text.strip()
    except Exception as e:
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


def escape_sql(text):
    """Escape single quotes for SQL"""
    if text is None:
        return ''
    return text.replace("'", "''")


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


def generate_sql_inserts(songs):
    """Generate SQL INSERT statements for all songs"""

    # Create error log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    error_log_path = f"import_errors_sql_{timestamp}.csv"
    error_log = open(error_log_path, 'w', newline='', encoding='utf-8')
    error_writer = csv.writer(error_log)
    error_writer.writerow(['Timestamp', 'Filename', 'Language', 'Full Path', 'Error Type', 'Error Message'])

    sql_statements = []
    imported = 0
    failed = 0
    skipped = 0

    print("\n" + "="*70)
    print("GENERATING SQL INSERTS")
    print("="*70)
    print(f"\nProcessing {len(songs)} songs...\n")

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

        # Generate UUID
        song_id = str(uuid.uuid4())

        # Escape content for SQL
        title_escaped = escape_sql(title)
        content_escaped = escape_sql(content)

        # Generate INSERT statement
        sql = f"INSERT INTO songs (id, title, lyrics, language, author, translation, created_at, updated_at) VALUES ('{song_id}', '{title_escaped}', '{content_escaped}', '{language}', '', 'no', NOW(), NOW());\n"
        sql_statements.append(sql)

        imported += 1
        if i % 100 == 0:
            print(f"[{i}/{len(songs)}] Processed {i} songs...")

    error_log.close()

    return sql_statements, imported, failed, skipped, error_log_path


def execute_sql_file(sql_file):
    """Execute SQL file using psql"""
    try:
        result = subprocess.run(
            ['psql', '-U', 'teleprompter_user', '-d', 'teleprompter', '-h', 'localhost', '-f', sql_file],
            env={**os.environ, 'PGPASSWORD': 'teleprompter_pass_2024'},
            capture_output=True,
            text=True,
            timeout=600
        )

        if result.returncode != 0:
            print(f"\nError executing SQL:")
            print(result.stderr)
            return False

        return True
    except Exception as e:
        print(f"\nError: {e}")
        return False


def main():
    print("\n" + "="*70)
    print("AUDIENCE STAGE TELEPROMPTER - SQL DIRECT IMPORT")
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
    response = input(f"\nImport {len(songs)} songs directly via SQL? (yes/no): ")
    if response.lower() != 'yes':
        print("Import cancelled")
        sys.exit(0)

    # Generate SQL
    print("\nGenerating SQL statements...")
    sql_statements, imported, failed, skipped, error_log = generate_sql_inserts(songs)

    if not sql_statements:
        print("\nNo songs to import!")
        sys.exit(1)

    # Write SQL to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', delete=False, encoding='utf-8') as f:
        sql_file = f.name
        f.write("-- Begin transaction\n")
        f.write("BEGIN;\n\n")
        for sql in sql_statements:
            f.write(sql)
        f.write("\n-- Update edit count\n")
        f.write(f"UPDATE edit_count SET count = count + {imported};\n\n")
        f.write("-- Commit transaction\n")
        f.write("COMMIT;\n")

    print(f"\nSQL file created: {sql_file}")
    print(f"Executing SQL via psql...")

    # Execute SQL
    success = execute_sql_file(sql_file)

    # Cleanup
    try:
        os.unlink(sql_file)
    except:
        pass

    if not success:
        print("\n✗ Import failed!")
        sys.exit(1)

    # Summary
    print("\n" + "="*70)
    print("IMPORT COMPLETE")
    print("="*70)
    print(f"Imported: {imported}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")
    print(f"Total: {len(songs)}")
    print(f"Error log: {error_log}")
    print(f"\nSuccess rate: {imported/len(songs)*100:.1f}%")
    print("\nNext step: Reindex songs to Typesense")
    print("  curl -X POST http://localhost:8080/api/admin/reindex")


if __name__ == '__main__':
    main()
