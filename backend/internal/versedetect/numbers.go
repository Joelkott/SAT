package versedetect

import (
	"strconv"
	"strings"
	"unicode"
)

var unitWords = map[string]int{
	"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
	"seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
	"thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
	"seventeen": 17, "eighteen": 18, "nineteen": 19,
}

var tensWords = map[string]int{
	"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
	"sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

var ordinalWords = map[string]string{
	"first": "1", "second": "2", "third": "3",
	"1st": "1", "2nd": "2", "3rd": "3",
	"i": "1", "ii": "2", "iii": "3",
}

// Bases of numbered books ("1 samuel" .. "3 john"): an ordinal is converted
// only directly before one of these.
var numberedBookBases = map[string]bool{
	"samuel": true, "kings": true, "chronicles": true, "corinthians": true,
	"thessalonians": true, "timothy": true, "peter": true, "john": true,
}

// parseBelow100 reads a number below 100 starting at toks[i]: "seventeen",
// "twenty", "twenty eight", "twenty-eight". Returns value and tokens consumed.
func parseBelow100(toks []string, i int) (int, int) {
	if i >= len(toks) {
		return 0, 0
	}
	t := toks[i]
	if v, ok := unitWords[t]; ok {
		return v, 1
	}
	if tens, unit, ok := strings.Cut(t, "-"); ok {
		tv, ok1 := tensWords[tens]
		uv, ok2 := unitWords[unit]
		if ok1 && ok2 && uv >= 1 && uv <= 9 {
			return tv + uv, 1
		}
		return 0, 0
	}
	if tv, ok := tensWords[t]; ok {
		if i+1 < len(toks) {
			if uv, ok := unitWords[toks[i+1]]; ok && uv >= 1 && uv <= 9 {
				return tv + uv, 2
			}
		}
		return tv, 1
	}
	return 0, 0
}

// parseNumber reads a spoken number (max 199) starting at toks[i].
func parseNumber(toks []string, i int) (int, int) {
	if i+1 < len(toks) && (toks[i] == "one" || toks[i] == "a") && toks[i+1] == "hundred" {
		j := i + 2
		if j+1 < len(toks) && toks[j] == "and" {
			if _, n := parseBelow100(toks, j+1); n > 0 {
				j++
			}
		}
		v, n := parseBelow100(toks, j)
		return 100 + v, j + n - i
	}
	return parseBelow100(toks, i)
}

// normalizeNumbers rewrites spoken numbers as digits ("twenty eight" -> "28")
// and numbered-book ordinals ("first corinthians" -> "1 corinthians"). Input
// must already be lowercased; other tokens are left unchanged.
func normalizeNumbers(s string) string {
	toks := strings.Fields(s)
	out := make([]string, 0, len(toks))
	for i := 0; i < len(toks); {
		t := toks[i]
		if d, ok := ordinalWords[t]; ok && i+1 < len(toks) && numberedBookBases[toks[i+1]] {
			out = append(out, d)
			i++
			continue
		}
		if v, n := parseNumber(toks, i); n > 0 {
			out = append(out, strconv.Itoa(v))
			i += n
			continue
		}
		out = append(out, t)
		i++
	}
	return strings.Join(out, " ")
}

// mostlyNonLatin reports whether more than half of the letters in s are not
// Latin script (e.g. an untranslated Malayalam caption line).
func mostlyNonLatin(s string) bool {
	letters, nonLatin := 0, 0
	for _, r := range s {
		if !unicode.IsLetter(r) {
			continue
		}
		letters++
		if !unicode.Is(unicode.Latin, r) {
			nonLatin++
		}
	}
	return letters > 0 && nonLatin*2 > letters
}
