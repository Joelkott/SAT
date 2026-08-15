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

const netBaseURL = "https://labs.bible.org/api/"

// NetBibleID is the bible ID the NET is served under, alongside the local-* IDs.
const NetBibleID = "net"

// NetProvider serves the NET Bible from labs.bible.org with api.bible-compatible
// response shapes, so the frontend treats it like any other translation.
// The endpoint is free and takes no key, so this provider is always configured.
type NetProvider struct {
	httpClient *http.Client
	cache      *Cache
}

// NewNetProvider creates a NET provider. No API key exists for this endpoint.
func NewNetProvider() *NetProvider {
	return &NetProvider{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		cache: NewCache(),
	}
}

// IsConfigured always reports true; kept for symmetry with EsvProvider so the
// handler can gate both providers the same way.
func (p *NetProvider) IsConfigured() bool {
	return true
}

// Has reports whether this provider serves the given bible ID.
func (p *NetProvider) Has(bibleID string) bool {
	return bibleID == NetBibleID
}

// Meta returns the translation metadata shown in the translation picker.
func (p *NetProvider) Meta() Bible {
	return Bible{
		ID:                NetBibleID,
		Name:              "New English Translation (NET)",
		NameLocal:         "New English Translation (NET)",
		Abbreviation:      "NET",
		AbbreviationLocal: "NET",
		Description:       "New English Translation (labs.bible.org)",
		DescriptionLocal:  "New English Translation (labs.bible.org)",
		Language:          Language{ID: "eng", Name: "English", NameLocal: "English", Script: "Latin", Direction: "ltr"},
	}
}

// netQuery converts an api.bible-shaped passage ID into a labs.bible.org
// `passage` value. labs.bible.org accepts the same reference spellings the ESV
// endpoint does (verified for "Psalms 23:1", "Psalm 23", "Song of Solomon 2:1"),
// so the shared formatter is reused rather than duplicated.
func netQuery(passageID string) (string, error) {
	return esvQuery(passageID)
}

// netVerse is one entry of the labs.bible.org JSON response.
type netVerse struct {
	Bookname string `json:"bookname"`
	Chapter  string `json:"chapter"`
	Verse    string `json:"verse"`
	Text     string `json:"text"`
}

var netWhitespaceRegex = regexp.MustCompile(`\s+`)

// buildNetPassage validates the response chapter and assembles "[n] text" content
// matching the format LocalProvider and EsvProvider produce.
func buildNetPassage(verses []netVerse, wantChapter string) (string, error) {
	if len(verses) == 0 {
		return "", fmt.Errorf("bible: net passage not found")
	}
	// Load-bearing guard: labs.bible.org answers an out-of-range reference with
	// HTTP 200 and a *different* chapter (passage=John 99:1 returns John 1:1),
	// so without this check a bad reference would put the wrong scripture on the
	// LED wall.
	if verses[0].Chapter != wantChapter {
		return "", fmt.Errorf("bible: net returned chapter %q, want %q", verses[0].Chapter, wantChapter)
	}

	var b strings.Builder
	for i, v := range verses {
		if i > 0 {
			b.WriteString(" ")
		}
		// The API appends a trailing space to every verse text.
		text := strings.TrimSpace(netWhitespaceRegex.ReplaceAllString(v.Text, " "))
		b.WriteString("[")
		b.WriteString(v.Verse)
		b.WriteString("] ")
		b.WriteString(text)
	}
	return b.String(), nil
}

// GetBooks returns the 66 canonical books, from the static table (no network).
// esvChapterCounts is shared deliberately: the NET uses the same 66-book
// Protestant canon, and that table is already cross-checked against the
// bundled KJV in esv_test.go.
func (p *NetProvider) GetBooks(bibleID string) ([]Book, error) {
	books := make([]Book, 0, len(usfmBooks))
	for i, id := range usfmBooks {
		books = append(books, Book{
			ID:           id,
			BibleID:      NetBibleID,
			Abbreviation: bookAbbrs[i],
			Name:         bookNames[i],
			NameLong:     bookNames[i],
		})
	}
	return books, nil
}

// GetChapters returns a book's chapters, from the shared static table (no network).
func (p *NetProvider) GetChapters(bibleID, bookID string) ([]Chapter, error) {
	i := bookIndex(bookID)
	if i < 0 {
		return nil, fmt.Errorf("bible: book %q not found in %q", bookID, NetBibleID)
	}
	count := esvChapterCounts[i]
	chapters := make([]Chapter, 0, count)
	for n := 1; n <= count; n++ {
		num := strconv.Itoa(n)
		chapters = append(chapters, Chapter{
			ID:        fmt.Sprintf("%s.%s", bookID, num),
			BibleID:   NetBibleID,
			BookID:    bookID,
			Number:    num,
			Reference: fmt.Sprintf("%s %s", bookNames[i], num),
		})
	}
	return chapters, nil
}

// fetchPassage returns "[n] text" passage content for an api.bible-shaped passage ID.
func (p *NetProvider) fetchPassage(passageID string) (string, error) {
	cacheKey := fmt.Sprintf("net-passage:%s", passageID)
	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached.(string), nil
	}

	_, chap, _, _, err := parsePassageID(passageID)
	if err != nil {
		return "", err
	}
	query, err := netQuery(passageID)
	if err != nil {
		return "", err
	}

	params := url.Values{}
	params.Set("passage", query)
	params.Set("type", "json")
	params.Set("formatting", "plain")

	req, err := http.NewRequest("GET", netBaseURL+"?"+params.Encode(), nil)
	if err != nil {
		return "", fmt.Errorf("bible: failed to create net request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("bible: failed to send net request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("bible: failed to read net response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bible: net api returned status %d: %s", resp.StatusCode, string(body))
	}

	var verses []netVerse
	if err := json.Unmarshal(body, &verses); err != nil {
		// labs.bible.org returns an HTML/plain error page for some malformed input.
		return "", fmt.Errorf("bible: failed to decode net response: %w (body: %s)", err, truncateBody(body))
	}

	text, err := buildNetPassage(verses, chap)
	if err != nil {
		return "", err
	}

	p.cache.Set(cacheKey, text, ContentTTL)
	return text, nil
}

// truncateBody shortens a response body for error messages.
func truncateBody(body []byte) string {
	const max = 200
	s := strings.TrimSpace(netWhitespaceRegex.ReplaceAllString(string(body), " "))
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}

// GetChapterContent returns full chapter text with [n] verse markers.
func (p *NetProvider) GetChapterContent(bibleID, chapterID string) (*ChapterContentResponse, error) {
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
	resp.Data.BibleID = NetBibleID
	resp.Data.BookID = bookID
	resp.Data.Number = chapNum
	resp.Data.Reference = localReference(chapterID)
	resp.Data.Content = text
	return &resp, nil
}

// GetVerse returns a single verse as plain text, without the [n] marker,
// matching LocalProvider.GetVerse.
func (p *NetProvider) GetVerse(bibleID, verseID string) (*Verse, error) {
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
		BibleID:   NetBibleID,
		BookID:    bookID,
		ChapterID: fmt.Sprintf("%s.%s", bookID, chapNum),
		Reference: localReference(verseID),
		Text:      esvVerseMarkerPrefix.ReplaceAllString(text, ""),
	}, nil
}

// GetPassage returns a verse, verse range or whole chapter with [n] markers.
func (p *NetProvider) GetPassage(bibleID, passageID string) (*Passage, error) {
	text, err := p.fetchPassage(passageID)
	if err != nil {
		return nil, err
	}
	return &Passage{
		ID:        passageID,
		BibleID:   NetBibleID,
		OrgID:     passageID,
		Reference: localReference(passageID),
		Content:   text,
	}, nil
}
