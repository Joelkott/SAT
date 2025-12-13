package database

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	pq "github.com/lib/pq"
	"github.com/yourusername/audience-stage-teleprompter/internal/models"
)

type DB struct {
	*sql.DB
}

func New(dsn string) (*DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("error opening database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("error connecting to database: %w", err)
	}

	log.Println("Database connection established")
	return &DB{db}, nil
}

// CreateSong inserts a new song into the database
func (db *DB) CreateSong(song *models.CreateSongRequest) (*models.Song, error) {
	query := `
		INSERT INTO songs (title, artist, lyrics, language, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		RETURNING id, title, artist, lyrics, language, content, created_at, updated_at
	`

	var result models.Song
	err := db.QueryRow(query, song.Title, song.Artist, song.Lyrics, song.Language, song.Content).
		Scan(&result.ID, &result.Title, &result.Artist, &result.Lyrics, &result.Language, &result.Content, &result.CreatedAt, &result.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("error creating song: %w", err)
	}

	return &result, nil
}

// GetSong retrieves a song by ID
func (db *DB) GetSong(id string) (*models.Song, error) {
	query := `
		SELECT id, title, artist, lyrics, language, content, created_at, updated_at
		FROM songs
		WHERE id = $1
	`

	var song models.Song
	err := db.QueryRow(query, id).
		Scan(&song.ID, &song.Title, &song.Artist, &song.Lyrics, &song.Language, &song.Content, &song.CreatedAt, &song.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("song not found")
	}
	if err != nil {
		return nil, fmt.Errorf("error getting song: %w", err)
	}

	return &song, nil
}

// GetAllSongs retrieves all songs
func (db *DB) GetAllSongs() ([]models.Song, error) {
	query := `
		SELECT id, title, artist, lyrics, language, content, created_at, updated_at
		FROM songs
		ORDER BY updated_at DESC
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("error getting songs: %w", err)
	}
	defer rows.Close()

	var songs []models.Song
	for rows.Next() {
		var song models.Song
		err := rows.Scan(&song.ID, &song.Title, &song.Artist, &song.Lyrics, &song.Language, &song.Content, &song.CreatedAt, &song.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("error scanning song: %w", err)
		}
		songs = append(songs, song)
	}

	return songs, nil
}

// SearchSongs performs a DB search with optional language filter and text query.
// If query is empty, only language filtering is applied.
func (db *DB) SearchSongs(query string, languages []string) ([]models.Song, error) {
	base := `
		SELECT id, title, artist, lyrics, language, content, created_at, updated_at
		FROM songs
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

	if query != "" && query != "*" {
		base += fmt.Sprintf(" AND (title ILIKE $%d OR artist ILIKE $%d OR lyrics ILIKE $%d OR content ILIKE $%d)", argPos, argPos, argPos, argPos)
		args = append(args, "%"+query+"%")
		argPos++
	}

	if len(languages) > 0 {
		base += fmt.Sprintf(" AND language = ANY($%d)", argPos)
		args = append(args, pq.Array(languages))
		argPos++
	}

	base += " ORDER BY updated_at DESC"

	rows, err := db.Query(base, args...)
	if err != nil {
		return nil, fmt.Errorf("error searching songs: %w", err)
	}
	defer rows.Close()

	var songs []models.Song
	for rows.Next() {
		var song models.Song
		if err := rows.Scan(&song.ID, &song.Title, &song.Artist, &song.Lyrics, &song.Language, &song.Content, &song.CreatedAt, &song.UpdatedAt); err != nil {
			return nil, fmt.Errorf("error scanning song: %w", err)
		}
		songs = append(songs, song)
	}

	return songs, nil
}

// UpdateSong updates an existing song
func (db *DB) UpdateSong(id string, updates *models.UpdateSongRequest) (*models.Song, error) {
	// Build dynamic update query
	query := `UPDATE songs SET updated_at = NOW()`
	args := []interface{}{}
	argCount := 1

	if updates.Title != nil {
		query += fmt.Sprintf(", title = $%d", argCount)
		args = append(args, *updates.Title)
		argCount++
	}
	if updates.Artist != nil {
		query += fmt.Sprintf(", artist = $%d", argCount)
		args = append(args, *updates.Artist)
		argCount++
	}
	if updates.Lyrics != nil {
		query += fmt.Sprintf(", lyrics = $%d", argCount)
		args = append(args, *updates.Lyrics)
		argCount++
	}
	if updates.Language != nil {
		query += fmt.Sprintf(", language = $%d", argCount)
		args = append(args, *updates.Language)
		argCount++
	}
	if updates.Content != nil {
		query += fmt.Sprintf(", content = $%d", argCount)
		args = append(args, *updates.Content)
		argCount++
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING id, title, artist, lyrics, language, content, created_at, updated_at", argCount)
	args = append(args, id)

	var song models.Song
	err := db.QueryRow(query, args...).
		Scan(&song.ID, &song.Title, &song.Artist, &song.Lyrics, &song.Language, &song.Content, &song.CreatedAt, &song.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("song not found")
	}
	if err != nil {
		return nil, fmt.Errorf("error updating song: %w", err)
	}

	return &song, nil
}

// DeleteSong deletes a song by ID
func (db *DB) DeleteSong(id string) error {
	query := `DELETE FROM songs WHERE id = $1`
	result, err := db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("error deleting song: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("error checking rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("song not found")
	}

	return nil
}

// GetEditCount returns the total number of edits (inserts + updates)
func (db *DB) GetEditCount() (int, error) {
	var count int
	query := `SELECT COUNT(*) FROM songs`
	err := db.QueryRow(query).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("error getting edit count: %w", err)
	}
	return count, nil
}
