package propresenter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Client handles communication with ProPresenter API
type Client struct {
	baseURL    string
	httpClient *http.Client
	enabled    bool
	config     *Config
	connected  bool
	lastCheck  time.Time
	mu         sync.RWMutex
}

// Config holds ProPresenter configuration
type Config struct {
	Host       string // e.g., "localhost" or "192.168.1.100"
	Port       string // e.g., "1025"
	Enabled    bool
	PlaylistID string // The playlist to add songs to (optional, uses "Live Queue" by default)
}

// LibraryItem represents a ProPresenter library item
type LibraryItem struct {
	ID   LibraryItemID `json:"id"`
	Type string        `json:"type"`
}

// LibraryItemID represents the nested ID structure
type LibraryItemID struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Playlist represents a ProPresenter playlist
type Playlist struct {
	ID    PlaylistID `json:"id"`
	Items []PlaylistItem `json:"items,omitempty"`
}

// PlaylistID represents playlist identification
type PlaylistID struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// PlaylistItem represents an item in a playlist
type PlaylistItem struct {
	ID           PlaylistItemID `json:"id"`
	Type         string         `json:"type"`
	IsHidden     bool           `json:"is_hidden"`
	IsEnabled    bool           `json:"is_enabled"`
}

// PlaylistItemID represents playlist item identification
type PlaylistItemID struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Presentation represents a ProPresenter presentation
type Presentation struct {
	ID     PresentationID  `json:"id"`
	Groups []SlideGroup    `json:"groups,omitempty"`
}

// PresentationID represents presentation identification
type PresentationID struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

// SlideGroup represents a group of slides (verse, chorus, etc.)
type SlideGroup struct {
	Name   string  `json:"name"`
	Color  string  `json:"color"`
	Slides []Slide `json:"slides"`
}

// Slide represents a single slide
type Slide struct {
	Enabled bool   `json:"enabled"`
	Notes   string `json:"notes"`
	Text    string `json:"text"`
}

// SearchResult holds library search results
type SearchResult struct {
	Items []LibraryItem `json:"items"`
}

// New creates a new ProPresenter client
func New(config *Config) *Client {
	if config == nil || !config.Enabled {
		return &Client{enabled: false}
	}

	baseURL := fmt.Sprintf("http://%s:%s", config.Host, config.Port)
	
	client := &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 5 * time.Second, // Shorter timeout for production
			Transport: &http.Transport{
				MaxIdleConns:        10,
				MaxIdleConnsPerHost:  5,
				IdleConnTimeout:      30 * time.Second,
				DisableKeepAlives:    false,
				ResponseHeaderTimeout: 3 * time.Second,
			},
		},
		enabled:   true,
		config:    config,
		connected: false,
	}
	
	// Check connection on initialization
	if err := client.Health(); err == nil {
		client.mu.Lock()
		client.connected = true
		client.lastCheck = time.Now()
		client.mu.Unlock()
	}
	
	return client
}

// Reconfigure updates the client configuration and checks connection
func (c *Client) Reconfigure(config *Config) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if config == nil || !config.Enabled || config.Host == "" {
		c.enabled = false
		c.connected = false
		return nil
	}
	
	c.config = config
	c.baseURL = fmt.Sprintf("http://%s:%s", config.Host, config.Port)
	c.enabled = true
	
	// Check connection with new configuration
	if err := c.healthCheckLocked(); err == nil {
		c.connected = true
		c.lastCheck = time.Now()
	} else {
		c.connected = false
	}
	
	return nil
}

// IsConnected returns whether ProPresenter is currently connected
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// healthCheckLocked performs health check without acquiring lock (must be called with lock held)
func (c *Client) healthCheckLocked() error {
	resp, err := c.httpClient.Get(c.baseURL + "/v1/status")
	if err != nil {
		return fmt.Errorf("ProPresenter not reachable: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ProPresenter returned status %d", resp.StatusCode)
	}
	
	return nil
}

// StartPeriodicHealthCheck starts a goroutine that checks ProPresenter health periodically
func (c *Client) StartPeriodicHealthCheck(interval time.Duration) {
	if !c.enabled {
		return
	}
	
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		
		for range ticker.C {
			c.mu.Lock()
			if err := c.healthCheckLocked(); err == nil {
				c.connected = true
				c.lastCheck = time.Now()
			} else {
				c.connected = false
			}
			c.mu.Unlock()
		}
	}()
}

// IsEnabled returns whether ProPresenter integration is enabled
func (c *Client) IsEnabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.enabled
}

// GetLibrary fetches all library items from ProPresenter
func (c *Client) GetLibrary() ([]LibraryItem, error) {
	if !c.enabled {
		return nil, fmt.Errorf("ProPresenter integration is not enabled")
	}

	resp, err := c.httpClient.Get(c.baseURL + "/v1/library")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch library: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var items []LibraryItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("failed to decode library: %w", err)
	}

	return items, nil
}

// SearchLibrary searches the library by name
func (c *Client) SearchLibrary(query string) ([]LibraryItem, error) {
	if !c.enabled {
		return nil, fmt.Errorf("ProPresenter integration is not enabled")
	}

	encodedQuery := url.QueryEscape(query)
	resp, err := c.httpClient.Get(c.baseURL + "/v1/library?q=" + encodedQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to search library: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var items []LibraryItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, fmt.Errorf("failed to decode search results: %w", err)
	}

	return items, nil
}

// FindSongByTitle searches for a song by exact title match
func (c *Client) FindSongByTitle(title string) (*LibraryItem, error) {
	items, err := c.SearchLibrary(title)
	if err != nil {
		return nil, err
	}

	// Look for exact match (case-insensitive)
	titleLower := strings.ToLower(strings.TrimSpace(title))
	for _, item := range items {
		if strings.ToLower(strings.TrimSpace(item.ID.Name)) == titleLower {
			return &item, nil
		}
	}

	// If no exact match, return first result if available
	if len(items) > 0 {
		return &items[0], nil
	}

	return nil, fmt.Errorf("song not found: %s", title)
}

// GetPlaylists fetches all playlists
func (c *Client) GetPlaylists() ([]Playlist, error) {
	if !c.enabled {
		return nil, fmt.Errorf("ProPresenter integration is not enabled")
	}

	resp, err := c.httpClient.Get(c.baseURL + "/v1/playlists")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch playlists: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var playlists []Playlist
	if err := json.NewDecoder(resp.Body).Decode(&playlists); err != nil {
		return nil, fmt.Errorf("failed to decode playlists: %w", err)
	}

	return playlists, nil
}

// FindOrCreatePlaylist finds a playlist by name or creates it
func (c *Client) FindOrCreatePlaylist(name string) (*Playlist, error) {
	playlists, err := c.GetPlaylists()
	if err != nil {
		return nil, err
	}

	// Look for existing playlist
	nameLower := strings.ToLower(strings.TrimSpace(name))
	for _, pl := range playlists {
		if strings.ToLower(strings.TrimSpace(pl.ID.Name)) == nameLower {
			return &pl, nil
		}
	}

	// Create new playlist
	return c.CreatePlaylist(name)
}

// CreatePlaylist creates a new playlist
func (c *Client) CreatePlaylist(name string) (*Playlist, error) {
	if !c.enabled {
		return nil, fmt.Errorf("ProPresenter integration is not enabled")
	}

	payload := map[string]string{"name": name}
	body, _ := json.Marshal(payload)

	resp, err := c.httpClient.Post(c.baseURL+"/v1/playlists", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create playlist: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to create playlist, status %d: %s", resp.StatusCode, string(respBody))
	}

	var playlist Playlist
	if err := json.NewDecoder(resp.Body).Decode(&playlist); err != nil {
		// Some versions don't return the created playlist, fetch it
		return c.FindOrCreatePlaylist(name)
	}

	return &playlist, nil
}

// AddToPlaylist adds a library item to a playlist using PUT method
// Format: [{"id":{"uuid":"..."},"type":"presentation"}]
func (c *Client) AddToPlaylist(playlistUUID, libraryItemUUID string) error {
	if !c.enabled {
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	// ProPresenter API: PUT /v1/playlist/{playlist_id}
	endpoint := fmt.Sprintf("%s/v1/playlist/%s", c.baseURL, playlistUUID)
	
	// Use the format: [{"id":{"uuid":"..."},"type":"presentation"}]
	payload := []map[string]interface{}{
		{
			"id": map[string]string{
				"uuid": libraryItemUUID,
			},
			"type": "presentation",
		},
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to add to playlist: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusNoContent {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to add to playlist, status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// TriggerLibraryItem triggers a library item to be displayed
func (c *Client) TriggerLibraryItem(uuid string) error {
	if !c.enabled {
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	endpoint := fmt.Sprintf("%s/v1/trigger/library/%s", c.baseURL, uuid)
	
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to trigger library item: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to trigger library item, status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// TriggerNextSlide advances to the next slide
func (c *Client) TriggerNextSlide() error {
	if !c.enabled {
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	resp, err := c.httpClient.Get(c.baseURL + "/v1/trigger/next")
	if err != nil {
		return fmt.Errorf("failed to trigger next slide: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// TriggerPreviousSlide goes to the previous slide
func (c *Client) TriggerPreviousSlide() error {
	if !c.enabled {
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	resp, err := c.httpClient.Get(c.baseURL + "/v1/trigger/previous")
	if err != nil {
		return fmt.Errorf("failed to trigger previous slide: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// ClearLayer clears a specific layer
func (c *Client) ClearLayer(layer string) error {
	if !c.enabled {
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	endpoint := fmt.Sprintf("%s/v1/clear/layer/%s", c.baseURL, layer)
	
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to clear layer: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// CreatePresentation creates a new presentation in ProPresenter with the given lyrics
func (c *Client) CreatePresentation(title string, lyrics string) (*LibraryItem, error) {
	if !c.enabled {
		return nil, fmt.Errorf("ProPresenter integration is not enabled")
	}

	// Split lyrics into slides (by double newline or paragraph breaks)
	lines := strings.Split(lyrics, "\n\n")
	if len(lines) == 1 {
		// If no double newlines, split by single newlines
		lines = strings.Split(lyrics, "\n")
	}

	// Create slide groups - one group with all slides
	slides := make([]Slide, 0)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			slides = append(slides, Slide{
				Enabled: true,
				Text:    line,
				Notes:   "",
			})
		}
	}

	if len(slides) == 0 {
		return nil, fmt.Errorf("no valid slides created from lyrics")
	}

	// Create presentation structure
	presentation := Presentation{
		ID: PresentationID{
			UUID: "",
			Name: title,
		},
		Groups: []SlideGroup{
			{
				Name:   "Lyrics",
				Color:  "",
				Slides: slides,
			},
		},
	}

	bodyBytes, err := json.Marshal(presentation)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal presentation: %w", err)
	}

	// POST to create presentation
	resp, err := c.httpClient.Post(c.baseURL+"/v1/presentation", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create presentation: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to create presentation, status %d: %s", resp.StatusCode, string(respBody))
	}

	// ProPresenter may not return the created presentation in response
	// So we need to search for it by name after creation
	// Wait a brief moment for ProPresenter to index it
	time.Sleep(500 * time.Millisecond)
	
	// Try to find the presentation we just created by searching for it
	var item *LibraryItem
	// err is already declared above, so we use = instead of :=
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		item, err = c.FindSongByTitle(title)
		if err == nil {
			return item, nil
		}
	}
	
	// If we still can't find it, try decoding the response (some versions might return it)
	resp.Body.Close()
	resp, err = c.httpClient.Get(c.baseURL + "/v1/library?q=" + url.QueryEscape(title))
	if err == nil {
		defer resp.Body.Close()
		var items []LibraryItem
		if json.NewDecoder(resp.Body).Decode(&items) == nil && len(items) > 0 {
			// Find exact match
			for _, it := range items {
				if strings.EqualFold(strings.TrimSpace(it.ID.Name), strings.TrimSpace(title)) {
					return &it, nil
				}
			}
		}
	}
	
	return nil, fmt.Errorf("created presentation but couldn't find it: %w", err)
}

// SendToLiveQueue finds an existing song in the library and adds it to the playlist
// Returns the library item UUID
// Includes retry logic for production resilience
func (c *Client) SendToLiveQueue(songTitle string, playlistName string, lyrics string) (string, error) {
	if !c.enabled {
		return "", fmt.Errorf("ProPresenter integration is not enabled")
	}

	if playlistName == "" {
		playlistName = "Live Queue"
	}

	if songTitle == "" {
		return "", fmt.Errorf("song title is required")
	}

	var item *LibraryItem
	var playlist *Playlist
	var err error

	// Find existing song in library (no presentation creation)
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		item, err = c.FindSongByTitle(songTitle)
		if err == nil {
			break
		}
	}
	if err != nil {
		return "", fmt.Errorf("song '%s' not found in ProPresenter library: %w", songTitle, err)
	}

	// Retry finding/creating playlist
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		playlist, err = c.FindOrCreatePlaylist(playlistName)
		if err == nil {
			break
		}
	}
	if err != nil {
		return "", fmt.Errorf("failed to get/create playlist: %w", err)
	}

	// Retry adding to playlist
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		err = c.AddToPlaylist(playlist.ID.UUID, item.ID.UUID)
		if err == nil {
			return item.ID.UUID, nil
		}
	}

	return "", fmt.Errorf("failed to add to playlist after retries: %w", err)
}

// Health checks if ProPresenter is reachable with retry logic
// Updates the connected state
func (c *Client) Health() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	
	if !c.enabled {
		c.connected = false
		return fmt.Errorf("ProPresenter integration is not enabled")
	}

	// Retry up to 2 times for production resilience
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(500 * time.Millisecond) // Brief delay between retries
		}

		if err := c.healthCheckLocked(); err != nil {
			lastErr = err
			continue
		}
		
		// Success
		c.connected = true
		c.lastCheck = time.Now()
		return nil
	}

	// Failed after retries
	c.connected = false
	return lastErr
}




