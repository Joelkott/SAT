package bible

import (
	"github.com/gofiber/fiber/v2"
)

// BibleHandler holds the Bible client and provides Fiber route handlers
type BibleHandler struct {
	client *Client
}

// NewHandler creates a new BibleHandler
func NewHandler(client *Client) *BibleHandler {
	return &BibleHandler{client: client}
}

// GetBibles returns all available Bible translations
// GET /api/bible/bibles
func (bh *BibleHandler) GetBibles(c *fiber.Ctx) error {
	bibles, err := bh.client.GetBibles()
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch Bible translations"})
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

	passage, err := bh.client.GetPassage(bibleID, passageID)
	if err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Failed to fetch passage"})
	}
	return c.JSON(passage)
}
