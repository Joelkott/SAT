package bible

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const esvBaseURL = "https://api.esv.org/v3/passage/text/"

// EsvBibleID is the bible ID the ESV is served under, alongside the local-* IDs.
const EsvBibleID = "esv"

// EsvProvider serves the ESV from Crossway's api.esv.org with api.bible-compatible
// response shapes, so the frontend treats it like any other translation.
type EsvProvider struct {
	apiKey     string
	httpClient *http.Client
	cache      *Cache
	configured bool
}

// NewEsvProvider creates an ESV provider. An empty key yields an unconfigured
// provider that claims no bible IDs and errors on every fetch.
func NewEsvProvider(apiKey string) *EsvProvider {
	if apiKey == "" {
		return &EsvProvider{configured: false}
	}
	return &EsvProvider{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		cache:      NewCache(),
		configured: true,
	}
}

// IsConfigured reports whether an ESV_API_KEY was supplied.
func (p *EsvProvider) IsConfigured() bool {
	return p.configured
}

// Has reports whether this provider serves the given bible ID.
func (p *EsvProvider) Has(bibleID string) bool {
	return p.configured && bibleID == EsvBibleID
}

// Meta returns the translation metadata shown in the translation picker.
func (p *EsvProvider) Meta() Bible {
	return Bible{
		ID:                EsvBibleID,
		Name:              "English Standard Version",
		NameLocal:         "English Standard Version",
		Abbreviation:      "ESV",
		AbbreviationLocal: "ESV",
		Description:       "English Standard Version (api.esv.org)",
		DescriptionLocal:  "English Standard Version (api.esv.org)",
		Language:          Language{ID: "eng", Name: "English", NameLocal: "English", Script: "Latin", Direction: "ltr"},
	}
}

// esvChapterCounts holds chapters per book, index-aligned with usfmBooks.
// api.esv.org exposes no books/chapters endpoint, so navigation is served from
// this table with zero network calls.
var esvChapterCounts = []int{
	50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, // GEN..2KI
	29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, // 1CH..JER
	5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, // LAM..ZEP
	2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, // HAG..GAL
	6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, // EPH..1PE
	3, 5, 1, 1, 1, 22, // 2PE..REV
}

func init() {
	if len(esvChapterCounts) != len(usfmBooks) {
		panic(fmt.Sprintf("bible: esvChapterCounts has %d entries, want %d", len(esvChapterCounts), len(usfmBooks)))
	}
}

// esvBookNameOverrides adjust book names for the outgoing ESV query only;
// display references keep the shared bookNames spellings.
var esvBookNameOverrides = map[string]string{
	"PSA": "Psalm",
	"SNG": "Song of Solomon",
}

// esvBookName returns the book name to use in an ESV query string.
func esvBookName(usfm string) (string, bool) {
	i := bookIndex(usfm)
	if i < 0 {
		return "", false
	}
	if name, ok := esvBookNameOverrides[usfm]; ok {
		return name, true
	}
	return bookNames[i], true
}

// parsePassageID splits an api.bible-shaped passage ID into its parts.
// Handles BOOK.C, BOOK.C.V, BOOK.C.V1-BOOK.C.V2 (or -V2) and BOOK.C1-BOOK.C2
// (chapter ranges, served as the starting chapter like LocalProvider does).
func parsePassageID(passageID string) (book, chap, startV, endV string, err error) {
	startRaw, endRaw, isRange := strings.Cut(passageID, "-")
	parts := strings.Split(startRaw, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return "", "", "", "", fmt.Errorf("bible: invalid passage id %q", passageID)
	}
	book, chap = parts[0], parts[1]
	if bookIndex(book) < 0 {
		return "", "", "", "", fmt.Errorf("bible: unknown book in passage id %q", passageID)
	}
	if _, convErr := strconv.Atoi(chap); convErr != nil {
		return "", "", "", "", fmt.Errorf("bible: invalid chapter in passage id %q", passageID)
	}

	// Whole chapter (also covers chapter ranges).
	if len(parts) == 2 {
		return book, chap, "", "", nil
	}

	startV = parts[2]
	endV = startV
	if isRange {
		endParts := strings.Split(endRaw, ".")
		endV = endParts[len(endParts)-1]
	}
	si, convErr := strconv.Atoi(startV)
	if convErr != nil {
		return "", "", "", "", fmt.Errorf("bible: invalid verse in passage id %q", passageID)
	}
	ei, convErr := strconv.Atoi(endV)
	if convErr != nil {
		return "", "", "", "", fmt.Errorf("bible: invalid verse range in passage id %q", passageID)
	}
	if ei < si {
		si, ei = ei, si
	}
	return book, chap, strconv.Itoa(si), strconv.Itoa(ei), nil
}

// esvQuery converts an api.bible-shaped passage ID into an ESV `q` value,
// e.g. "JHN.3.16-JHN.3.18" -> "John 3:16-18".
func esvQuery(passageID string) (string, error) {
	book, chap, startV, endV, err := parsePassageID(passageID)
	if err != nil {
		return "", err
	}
	name, ok := esvBookName(book)
	if !ok {
		return "", fmt.Errorf("bible: unknown book in passage id %q", passageID)
	}
	if startV == "" {
		return fmt.Sprintf("%s %s", name, chap), nil
	}
	if startV == endV {
		return fmt.Sprintf("%s %s:%s", name, chap, startV), nil
	}
	return fmt.Sprintf("%s %s:%s-%s", name, chap, startV, endV), nil
}

// localReference builds the display reference in the same format LocalProvider
// uses, so every translation renders identically in multiview. The API's own
// `canonical` field is deliberately ignored. Unparseable IDs pass through.
func localReference(passageID string) string {
	book, chap, startV, endV, err := parsePassageID(passageID)
	if err != nil {
		return passageID
	}
	name := bookNames[bookIndex(book)]
	switch {
	case startV == "":
		return fmt.Sprintf("%s %s", name, chap)
	case startV == endV:
		return fmt.Sprintf("%s %s:%s", name, chap, startV)
	default:
		return fmt.Sprintf("%s %s:%s-%s", name, chap, startV, endV)
	}
}

var (
	esvWhitespaceRegex   = regexp.MustCompile(`\s+`)
	esvVerseMarkerPrefix = regexp.MustCompile(`^\[\d+\]\s*`)
)

// cleanESVText normalizes an ESV passage into a single "[n] text [n+1] text" line.
func cleanESVText(s string) string {
	t := strings.TrimSpace(esvWhitespaceRegex.ReplaceAllString(s, " "))
	t = strings.TrimSpace(strings.TrimSuffix(t, "(ESV)"))
	// Defensive: drop a canonical reference prefix if one slips through.
	if !strings.HasPrefix(t, "[") {
		if i := strings.Index(t, "["); i > 0 {
			t = t[i:]
		}
	}
	return strings.TrimSpace(t)
}

// GetBooks returns the 66 canonical books, from the static table (no network).
func (p *EsvProvider) GetBooks(bibleID string) ([]Book, error) {
	if !p.configured {
		return nil, fmt.Errorf("bible: esv provider not configured")
	}
	books := make([]Book, 0, len(usfmBooks))
	for i, id := range usfmBooks {
		books = append(books, Book{
			ID:           id,
			BibleID:      EsvBibleID,
			Abbreviation: bookAbbrs[i],
			Name:         bookNames[i],
			NameLong:     bookNames[i],
		})
	}
	return books, nil
}

// GetChapters returns a book's chapters, from the static table (no network).
func (p *EsvProvider) GetChapters(bibleID, bookID string) ([]Chapter, error) {
	if !p.configured {
		return nil, fmt.Errorf("bible: esv provider not configured")
	}
	i := bookIndex(bookID)
	if i < 0 {
		return nil, fmt.Errorf("bible: book %q not found in %q", bookID, EsvBibleID)
	}
	count := esvChapterCounts[i]
	chapters := make([]Chapter, 0, count)
	for n := 1; n <= count; n++ {
		num := strconv.Itoa(n)
		chapters = append(chapters, Chapter{
			ID:        fmt.Sprintf("%s.%s", bookID, num),
			BibleID:   EsvBibleID,
			BookID:    bookID,
			Number:    num,
			Reference: fmt.Sprintf("%s %s", bookNames[i], num),
		})
	}
	return chapters, nil
}

// fetchPassage returns cleaned passage text for an api.bible-shaped passage ID.
func (p *EsvProvider) fetchPassage(passageID string) (string, error) {
	if !p.configured {
		return "", fmt.Errorf("bible: esv provider not configured")
	}

	cacheKey := fmt.Sprintf("esv-passage:%s", passageID)
	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached.(string), nil
	}

	query, err := esvQuery(passageID)
	if err != nil {
		return "", err
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("include-passage-references", "false")
	params.Set("include-headings", "false")
	params.Set("include-footnotes", "false")
	params.Set("include-footnote-body", "false")
	params.Set("include-short-copyright", "false")
	params.Set("include-copyright", "false")
	params.Set("include-passage-horizontal-lines", "false")
	params.Set("include-heading-horizontal-lines", "false")
	params.Set("include-verse-numbers", "true")
	params.Set("include-first-verse-numbers", "true")
	params.Set("indent-poetry", "false")
	params.Set("indent-paragraphs", "0")
	params.Set("indent-declares", "0")
	params.Set("indent-psalm-doxology", "0")

	req, err := http.NewRequest("GET", esvBaseURL+"?"+params.Encode(), nil)
	if err != nil {
		return "", fmt.Errorf("bible: failed to create esv request: %w", err)
	}
	req.Header.Set("Authorization", "Token "+p.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("bible: failed to send esv request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("bible: failed to read esv response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bible: esv api returned status %d: %s", resp.StatusCode, string(body))
	}

	var decoded struct {
		Passages []string `json:"passages"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return "", fmt.Errorf("bible: failed to decode esv response: %w", err)
	}

	text := cleanESVText(strings.Join(decoded.Passages, " "))
	if text == "" {
		return "", fmt.Errorf("bible: esv passage %q not found", passageID)
	}

	p.cache.Set(cacheKey, text, ContentTTL)
	return text, nil
}

// GetChapterContent returns full chapter text with [n] verse markers.
func (p *EsvProvider) GetChapterContent(bibleID, chapterID string) (*ChapterContentResponse, error) {
	bookID, chapNum, ok := splitChapterID(chapterID)
	if !ok {
		return nil, fmt.Errorf("bible: invalid chapter id %q", chapterID)
	}
	text, err := p.fetchPassage(chapterID)
	if err != nil {
		return nil, err
	}
	var resp ChapterContentResponse
	resp.Data.ID = chapterID
	resp.Data.BibleID = EsvBibleID
	resp.Data.BookID = bookID
	resp.Data.Number = chapNum
	resp.Data.Reference = localReference(chapterID)
	resp.Data.Content = text
	return &resp, nil
}

// GetVerse returns a single verse as plain text, without the [n] marker,
// matching LocalProvider.GetVerse.
func (p *EsvProvider) GetVerse(bibleID, verseID string) (*Verse, error) {
	bookID, chapNum, _, ok := splitVerseID(verseID)
	if !ok {
		return nil, fmt.Errorf("bible: invalid verse id %q", verseID)
	}
	text, err := p.fetchPassage(verseID)
	if err != nil {
		return nil, err
	}
	return &Verse{
		ID:        verseID,
		OrgID:     verseID,
		BibleID:   EsvBibleID,
		BookID:    bookID,
		ChapterID: fmt.Sprintf("%s.%s", bookID, chapNum),
		Reference: localReference(verseID),
		Text:      esvVerseMarkerPrefix.ReplaceAllString(text, ""),
	}, nil
}

// GetPassage returns a verse, verse range or whole chapter with [n] markers.
func (p *EsvProvider) GetPassage(bibleID, passageID string) (*Passage, error) {
	text, err := p.fetchPassage(passageID)
	if err != nil {
		return nil, err
	}
	return &Passage{
		ID:        passageID,
		BibleID:   EsvBibleID,
		OrgID:     passageID,
		Reference: localReference(passageID),
		Content:   text,
	}, nil
}
