package handlers

import (
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/yourusername/audience-stage-teleprompter/internal/backup"
	"github.com/yourusername/audience-stage-teleprompter/internal/database"
	"github.com/yourusername/audience-stage-teleprompter/internal/models"
	"github.com/yourusername/audience-stage-teleprompter/internal/propresenter"
	"github.com/yourusername/audience-stage-teleprompter/internal/typesense"
)

type Handler struct {
	db            *database.DB
	ts            *typesense.Client
	backupManager *backup.Manager
	propresenter  *propresenter.Client
	skipTypesense bool
}

func New(db *database.DB, ts *typesense.Client, backupManager *backup.Manager, pp *propresenter.Client, skipTypesense bool) *Handler {
	return &Handler{
		db:            db,
		ts:            ts,
		backupManager: backupManager,
		propresenter:  pp,
		skipTypesense: skipTypesense,
	}
}

// CreateSong creates a new song
func (h *Handler) CreateSong(c *fiber.Ctx) error {
	var req models.CreateSongRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Validation
	if req.Title == "" || req.DisplayLyrics == "" || req.Language == "" || req.Library == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title, display lyrics, language, and library are required"})
	}

	// Create in database
	song, err := h.db.CreateSong(&req)
	if err != nil {
		log.Printf("Error creating song: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create song"})
	}

	// Index in Typesense (skip if skipTypesense is enabled or Typesense is disabled)
	if !h.skipTypesense && h.ts != nil {
		if err := h.ts.IndexSong(song); err != nil {
			log.Printf("Error indexing song in Typesense: %v", err)
			// Don't fail the request, just log the error
		}
	}

	// Check backup threshold (async - don't block response)
	go func() {
		count, _ := h.db.GetEditCount()
		if err := h.backupManager.CheckEditThreshold(count); err != nil {
			log.Printf("Error checking backup threshold: %v", err)
		}
	}()

	return c.Status(201).JSON(song)
}

// GetSong retrieves a song by ID
func (h *Handler) GetSong(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ID is required"})
	}

	song, err := h.db.GetSong(id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
	}

	return c.JSON(song)
}

// GetAllSongs retrieves all songs
func (h *Handler) GetAllSongs(c *fiber.Ctx) error {
	songs, err := h.db.GetAllSongs()
	if err != nil {
		log.Printf("Error getting songs: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve songs"})
	}

	return c.JSON(songs)
}

// UpdateSong updates an existing song
func (h *Handler) UpdateSong(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ID is required"})
	}

	var req models.UpdateSongRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Update in database
	song, err := h.db.UpdateSong(id, &req)
	if err != nil {
		log.Printf("Error updating song: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update song"})
	}

	// Update in Typesense
	if h.ts != nil {
		if err := h.ts.IndexSong(song); err != nil {
			log.Printf("Error updating song in Typesense: %v", err)
		}
	}

	// Check backup threshold (async - don't block response)
	go func() {
		count, _ := h.db.GetEditCount()
		if err := h.backupManager.CheckEditThreshold(count); err != nil {
			log.Printf("Error checking backup threshold: %v", err)
		}
	}()

	return c.JSON(song)
}

// DeleteSong deletes a song
func (h *Handler) DeleteSong(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ID is required"})
	}

	// Delete from database
	if err := h.db.DeleteSong(id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
	}

	// Delete from Typesense
	if h.ts != nil {
		if err := h.ts.DeleteSong(id); err != nil {
			log.Printf("Error deleting song from Typesense: %v", err)
		}
	}

	return c.JSON(fiber.Map{"message": "Song deleted successfully"})
}

// SearchSongs searches for songs using Typesense
func (h *Handler) SearchSongs(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		// Allow empty query; treat as wildcard to enable language-only filtering.
		query = "*"
	}

	// Support multiple languages via comma-separated list (languages=eng,malayalam)
	languagesParam := c.Query("languages", "")
	languages := []string{}
	if languagesParam != "" {
		for _, lang := range strings.Split(languagesParam, ",") {
			if trimmed := strings.TrimSpace(lang); trimmed != "" {
				languages = append(languages, trimmed)
			}
		}
	}
	// Backward compatibility with single 'language' param
	if len(languages) == 0 {
		if single := strings.TrimSpace(c.Query("language", "")); single != "" {
			languages = append(languages, single)
		}
	}

	// If no text query (wildcard) and languages selected, filter from DB directly to guarantee language-only view.
	if len(languages) > 0 {
		q := strings.TrimSpace(query)
		songs, err := h.db.SearchSongs(q, languages)
		if err != nil {
			log.Printf("Error searching songs in DB: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Search failed"})
		}

		// Reorder by preference (stable within language)
		songs = reorderByLanguage(songs, languages)

		return c.JSON(typesense.SearchResult{
			Songs:      songs,
			TotalFound: len(songs),
			SearchTime: 0,
		})
	}

	// Use Typesense if available, otherwise fall back to PostgreSQL
	if h.ts == nil {
		// Fall back to PostgreSQL search
		songs, err := h.db.SearchSongs(query, languages)
		if err != nil {
			log.Printf("Error searching songs in DB: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Search failed"})
		}
		
		// Reorder by preference (stable within language)
		if len(languages) > 0 {
			songs = reorderByLanguage(songs, languages)
		}
		
		return c.JSON(typesense.SearchResult{
			Songs:      songs,
			TotalFound: len(songs),
			SearchTime: 0,
		})
	}
	
	results, err := h.ts.Search(query, languages)
	if err != nil {
		log.Printf("Error searching songs: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Search failed"})
	}

	// If specific languages are selected, drop others and prioritize selected languages in order.
	if len(languages) > 0 {
		results.Songs = filterToLanguages(results.Songs, languages)
		results.Songs = reorderByLanguage(results.Songs, languages)
	}

	return c.JSON(results)
}

// filterToLanguages keeps only songs whose Language matches the given preferences (case-insensitive).
func filterToLanguages(songs []models.Song, preferences []string) []models.Song {
	if len(preferences) == 0 || len(songs) == 0 {
		return songs
	}
	allowed := make(map[string]struct{}, len(preferences))
	for _, lang := range preferences {
		lc := strings.ToLower(strings.TrimSpace(lang))
		if lc != "" {
			allowed[lc] = struct{}{}
		}
	}
	filtered := make([]models.Song, 0, len(songs))
	for _, song := range songs {
		if _, ok := allowed[strings.ToLower(strings.TrimSpace(song.Language))]; ok {
			filtered = append(filtered, song)
		}
	}
	return filtered
}

// reorderByLanguage promotes songs whose Language matches the given preference order, preserving relative order within each language group.
func reorderByLanguage(songs []models.Song, preferences []string) []models.Song {
	if len(preferences) == 0 || len(songs) == 0 {
		return songs
	}

	// Normalize preferences to lowercase while preserving order
	prefIndex := make(map[string]int, len(preferences))
	prefList := make([]string, 0, len(preferences))
	for i, lang := range preferences {
		lc := strings.ToLower(strings.TrimSpace(lang))
		if lc == "" {
			continue
		}
		if _, exists := prefIndex[lc]; exists {
			continue
		}
		prefIndex[lc] = i
		prefList = append(prefList, lc)
	}

	if len(prefList) == 0 {
		return songs
	}

	// Buckets per language preference, keeping relative order
	buckets := make(map[string][]models.Song, len(prefList))
	other := make([]models.Song, 0)

	for _, song := range songs {
		lc := strings.ToLower(strings.TrimSpace(song.Language))
		if _, ok := prefIndex[lc]; ok {
			buckets[lc] = append(buckets[lc], song)
		} else {
			other = append(other, song)
		}
	}

	ordered := make([]models.Song, 0, len(songs))
	for _, lc := range prefList {
		ordered = append(ordered, buckets[lc]...)
	}
	ordered = append(ordered, other...)

	return ordered
}

// ReindexAll reindexes all songs from database to Typesense
func (h *Handler) ReindexAll(c *fiber.Ctx) error {
	if h.ts == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Typesense is disabled"})
	}
	
	songs, err := h.db.GetAllSongs()
	if err != nil {
		log.Printf("Error getting songs for reindex: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve songs"})
	}

	if err := h.ts.ReindexAll(songs); err != nil {
		log.Printf("Error reindexing: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Reindex failed"})
	}

	return c.JSON(fiber.Map{
		"message": "Reindex completed successfully",
		"count":   len(songs),
	})
}

// GetBackups lists all backups
func (h *Handler) GetBackups(c *fiber.Ctx) error {
	backups, err := h.backupManager.ListBackups()
	if err != nil {
		log.Printf("Error listing backups: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to list backups"})
	}

	return c.JSON(backups)
}

// CreateBackup manually triggers a backup
func (h *Handler) CreateBackup(c *fiber.Ctx) error {
	if err := h.backupManager.CreateBackup("manual"); err != nil {
		log.Printf("Error creating backup: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create backup"})
	}

	return c.JSON(fiber.Map{"message": "Backup created successfully"})
}

// HealthCheck returns server health status
func (h *Handler) HealthCheck(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status": "healthy",
		"timestamp": fiber.Map{
			"unix": c.Context().Time().Unix(),
		},
	})
}

// ============ ProPresenter Handlers ============

// ProPresenterStatus returns the ProPresenter connection status
func (h *Handler) ProPresenterStatus(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.JSON(fiber.Map{
			"enabled":   false,
			"connected": false,
			"message":   "ProPresenter integration is not configured",
		})
	}

	// Check current connection status
	connected := h.propresenter.IsConnected()
	
	// If not connected, try a health check
	if !connected {
		err := h.propresenter.Health()
		if err != nil {
			return c.JSON(fiber.Map{
				"enabled":   true,
				"connected": false,
				"message":   err.Error(),
			})
		}
		connected = h.propresenter.IsConnected()
	}

	return c.JSON(fiber.Map{
		"enabled":   true,
		"connected": connected,
		"message":   func() string {
			if connected {
				return "ProPresenter is connected"
			}
			return "ProPresenter is not connected"
		}(),
	})
}

// ProPresenterLibrary returns the ProPresenter library items
func (h *Handler) ProPresenterLibrary(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	query := c.Query("q", "")
	
	var items []propresenter.LibraryItem
	var err error
	
	if query != "" {
		items, err = h.propresenter.SearchLibrary(query)
	} else {
		items, err = h.propresenter.GetLibrary()
	}
	
	if err != nil {
		log.Printf("Error fetching ProPresenter library: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"items": items,
		"count": len(items),
	})
}

// ProPresenterPlaylists returns the ProPresenter playlists
func (h *Handler) ProPresenterPlaylists(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	playlists, err := h.propresenter.GetPlaylists()
	if err != nil {
		log.Printf("Error fetching ProPresenter playlists: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"playlists": playlists,
		"count":     len(playlists),
	})
}

// ProPresenterSendToQueue sends a song to the ProPresenter playlist using pro_uuid from database
func (h *Handler) ProPresenterSendToQueue(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	var req struct {
		SongID       string `json:"song_id"`
		SongTitle    string `json:"song_title"`
		PlaylistName string `json:"playlist_name"` // optional, uses settings if not provided
		ThemeName    string `json:"theme_name"`     // optional, theme to apply to the song
		Lyrics       string `json:"lyrics"`         // optional, not used anymore
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Get song from database to retrieve pro_uuid
	var song *models.Song
	var err error
	if req.SongID != "" {
		song, err = h.db.GetSong(req.SongID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
		}
	} else if req.SongTitle != "" {
		// Try to find by title
		songs, _ := h.db.GetAllSongs()
		for _, s := range songs {
			if s.Title == req.SongTitle {
				song = &s
				break
			}
		}
		if song == nil {
			return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
		}
	} else {
		return c.Status(400).JSON(fiber.Map{"error": "song_id or song_title is required"})
	}

	// Check if song has pro_uuid
	if song.ProUUID == nil || *song.ProUUID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Song does not have a ProPresenter UUID (pro_uuid)"})
	}

	// Get playlist UUID from settings
	settings, err := h.db.GetSettings()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve settings"})
	}

	// Use ProPresenter playlist UUID from settings, fallback to live_playlist_uuid
	playlistUUID := settings.ProPresenterPlaylistUUID
	if playlistUUID == "" || playlistUUID == "00000000-0000-0000-0000-000000000000" {
		playlistUUID = settings.LivePlaylistUUID
	}
	
	playlistName := req.PlaylistName
	if playlistName == "" {
		playlistName = settings.ProPresenterPlaylist
		if playlistName == "" {
			playlistName = "Live Queue"
		}
	}

	// If playlist UUID is default/empty, try to find playlist by name
	if (playlistUUID == "" || playlistUUID == "00000000-0000-0000-0000-000000000000") && playlistName != "" {
		playlists, err := h.propresenter.GetPlaylists()
		if err == nil {
			for _, pl := range playlists {
				if strings.EqualFold(pl.ID.Name, playlistName) {
					playlistUUID = pl.ID.UUID
					// Update settings with the found UUID
					updates := models.UpdateSettingsRequest{
						ProPresenterPlaylistUUID: &pl.ID.UUID,
					}
					h.db.UpdateSettings(&updates)
					break
				}
			}
		}
	}

	// Add song to playlist using pro_uuid
	err = h.propresenter.AddToPlaylist(playlistUUID, *song.ProUUID)
	if err != nil {
		log.Printf("Error adding song to ProPresenter playlist: %v", err)
		return c.Status(503).JSON(fiber.Map{
			"error":      "Failed to sync with ProPresenter",
			"message":    err.Error(),
			"song_title": song.Title,
			"playlist":   playlistName,
		})
	}

	uuid := *song.ProUUID

	// Apply theme if specified (ProPresenter API endpoint: PUT /v1/presentation/{uuid}/theme/{theme_uuid})
	// Note: Theme application requires theme UUID lookup - to be implemented if needed
	if req.ThemeName != "" {
		log.Printf("Theme application requested: %s (feature pending ProPresenter theme API integration)", req.ThemeName)
	}

	return c.JSON(fiber.Map{
		"success":      true,
		"message":      "Song added to ProPresenter playlist",
		"song_title":   song.Title,
		"playlist":     playlistName,
		"pp_item_uuid": uuid,
	})
}

// ProPresenterTrigger triggers a library item in ProPresenter
func (h *Handler) ProPresenterTrigger(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	var req struct {
		UUID      string `json:"uuid"`
		SongTitle string `json:"song_title"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	uuid := req.UUID
	
	// If no UUID, try to find by title
	if uuid == "" && req.SongTitle != "" {
		item, err := h.propresenter.FindSongByTitle(req.SongTitle)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Song not found in ProPresenter library"})
		}
		uuid = item.ID.UUID
	}

	if uuid == "" {
		return c.Status(400).JSON(fiber.Map{"error": "uuid or song_title is required"})
	}

	if err := h.propresenter.TriggerLibraryItem(uuid); err != nil {
		log.Printf("Error triggering ProPresenter item: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Song triggered in ProPresenter",
		"uuid":    uuid,
	})
}

// ProPresenterNextSlide advances to the next slide
func (h *Handler) ProPresenterNextSlide(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	if err := h.propresenter.TriggerNextSlide(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Advanced to next slide"})
}

// ProPresenterPreviousSlide goes to the previous slide
func (h *Handler) ProPresenterPreviousSlide(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	if err := h.propresenter.TriggerPreviousSlide(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Went to previous slide"})
}

// ProPresenterClear clears a layer in ProPresenter
func (h *Handler) ProPresenterClear(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	layer := c.Query("layer", "slide")
	
	if err := h.propresenter.ClearLayer(layer); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"success": true, "message": "Layer cleared", "layer": layer})
}

// ============ Settings Handlers ============

// GetSettings retrieves the current settings
func (h *Handler) GetSettings(c *fiber.Ctx) error {
	settings, err := h.db.GetSettings()
	if err != nil {
		log.Printf("Error getting settings: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve settings"})
	}

	return c.JSON(settings)
}

// UpdateSettings updates the settings
func (h *Handler) UpdateSettings(c *fiber.Ctx) error {
	var req models.UpdateSettingsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	settings, err := h.db.UpdateSettings(&req)
	if err != nil {
		log.Printf("Error updating settings: %v", err)
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to update settings",
			"details": err.Error(),
		})
	}

	// Reconfigure ProPresenter client with new settings
	if h.propresenter != nil {
		if settings.ProPresenterHost != "" && settings.ProPresenterPort > 0 {
			ppConfig := &propresenter.Config{
				Host:       settings.ProPresenterHost,
				Port:       fmt.Sprintf("%d", settings.ProPresenterPort),
				Enabled:    true,
				PlaylistID: settings.ProPresenterPlaylist,
			}
			if err := h.propresenter.Reconfigure(ppConfig); err != nil {
				log.Printf("Warning: Failed to reconfigure ProPresenter: %v", err)
			} else {
				if h.propresenter.IsConnected() {
					log.Printf("✅ ProPresenter reconfigured and connected: %s:%d", settings.ProPresenterHost, settings.ProPresenterPort)
				} else {
					log.Printf("⚠️  ProPresenter reconfigured but not connected: %s:%d", settings.ProPresenterHost, settings.ProPresenterPort)
				}
			}
		} else {
			// Disable if settings are empty
			h.propresenter.Reconfigure(nil)
		}
	}

	return c.JSON(settings)
}

// ============ Queue Handlers ============

// GetQueue returns all items in the queue
func (h *Handler) GetQueue(c *fiber.Ctx) error {
	items, err := h.db.GetQueue()
	if err != nil {
		log.Printf("Error getting queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve queue"})
	}

	return c.JSON(items)
}

// AddToQueue adds a song to the queue
func (h *Handler) AddToQueue(c *fiber.Ctx) error {
	var req models.AddToQueueRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.SongID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "song_id is required"})
	}

	// Verify song exists
	_, err := h.db.GetSong(req.SongID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
	}

	item, err := h.db.AddToQueue(req.SongID)
	if err != nil {
		if err.Error() == "song already in queue" {
			return c.Status(409).JSON(fiber.Map{"error": "Song already in queue"})
		}
		log.Printf("Error adding to queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add song to queue"})
	}

	return c.Status(201).JSON(item)
}

// RemoveFromQueue removes an item from the queue by queue item ID
func (h *Handler) RemoveFromQueue(c *fiber.Ctx) error {
	idStr := c.Params("id")
	if idStr == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ID is required"})
	}

	var id int
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid ID format"})
	}

	err := h.db.RemoveFromQueue(id)
	if err != nil {
		if err.Error() == "queue item not found" {
			return c.Status(404).JSON(fiber.Map{"error": "Queue item not found"})
		}
		log.Printf("Error removing from queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove item from queue"})
	}

	return c.JSON(fiber.Map{"message": "Item removed from queue successfully"})
}

// RemoveFromQueueBySong removes an item from the queue by song ID
func (h *Handler) RemoveFromQueueBySong(c *fiber.Ctx) error {
	songID := c.Params("song_id")
	if songID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "song_id is required"})
	}

	err := h.db.RemoveFromQueueBySongID(songID)
	if err != nil {
		if err.Error() == "song not in queue" {
			return c.Status(404).JSON(fiber.Map{"error": "Song not in queue"})
		}
		log.Printf("Error removing from queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to remove song from queue"})
	}

	return c.JSON(fiber.Map{"message": "Song removed from queue successfully"})
}

// ReorderQueue updates the positions of queue items
func (h *Handler) ReorderQueue(c *fiber.Ctx) error {
	var req models.ReorderQueueRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if len(req.Items) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "items array is required"})
	}

	err := h.db.ReorderQueue(req.Items)
	if err != nil {
		log.Printf("Error reordering queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to reorder queue"})
	}

	return c.JSON(fiber.Map{"message": "Queue reordered successfully"})
}

// ClearQueue removes all items from the queue
func (h *Handler) ClearQueue(c *fiber.Ctx) error {
	err := h.db.ClearQueue()
	if err != nil {
		log.Printf("Error clearing queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to clear queue"})
	}

	return c.JSON(fiber.Map{"message": "Queue cleared successfully"})
}
