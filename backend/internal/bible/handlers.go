package bible

import (
	"github.com/gofiber/fiber/v2"
)

// BibleHandler holds the Bible client + local/ESV providers and provides Fiber route handlers
type BibleHandler struct {
	client *Client
	local  *LocalProvider
	esv    *EsvProvider
}

// NewHandler creates a new BibleHandler. client and esv may be unconfigured
// (no api.bible / ESV key), in which case only the bundled local Bibles are served.
func NewHandler(client *Client, local *LocalProvider, esv *EsvProvider) *BibleHandler {
	return &BibleHandler{client: client, local: local, esv: esv}
}

// GetBibles returns all available Bible translations: bundled local ones first,
// then remote api.bible translations when a key is configured.
// GET /api/bible/bibles
func (bh *BibleHandler) GetBibles(c *fiber.Ctx) error {
	bibles := bh.local.Bibles()
	if bh.esv.IsConfigured() {
		bibles = append(bibles, bh.esv.Meta())
	}
	if bh.client.IsConfigured() {
		remote, err := bh.client.GetBibles()
		if err != nil {
			// Non-fatal: still return the local Bibles so the tab keeps working.
			return c.JSON(bibles)
		}
		bibles = append(bibles, remote...)
	}
	return c.JSON(bibles)
}

// GetBooks returns all books for a Bible translation
// GET /api/bible/bibles/:bibleId/books
func (bh *BibleHandler) GetBooks(c *fiber.Ctx) error {
	bibleID := c.Params("bibleId")
	if bibleID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "bibleId is required"})
	}

	if bh.local.Has(bibleID) {
		books, err := bh.local.GetBooks(bibleID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch books"})
		}
		return c.JSON(books)
	}

	if bh.esv.Has(bibleID) {
		books, err := bh.esv.GetBooks(bibleID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch books"})
		}
		return c.JSON(books)
	}

	books, err := bh.client.GetBooks(bibleID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch books"})
	}
	return c.JSON(books)
}

// GetChapters returns all chapters for a book in a Bible translation
// GET /api/bible/bibles/:bibleId/books/:bookId/chapters
func (bh *BibleHandler) GetChapters(c *fiber.Ctx) error {
	bibleID := c.Params("bibleId")
	bookID := c.Params("bookId")
	if bibleID == "" || bookID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "bibleId and bookId are required"})
	}

	if bh.local.Has(bibleID) {
		chapters, err := bh.local.GetChapters(bibleID, bookID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch chapters"})
		}
		return c.JSON(chapters)
	}

	if bh.esv.Has(bibleID) {
		chapters, err := bh.esv.GetChapters(bibleID, bookID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch chapters"})
		}
		return c.JSON(chapters)
	}

	chapters, err := bh.client.GetChapters(bibleID, bookID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch chapters"})
	}
	return c.JSON(chapters)
}

// GetChapter returns the content of a specific chapter
// GET /api/bible/bibles/:bibleId/chapters/:chapterId
func (bh *BibleHandler) GetChapter(c *fiber.Ctx) error {
	bibleID := c.Params("bibleId")
	chapterID := c.Params("chapterId")
	if bibleID == "" || chapterID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "bibleId and chapterId are required"})
	}

	if bh.local.Has(bibleID) {
		chapter, err := bh.local.GetChapterContent(bibleID, chapterID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch chapter content"})
		}
		return c.JSON(chapter.Data)
	}

	if bh.esv.Has(bibleID) {
		chapter, err := bh.esv.GetChapterContent(bibleID, chapterID)
		if err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch chapter content"})
		}
		return c.JSON(chapter.Data)
	}

	chapter, err := bh.client.GetChapterContent(bibleID, chapterID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch chapter content"})
	}
	return c.JSON(chapter.Data)
}

// GetVerse returns a single verse
// GET /api/bible/bibles/:bibleId/verses/:verseId
func (bh *BibleHandler) GetVerse(c *fiber.Ctx) error {
	bibleID := c.Params("bibleId")
	verseID := c.Params("verseId")
	if bibleID == "" || verseID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "bibleId and verseId are required"})
	}

	if bh.local.Has(bibleID) {
		verse, err := bh.local.GetVerse(bibleID, verseID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch verse"})
		}
		return c.JSON(verse)
	}

	if bh.esv.Has(bibleID) {
		verse, err := bh.esv.GetVerse(bibleID, verseID)
		if err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch verse"})
		}
		return c.JSON(verse)
	}

	verse, err := bh.client.GetVerse(bibleID, verseID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch verse"})
	}
	return c.JSON(verse)
}

// GetPassage returns a passage (range of verses)
// GET /api/bible/bibles/:bibleId/passages/:passageId
func (bh *BibleHandler) GetPassage(c *fiber.Ctx) error {
	bibleID := c.Params("bibleId")
	passageID := c.Params("passageId")
	if bibleID == "" || passageID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "bibleId and passageId are required"})
	}

	if bh.local.Has(bibleID) {
		passage, err := bh.local.GetPassage(bibleID, passageID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "Failed to fetch passage"})
		}
		return c.JSON(passage)
	}

	if bh.esv.Has(bibleID) {
		passage, err := bh.esv.GetPassage(bibleID, passageID)
		if err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch passage"})
		}
		return c.JSON(passage)
	}

	passage, err := bh.client.GetPassage(bibleID, passageID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch passage"})
	}
	return c.JSON(passage)
}
