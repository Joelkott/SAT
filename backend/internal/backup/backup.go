package backup

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type Manager struct {
	dbDSN          string
	backupDir      string
	lastEditCount  int
	editsThreshold int
	mu             sync.Mutex
}

func NewManager(dbDSN, backupDir string, editsThreshold int) *Manager {
	return &Manager{
		dbDSN:          dbDSN,
		backupDir:      backupDir,
		editsThreshold: editsThreshold,
		lastEditCount:  0,
	}
}

// Start begins the backup scheduler
func (m *Manager) Start() {
	// Daily backup at 2 AM
	go m.scheduleDailyBackup()
	log.Println("Backup manager started")
}

// scheduleDailyBackup runs daily backups
func (m *Manager) scheduleDailyBackup() {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day()+1, 2, 0, 0, 0, now.Location())
		duration := next.Sub(now)

		log.Printf("Next scheduled backup in %v", duration)
		time.Sleep(duration)

		if err := m.CreateBackup("daily"); err != nil {
			log.Printf("Error creating daily backup: %v", err)
		}
	}
}

// CheckEditThreshold checks if we need to backup based on edit count
func (m *Manager) CheckEditThreshold(currentEditCount int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if currentEditCount-m.lastEditCount >= m.editsThreshold {
		if err := m.CreateBackup("edit-threshold"); err != nil {
			return err
		}
		m.lastEditCount = currentEditCount
	}

	return nil
}

// CreateBackup creates a PostgreSQL dump
func (m *Manager) CreateBackup(backupType string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create backup directory if it doesn't exist
	if err := os.MkdirAll(m.backupDir, 0755); err != nil {
		return fmt.Errorf("error creating backup directory: %w", err)
	}

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	filename := fmt.Sprintf("backup_%s_%s.sql", backupType, timestamp)
	filePath := filepath.Join(m.backupDir, filename)

	// Execute pg_dump
	cmd := exec.Command("pg_dump", m.dbDSN, "-f", filePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pg_dump failed: %w, output: %s", err, string(output))
	}

	// Get file size
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("error getting backup file info: %w", err)
	}

	log.Printf("Backup created: %s (%.2f MB)", filename, float64(fileInfo.Size())/(1024*1024))

	// Create metadata file
	metadata := map[string]interface{}{
		"backup_type": backupType,
		"timestamp":   timestamp,
		"size_bytes":  fileInfo.Size(),
		"filename":    filename,
	}

	metadataFilename := fmt.Sprintf("backup_%s_%s.json", backupType, timestamp)
	metadataPath := filepath.Join(m.backupDir, metadataFilename)

	metadataJSON, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return fmt.Errorf("error creating metadata: %w", err)
	}

	if err := os.WriteFile(metadataPath, metadataJSON, 0644); err != nil {
		return fmt.Errorf("error writing metadata: %w", err)
	}

	// Clean old backups (keep last 7 days)
	m.cleanOldBackups(7)

	return nil
}

// cleanOldBackups removes backups older than the specified number of days
func (m *Manager) cleanOldBackups(daysToKeep int) {
	files, err := os.ReadDir(m.backupDir)
	if err != nil {
		log.Printf("Error reading backup directory: %v", err)
		return
	}

	cutoff := time.Now().AddDate(0, 0, -daysToKeep)
	deleted := 0

	for _, file := range files {
		if file.IsDir() {
			continue
		}

		info, err := file.Info()
		if err != nil {
			continue
		}

		if info.ModTime().Before(cutoff) {
			filePath := filepath.Join(m.backupDir, file.Name())
			if err := os.Remove(filePath); err != nil {
				log.Printf("Error deleting old backup %s: %v", file.Name(), err)
			} else {
				deleted++
			}
		}
	}

	if deleted > 0 {
		log.Printf("Cleaned up %d old backup files", deleted)
	}
}

// ListBackups returns a list of all backups
func (m *Manager) ListBackups() ([]map[string]interface{}, error) {
	files, err := os.ReadDir(m.backupDir)
	if err != nil {
		return nil, fmt.Errorf("error reading backup directory: %w", err)
	}

	var backups []map[string]interface{}

	for _, file := range files {
		if file.IsDir() || filepath.Ext(file.Name()) != ".json" {
			continue
		}

		metadataPath := filepath.Join(m.backupDir, file.Name())
		data, err := os.ReadFile(metadataPath)
		if err != nil {
			continue
		}

		var metadata map[string]interface{}
		if err := json.Unmarshal(data, &metadata); err != nil {
			continue
		}

		backups = append(backups, metadata)
	}

	return backups, nil
}
