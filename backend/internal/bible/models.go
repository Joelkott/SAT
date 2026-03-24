package bible

// Bible represents a translation/version
type Bible struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	NameLocal         string   `json:"nameLocal"`
	Abbreviation      string   `json:"abbreviation"`
	AbbreviationLocal string   `json:"abbreviationLocal"`
	Description       string   `json:"description"`
	DescriptionLocal  string   `json:"descriptionLocal"`
	Language          Language `json:"language"`
}

// Language represents the language metadata for a Bible translation
type Language struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	NameLocal string `json:"nameLocal"`
	Script    string `json:"script"`
	Direction string `json:"scriptDirection"`
}

// Book represents a Bible book
type Book struct {
	ID           string `json:"id"`           // e.g., "GEN"
	BibleID      string `json:"bibleId"`
	Abbreviation string `json:"abbreviation"` // e.g., "Gen"
	Name         string `json:"name"`         // e.g., "Genesis"
	NameLong     string `json:"nameLong"`     // e.g., "The First Book of Moses, called Genesis"
}

// Chapter represents a chapter in a book
type Chapter struct {
	ID        string `json:"id"`        // e.g., "GEN.1"
	BibleID   string `json:"bibleId"`
	BookID    string `json:"bookId"`
	Number    string `json:"number"`
	Reference string `json:"reference"` // e.g., "Genesis 1"
}

// Verse represents a single verse
type Verse struct {
	ID        string `json:"id"`        // e.g., "GEN.1.1"
	OrgID     string `json:"orgId"`
	BibleID   string `json:"bibleId"`
	BookID    string `json:"bookId"`
	ChapterID string `json:"chapterId"`
	Reference string `json:"reference"` // e.g., "Genesis 1:1"
	Text      string `json:"text"`      // plain text, HTML stripped
}

// Passage represents a range of verses
type Passage struct {
	ID        string `json:"id"`
	BibleID   string `json:"bibleId"`
	OrgID     string `json:"orgId"`
	Reference string `json:"reference"`
	Content   string `json:"content"` // plain text, HTML stripped
}

// API response wrappers (api.bible nests data under "data" key)

// BiblesResponse wraps the list of bibles from api.bible
type BiblesResponse struct {
	Data []Bible `json:"data"`
}

// BooksResponse wraps the list of books from api.bible
type BooksResponse struct {
	Data []Book `json:"data"`
}

// ChaptersResponse wraps the list of chapters from api.bible
type ChaptersResponse struct {
	Data []Chapter `json:"data"`
}

// ChapterContentResponse wraps chapter content from api.bible
type ChapterContentResponse struct {
	Data struct {
		ID        string `json:"id"`
		BibleID   string `json:"bibleId"`
		BookID    string `json:"bookId"`
		Number    string `json:"number"`
		Reference string `json:"reference"`
		Content   string `json:"content"`
	} `json:"data"`
}

// VersesResponse wraps the list of verses from api.bible
type VersesResponse struct {
	Data []Verse `json:"data"`
}

// VerseResponse wraps a single verse from api.bible
type VerseResponse struct {
	Data Verse `json:"data"`
}

// PassageResponse wraps a passage from api.bible
type PassageResponse struct {
	Data Passage `json:"data"`
}
