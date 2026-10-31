package versedetect

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// HTTP layer for the media Bible panel. The global auth middleware already
// requires a login for these paths; this file only adds the role gate.

const maxPollWait = 20 // seconds; Fiber WriteTimeout is 30s

// RequireMediaOrAdmin gates every verse-detect route: detections are media-only UI in phase 5, admin may debug.
func RequireMediaOrAdmin(c *fiber.Ctx) error {
	role, _ := c.Locals("role").(string)
	if role != "media" && role != "admin" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Verse detection is for the media team"})
	}
	return c.Next()
}

// Register mounts GET /verse-detect/suggestions, GET /verse-detect/status, POST /verse-detect/config.
func Register(api fiber.Router, d *Detector) {
	g := api.Group("/verse-detect", RequireMediaOrAdmin)
	g.Get("/suggestions", suggestions(d))
	g.Get("/status", status(d))
	g.Post("/config", config(d))
}

// waitSeconds parses ?wait= as whole seconds clamped to 0..maxPollWait; junk = 0.
func waitSeconds(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 {
		return 0
	}
	if n > maxPollWait {
		return maxPollWait
	}
	return n
}

func suggestions(d *Detector) fiber.Handler {
	return func(c *fiber.Ctx) error {
		since := int64(-1)
		if s := c.Query("since"); s != "" {
			if n, err := strconv.ParseInt(s, 10, 64); err == nil {
				since = n
			}
		}
		wait := time.Duration(waitSeconds(c.Query("wait"))) * time.Second
		return c.JSON(d.Poll(since, wait))
	}
}

func status(d *Detector) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(d.Status())
	}
}

func config(d *Detector) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var b struct {
			Enabled *bool `json:"enabled"`
		}
		body := bytes.TrimSpace(c.Body())
		if len(body) == 0 || json.Unmarshal(body, &b) != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if b.Enabled == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "enabled is required"})
		}
		return c.JSON(d.SetEnabled(*b.Enabled))
	}
}
