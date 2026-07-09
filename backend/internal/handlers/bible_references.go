package handlers

import (
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
)

// ParsedReferencesPayload represents incoming parsed Bible references from remote parser
type ParsedReferencesPayload struct {
	References []BibleReference `json:"references"`
	Timestamp  string           `json:"timestamp"`
}

// ReceiveParsedReferences handles incoming parsed Bible references from remote parser
// This endpoint is designed for the VPS deployment where Ollama runs on a remote machine
func (h *Handler) ReceiveParsedReferences(c *fiber.Ctx) error {
	// Check API key authentication
	apiKey := os.Getenv("BIBLE_PARSER_API_KEY")
	if apiKey != "" {
		providedKey := c.Get("X-API-Key")
		if providedKey != apiKey {
			log.Printf("⚠️  Unauthorized bible reference submission attempt")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Unauthorized - Invalid API key",
			})
		}
	}

	var payload ParsedReferencesPayload
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid payload",
		})
	}

	log.Printf("📨 Received %d parsed Bible reference(s) from remote parser", len(payload.References))

	// Broadcast each reference to connected frontend clients via SSE
	broadcastCount := 0
	for _, ref := range payload.References {
		// Only broadcast references with sufficient confidence
		if ref.Confidence > 0.7 {
			log.Printf("📖 Broadcasting reference: %s %d:%d (confidence: %.2f)",
				ref.Book, ref.Chapter, ref.Verse, ref.Confidence)
			BroadcastBibleVerse(ref)
			broadcastCount++
		} else {
			log.Printf("⚠️  Skipping low confidence reference: %s %d:%d (confidence: %.2f)",
				ref.Book, ref.Chapter, ref.Verse, ref.Confidence)
		}
	}

	return c.JSON(fiber.Map{
		"success":          true,
		"received":         len(payload.References),
		"broadcasted":      broadcastCount,
		"timestamp":        payload.Timestamp,
	})
}
