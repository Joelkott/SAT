package versedetect

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/jev"
)

// asker is the subset of *jev.Client used by resolveWithJev (faked in tests).
type asker interface {
	Ask(ctx context.Context, state any, qs map[string]jev.Question) (*jev.Response, error)
}

// jevTask is the fixed task description sent in every Jev state.
const jevTask = "Live speech-to-text captions of a church sermon. Malayalam speech is machine-translated to English, so wording can be rough. Decide whether latest_caption points the listeners to a specific Bible location."

// jevState is the "state" object sent to Jev.
type jevState struct {
	Task             string   `json:"task"`
	EarlierCaptions  []string `json:"earlier_captions"`  // up to 5 previous captions, oldest first
	LatestCaption    string   `json:"latest_caption"`    // the new caption(s) being judged, <= 400 runes
	CurrentPassage   string   `json:"current_passage"`   // e.g. "John 3:16", or "none"
	RecentReferences []string `json:"recent_references"` // up to 5, most recent last, display form
}

// jevResult is the outcome of resolveWithJev.
type jevResult struct {
	Ref         Ref
	Confidence  float64
	Rounds      int
	ContextOnly bool // chapter known, verse not (or "whole_chapter")
	Found       bool
}

const (
	qCites     = "cites"
	qBook      = "book"
	qVerseHere = "verse_here"
	qChapter   = "chapter"
	qVerse     = "verse"

	optNone          = "none"
	optSameAsCurrent = "same_as_current"
	optWholeChapter  = "whole_chapter"
)

const citesInstructions = "latest_caption cites, announces or points the listeners to a specific Bible book, chapter or verse — for example 'turn to John 3', 'verse seventeen', 'look at the next verse', 'go back to verse 4'. Quoting or paraphrasing scripture without saying where it is found does not count, and references that appear only in earlier_captions do not count."

const bookInstructions = "Which Bible book is the location referred to in latest_caption in? Choose same_as_current when latest_caption gives a chapter or verse without naming a book and current_passage is set. Choose none when latest_caption does not refer to a Bible location."

// verseCriteria returns "1".."N" -> "<Book C:v> — <first 8 words>" for a chapter.
func verseCriteria(book string, chapter int, canon Canon) map[string]string {
	out := map[string]string{}
	n := canon.VerseCount(book, chapter)
	label := Ref{Book: book, Chapter: chapter}.Reference()
	for v := 1; v <= n; v++ {
		desc := fmt.Sprintf("%s:%d", label, v)
		if words := strings.Fields(canon.VerseText(book, chapter, v)); len(words) > 0 {
			if len(words) > 8 {
				words = words[:8]
			}
			desc += " — " + strings.Join(words, " ")
		}
		out[strconv.Itoa(v)] = desc
	}
	return out
}

// buildRound1 builds the parallel first-round questions: cites, book and
// (when a current chapter is known) verse_here.
func buildRound1(cur *Ref, canon Canon) map[string]jev.Question {
	bookCrit := map[string]string{optNone: "latest_caption does not refer to a Bible location"}
	if cur != nil {
		bookCrit[optSameAsCurrent] = "a chapter or verse in " + BookName(cur.Book) +
			" (the book of current_passage) without naming another book"
	}
	for _, b := range books {
		bookCrit[b.ID] = b.Name
	}
	qs := map[string]jev.Question{
		qCites: {Type: "noul", Instructions: citesInstructions},
		qBook:  {Type: "choice", Instructions: bookInstructions, Criteria: bookCrit},
	}
	if cur != nil && cur.Chapter > 0 && canon.VerseCount(cur.Book, cur.Chapter) > 0 {
		chap := Ref{Book: cur.Book, Chapter: cur.Chapter}.Reference()
		n := canon.VerseCount(cur.Book, cur.Chapter)
		curVerse := "not set"
		if cur.Verse > 0 {
			curVerse = strconv.Itoa(cur.Verse)
		}
		ins := fmt.Sprintf("If latest_caption points to a verse of %s (the chapter of current_passage; the current verse is %s), which verse?", chap, curVerse)
		if cur.Verse > 0 {
			if cur.Verse+1 <= n {
				ins += fmt.Sprintf(" 'the next verse' means %d.", cur.Verse+1)
			}
			if cur.Verse-1 >= 1 {
				ins += fmt.Sprintf(" 'the previous verse' means %d.", cur.Verse-1)
			}
		}
		ins += " Choose none if it points somewhere else or to no verse."
		crit := verseCriteria(cur.Book, cur.Chapter, canon)
		crit[optNone] = "latest_caption points somewhere else or to no verse of " + chap
		qs[qVerseHere] = jev.Question{Type: "choice", Instructions: ins, Criteria: crit}
	}
	return qs
}

func buildChapterQuestion(book string, canon Canon) map[string]jev.Question {
	name := BookName(book)
	crit := map[string]string{optNone: "no chapter is stated or clearly implied"}
	for c := 1; c <= canon.ChapterCount(book); c++ {
		crit[strconv.Itoa(c)] = fmt.Sprintf("%s chapter %d", name, c)
	}
	return map[string]jev.Question{qChapter: {
		Type:         "choice",
		Instructions: fmt.Sprintf("Which chapter of %s does latest_caption point to? Choose none if no chapter is stated or clearly implied.", name),
		Criteria:     crit,
	}}
}

func buildVerseQuestion(book string, chapter int, canon Canon) map[string]jev.Question {
	chap := Ref{Book: book, Chapter: chapter}.Reference()
	crit := verseCriteria(book, chapter, canon)
	crit[optWholeChapter] = "the chapter " + chap + " as a whole, or no verse is named"
	return map[string]jev.Question{qVerse: {
		Type:         "choice",
		Instructions: fmt.Sprintf("Which verse of %s does latest_caption point to? Choose whole_chapter if it refers to the chapter as a whole or names no verse.", chap),
		Criteria:     crit,
	}}
}

// pickNumber parses a numeric choice and checks 1 <= n <= max.
func pickNumber(a jev.Answer, max int) (int, bool) {
	n, err := strconv.Atoi(a.Choice)
	if err != nil || n < 1 || n > max {
		return 0, false
	}
	return n, true
}

// resolveWithJev resolves a contextual/spoken reference in at most 3 Jev
// rounds (book [+ verse in the current chapter], chapter, verse). Every gating
// answer must reach minConf. budget is consulted before every ask.
func resolveWithJev(ctx context.Context, a asker, st jevState, cur *Ref, canon Canon, minConf float64, budget func() bool) (jevResult, error) {
	var res jevResult
	ask := func(qs map[string]jev.Question) (map[string]jev.Answer, bool, error) {
		if res.Rounds >= 3 || !budget() {
			return nil, false, nil
		}
		res.Rounds++
		resp, err := a.Ask(ctx, st, qs)
		if err != nil {
			return nil, false, err
		}
		return resp.Answers, true, nil
	}

	// Round 1: cites + book (+ verse_here).
	ans, ok, err := ask(buildRound1(cur, canon))
	if err != nil || !ok {
		return res, err
	}
	cites, okC := ans[qCites]
	book, okB := ans[qBook]
	if !okC || !okB || cites.Noul < minConf || book.Choice == optNone || book.Prob() < minConf {
		return res, nil
	}
	conf := math.Min(cites.Noul, book.Prob())

	sameBook := cur != nil && (book.Choice == optSameAsCurrent || book.Choice == cur.Book)
	if sameBook && cur.Chapter > 0 {
		if vh, ok := ans[qVerseHere]; ok && vh.Choice != optNone && vh.Prob() >= minConf {
			if v, ok := pickNumber(vh, canon.VerseCount(cur.Book, cur.Chapter)); ok {
				res.Ref = Ref{Book: cur.Book, Chapter: cur.Chapter, Verse: v}
				res.Confidence = math.Min(conf, vh.Prob())
				res.Found = true
				return res, nil
			}
		}
	}
	var target string
	switch {
	case sameBook:
		target = cur.Book
	case book.Choice == optSameAsCurrent:
		return res, nil // same_as_current without context
	default:
		target = book.Choice
	}
	if _, ok := bookByID(target); !ok || canon.ChapterCount(target) <= 0 {
		return res, nil
	}

	// Round 2: chapter (skipped for single-chapter books).
	chapter := 1
	if n := canon.ChapterCount(target); n > 1 {
		ans, ok, err := ask(buildChapterQuestion(target, canon))
		if err != nil || !ok {
			return res, err
		}
		ch, okCh := ans[qChapter]
		if !okCh || ch.Choice == optNone || ch.Prob() < minConf {
			return res, nil
		}
		c, ok := pickNumber(ch, n)
		if !ok {
			return res, nil
		}
		chapter = c
		conf = math.Min(conf, ch.Prob())
	}

	// Round 3: verse.
	ans, ok, err = ask(buildVerseQuestion(target, chapter, canon))
	if err != nil || !ok {
		return res, err
	}
	chapterRef := Ref{Book: target, Chapter: chapter}
	vs, okV := ans[qVerse]
	if !okV {
		return res, nil
	}
	if vs.Choice == optWholeChapter || vs.Prob() < minConf {
		res.Ref = chapterRef
		res.ContextOnly = true
		return res, nil
	}
	v, okN := pickNumber(vs, canon.VerseCount(target, chapter))
	if !okN {
		res.Ref = chapterRef
		res.ContextOnly = true
		return res, nil
	}
	res.Ref = Ref{Book: target, Chapter: chapter, Verse: v}
	res.Confidence = math.Min(conf, vs.Prob())
	res.Found = true
	return res, nil
}
