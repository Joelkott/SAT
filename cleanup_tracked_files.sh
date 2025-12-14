#!/bin/bash

# Remove unnecessary files from git tracking (but keep them locally)

echo "🧹 Cleaning up tracked files that should be ignored..."
echo ""

# Remove CSV error files
echo "Removing CSV error files from git tracking..."
git rm --cached backend/*_errors_*.csv backend/direct_import_errors_*.csv 2>/dev/null || echo "  (Some files may not be tracked)"

# Remove log files if tracked
echo "Removing log files from git tracking..."
git rm --cached backend/*.log 2>/dev/null || echo "  (Log files not tracked)"

# Remove backup files if tracked
echo "Removing backup files from git tracking..."
git rm --cached backend/backups/*.sql backend/backups/*.json 2>/dev/null || echo "  (Backup files not tracked)"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "These files are now ignored by git but remain on your local filesystem."
echo ""
echo "Review changes with: git status"

