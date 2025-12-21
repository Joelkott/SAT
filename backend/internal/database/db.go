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
		INSERT INTO songs (title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		RETURNING id, title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at
	`

	var result models.Song
	err := db.QueryRow(query, song.Title, song.FileName, song.Library, song.Language, song.ProUUID, song.DisplayLyrics, song.MusicMinistryLyrics, song.Artist).
		Scan(&result.ID, &result.Title, &result.FileName, &result.Library, &result.Language, &result.ProUUID, &result.DisplayLyrics, &result.MusicMinistryLyrics, &result.Artist, &result.CreatedAt, &result.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("error creating song: %w", err)
	}

	return &result, nil
}

// GetSong retrieves a song by ID
func (db *DB) GetSong(id string) (*models.Song, error) {
	query := `
		SELECT id, title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at
		FROM songs
		WHERE id = $1
	`

	var song models.Song
	err := db.QueryRow(query, id).
		Scan(&song.ID, &song.Title, &song.FileName, &song.Library, &song.Language, &song.ProUUID, &song.DisplayLyrics, &song.MusicMinistryLyrics, &song.Artist, &song.CreatedAt, &song.UpdatedAt)

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
		SELECT id, title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at
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
		err := rows.Scan(&song.ID, &song.Title, &song.FileName, &song.Library, &song.Language, &song.ProUUID, &song.DisplayLyrics, &song.MusicMinistryLyrics, &song.Artist, &song.CreatedAt, &song.UpdatedAt)
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
		SELECT id, title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at
		FROM songs
		WHERE 1=1
	`
	args := []interface{}{}
	argPos := 1

	if query != "" && query != "*" {
		base += fmt.Sprintf(" AND (title ILIKE $%d OR artist ILIKE $%d OR display_lyrics ILIKE $%d OR music_ministry_lyrics ILIKE $%d)", argPos, argPos, argPos, argPos)
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
		if err := rows.Scan(&song.ID, &song.Title, &song.FileName, &song.Library, &song.Language, &song.ProUUID, &song.DisplayLyrics, &song.MusicMinistryLyrics, &song.Artist, &song.CreatedAt, &song.UpdatedAt); err != nil {
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
	if updates.Library != nil {
		query += fmt.Sprintf(", library = $%d", argCount)
		args = append(args, *updates.Library)
		argCount++
	}
	if updates.DisplayLyrics != nil {
		query += fmt.Sprintf(", display_lyrics = $%d", argCount)
		args = append(args, *updates.DisplayLyrics)
		argCount++
	}
	if updates.Language != nil {
		query += fmt.Sprintf(", language = $%d", argCount)
		args = append(args, *updates.Language)
		argCount++
	}
	if updates.MusicMinistryLyrics != nil {
		query += fmt.Sprintf(", music_ministry_lyrics = $%d", argCount)
		args = append(args, *updates.MusicMinistryLyrics)
		argCount++
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING id, title, file_name, library, language, pro_uuid, display_lyrics, music_ministry_lyrics, artist, created_at, updated_at", argCount)
	args = append(args, id)

	var song models.Song
	err := db.QueryRow(query, args...).
		Scan(&song.ID, &song.Title, &song.FileName, &song.Library, &song.Language, &song.ProUUID, &song.DisplayLyrics, &song.MusicMinistryLyrics, &song.Artist, &song.CreatedAt, &song.UpdatedAt)

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

// GetSettings retrieves the settings (there's only one row with id=1)
func (db *DB) GetSettings() (*models.Settings, error) {
	query := `
		SELECT id, laptop_b_ip, laptop_b_port, live_playlist_uuid, 
		       COALESCE(propresenter_host, '') as propresenter_host,
		       COALESCE(propresenter_port, 4031) as propresenter_port,
		       COALESCE(propresenter_playlist, 'Live Queue') as propresenter_playlist,
		       COALESCE(propresenter_playlist_uuid::text, '00000000-0000-0000-0000-000000000000') as propresenter_playlist_uuid,
		       updated_at
		FROM settings
		WHERE id = 1
	`

	var settings models.Settings
	err := db.QueryRow(query).
		Scan(&settings.ID, &settings.LaptopBIP, &settings.LaptopBPort, &settings.LivePlaylistUUID,
			&settings.ProPresenterHost, &settings.ProPresenterPort, &settings.ProPresenterPlaylist,
			&settings.ProPresenterPlaylistUUID, &settings.UpdatedAt)

	if err == sql.ErrNoRows {
		// Create default settings if none exist
		return db.createDefaultSettings()
	}
	if err != nil {
		return nil, fmt.Errorf("error getting settings: %w", err)
	}

	return &settings, nil
}

// createDefaultSettings creates default settings if none exist
func (db *DB) createDefaultSettings() (*models.Settings, error) {
	query := `
		INSERT INTO settings (id, propresenter_host, propresenter_port, propresenter_playlist, propresenter_playlist_uuid)
		VALUES (1, '', 4031, 'Live Queue', '00000000-0000-0000-0000-000000000000')
		ON CONFLICT (id) DO NOTHING
		RETURNING id, laptop_b_ip, laptop_b_port, live_playlist_uuid,
		          COALESCE(propresenter_host, '') as propresenter_host,
		          COALESCE(propresenter_port, 4031) as propresenter_port,
		          COALESCE(propresenter_playlist, 'Live Queue') as propresenter_playlist,
		          COALESCE(propresenter_playlist_uuid::text, '00000000-0000-0000-0000-000000000000') as propresenter_playlist_uuid,
		          updated_at
	`

	var settings models.Settings
	err := db.QueryRow(query).
		Scan(&settings.ID, &settings.LaptopBIP, &settings.LaptopBPort, &settings.LivePlaylistUUID,
			&settings.ProPresenterHost, &settings.ProPresenterPort, &settings.ProPresenterPlaylist,
			&settings.ProPresenterPlaylistUUID, &settings.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("error creating default settings: %w", err)
	}

	return &settings, nil
}

// UpdateSettings updates the settings
func (db *DB) UpdateSettings(updates *models.UpdateSettingsRequest) (*models.Settings, error) {
	query := `UPDATE settings SET updated_at = NOW()`
	args := []interface{}{}
	argCount := 1

	if updates.ProPresenterHost != nil {
		query += fmt.Sprintf(", propresenter_host = $%d", argCount)
		args = append(args, *updates.ProPresenterHost)
		argCount++
	}
	if updates.ProPresenterPort != nil {
		query += fmt.Sprintf(", propresenter_port = $%d", argCount)
		args = append(args, *updates.ProPresenterPort)
		argCount++
	}
	if updates.ProPresenterPlaylist != nil {
		query += fmt.Sprintf(", propresenter_playlist = $%d", argCount)
		args = append(args, *updates.ProPresenterPlaylist)
		argCount++
	}
	if updates.ProPresenterPlaylistUUID != nil {
		uuidValue := *updates.ProPresenterPlaylistUUID
		// Handle empty string as NULL/default UUID
		if uuidValue == "" {
			uuidValue = "00000000-0000-0000-0000-000000000000"
		}
		query += fmt.Sprintf(", propresenter_playlist_uuid = $%d::uuid", argCount)
		args = append(args, uuidValue)
		argCount++
	}

	// If no fields to update, just return current settings
	if argCount == 1 {
		return db.GetSettings()
	}

	query += ` WHERE id = 1 
		RETURNING id, laptop_b_ip, laptop_b_port, live_playlist_uuid,
		          COALESCE(propresenter_host, '') as propresenter_host,
		          COALESCE(propresenter_port, 4031) as propresenter_port,
		          COALESCE(propresenter_playlist, 'Live Queue') as propresenter_playlist,
		          COALESCE(propresenter_playlist_uuid::text, '00000000-0000-0000-0000-000000000000') as propresenter_playlist_uuid,
		          updated_at`

	var settings models.Settings
	err := db.QueryRow(query, args...).
		Scan(&settings.ID, &settings.LaptopBIP, &settings.LaptopBPort, &settings.LivePlaylistUUID,
			&settings.ProPresenterHost, &settings.ProPresenterPort, &settings.ProPresenterPlaylist,
			&settings.ProPresenterPlaylistUUID, &settings.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("settings not found")
	}
	if err != nil {
		return nil, fmt.Errorf("error updating settings: %w", err)
	}

	return &settings, nil
}
