package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// CaptionPayload represents incoming caption from Jgm-live-captions
type CaptionPayload struct {
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
}

// BibleReference represents a parsed Bible verse reference
type BibleReference struct {
	Book      string `json:"book"`
	Chapter   int    `json:"chapter"`
	Verse     int    `json:"verse"`
	EndVerse  *int   `json:"endVerse,omitempty"`
	RawText   string `json:"rawText"`
	Confidence float64 `json:"confidence"`
}

// OpenAIResponse represents the response from OpenAI API
type OpenAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// ReceiveCaption handles incoming captions from Jgm-live-captions
// It parses Bible references using an SLM and forwards to the frontend
func (h *Handler) ReceiveCaption(c *fiber.Ctx) error {
	var payload CaptionPayload
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid payload",
		})
	}

	log.Printf("📨 Received caption: %s", payload.Text)

	// Process the caption text
	references := h.ProcessCaptionText(payload.Text, payload.Timestamp)

	return c.JSON(fiber.Map{
		"success": true,
		"references": references,
	})
}

// ProcessCaptionText processes caption text and extracts Bible references
// This can be called from HTTP endpoint or SSE stream
func (h *Handler) ProcessCaptionText(text string, timestamp string) []BibleReference {
	// Check if caption processing is enabled
	// For VPS deployment, this should be "false" as processing happens on remote machine
	enableProcessing := os.Getenv("ENABLE_CAPTION_PROCESSING")
	if enableProcessing == "false" {
		log.Printf("ℹ️  Caption processing disabled (handled by remote parser)")
		return []BibleReference{}
	}

	// Parse Bible references using SLM
	references, err := parseBibleReferences(text)
	if err != nil {
		log.Printf("⚠️  Failed to parse Bible references: %v", err)
		return []BibleReference{}
	}

	if len(references) > 0 {
		log.Printf("📖 Found %d Bible reference(s)", len(references))
		for _, ref := range references {
			log.Printf("   → %s %d:%d (confidence: %.2f)", ref.Book, ref.Chapter, ref.Verse, ref.Confidence)

			// Broadcast the highest confidence reference to frontend
			if ref.Confidence > 0.7 {
				BroadcastBibleVerse(ref)
			}
		}
	}

	return references
}

// parseBibleReferences uses Ollama (if available) or OpenAI to parse Bible references from text
func parseBibleReferences(text string) ([]BibleReference, error) {
	// Try Ollama first
	ollamaURL := os.Getenv("OLLAMA_URL")
	if ollamaURL != "" {
		if refs, err := parseWithOllama(text, ollamaURL); err == nil && len(refs) > 0 {
			return refs, nil
		}
		log.Printf("⚠️  Ollama parsing failed or empty, trying OpenAI")
	}

	// Fall back to OpenAI
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Printf("⚠️  OPENAI_API_KEY not set, using regex fallback")
		return parseWithRegex(text), nil
	}

	// GPT-4o-mini is fast and doesn't use reasoning tokens
	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini" // Fast, efficient model for reference extraction
	}

	// Construct prompt for Bible reference extraction with explicit anti-hallucination constraints
	// Note: JSON mode requires response to be a JSON object, not an array
	systemPrompt := "You are a Bible reference parser. Extract ONLY Bible verse references that are EXPLICITLY mentioned in the input text. DO NOT add any references that are not in the input. Return a JSON object with a 'references' array."

	userPrompt := fmt.Sprintf(`CRITICAL: If the input says "Genesis 8:1", return ONLY Genesis 8:1. Do not add Genesis 1:1 or any other verses. Only parse what is actually in the input text.

Example input: "turn to John chapter 3 verse 16"
Example output: {"references":[{"book":"John","chapter":3,"verse":16,"endVerse":null,"rawText":"John 3:16","confidence":0.95}]}

Example input: "Genesis 1 verse 1"
Example output: {"references":[{"book":"Genesis","chapter":1,"verse":1,"endVerse":null,"rawText":"Genesis 1:1","confidence":0.95}]}

Now parse this input and return a JSON object with a 'references' array containing references that are ACTUALLY in the text:
Input: "%s"`, text)

	// Create request to OpenAI
	reqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature":   0.0, // GPT-4o-mini supports temperature 0 for deterministic output
		"max_tokens":    500, // GPT-4o-mini uses max_tokens, not max_completion_tokens
		"response_format": map[string]string{"type": "json_object"}, // Force JSON output
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Make HTTP request to OpenAI with timeout
	client := &http.Client{
		Timeout: 10 * time.Second, // OpenAI is much faster than local Ollama
	}

	req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		// Fallback to regex if OpenAI is not available
		log.Printf("⚠️  OpenAI not available, using regex fallback: %v", err)
		return parseWithRegex(text), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		// Fallback to regex if OpenAI returns an error
		log.Printf("⚠️  OpenAI error (status %d), using regex fallback: %s", resp.StatusCode, string(body))
		return parseWithRegex(text), nil
	}

	// Parse OpenAI response
	bodyBytes, _ := io.ReadAll(resp.Body)
	log.Printf("🔍 Raw OpenAI response: %s", string(bodyBytes))

	var openaiResp OpenAIResponse
	if err := json.Unmarshal(bodyBytes, &openaiResp); err != nil {
		return nil, fmt.Errorf("failed to decode OpenAI response: %w", err)
	}

	if len(openaiResp.Choices) == 0 {
		log.Printf("⚠️  No choices in OpenAI response, using regex fallback")
		return parseWithRegex(text), nil
	}

	// Extract JSON from response (sometimes LLMs add extra text or markdown)
	responseText := strings.TrimSpace(openaiResp.Choices[0].Message.Content)

	// Remove markdown code fences if present (e.g., ```json ... ```)
	responseText = strings.ReplaceAll(responseText, "```json", "")
	responseText = strings.ReplaceAll(responseText, "```", "")
	responseText = strings.TrimSpace(responseText)

	log.Printf("🔍 OpenAI response content: %s", responseText)

	// Parse the JSON - it could be an array or an object with a "references" field
	var references []BibleReference

	// Try parsing as array first
	if err := json.Unmarshal([]byte(responseText), &references); err != nil {
		// If that fails, try parsing as object with references field
		var wrapper struct {
			References []BibleReference `json:"references"`
		}
		if err2 := json.Unmarshal([]byte(responseText), &wrapper); err2 != nil {
			log.Printf("⚠️  Failed to parse JSON from OpenAI (array error: %v, object error: %v), falling back to regex", err, err2)
			return parseWithRegex(text), nil
		}
		references = wrapper.References
	}

	// If SLM returned empty array, try regex as backup
	if len(references) == 0 {
		log.Printf("ℹ️  SLM returned no references, trying regex fallback")
		return parseWithRegex(text), nil
	}

	// Validate references to filter out hallucinations
	validated := validateReferences(references, text)
	if len(validated) < len(references) {
		log.Printf("⚠️  Filtered out %d hallucinated reference(s)", len(references)-len(validated))
	}

	return validated, nil
}

// OllamaResponse represents the response from Ollama API
type OllamaResponse struct {
	Model    string `json:"model"`
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

// parseWithOllama uses Ollama to parse Bible references
func parseWithOllama(text string, ollamaURL string) ([]BibleReference, error) {
	model := os.Getenv("OLLAMA_MODEL")
	if model == "" {
		model = "gemma3:4b"
	}

	prompt := fmt.Sprintf(`You are a Bible reference parser. Extract ONLY Bible verse references that are EXPLICITLY mentioned in the input text. Return a JSON object with a 'references' array.

Example input: "turn to John chapter 3 verse 16"
Example output: {"references":[{"book":"John","chapter":3,"verse":16,"endVerse":null,"rawText":"John 3:16","confidence":0.95}]}

Input: "%s"`, text)

	reqBody := map[string]interface{}{
		"model":  model,
		"prompt": prompt,
		"stream": false,
		"format": "json", // Force JSON output
		"options": map[string]interface{}{
			"temperature": 0.0,
			"num_predict": 500,
		},
	}

	jsonData, _ := json.Marshal(reqBody)

	client := &http.Client{Timeout: 60 * time.Second} // Allow time for GPU model loading on cold start
	resp, err := client.Post(ollamaURL+"/api/generate", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama returned status %d", resp.StatusCode)
	}

	var ollamaResp OllamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return nil, err
	}

	responseText := strings.TrimSpace(ollamaResp.Response)
	responseText = strings.ReplaceAll(responseText, "```json", "")
	responseText = strings.ReplaceAll(responseText, "```", "")
	responseText = strings.TrimSpace(responseText)

	var references []BibleReference
	if err := json.Unmarshal([]byte(responseText), &references); err != nil {
		var wrapper struct {
			References []BibleReference `json:"references"`
		}
		if err2 := json.Unmarshal([]byte(responseText), &wrapper); err2 != nil {
			return nil, fmt.Errorf("failed to parse Ollama JSON: %v", err)
		}
		references = wrapper.References
	}

	if len(references) == 0 {
		return nil, fmt.Errorf("no references found")
	}

	validated := validateReferences(references, text)
	return validated, nil
}

// parseWithRegex is a fallback method using regex patterns
// Handles common Bible reference formats like "Genesis 1:1", "John 3:16-17", "1 Cor 13:4"
func parseWithRegex(text string) []BibleReference {
	var references []BibleReference

	// Common Bible book names and abbreviations
	bookPattern := `(?:Genesis|Gen|Exodus|Ex|Leviticus|Lev|Numbers|Num|Deuteronomy|Deut|Joshua|Josh|Judges|Judg|Ruth|1 Samuel|1 Sam|2 Samuel|2 Sam|1 Kings|1 Kgs|2 Kings|2 Kgs|1 Chronicles|1 Chr|2 Chronicles|2 Chr|Ezra|Nehemiah|Neh|Esther|Est|Job|Psalms?|Ps|Proverbs?|Prov|Ecclesiastes|Eccl|Song of Solomon|Song|Isaiah|Isa|Jeremiah|Jer|Lamentations|Lam|Ezekiel|Ezek|Daniel|Dan|Hosea|Hos|Joel|Amos|Obadiah|Obad|Jonah|Jon|Micah|Mic|Nahum|Nah|Habakkuk|Hab|Zephaniah|Zeph|Haggai|Hag|Zechariah|Zech|Malachi|Mal|Matthew|Matt|Mark|Luke|John|Acts|Romans|Rom|1 Corinthians|1 Cor|2 Corinthians|2 Cor|Galatians|Gal|Ephesians|Eph|Philippians|Phil|Colossians|Col|1 Thessalonians|1 Thess|2 Thessalonians|2 Thess|1 Timothy|1 Tim|2 Timothy|2 Tim|Titus|Philemon|Phlm|Hebrews|Heb|James|Jas|1 Peter|1 Pet|2 Peter|2 Pet|1 John|2 John|3 John|Jude|Revelation|Rev)`

	// Pattern: BookName Chapter:Verse or BookName Chapter:Verse-EndVerse
	pattern := regexp.MustCompile(fmt.Sprintf(`(?i)\b(%s)\s+(\d+):(\d+)(?:-(\d+))?`, bookPattern))

	matches := pattern.FindAllStringSubmatch(text, -1)
	for _, match := range matches {
		if len(match) >= 4 {
			chapter := parseInt(match[2])
			verse := parseInt(match[3])

			var endVerse *int
			if match[4] != "" {
				ev := parseInt(match[4])
				endVerse = &ev
			}

			references = append(references, BibleReference{
				Book:       normalizeBookName(match[1]),
				Chapter:    chapter,
				Verse:      verse,
				EndVerse:   endVerse,
				RawText:    match[0],
				Confidence: 0.85, // Regex has high confidence but lower than SLM
			})
		}
	}

	return references
}

// Helper function to parse int, returns 0 if invalid
func parseInt(s string) int {
	var result int
	fmt.Sscanf(s, "%d", &result)
	return result
}

// normalizeBookName converts abbreviations to full book names
func normalizeBookName(book string) string {
	bookMap := map[string]string{
		"gen":   "Genesis",
		"ex":    "Exodus",
		"lev":   "Leviticus",
		"num":   "Numbers",
		"deut":  "Deuteronomy",
		"josh":  "Joshua",
		"judg":  "Judges",
		"1 sam": "1 Samuel",
		"2 sam": "2 Samuel",
		"1 kgs": "1 Kings",
		"2 kgs": "2 Kings",
		"1 chr": "1 Chronicles",
		"2 chr": "2 Chronicles",
		"neh":   "Nehemiah",
		"est":   "Esther",
		"ps":    "Psalms",
		"prov":  "Proverbs",
		"eccl":  "Ecclesiastes",
		"song":  "Song of Solomon",
		"isa":   "Isaiah",
		"jer":   "Jeremiah",
		"lam":   "Lamentations",
		"ezek":  "Ezekiel",
		"dan":   "Daniel",
		"hos":   "Hosea",
		"obad":  "Obadiah",
		"jon":   "Jonah",
		"mic":   "Micah",
		"nah":   "Nahum",
		"hab":   "Habakkuk",
		"zeph":  "Zephaniah",
		"hag":   "Haggai",
		"zech":  "Zechariah",
		"mal":   "Malachi",
		"matt":  "Matthew",
		"rom":   "Romans",
		"1 cor": "1 Corinthians",
		"2 cor": "2 Corinthians",
		"gal":   "Galatians",
		"eph":   "Ephesians",
		"phil":  "Philippians",
		"col":   "Colossians",
		"1 thess": "1 Thessalonians",
		"2 thess": "2 Thessalonians",
		"1 tim": "1 Timothy",
		"2 tim": "2 Timothy",
		"phlm":  "Philemon",
		"heb":   "Hebrews",
		"jas":   "James",
		"1 pet": "1 Peter",
		"2 pet": "2 Peter",
		"rev":   "Revelation",
	}

	lowerBook := strings.ToLower(strings.TrimSpace(book))
	if normalized, ok := bookMap[lowerBook]; ok {
		return normalized
	}

	// Return title-cased version if not in map
	return strings.Title(strings.ToLower(book))
}

// validateReferences filters out hallucinated references by checking if they appear in input text
// This prevents the SLM from adding references that weren't actually mentioned
func validateReferences(references []BibleReference, inputText string) []BibleReference {
	validated := []BibleReference{}
	lowerInput := strings.ToLower(inputText)

	for _, ref := range references {
		// Check if the chapter and verse numbers appear in the input text
		// We need flexible patterns to handle natural language like "chapter 8 verse one" or "8:1"

		// Convert verse to words for matching (handle "one", "two", etc.)
		verseWords := map[int]string{
			1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
			6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
			11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen",
			16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen", 20: "twenty",
		}

		chapterStr := fmt.Sprintf("%d", ref.Chapter)
		verseStr := fmt.Sprintf("%d", ref.Verse)
		verseWord := verseWords[ref.Verse]

		// Pattern 1: "chapter X verse Y" (Y as number)
		pattern1 := fmt.Sprintf("chapter\\s+%s\\s+verse\\s+%s", chapterStr, verseStr)
		// Pattern 2: "chapter X verse Y" (Y as word, e.g., "one")
		pattern2 := ""
		if verseWord != "" {
			pattern2 = fmt.Sprintf("chapter\\s+%s\\s+verse\\s+%s", chapterStr, verseWord)
		}
		// Pattern 3: "X:Y" format
		pattern3 := fmt.Sprintf("%s:%s", chapterStr, verseStr)
		// Pattern 4: "chapter X:Y"
		pattern4 := fmt.Sprintf("chapter\\s+%s\\s*:\\s*%s", chapterStr, verseStr)
		// Pattern 5: "X verse Y"
		pattern5 := fmt.Sprintf("%s\\s+verse\\s+%s", chapterStr, verseStr)
		// Pattern 6: Just check if both chapter and verse numbers appear somewhere
		hasChapter := strings.Contains(lowerInput, chapterStr)
		hasVerse := strings.Contains(lowerInput, verseStr) || (verseWord != "" && strings.Contains(lowerInput, verseWord))

		matched1, _ := regexp.MatchString(pattern1, lowerInput)
		matched2 := false
		if pattern2 != "" {
			matched2, _ = regexp.MatchString(pattern2, lowerInput)
		}
		matched3, _ := regexp.MatchString(pattern3, lowerInput)
		matched4, _ := regexp.MatchString(pattern4, lowerInput)
		matched5, _ := regexp.MatchString(pattern5, lowerInput)

		// Accept if ANY pattern matches OR if both chapter and verse are mentioned
		if matched1 || matched2 || matched3 || matched4 || matched5 || (hasChapter && hasVerse) {
			log.Printf("✓ Validated reference: %s %d:%d", ref.Book, ref.Chapter, ref.Verse)
			validated = append(validated, ref)
		} else {
			log.Printf("✗ Rejected hallucinated reference: %s %d:%d (not found in input)", ref.Book, ref.Chapter, ref.Verse)
		}
	}

	return validated
}
