#!/usr/bin/env python3
"""
Song Import Script for Audience Stage Teleprompter
Imports songs from .doc/.docx files into the database
"""

import os
import sys
import json
import requests
from pathlib import Path
import subprocess
import csv
from datetime import datetime

# Configuration
API_URL = "http://localhost:8080/api"
SONGS_BASE_DIR = "/mnt/c/Users/joelv/Downloads/Complete Song List 2024-20251208T122705Z-1-001/Complete Song List 2024"

# Language mapping from folder names
LANGUAGE_MAP = {
    "Joshua English Slides": "english",
    "Joshua Hindi Slides": "hindi",
    "Joshua Malayalam Slides": "malayalam",
    "Joshua Tamil Slides": "tamil",
    "Pennu Band List": "english",  # Assuming English for band list
    "Song database": "english"  # Default to English
}

def read_doc_file(filepath):
    """Read .doc file using antiword or textract"""
    try:
        # Try using antiword first (faster)
        result = subprocess.run(
            ['antiword', filepath],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            # Fallback to textract
            result = subprocess.run(
                ['textract', filepath],
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            print(f"Warning: Could not read {filepath}, skipping...")
            return None

def read_docx_file(filepath):
    """Read .docx file using python-docx"""
    try:
        from docx import Document
        doc = Document(filepath)
        full_text = []
        for para in doc.paragraphs:
            full_text.append(para.text)
        return '\n'.join(full_text)
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return None

def extract_title_from_filename(filename):
    """Extract clean title from filename"""
    # Remove extension
    title = os.path.splitext(filename)[0]
    # Clean up
    title = title.replace('_', ' ').strip()
    return title

def detect_language_from_path(filepath):
    """Detect language from folder path"""
    path_parts = Path(filepath).parts
    for part in path_parts:
        if part in LANGUAGE_MAP:
            return LANGUAGE_MAP[part]
    return "english"  # Default

def import_song(filepath, language):
    """Import a single song file. Returns (success, error_type, error_message)"""
    filename = os.path.basename(filepath)
    title = extract_title_from_filename(filename)

    # Read file content
    if filepath.endswith('.docx'):
        content = read_docx_file(filepath)
    elif filepath.endswith('.doc'):
        content = read_doc_file(filepath)
    else:
        error_msg = f"Unsupported file type: {filepath}"
        print(error_msg)
        return False, "UNSUPPORTED_FILE_TYPE", error_msg

    if content is None:
        error_msg = f"Could not read file (corrupted or unreadable)"
        print(f"Warning: {error_msg}")
        return False, "FILE_READ_ERROR", error_msg

    if not content.strip():
        error_msg = f"Empty content for {filename}, skipping..."
        print(error_msg)
        return False, "EMPTY_CONTENT", error_msg

    # Prepare data
    song_data = {
        "title": title,
        "lyrics": content.strip(),
        "language": language,
        "content": content.strip()
    }

    try:
        # Send to API
        response = requests.post(f"{API_URL}/songs", json=song_data, timeout=30)
        if response.status_code == 201:
            return True, None, None
        else:
            error_msg = f"API error: {response.text}"
            print(f"Error importing {filename}: {response.text}")
            return False, "API_ERROR", error_msg
    except requests.exceptions.Timeout:
        error_msg = "API timeout (>30s)"
        print(f"Timeout importing {filename}")
        return False, "TIMEOUT", error_msg
    except requests.exceptions.ConnectionError as e:
        error_msg = f"Connection error: {str(e)}"
        print(f"Connection error importing {filename}: {e}")
        return False, "CONNECTION_ERROR", error_msg
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        print(f"Failed to import {filename}: {e}")
        return False, "UNKNOWN_ERROR", error_msg

def main():
    # Check for --yes flag
    auto_yes = '--yes' in sys.argv or '-y' in sys.argv

    print("=" * 70)
    print("AUDIENCE STAGE TELEPROMPTER - SONG IMPORT UTILITY")
    print("=" * 70)
    print()

    # Check if required packages are installed
    try:
        from docx import Document
    except ImportError:
        print("Installing required package: python-docx...")
        subprocess.run([sys.executable, '-m', 'pip', 'install', 'python-docx'], check=True)
        print("Package installed successfully!")
        print()

    # Check if antiword is available
    try:
        subprocess.run(['which', 'antiword'], capture_output=True, check=True)
        print("✓ antiword found (for .doc files)")
    except subprocess.CalledProcessError:
        print("✗ antiword not found - .doc files may fail to import")
        print("  Install with: sudo apt-get install antiword")

    print()
    print(f"Scanning directory: {SONGS_BASE_DIR}")
    print()

    # Find all song files
    song_files = []
    for ext in ['*.doc', '*.docx']:
        song_files.extend(Path(SONGS_BASE_DIR).rglob(ext))

    total_files = len(song_files)
    print(f"Found {total_files} song files to import")
    print()

    if total_files == 0:
        print("No song files found!")
        return

    # Confirm import
    if not auto_yes:
        try:
            response = input(f"Import all {total_files} songs? (yes/no): ")
            if response.lower() not in ['yes', 'y']:
                print("Import cancelled")
                return
        except EOFError:
            print("Running in non-interactive mode. Use --yes flag to auto-confirm.")
            return
    else:
        print(f"Auto-confirming import of {total_files} songs (--yes flag provided)")
        print()

    print()
    print("Starting import...")
    print("-" * 70)

    imported = 0
    failed = 0
    skipped = 0

    # Create error log file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    error_log_path = f"import_errors_{timestamp}.csv"
    error_log = open(error_log_path, 'w', newline='', encoding='utf-8')
    error_writer = csv.writer(error_log)
    error_writer.writerow(['Timestamp', 'Filename', 'Language', 'Full Path', 'Error Type', 'Error Message'])

    print(f"Error log will be written to: {error_log_path}")
    print()

    try:
        for i, filepath in enumerate(song_files, 1):
            filepath_str = str(filepath)
            language = detect_language_from_path(filepath_str)

            print(f"[{i}/{total_files}] Importing: {filepath.name} ({language})...", end=" ")

            success, error_type, error_msg = import_song(filepath_str, language)
            if success:
                imported += 1
                print("✓")
            else:
                failed += 1
                print("✗ (failed)")
                # Log error to CSV
                error_writer.writerow([
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    filepath.name,
                    language,
                    filepath_str,
                    error_type,
                    error_msg
                ])
                error_log.flush()  # Ensure it's written immediately

            # Progress update every 100 songs
            if i % 100 == 0:
                print(f"\nProgress: {imported} imported, {failed} failed\n")
    finally:
        error_log.close()

    print()
    print("=" * 70)
    print("IMPORT COMPLETE")
    print("=" * 70)
    print(f"Total files processed: {total_files}")
    print(f"Successfully imported: {imported}")
    print(f"Failed: {failed}")
    print()
    if failed > 0:
        print(f"⚠ Error details saved to: {error_log_path}")
        print(f"  Review this file to see why {failed} songs failed to import")
        print()
    print("All songs have been imported and indexed in Typesense!")
    print("You can now search for them at: http://localhost:3000")
    print()

if __name__ == "__main__":
    main()
