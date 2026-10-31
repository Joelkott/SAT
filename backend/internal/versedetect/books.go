package versedetect

import (
	"sort"
	"strings"
)

// USFM book IDs in canonical (Protestant) order (copied from package bible).
var usfmBooks = []string{
	"GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI",
	"1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER",
	"LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP",
	"HAG", "ZEC", "MAL", "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL",
	"EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
	"2PE", "1JN", "2JN", "3JN", "JUD", "REV",
}

// English display names, canonical order (copied from package bible).
var bookNamesEn = []string{
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

// BookName returns the English display name for a USFM id ("" if unknown).
func BookName(id string) string {
	for i, b := range usfmBooks {
		if b == id {
			return bookNamesEn[i]
		}
	}
	return ""
}

// Traditional Sathyavedapusthakam book names, canonical order (copied from package bible).
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

// bookAliases is ported from frontend BOOK_ALIASES (components/bible/verseUtils.ts):
// typed abbreviation -> USFM id. Only keys of length >= 3 are used (colon form only).
var bookAliases = map[string]string{
	"gen": "GEN", "ge": "GEN", "gn": "GEN",
	"ex": "EXO", "exo": "EXO", "exod": "EXO",
	"lev": "LEV", "lv": "LEV",
	"num": "NUM", "nm": "NUM", "nu": "NUM",
	"deut": "DEU", "deu": "DEU", "dt": "DEU",
	"josh": "JOS", "jos": "JOS",
	"judg": "JDG", "jdg": "JDG", "jgs": "JDG",
	"ruth": "RUT", "rut": "RUT", "ru": "RUT",
	"1sam": "1SA", "1sa": "1SA", "2sam": "2SA", "2sa": "2SA",
	"1kgs": "1KI", "1ki": "1KI", "2kgs": "2KI", "2ki": "2KI",
	"1chr": "1CH", "1ch": "1CH", "2chr": "2CH", "2ch": "2CH",
	"ezra": "EZR", "ezr": "EZR",
	"neh": "NEH", "ne": "NEH",
	"est": "EST", "esth": "EST",
	"job": "JOB", "jb": "JOB",
	"ps": "PSA", "pss": "PSA", "psa": "PSA", "psalm": "PSA", "psalms": "PSA",
	"prov": "PRO", "pro": "PRO", "pr": "PRO", "prv": "PRO",
	"eccl": "ECC", "ecc": "ECC", "ec": "ECC", "qoh": "ECC",
	"song": "SNG", "sos": "SNG", "ss": "SNG", "sng": "SNG", "cant": "SNG",
	"isa": "ISA", "is": "ISA",
	"jer": "JER", "je": "JER",
	"lam": "LAM", "la": "LAM",
	"ezek": "EZK", "ezk": "EZK", "eze": "EZK",
	"dan": "DAN", "dn": "DAN",
	"hos": "HOS", "ho": "HOS",
	"joel": "JOL", "jol": "JOL", "jl": "JOL",
	"amos": "AMO", "amo": "AMO", "am": "AMO",
	"obad": "OBA", "oba": "OBA", "ob": "OBA",
	"jon": "JON", "jnh": "JON",
	"mic": "MIC", "mi": "MIC",
	"nah": "NAM", "nam": "NAM", "na": "NAM",
	"hab": "HAB", "hb": "HAB",
	"zeph": "ZEP", "zep": "ZEP", "zp": "ZEP",
	"hag": "HAG", "hg": "HAG",
	"zech": "ZEC", "zec": "ZEC", "zc": "ZEC",
	"mal": "MAL", "ml": "MAL",
	"matt": "MAT", "mat": "MAT", "mt": "MAT",
	"mark": "MRK", "mrk": "MRK", "mk": "MRK", "mr": "MRK",
	"luke": "LUK", "luk": "LUK", "lk": "LUK", "lu": "LUK",
	"john": "JHN", "jhn": "JHN", "jn": "JHN",
	"acts": "ACT", "act": "ACT", "ac": "ACT",
	"rom": "ROM", "ro": "ROM", "rm": "ROM",
	"1cor": "1CO", "1co": "1CO", "2cor": "2CO", "2co": "2CO",
	"gal": "GAL", "ga": "GAL",
	"eph": "EPH", "ep": "EPH",
	"phil": "PHP", "php": "PHP", "pp": "PHP",
	"col":    "COL",
	"1thess": "1TH", "1thes": "1TH", "1th": "1TH",
	"2thess": "2TH", "2thes": "2TH", "2th": "2TH",
	"1tim": "1TI", "1ti": "1TI", "2tim": "2TI", "2ti": "2TI",
	"tit": "TIT", "ti": "TIT",
	"phlm": "PHM", "phm": "PHM", "philem": "PHM",
	"heb": "HEB", "he": "HEB",
	"jas": "JAS", "jam": "JAS", "jm": "JAS",
	"1pet": "1PE", "1pe": "1PE", "1pt": "1PE",
	"2pet": "2PE", "2pe": "2PE", "2pt": "2PE",
	"1john": "1JN", "1jn": "1JN", "1jo": "1JN",
	"2john": "2JN", "2jn": "2JN", "2jo": "2JN",
	"3john": "3JN", "3jn": "3JN", "3jo": "3JN",
	"jude": "JUD", "jud": "JUD",
	"rev": "REV", "re": "REV", "rv": "REV", "apoc": "REV",
}

// Extra spoken names (lowercase) beyond the lowercased English display name.
var extraNames = map[string][]string{
	"PSA": {"psalm", "psalms"},
	"SNG": {"song of solomon", "song of songs", "songs of solomon"},
	"REV": {"revelation", "revelations"},
	"PHP": {"philippians", "phillipians"},
	"ACT": {"acts", "acts of the apostles"},
}

// Book names that are also everyday English words: they only count as a book
// in the colon form ("Mark 4:39") or with the word "chapter" ("Mark chapter 4").
var ambiguousBooks = map[string]bool{"JOB": true, "ACT": true, "MRK": true, "NUM": true, "JDG": true}

type bookInfo struct {
	ID        string
	Name      string   // English display name
	Names     []string // spoken full names, lowercase, normalized form
	Abbrs     []string // colon-form only
	Ambiguous bool
}

// books holds all 66 books in canonical order.
var books = buildBooks()

func buildBooks() []bookInfo {
	out := make([]bookInfo, len(usfmBooks))
	nameSet := map[string]bool{}
	for i, id := range usfmBooks {
		b := bookInfo{ID: id, Name: bookNamesEn[i], Ambiguous: ambiguousBooks[id]}
		seen := map[string]bool{}
		add := func(n string) {
			if n == "" || seen[n] {
				return
			}
			seen[n] = true
			nameSet[n] = true
			b.Names = append(b.Names, n)
		}
		lower := strings.ToLower(bookNamesEn[i])
		add(lower)
		for _, n := range extraNames[id] {
			add(n)
		}
		// Numbered books: "1 samuel" and "1samuel".
		if len(lower) > 2 && lower[0] >= '1' && lower[0] <= '3' && lower[1] == ' ' {
			add(lower[:1] + lower[2:])
		}
		add(bookNamesMal[i])
		out[i] = b
	}
	for alias, id := range bookAliases {
		if len(alias) < 3 || nameSet[alias] {
			continue
		}
		for i := range out {
			if out[i].ID == id {
				out[i].Abbrs = append(out[i].Abbrs, alias)
			}
		}
	}
	for i := range out {
		sort.Strings(out[i].Abbrs)
	}
	return out
}

func bookByID(id string) (bookInfo, bool) {
	for _, b := range books {
		if b.ID == id {
			return b, true
		}
	}
	return bookInfo{}, false
}
