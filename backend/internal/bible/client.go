package bible

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const defaultBaseURL = "https://rest.api.bible/v1"

// htmlTagRegex matches HTML tags for stripping from content
var htmlTagRegex = regexp.MustCompile(`<[^>]*>`)

// Config holds api.bible client configuration
type Config struct {
	APIKey  string // from API_BIBLE_KEY env var
	BaseURL string // from API_BIBLE_BASE_URL env var, default "https://api.scripture.api.bible/v1"
}

// Client is the api.bible HTTP client with caching
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	cache      *Cache
	configured bool
}

// New creates a new api.bible client. Returns a nil-safe client if config is nil or has no API key.
func New(config *Config) *Client {
	if config == nil || config.APIKey == "" {
		return &Client{configured: false}
	}

	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	// Ensure no trailing slash
	baseURL = strings.TrimRight(baseURL, "/")

	return &Client{
		baseURL: baseURL,
		apiKey:  config.APIKey,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		cache:      NewCache(),
		configured: true,
	}
}

// IsConfigured returns whether the client has a valid API key
func (c *Client) IsConfigured() bool {
	return c.configured
}

// doRequest performs an authenticated GET request to api.bible
func (c *Client) doRequest(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to create request: %w", err)
	}
	req.Header.Set("api-key", c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to send request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bible: api returned status %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// stripHTML removes HTML tags from content
func stripHTML(s string) string {
	return strings.TrimSpace(htmlTagRegex.ReplaceAllString(s, ""))
}

// GetBibles returns all available Bible translations
func (c *Client) GetBibles() ([]Bible, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := "bibles"
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.([]Bible), nil
	}

	body, err := c.doRequest(c.baseURL + "/bibles")
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get bibles: %w", err)
	}

	var resp BiblesResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode bibles response: %w", err)
	}

	c.cache.Set(cacheKey, resp.Data, MetadataTTL)
	return resp.Data, nil
}

// GetBooks returns all books for a given Bible translation
func (c *Client) GetBooks(bibleID string) ([]Book, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := fmt.Sprintf("books:%s", bibleID)
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.([]Book), nil
	}

	url := fmt.Sprintf("%s/bibles/%s/books", c.baseURL, bibleID)
	body, err := c.doRequest(url)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get books for %s: %w", bibleID, err)
	}

	var resp BooksResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode books response: %w", err)
	}

	c.cache.Set(cacheKey, resp.Data, MetadataTTL)
	return resp.Data, nil
}

// GetChapters returns all chapters for a given book in a Bible translation
func (c *Client) GetChapters(bibleID, bookID string) ([]Chapter, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := fmt.Sprintf("chapters:%s:%s", bibleID, bookID)
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.([]Chapter), nil
	}

	url := fmt.Sprintf("%s/bibles/%s/books/%s/chapters", c.baseURL, bibleID, bookID)
	body, err := c.doRequest(url)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get chapters for %s/%s: %w", bibleID, bookID, err)
	}

	var resp ChaptersResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode chapters response: %w", err)
	}

	c.cache.Set(cacheKey, resp.Data, MetadataTTL)
	return resp.Data, nil
}

// GetChapterContent returns the content of a specific chapter
func (c *Client) GetChapterContent(bibleID, chapterID string) (*ChapterContentResponse, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := fmt.Sprintf("chapter-content:%s:%s", bibleID, chapterID)
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.(*ChapterContentResponse), nil
	}

	url := fmt.Sprintf("%s/bibles/%s/chapters/%s?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true", c.baseURL, bibleID, chapterID)
	body, err := c.doRequest(url)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get chapter content for %s/%s: %w", bibleID, chapterID, err)
	}

	var resp ChapterContentResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode chapter content response: %w", err)
	}

	// Strip any residual HTML tags from content
	resp.Data.Content = stripHTML(resp.Data.Content)

	c.cache.Set(cacheKey, &resp, ContentTTL)
	return &resp, nil
}

// GetVerse returns a single verse
func (c *Client) GetVerse(bibleID, verseID string) (*Verse, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := fmt.Sprintf("verse:%s:%s", bibleID, verseID)
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.(*Verse), nil
	}

	url := fmt.Sprintf("%s/bibles/%s/verses/%s?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true", c.baseURL, bibleID, verseID)
	body, err := c.doRequest(url)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get verse %s/%s: %w", bibleID, verseID, err)
	}

	var resp VerseResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode verse response: %w", err)
	}

	// Strip any residual HTML tags from text
	resp.Data.Text = stripHTML(resp.Data.Text)

	c.cache.Set(cacheKey, &resp.Data, ContentTTL)
	return &resp.Data, nil
}

// GetPassage returns a passage (range of verses)
func (c *Client) GetPassage(bibleID, passageID string) (*Passage, error) {
	if !c.configured {
		return nil, fmt.Errorf("bible: client not configured")
	}

	cacheKey := fmt.Sprintf("passage:%s:%s", bibleID, passageID)
	if cached, ok := c.cache.Get(cacheKey); ok {
		return cached.(*Passage), nil
	}

	url := fmt.Sprintf("%s/bibles/%s/passages/%s?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true", c.baseURL, bibleID, passageID)
	body, err := c.doRequest(url)
	if err != nil {
		return nil, fmt.Errorf("bible: failed to get passage %s/%s: %w", bibleID, passageID, err)
	}

	var resp PassageResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("bible: failed to decode passage response: %w", err)
	}

	// Strip any residual HTML tags from content
	resp.Data.Content = stripHTML(resp.Data.Content)

	c.cache.Set(cacheKey, &resp.Data, ContentTTL)
	return &resp.Data, nil
}
