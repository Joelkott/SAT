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

// --- Verse suggestions: media team proposes, worship team accepts ---

type liveSuggestion struct {
	Reference string `json:"reference"`
	From      string `json:"from"`
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
		Reference string `json:"reference"`
		From      string `json:"from"`
	}
	if err := c.BodyParser(&req); err != nil || req.Reference == "" {
		return c.Status(400).JSON(fiber.Map{"error": "reference is required"})
	}
	suggestionState.mu.Lock()
	suggestionState.s = liveSuggestion{Reference: req.Reference, From: req.From, UpdatedAt: time.Now().UnixMilli()}
	out := suggestionState.s
	suggestionState.mu.Unlock()
	return c.JSON(out)
}
