package handlers

import (
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
	if req.Title == "" || req.Lyrics == "" || req.Language == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title, lyrics, and language are required"})
	}

	// Create in database
	song, err := h.db.CreateSong(&req)
	if err != nil {
		log.Printf("Error creating song: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create song"})
	}

	// Index in Typesense (skip if skipTypesense is enabled)
	if !h.skipTypesense {
		if err := h.ts.IndexSong(song); err != nil {
			log.Printf("Error indexing song in Typesense: %v", err)
			// Don't fail the request, just log the error
		}
	}

	// Check backup threshold
	count, _ := h.db.GetEditCount()
	if err := h.backupManager.CheckEditThreshold(count); err != nil {
		log.Printf("Error checking backup threshold: %v", err)
	}

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
	if err := h.ts.IndexSong(song); err != nil {
		log.Printf("Error updating song in Typesense: %v", err)
	}

	// Check backup threshold
	count, _ := h.db.GetEditCount()
	if err := h.backupManager.CheckEditThreshold(count); err != nil {
		log.Printf("Error checking backup threshold: %v", err)
	}

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
	if err := h.ts.DeleteSong(id); err != nil {
		log.Printf("Error deleting song from Typesense: %v", err)
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

	err := h.propresenter.Health()
	if err != nil {
		return c.JSON(fiber.Map{
			"enabled":   true,
			"connected": false,
			"message":   err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"enabled":   true,
		"connected": true,
		"message":   "ProPresenter is connected",
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

// ProPresenterSendToQueue sends a song to the ProPresenter "Live Queue" playlist
func (h *Handler) ProPresenterSendToQueue(c *fiber.Ctx) error {
	if h.propresenter == nil || !h.propresenter.IsEnabled() {
		return c.Status(503).JSON(fiber.Map{"error": "ProPresenter integration is not enabled"})
	}

	var req struct {
		SongID       string `json:"song_id"`
		SongTitle    string `json:"song_title"`
		PlaylistName string `json:"playlist_name"` // optional, defaults to "Live Queue"
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// If song_id provided, fetch title from database
	songTitle := req.SongTitle
	if songTitle == "" && req.SongID != "" {
		song, err := h.db.GetSong(req.SongID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Song not found"})
		}
		songTitle = song.Title
	}

	if songTitle == "" {
		return c.Status(400).JSON(fiber.Map{"error": "song_title or song_id is required"})
	}

	playlistName := req.PlaylistName
	if playlistName == "" {
		playlistName = "Live Queue"
	}

	uuid, err := h.propresenter.SendToLiveQueue(songTitle, playlistName)
	if err != nil {
		log.Printf("Error sending to ProPresenter queue: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"success":      true,
		"message":      "Song added to ProPresenter playlist",
		"song_title":   songTitle,
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
