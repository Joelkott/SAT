package versedetect

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// Hit is one explicit reference found in a caption.
type Hit struct {
	Ref   Ref
	Kind  string // KindFull | KindChapter | KindVerse
	Start int    // byte offsets in the normalized text (for overlap handling)
	End   int
}

const (
	KindFull    = "full"    // book + chapter + verse spoken together
	KindChapter = "chapter" // book + chapter only (context, not a suggestion)
	KindVerse   = "verse"   // verse resolved against the discourse context
)

// Leading word boundary: Go RE2 has no lookbehind and \b is ASCII-only, so the
// boundary character is consumed and the real match start comes from group 1.
const lead = `(?:^|[^\p{L}\p{N}\p{M}])`

const rangeTail = `(?: ?(?:-|to|through) ?(\d+))?`

type patterns struct {
	full      *regexp.Regexp // NAME (chapter )?C(:| verses? | and verses? )V(range)?
	abbr      *regexp.Regexp // ABBR ?C:V(-V2)?
	chapter   *regexp.Regexp // NAME (chapter )?C
	ctxChap   *regexp.Regexp // chapter C (and )?verses? V(range)?
	ctxVerse  *regexp.Regexp // verses? V(range)?
	nameToID  map[string]string
	abbrToID  map[string]string
	ambiguous map[string]bool
}

var (
	patOnce sync.Once
	pat     patterns
)

func alternation(words []string) string {
	sort.Slice(words, func(i, j int) bool {
		if len(words[i]) != len(words[j]) {
			return len(words[i]) > len(words[j])
		}
		return words[i] < words[j]
	})
	quoted := make([]string, len(words))
	for i, w := range words {
		quoted[i] = regexp.QuoteMeta(w)
	}
	return strings.Join(quoted, "|")
}

func compiled() *patterns {
	patOnce.Do(func() {
		pat.nameToID = map[string]string{}
		pat.abbrToID = map[string]string{}
		pat.ambiguous = map[string]bool{}
		var names, abbrs []string
		for _, b := range books {
			for _, n := range b.Names {
				pat.nameToID[n] = b.ID
				names = append(names, n)
			}
			for _, a := range b.Abbrs {
				pat.abbrToID[a] = b.ID
				abbrs = append(abbrs, a)
			}
			pat.ambiguous[b.ID] = b.Ambiguous
		}
		nameAlt := alternation(names)
		abbrAlt := alternation(abbrs)
		pat.full = regexp.MustCompile(lead + `(` + nameAlt + `) (chapter )?(\d+)(:| verses? | and verses? )(\d+)` + rangeTail)
		pat.abbr = regexp.MustCompile(lead + `(` + abbrAlt + `) ?(\d+):(\d+)(?:-(\d+))?`)
		pat.chapter = regexp.MustCompile(lead + `(` + nameAlt + `) (chapter )?(\d+)`)
		pat.ctxChap = regexp.MustCompile(lead + `(chapter) (\d+) (?:and )?verses? (\d+)` + rangeTail)
		pat.ctxVerse = regexp.MustCompile(lead + `(verses?) (\d+)` + rangeTail)
	})
	return &pat
}

// normalizeText lowercases a caption, strips punctuation that never belongs to
// a reference, keeps ':' / '-' between digits and spells numbers as digits.
func normalizeText(text string) string {
	rs := []rune(strings.ToLower(text))
	isDigit := func(i int) bool { return i >= 0 && i < len(rs) && unicode.IsDigit(rs[i]) }
	var b strings.Builder
	for i, r := range rs {
		switch r {
		case '.', ',', ';', '!', '?', '(', ')', '"', '[', ']', '“', '”':
			if r == '.' && isDigit(i-1) && isDigit(i+1) {
				b.WriteRune(':') // "John 3.16"
			} else {
				b.WriteRune(' ')
			}
		case '‘', '’':
			b.WriteRune('\'')
		case '–', '—':
			if isDigit(i-1) && isDigit(i+1) {
				b.WriteRune('-')
			} else {
				b.WriteRune(' ')
			}
		default:
			if unicode.IsSpace(r) {
				b.WriteRune(' ')
			} else {
				b.WriteRune(r)
			}
		}
	}
	return normalizeNumbers(strings.Join(strings.Fields(b.String()), " "))
}

// candidate is a raw regex match awaiting context resolution + validation.
type candidate struct {
	start, end int
	kind       string // KindFull | KindChapter | KindVerse
	book       string // "" for context-relative candidates
	chapter    int    // 0 = take from context
	verse      int
	endVerse   int
	reject     bool // claims its span but yields nothing (ambiguous book)
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// trailingOK reports whether the match ends at a word boundary.
func trailingOK(s string, end int) bool {
	if end >= len(s) {
		return true
	}
	r, _ := utf8.DecodeRuneInString(s[end:])
	return !(unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r))
}

func overlaps(cands []candidate, start, end int) bool {
	for _, c := range cands {
		if start < c.end && c.start < end {
			return true
		}
	}
	return false
}

// ParseExplicit finds explicit references in one caption. ctx is the current
// discourse passage (may be nil); chapter hits found earlier in the same text
// become context for later relative hits. Every returned Ref is validated
// against canon (chapter <= ChapterCount, verse/endVerse <= VerseCount).
func ParseExplicit(text string, ctx *Ref, canon Canon) []Hit {
	p := compiled()
	s := normalizeText(text)
	var cands []candidate

	// collect runs one pattern, skipping matches overlapping earlier ones.
	collect := func(re *regexp.Regexp, build func(m []int) (candidate, bool)) {
		for _, m := range re.FindAllStringSubmatchIndex(s, -1) {
			start, end := m[2], m[1]
			if !trailingOK(s, end) || overlaps(cands, start, end) {
				continue
			}
			c, ok := build(m)
			if !ok {
				continue
			}
			c.start, c.end = start, end
			cands = append(cands, c)
		}
	}
	group := func(m []int, g int) string {
		if m[2*g] < 0 {
			return ""
		}
		return s[m[2*g]:m[2*g+1]]
	}

	// 1. full: NAME (chapter )?C sep V(range)?
	collect(p.full, func(m []int) (candidate, bool) {
		id := p.nameToID[group(m, 1)]
		c := candidate{kind: KindFull, book: id, chapter: atoi(group(m, 3)),
			verse: atoi(group(m, 5)), endVerse: atoi(group(m, 6))}
		if p.ambiguous[id] && group(m, 4) != ":" && group(m, 2) == "" {
			c.reject = true
		}
		return c, true
	})
	// 1b. abbreviations, colon form only.
	collect(p.abbr, func(m []int) (candidate, bool) {
		return candidate{kind: KindFull, book: p.abbrToID[group(m, 1)], chapter: atoi(group(m, 2)),
			verse: atoi(group(m, 3)), endVerse: atoi(group(m, 4))}, true
	})
	// 2. chapter-only: NAME (chapter )?C
	collect(p.chapter, func(m []int) (candidate, bool) {
		id := p.nameToID[group(m, 1)]
		if p.ambiguous[id] && group(m, 2) == "" {
			return candidate{}, false
		}
		n := atoi(group(m, 3))
		if canon.ChapterCount(id) == 1 {
			// Single-chapter book ("Jude 5"): the number is the verse.
			return candidate{kind: KindFull, book: id, chapter: 1, verse: n}, true
		}
		return candidate{kind: KindChapter, book: id, chapter: n}, true
	})
	// 3. context chapter + verse: chapter C (and )?verses? V(range)?
	collect(p.ctxChap, func(m []int) (candidate, bool) {
		return candidate{kind: KindVerse, chapter: atoi(group(m, 2)),
			verse: atoi(group(m, 3)), endVerse: atoi(group(m, 4))}, true
	})
	// 4. context verse: verses? V(range)?
	collect(p.ctxVerse, func(m []int) (candidate, bool) {
		return candidate{kind: KindVerse, verse: atoi(group(m, 2)), endVerse: atoi(group(m, 3))}, true
	})

	sort.Slice(cands, func(i, j int) bool { return cands[i].start < cands[j].start })

	var cur Ref
	if ctx != nil {
		cur = *ctx
	}
	var hits []Hit
	for _, c := range cands {
		if c.reject {
			continue
		}
		ref := Ref{Book: c.book, Chapter: c.chapter, Verse: c.verse, EndVerse: c.endVerse}
		if ref.Book == "" {
			if cur.Book == "" {
				continue
			}
			ref.Book = cur.Book
			if ref.Chapter == 0 {
				if cur.Chapter == 0 {
					continue
				}
				ref.Chapter = cur.Chapter
			}
		}
		ref, ok := validate(ref, canon)
		if !ok {
			continue
		}
		hits = append(hits, Hit{Ref: ref, Kind: c.kind, Start: c.start, End: c.end})
		cur = ref
	}
	return hits
}

// validate checks a ref against the canon, normalizing EndVerse. Chapter-only
// refs (Verse == 0) only need a valid chapter.
func validate(r Ref, canon Canon) (Ref, bool) {
	if r.Chapter < 1 || r.Chapter > canon.ChapterCount(r.Book) {
		return r, false
	}
	if r.Verse == 0 {
		r.EndVerse = 0
		return r, true
	}
	max := canon.VerseCount(r.Book, r.Chapter)
	if r.Verse < 1 || r.Verse > max {
		return r, false
	}
	if r.EndVerse <= r.Verse {
		r.EndVerse = 0
	} else if r.EndVerse > max {
		r.EndVerse = max
	}
	return r, true
}
