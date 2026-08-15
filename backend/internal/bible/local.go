package bible

import (
	"embed"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Bundled Bibles served locally (no api.bible dependency).
// KJV + Malayalam OV come from getbible.net exports (data/generate.py);
// AMPC from a Zefania XML (data/convert_zefania.py); ASV from a bibleapi
// resultset JSON (data/convert_bibleapi.py).
//
//go:embed data/kjv.json data/mal_ov_1910.json data/ampc.json data/asv.json
var localData embed.FS

// USFM book IDs in canonical (Protestant) order — matches api.bible book IDs.
var usfmBooks = []string{
	"GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI",
	"1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER",
	"LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP",
	"HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL",
	"EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
	"2PE", "1JN", "2JN", "3JN", "JUD", "REV",
}

var bookNames = []string{
	"Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
	"1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
	"Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Songs",
	"Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
	"Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
	"Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
	"2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
	"2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
	"1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
}

// Traditional Sathyavedapusthakam book names, canonical order.
var bookNamesMal = []string{
	"ഉല്പത്തി", "പുറപ്പാടു", "ലേവ്യപുസ്തകം", "സംഖ്യാപുസ്തകം", "ആവർത്തനം",
	"യോശുവ", "ന്യായാധിപന്മാർ", "രൂത്ത്", "1 ശമൂവേൽ", "2 ശമൂവേൽ",
	"1 രാജാക്കന്മാർ", "2 രാജാക്കന്മാർ", "1 ദിനവൃത്താന്തം", "2 ദിനവൃത്താന്തം",
	"എസ്രാ", "നെഹെമ്യാവു", "എസ്ഥേർ", "ഇയ്യോബ്", "സങ്കീർത്തനങ്ങൾ",
	"സദൃശ്യവാക്യങ്ങൾ", "സഭാപ്രസംഗി", "ഉത്തമഗീതം", "യെശയ്യാ", "യിരെമ്യാവു",
	"വിലാപങ്ങൾ", "യെഹെസ്കേൽ", "ദാനീയേൽ", "ഹോശേയ", "യോവേൽ", "ആമോസ്",
	"ഓബദ്യാവു", "യോനാ", "മീഖാ", "നഹൂം", "ഹബക്കൂക്", "സെഫന്യാവു",
	"ഹഗ്ഗായി", "സെഖർയ്യാവു", "മലാഖി",
	"മത്തായി", "മർക്കൊസ്", "ലൂക്കൊസ്", "യോഹന്നാൻ", "അപ്പൊസ്തലപ്രവൃത്തികൾ",
	"റോമർ", "1 കൊരിന്ത്യർ", "2 കൊരിന്ത്യർ", "ഗലാത്യർ", "എഫെസ്യർ",
	"ഫിലിപ്പിയർ", "കൊലൊസ്സ്യർ", "1 തെസ്സലൊനീക്യർ", "2 തെസ്സലൊനീക്യർ",
	"1 തിമൊഥെയൊസ്", "2 തിമൊഥെയൊസ്", "തീത്തൊസ്", "ഫിലേമോൻ", "എബ്രായർ",
	"യാക്കോബ്", "1 പത്രൊസ്", "2 പത്രൊസ്", "1 യോഹന്നാൻ", "2 യോഹന്നാൻ",
	"3 യോഹന്നാൻ", "യൂദാ", "വെളിപ്പാടു",
}

var bookAbbrs = []string{
	"Gen", "Exo", "Lev", "Num", "Deu", "Jos", "Jdg", "Rut", "1Sa", "2Sa", "1Ki", "2Ki",
	"1Ch", "2Ch", "Ezr", "Neh", "Est", "Job", "Psa", "Pro", "Ecc", "Sng", "Isa", "Jer",
	"Lam", "Ezk", "Dan", "Hos", "Jol", "Amo", "Oba", "Jon", "Mic", "Nam", "Hab", "Zep",
	"Hag", "Zec", "Mal", "Mat", "Mrk", "Luk", "Jhn", "Act", "Rom", "1Co", "2Co", "Gal",
	"Eph", "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas", "1Pe",
	"2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev",
}

func bookIndex(usfm string) int {
	for i, b := range usfmBooks {
		if b == usfm {
			return i
		}
	}
	return -1
}

// localBible is one bundled translation: book -> chapter -> verse -> text.
type localBible struct {
	meta Bible
	data map[string]map[string]map[string]string
	// names holds localized book display names in canonical order; falls back
	// to English bookNames when nil.
	names []string
}

// bookName returns the localized display name for a USFM book ID.
func (lb *localBible) bookName(bookID string) string {
	i := bookIndex(bookID)
	if i < 0 {
		return bookID
	}
	if lb.names != nil {
		return lb.names[i]
	}
	return bookNames[i]
}

// LocalProvider serves bundled Bibles with api.bible-compatible response shapes.
type LocalProvider struct {
	bibles map[string]*localBible
	order  []string // stable display order of bible IDs
}

// NewLocalProvider loads the embedded Bible data. Panics on malformed embed
// (a build-time asset problem, not a runtime condition).
func NewLocalProvider() *LocalProvider {
	lp := &LocalProvider{bibles: map[string]*localBible{}}

	load := func(id, file string, meta Bible, names []string) {
		raw, err := localData.ReadFile(file)
		if err != nil {
			panic(fmt.Sprintf("bible: cannot read embedded %s: %v", file, err))
		}
		var data map[string]map[string]map[string]string
		if err := json.Unmarshal(raw, &data); err != nil {
			panic(fmt.Sprintf("bible: cannot parse embedded %s: %v", file, err))
		}
		meta.ID = id
		lp.bibles[id] = &localBible{meta: meta, data: data, names: names}
		lp.order = append(lp.order, id)
	}

	load("local-kjv", "data/kjv.json", Bible{
		Name:              "King James Version (Local)",
		NameLocal:         "King James Version",
		Abbreviation:      "KJV",
		AbbreviationLocal: "KJV",
		Description:       "Public-domain KJV, bundled locally",
		DescriptionLocal:  "Public-domain KJV, bundled locally",
		Language:          Language{ID: "eng", Name: "English", NameLocal: "English", Script: "Latin", Direction: "ltr"},
	}, nil)
	load("local-mal-ov", "data/mal_ov_1910.json", Bible{
		Name:              "Malayalam Sathyavedapusthakam O.V. (1910)",
		NameLocal:         "സത്യവേദപുസ്തകം O.V. (1910)",
		Abbreviation:      "MOV",
		AbbreviationLocal: "സത്യവേദപുസ്തകം",
		Description:       "Public-domain Malayalam Old Version, bundled locally",
		DescriptionLocal:  "പൊതുസഞ്ചയത്തിലുള്ള മലയാളം പഴയ പതിപ്പ്",
		Language:          Language{ID: "mal", Name: "Malayalam", NameLocal: "മലയാളം", Script: "Malayalam", Direction: "ltr"},
	}, bookNamesMal)
	load("local-ampc", "data/ampc.json", Bible{
		Name:              "Amplified Bible, Classic Edition",
		NameLocal:         "Amplified Bible, Classic Edition",
		Abbreviation:      "AMPC",
		AbbreviationLocal: "AMPC",
		Description:       "Amplified Bible, Classic Edition, bundled locally",
		DescriptionLocal:  "Amplified Bible, Classic Edition, bundled locally",
		Language:          Language{ID: "eng", Name: "English", NameLocal: "English", Script: "Latin", Direction: "ltr"},
	}, nil)
	load("local-asv", "data/asv.json", Bible{
		Name:              "American Standard Version (1901)",
		NameLocal:         "American Standard Version",
		Abbreviation:      "ASV",
		AbbreviationLocal: "ASV",
		Description:       "Public-domain ASV (1901), bundled locally",
		DescriptionLocal:  "Public-domain ASV (1901), bundled locally",
		Language:          Language{ID: "eng", Name: "English", NameLocal: "English", Script: "Latin", Direction: "ltr"},
	}, nil)

	return lp
}

// Has reports whether the given bible ID is served locally.
func (lp *LocalProvider) Has(bibleID string) bool {
	_, ok := lp.bibles[bibleID]
	return ok
}

// Bibles returns metadata for all bundled translations, in display order.
func (lp *LocalProvider) Bibles() []Bible {
	out := make([]Bible, 0, len(lp.order))
	for _, id := range lp.order {
		out = append(out, lp.bibles[id].meta)
	}
	return out
}

// GetBooks returns the 66 canonical books for a bundled Bible.
func (lp *LocalProvider) GetBooks(bibleID string) ([]Book, error) {
	lb, ok := lp.bibles[bibleID]
	if !ok {
		return nil, fmt.Errorf("bible: local bible %q not found", bibleID)
	}
	books := make([]Book, 0, len(usfmBooks))
	for i, id := range usfmBooks {
		if _, present := lb.data[id]; !present {
			continue
		}
		// Name is localized for display; NameLong keeps the English name so
		// English reference search still matches non-English translations.
		books = append(books, Book{
			ID:           id,
			BibleID:      bibleID,
			Abbreviation: bookAbbrs[i],
			Name:         lb.bookName(id),
			NameLong:     bookNames[i],
		})
	}
	return books, nil
}

// GetChapters returns chapters for a book, sorted numerically.
func (lp *LocalProvider) GetChapters(bibleID, bookID string) ([]Chapter, error) {
	lb, ok := lp.bibles[bibleID]
	if !ok {
		return nil, fmt.Errorf("bible: local bible %q not found", bibleID)
	}
	chapters, ok := lb.data[bookID]
	if !ok {
		return nil, fmt.Errorf("bible: book %q not found in %q", bookID, bibleID)
	}
	name := lb.bookName(bookID)
	nums := sortedNumericKeys(chapters)
	out := make([]Chapter, 0, len(nums))
	for _, n := range nums {
		out = append(out, Chapter{
			ID:        fmt.Sprintf("%s.%s", bookID, n),
			BibleID:   bibleID,
			BookID:    bookID,
			Number:    n,
			Reference: fmt.Sprintf("%s %s", name, n),
		})
	}
	return out, nil
}

// GetChapterContent returns full chapter text with [n] verse markers.
func (lp *LocalProvider) GetChapterContent(bibleID, chapterID string) (*ChapterContentResponse, error) {
	lb, ok := lp.bibles[bibleID]
	if !ok {
		return nil, fmt.Errorf("bible: local bible %q not found", bibleID)
	}
	bookID, chapNum, ok := splitChapterID(chapterID)
	if !ok {
		return nil, fmt.Errorf("bible: invalid chapter id %q", chapterID)
	}
	verses, ok := lb.data[bookID][chapNum]
	if !ok {
		return nil, fmt.Errorf("bible: chapter %q not found in %q", chapterID, bibleID)
	}
	var resp ChapterContentResponse
	resp.Data.ID = chapterID
	resp.Data.BibleID = bibleID
	resp.Data.BookID = bookID
	resp.Data.Number = chapNum
	resp.Data.Reference = fmt.Sprintf("%s %s", lb.bookName(bookID), chapNum)
	resp.Data.Content = renderVerses(verses, sortedNumericKeys(verses))
	return &resp, nil
}

// GetVerse returns a single verse as plain text.
func (lp *LocalProvider) GetVerse(bibleID, verseID string) (*Verse, error) {
	lb, ok := lp.bibles[bibleID]
	if !ok {
		return nil, fmt.Errorf("bible: local bible %q not found", bibleID)
	}
	bookID, chapNum, verseNum, ok := splitVerseID(verseID)
	if !ok {
		return nil, fmt.Errorf("bible: invalid verse id %q", verseID)
	}
	text, ok := lb.data[bookID][chapNum][verseNum]
	if !ok {
		return nil, fmt.Errorf("bible: verse %q not found in %q", verseID, bibleID)
	}
	return &Verse{
		ID:        verseID,
		OrgID:     verseID,
		BibleID:   bibleID,
		BookID:    bookID,
		ChapterID: fmt.Sprintf("%s.%s", bookID, chapNum),
		Reference: fmt.Sprintf("%s %s:%s", lb.bookName(bookID), chapNum, verseNum),
		Text:      text,
	}, nil
}

// GetPassage handles single verse (BOOK.C.V), range (BOOK.C.V1-BOOK.C.V2),
// and whole chapter (BOOK.C) passage IDs, matching how the frontend builds them.
func (lp *LocalProvider) GetPassage(bibleID, passageID string) (*Passage, error) {
	lb, ok := lp.bibles[bibleID]
	if !ok {
		return nil, fmt.Errorf("bible: local bible %q not found", bibleID)
	}

	startRaw, endRaw, isRange := strings.Cut(passageID, "-")
	startParts := strings.Split(startRaw, ".")
	if len(startParts) < 2 {
		return nil, fmt.Errorf("bible: invalid passage id %q", passageID)
	}
	bookID, chapNum := startParts[0], startParts[1]
	chapter, ok := lb.data[bookID][chapNum]
	if !ok {
		return nil, fmt.Errorf("bible: passage %q not found in %q", passageID, bibleID)
	}
	name := lb.bookName(bookID)

	// Whole chapter (also covers chapter ranges like GEN.1-GEN.3, which we
	// serve as the starting chapter rather than panicking on a missing verse part).
	if len(startParts) == 2 {
		nums := sortedNumericKeys(chapter)
		return &Passage{
			ID:        passageID,
			BibleID:   bibleID,
			OrgID:     passageID,
			Reference: fmt.Sprintf("%s %s", name, chapNum),
			Content:   renderVerses(chapter, nums),
		}, nil
	}

	startV := startParts[2]
	endV := startV
	if isRange {
		endParts := strings.Split(endRaw, ".")
		endV = endParts[len(endParts)-1]
	}

	si, _ := strconv.Atoi(startV)
	ei, _ := strconv.Atoi(endV)
	if ei < si {
		si, ei = ei, si
	}
	var selected []string
	for _, n := range sortedNumericKeys(chapter) {
		vi, _ := strconv.Atoi(n)
		if vi >= si && vi <= ei {
			selected = append(selected, n)
		}
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("bible: passage %q has no verses in %q", passageID, bibleID)
	}

	ref := fmt.Sprintf("%s %s:%s", name, chapNum, startV)
	if startV != endV {
		ref = fmt.Sprintf("%s %s:%s-%s", name, chapNum, startV, endV)
	}
	return &Passage{
		ID:        passageID,
		BibleID:   bibleID,
		OrgID:     passageID,
		Reference: ref,
		Content:   renderVerses(chapter, selected),
	}, nil
}

// --- helpers ---

func splitChapterID(id string) (book, chap string, ok bool) {
	parts := strings.Split(id, ".")
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func splitVerseID(id string) (book, chap, verse string, ok bool) {
	parts := strings.Split(id, ".")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func sortedNumericKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		ai, _ := strconv.Atoi(keys[i])
		aj, _ := strconv.Atoi(keys[j])
		return ai < aj
	})
	return keys
}

// renderVerses builds "[n] text" content matching api.bible's text format
// (include-verse-numbers=true), which the frontend VerseDisplay parses.
func renderVerses(verses map[string]string, order []string) string {
	var b strings.Builder
	for i, n := range order {
		if i > 0 {
			b.WriteString(" ")
		}
		b.WriteString("[")
		b.WriteString(n)
		b.WriteString("] ")
		b.WriteString(verses[n])
	}
	return b.String()
}
