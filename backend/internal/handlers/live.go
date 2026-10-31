package handlers

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

// Live scripture state shared between the control UI and output pages
// (e.g. the Resolume-captured /output/bible page). Server-side because the
// output browser usually runs on a different machine than the operator, so
// BroadcastChannel/localStorage cannot carry it.

// LiveScriptureColumn is one translation's rendering of the current passage.
type LiveScriptureColumn struct {
	Abbreviation string `json:"abbreviation"`
	Reference    string `json:"reference"`
	Content      string `json:"content"` // "[n] text ..." format
	Indic        bool   `json:"indic"`   // taller line boxes for Indic scripts
}

// LiveScripture is the currently displayed passage, or hidden when !Visible.
type LiveScripture struct {
	Columns   []LiveScriptureColumn `json:"columns"`
	Visible   bool                  `json:"visible"`
	UpdatedAt int64                 `json:"updated_at"` // unix millis, for cheap change detection
}

// OutputConfig is the operator-adjustable layout of the Resolume/OBS capture
// page (/output/bible): frosted-box blur and how much of each side panel the
// box fills. Persisted in the DB so it survives restarts and is shared across
// machines. Set by media/admin, read publicly by the capture page.
type OutputConfig struct {
	Blur      int     `json:"blur"`       // backdrop blur radius in px
	BoxWpx    int     `json:"box_w_px"`   // box width in px; 0 = fill the side panel
	BoxHpx    int     `json:"box_h_px"`   // box height in px; 0 = fill the IMAG band
	TextScale float64 `json:"text_scale"` // 0.5..1.0 — text auto-fits the box, so this can only pull it back
	Layout    string  `json:"layout"`     // "imag" (boxes flank a free centre) or "fullscreen" (boxes split the full width)
	UpdatedAt int64   `json:"updated_at"` // unix millis
}

func defaultOutputConfig() OutputConfig {
	return OutputConfig{Blur: 14, BoxWpx: 0, BoxHpx: 0, TextScale: 1.0, Layout: "imag", UpdatedAt: 0}
}

func clampf(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampi(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampOutputConfig(cfg OutputConfig) OutputConfig {
	cfg.Blur = clampi(cfg.Blur, 0, 60)
	cfg.BoxWpx = clampi(cfg.BoxWpx, 0, 6000) // 0 = auto
	cfg.BoxHpx = clampi(cfg.BoxHpx, 0, 6000)
	// Text auto-fits its box; the operator scale only shrinks from that.
	cfg.TextScale = clampf(cfg.TextScale, 0.5, 1.0)
	// Only "fullscreen" is a recognised alternative; anything else (including
	// missing/legacy values) falls back to the IMAG layout.
	l := strings.ToLower(strings.TrimSpace(cfg.Layout))
	if l != "fullscreen" {
		l = "imag"
	}
	cfg.Layout = l
	return cfg
}

type liveState struct {
	mu        sync.RWMutex
	scripture LiveScripture
}

var live liveState

// GetLiveScripture returns the current live scripture state.
// GET /api/live/scripture
func (h *Handler) GetLiveScripture(c *fiber.Ctx) error {
	live.mu.RLock()
	defer live.mu.RUnlock()
	return c.JSON(live.scripture)
}

// SetLiveScripture replaces the live scripture and marks it visible.
// POST /api/live/scripture
func (h *Handler) SetLiveScripture(c *fiber.Ctx) error {
	var req struct {
		Columns []LiveScriptureColumn `json:"columns"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if len(req.Columns) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "At least one column is required"})
	}

	live.mu.Lock()
	live.scripture = LiveScripture{
		Columns:   req.Columns,
		Visible:   true,
		UpdatedAt: time.Now().UnixMilli(),
	}
	state := live.scripture
	live.mu.Unlock()

	return c.JSON(state)
}

// ClearLiveScripture hides the live scripture.
// DELETE /api/live/scripture
func (h *Handler) ClearLiveScripture(c *fiber.Ctx) error {
	live.mu.Lock()
	live.scripture = LiveScripture{
		Visible:   false,
		UpdatedAt: time.Now().UnixMilli(),
	}
	state := live.scripture
	live.mu.Unlock()

	return c.JSON(state)
}

// GetOutputConfig returns the wall-output layout config (public — read by the
// capture page). GET /api/live/output-config
func (h *Handler) GetOutputConfig(c *fiber.Ctx) error {
	blur, boxWpx, boxHpx, textScale, layout, updatedAt, err := h.db.GetOutputConfig()
	if err != nil {
		return c.JSON(defaultOutputConfig())
	}
	return c.JSON(clampOutputConfig(OutputConfig{Blur: blur, BoxWpx: boxWpx, BoxHpx: boxHpx, TextScale: textScale, Layout: layout, UpdatedAt: updatedAt}))
}

// SetOutputConfig updates the wall-output layout (media/admin only).
// PUT /api/live/output-config
func (h *Handler) SetOutputConfig(c *fiber.Ctx) error {
	if role, _ := c.Locals("role").(string); role != "media" && role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Media or admin access required"})
	}
	var req struct {
		Blur      int     `json:"blur"`
		BoxWpx    int     `json:"box_w_px"`
		BoxHpx    int     `json:"box_h_px"`
		TextScale float64 `json:"text_scale"`
		Layout    string  `json:"layout"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	cfg := clampOutputConfig(OutputConfig{Blur: req.Blur, BoxWpx: req.BoxWpx, BoxHpx: req.BoxHpx, TextScale: req.TextScale, Layout: req.Layout, UpdatedAt: time.Now().UnixMilli()})
	if err := h.db.SetOutputConfig(cfg.Blur, cfg.BoxWpx, cfg.BoxHpx, cfg.TextScale, cfg.Layout, cfg.UpdatedAt); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save output config"})
	}
	return c.JSON(cfg)
}

// --- Wall layout presets ---

// normalizeWallPreset validates a preset name (trimmed, 1..60 runes) and
// clamps the config values the same way as the live output config.
func normalizeWallPreset(name string, cfg OutputConfig) (string, OutputConfig, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", cfg, errors.New("name is required")
	}
	if utf8.RuneCountInString(name) > 60 {
		return "", cfg, errors.New("name must be 60 characters or fewer")
	}
	return name, clampOutputConfig(cfg), nil
}

// ListWallPresets returns the saved wall layout presets.
// GET /api/live/wall-presets
func (h *Handler) ListWallPresets(c *fiber.Ctx) error {
	presets, err := h.db.ListWallPresets()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to load wall presets"})
	}
	return c.JSON(presets)
}

// SaveWallPreset creates or overwrites (by name) a wall preset (media/admin only).
// POST /api/live/wall-presets
func (h *Handler) SaveWallPreset(c *fiber.Ctx) error {
	if role, _ := c.Locals("role").(string); role != "media" && role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Media or admin access required"})
	}
	var req struct {
		Name      string  `json:"name"`
		Layout    string  `json:"layout"`
		Blur      int     `json:"blur"`
		BoxWpx    int     `json:"box_w_px"`
		BoxHpx    int     `json:"box_h_px"`
		TextScale float64 `json:"text_scale"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	name, cfg, err := normalizeWallPreset(req.Name, OutputConfig{Blur: req.Blur, BoxWpx: req.BoxWpx, BoxHpx: req.BoxHpx, TextScale: req.TextScale, Layout: req.Layout})
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	preset, err := h.db.UpsertWallPreset(name, cfg.Layout, cfg.Blur, cfg.BoxWpx, cfg.BoxHpx, cfg.TextScale)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save wall preset"})
	}
	return c.JSON(preset)
}

// DeleteWallPreset deletes a custom wall preset (media/admin only). Built-ins
// cannot be deleted. DELETE /api/live/wall-presets/:id
func (h *Handler) DeleteWallPreset(c *fiber.Ctx) error {
	if role, _ := c.Locals("role").(string); role != "media" && role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Media or admin access required"})
	}
	id, err := c.ParamsInt("id")
	if err != nil || id <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid preset id"})
	}
	found, builtin, err := h.db.DeleteWallPreset(id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete wall preset"})
	}
	if !found {
		return c.Status(404).JSON(fiber.Map{"error": "Preset not found"})
	}
	if builtin {
		return c.Status(400).JSON(fiber.Map{"error": "Built-in presets cannot be deleted"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// DisplayConfig is site-wide lyric display preferences shared by every
// machine (unlike localStorage prefs which are per-device).
type DisplayConfig struct {
	LineSpacing      float64 `json:"line_spacing"`
	ParagraphSpacing float64 `json:"paragraph_spacing"` // multiplier on the blank-line gap between sections
	UpdatedAt        int64   `json:"updated_at"`
}

// GetDisplayConfig returns site-wide display prefs. GET /api/display-config
func (h *Handler) GetDisplayConfig(c *fiber.Ctx) error {
	ls, ps, updatedAt, err := h.db.GetDisplayConfig()
	if err != nil {
		return c.JSON(DisplayConfig{LineSpacing: 1.6, ParagraphSpacing: 1.0, UpdatedAt: 0})
	}
	return c.JSON(DisplayConfig{LineSpacing: ls, ParagraphSpacing: ps, UpdatedAt: updatedAt})
}

// SetDisplayConfig updates site-wide display prefs (any signed-in role).
// PUT /api/display-config
func (h *Handler) SetDisplayConfig(c *fiber.Ctx) error {
	var req struct {
		LineSpacing      float64 `json:"line_spacing"`
		ParagraphSpacing float64 `json:"paragraph_spacing"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	cfg := DisplayConfig{
		LineSpacing:      clampf(req.LineSpacing, 0.6, 2.6),
		ParagraphSpacing: clampf(req.ParagraphSpacing, 0, 3.0),
		UpdatedAt:        time.Now().UnixMilli(),
	}
	if err := h.db.SetDisplayConfig(cfg.LineSpacing, cfg.ParagraphSpacing, cfg.UpdatedAt); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save display config"})
	}
	return c.JSON(cfg)
}

// --- Verse suggestions: media team proposes, worship team accepts ---

type liveSuggestion struct {
	Reference string   `json:"reference"`
	From      string   `json:"from"`
	Bibles    []string `json:"bibles,omitempty"`
	// Passage is the language-neutral reference ("JHN 3:16-18", USFM book
	// id) the other side navigates by; Reference is only for display.
	Passage   string `json:"passage,omitempty"`
	UpdatedAt int64  `json:"updated_at"`
}

var suggestionState struct {
	mu sync.RWMutex
	s  liveSuggestion
}

// GET /api/live/suggestion
func (h *Handler) GetLiveSuggestion(c *fiber.Ctx) error {
	suggestionState.mu.RLock()
	defer suggestionState.mu.RUnlock()
	return c.JSON(suggestionState.s)
}

// POST /api/live/suggestion
func (h *Handler) SetLiveSuggestion(c *fiber.Ctx) error {
	var req struct {
		Reference string   `json:"reference"`
		From      string   `json:"from"`
		Bibles    []string `json:"bibles"`
		Passage   string   `json:"passage"`
	}
	if err := c.BodyParser(&req); err != nil || req.Reference == "" {
		return c.Status(400).JSON(fiber.Map{"error": "reference is required"})
	}
	suggestionState.mu.Lock()
	suggestionState.s = liveSuggestion{Reference: req.Reference, From: req.From, Bibles: req.Bibles, Passage: req.Passage, UpdatedAt: time.Now().UnixMilli()}
	out := suggestionState.s
	suggestionState.mu.Unlock()
	return c.JSON(out)
}

// --- Song pings: phone viewer points other accounts at a song ---
//
// Deliberately separate from suggestionState: suggestions drive the Bible
// panel / mirror flow, pings only raise a banner in other control windows.

type songPing struct {
	ID        string `json:"id,omitempty"`
	SongID    string `json:"song_id,omitempty"`
	Title     string `json:"title,omitempty"`
	FromRole  string `json:"from_role,omitempty"`
	FromUser  string `json:"from_user,omitempty"`
	CreatedAt int64  `json:"created_at,omitempty"`
}

const (
	songPingTTL      = 120 * time.Second
	songPingMinGap   = 3 * time.Second
	songPingMaxTitle = 200
	songPingMaxID    = 64
)

// validateSongPing trims and checks the client-supplied fields. Titles are
// truncated rune-safely (Malayalam etc.) rather than rejected.
func validateSongPing(songID, title string) (string, string, error) {
	songID = strings.TrimSpace(songID)
	title = strings.TrimSpace(title)
	if songID == "" {
		return "", "", errors.New("song_id is required")
	}
	if len(songID) > songPingMaxID {
		return "", "", errors.New("song_id is too long")
	}
	if title == "" {
		return "", "", errors.New("title is required")
	}
	if utf8.RuneCountInString(title) > songPingMaxTitle {
		title = string([]rune(title)[:songPingMaxTitle])
	}
	return songID, title, nil
}

// songPingFresh reports whether p is set and younger than songPingTTL.
func songPingFresh(p songPing, now time.Time) bool {
	return p.CreatedAt > 0 && now.Sub(time.UnixMilli(p.CreatedAt)) <= songPingTTL
}

// visibleSongPing hides stale pings and the viewer's own pings.
func visibleSongPing(p songPing, viewer string, now time.Time) songPing {
	if !songPingFresh(p, now) || p.FromUser == viewer {
		return songPing{}
	}
	return p
}

// songPingLimiter enforces songPingMinGap between pings per user.
type songPingLimiter struct {
	last map[string]time.Time
}

func (l *songPingLimiter) allow(user string, now time.Time) bool {
	if l.last == nil {
		l.last = make(map[string]time.Time)
	}
	if prev, ok := l.last[user]; ok && now.Sub(prev) < songPingMinGap {
		return false
	}
	for u, t := range l.last {
		if now.Sub(t) > songPingTTL {
			delete(l.last, u)
		}
	}
	l.last[user] = now
	return true
}

var songPingState struct {
	mu  sync.Mutex
	p   songPing
	seq int64
	lim songPingLimiter
}

// GET /api/live/song-ping — latest fresh ping not sent by the caller.
func (h *Handler) GetSongPing(c *fiber.Ctx) error {
	username, _ := c.Locals("username").(string)
	songPingState.mu.Lock()
	p := songPingState.p
	songPingState.mu.Unlock()
	return c.JSON(visibleSongPing(p, username, time.Now()))
}

// POST /api/live/song-ping — sender identity comes from auth, never the body.
func (h *Handler) SendSongPing(c *fiber.Ctx) error {
	var req struct {
		SongID string `json:"song_id"`
		Title  string `json:"title"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	songID, title, err := validateSongPing(req.SongID, req.Title)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	role, _ := c.Locals("role").(string)
	username, _ := c.Locals("username").(string)
	if username == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Not signed in"})
	}
	now := time.Now()
	songPingState.mu.Lock()
	defer songPingState.mu.Unlock()
	if !songPingState.lim.allow(username, now) {
		return c.Status(429).JSON(fiber.Map{"error": "Wait a moment before notifying again", "code": "rate_limited"})
	}
	songPingState.seq++
	songPingState.p = songPing{
		ID:        fmt.Sprintf("%d-%d", now.UnixMilli(), songPingState.seq),
		SongID:    songID,
		Title:     title,
		FromRole:  role,
		FromUser:  username,
		CreatedAt: now.UnixMilli(),
	}
	return c.JSON(songPingState.p)
}
