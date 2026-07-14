package handlers

import (
	"sync"
	"time"

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
	BoxScale  float64 `json:"box_scale"`  // 0.5..1.0 fraction of the panel the box fills
	UpdatedAt int64   `json:"updated_at"` // unix millis
}

func defaultOutputConfig() OutputConfig {
	return OutputConfig{Blur: 14, BoxScale: 1.0, UpdatedAt: 0}
}

func clampOutputConfig(cfg OutputConfig) OutputConfig {
	if cfg.Blur < 0 {
		cfg.Blur = 0
	}
	if cfg.Blur > 60 {
		cfg.Blur = 60
	}
	if cfg.BoxScale < 0.5 {
		cfg.BoxScale = 0.5
	}
	if cfg.BoxScale > 1.0 {
		cfg.BoxScale = 1.0
	}
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
	blur, boxScale, updatedAt, err := h.db.GetOutputConfig()
	if err != nil {
		return c.JSON(defaultOutputConfig())
	}
	return c.JSON(clampOutputConfig(OutputConfig{Blur: blur, BoxScale: boxScale, UpdatedAt: updatedAt}))
}

// SetOutputConfig updates the wall-output layout (media/admin only).
// PUT /api/live/output-config
func (h *Handler) SetOutputConfig(c *fiber.Ctx) error {
	if role, _ := c.Locals("role").(string); role != "media" && role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Media or admin access required"})
	}
	var req struct {
		Blur     int     `json:"blur"`
		BoxScale float64 `json:"box_scale"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	cfg := clampOutputConfig(OutputConfig{Blur: req.Blur, BoxScale: req.BoxScale, UpdatedAt: time.Now().UnixMilli()})
	if err := h.db.SetOutputConfig(cfg.Blur, cfg.BoxScale, cfg.UpdatedAt); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save output config"})
	}
	return c.JSON(cfg)
}

// --- Verse suggestions: media team proposes, worship team accepts ---

type liveSuggestion struct {
	Reference string   `json:"reference"`
	From      string   `json:"from"`
	Bibles    []string `json:"bibles,omitempty"`
	UpdatedAt int64    `json:"updated_at"`
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
	}
	if err := c.BodyParser(&req); err != nil || req.Reference == "" {
		return c.Status(400).JSON(fiber.Map{"error": "reference is required"})
	}
	suggestionState.mu.Lock()
	suggestionState.s = liveSuggestion{Reference: req.Reference, From: req.From, Bibles: req.Bibles, UpdatedAt: time.Now().UnixMilli()}
	out := suggestionState.s
	suggestionState.mu.Unlock()
	return c.JSON(out)
}
