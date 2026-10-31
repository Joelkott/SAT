// Package versedetect detects Bible references in live sermon captions and
// turns them into suggestions for the media Bible panel.
package versedetect

import "fmt"

// Ref is a Bible location. Verse == 0 means chapter-only. EndVerse == 0 means single verse.
type Ref struct {
	Book     string // USFM id, e.g. "JHN"
	Chapter  int
	Verse    int
	EndVerse int
}

// Passage is the language-neutral id the frontend navigates by: "JHN 3:16", "JHN 3:16-18", "JHN 3".
func (r Ref) Passage() string {
	return r.Book + " " + r.chapterVerse()
}

// Reference is the English display form: "John 3:16", "1 Corinthians 13:4-7", "Psalms 23".
func (r Ref) Reference() string {
	name := BookName(r.Book)
	if name == "" {
		name = r.Book
	}
	return name + " " + r.chapterVerse()
}

func (r Ref) chapterVerse() string {
	if r.Verse <= 0 {
		return fmt.Sprintf("%d", r.Chapter)
	}
	if r.EndVerse > r.Verse {
		return fmt.Sprintf("%d:%d-%d", r.Chapter, r.Verse, r.EndVerse)
	}
	return fmt.Sprintf("%d:%d", r.Chapter, r.Verse)
}

// Canon validates references against bundled Bible data (implemented by *bible.LocalProvider).
type Canon interface {
	ChapterCount(book string) int
	VerseCount(book string, chapter int) int
	VerseText(book string, chapter, verse int) string
}

// Detection is one suggestion shown on the media Bible panel.
type Detection struct {
	ID         int64   `json:"id"`
	Passage    string  `json:"passage"`    // "JHN 3:17"
	Reference  string  `json:"reference"`  // "John 3:17"
	Confidence float64 `json:"confidence"` // 0..1
	Source     string  `json:"source"`     // "explicit" | "context" | "jev"
	Snippet    string  `json:"snippet"`    // triggering caption, <=140 runes, "…" if cut
	CreatedAt  int64   `json:"created_at"` // unix ms (server clock)
	AgeMs      int64   `json:"age_ms"`     // filled per response: now - CreatedAt
}

// Status drives the small indicator + toggle on the media Bible panel.
type Status struct {
	Configured     bool   `json:"configured"`      // a stream URL is set (not "off")
	Enabled        bool   `json:"enabled"`         // operator toggle (server-side, default true)
	Stream         string `json:"stream"`          // "disabled" | "connecting" | "connected" | "offline"
	ServiceStatus  string `json:"service_status"`  // last caption-service status ("" until known): offline|connecting|ready|live|paused|ended
	Listening      bool   `json:"listening"`       // Configured && Enabled && Stream=="connected" && ServiceStatus in {"", "ready", "live"}
	Jev            bool   `json:"jev"`             // TYPESAFE_API_KEY present
	LastCaptionAt  int64  `json:"last_caption_at"` // unix ms of last live (non-replay) caption, 0 if none
	CurrentPassage string `json:"current_passage"` // discourse context, e.g. "JHN 3:16", "" if none
}

// PollResponse is returned by GET /api/verse-detect/suggestions.
type PollResponse struct {
	Version    int64       `json:"version"`    // bumps on new detection or status change; pass back as ?since=
	Detections []Detection `json:"detections"` // fresh ones (age <= TTL), oldest first, at most 5, never null
	Status     Status      `json:"status"`
}

const (
	SourceExplicit = "explicit"
	SourceContext  = "context"
	SourceJev      = "jev"
)
