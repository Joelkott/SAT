package versedetect

import (
	"strings"
	"sync"
	"testing"

	"github.com/yourusername/audience-stage-teleprompter/internal/bible"
)

var (
	testCanonOnce sync.Once
	testCanon     Canon
)

// kjv returns the real bundled KJV canon (loaded once per test binary).
func kjv() Canon {
	testCanonOnce.Do(func() { testCanon = bible.NewLocalProvider() })
	return testCanon
}

func hitStrings(hits []Hit) []string {
	out := []string{}
	for _, h := range hits {
		out = append(out, h.Ref.Passage()+" "+h.Kind)
	}
	return out
}

func TestParseExplicit(t *testing.T) {
	jhn316 := &Ref{Book: "JHN", Chapter: 3, Verse: 16}
	rom828 := &Ref{Book: "ROM", Chapter: 8, Verse: 28}
	cor13 := &Ref{Book: "1CO", Chapter: 13}

	cases := []struct {
		name string
		text string
		ctx  *Ref
		want []string
	}{
		{"spoken chapter verse", "Please turn to John chapter 3 verse 16.", nil, []string{"JHN 3:16 full"}},
		{"colon form", "John 3:16", nil, []string{"JHN 3:16 full"}},
		{"colon in sentence", "Paul writes in Romans 8:28 that all things", nil, []string{"ROM 8:28 full"}},
		{"number words", "Romans chapter eight verse twenty eight", nil, []string{"ROM 8:28 full"}},
		{"comma between", "romans chapter 8, verse 28", nil, []string{"ROM 8:28 full"}},
		{"range", "1 Corinthians 13:4-7", nil, []string{"1CO 13:4-7 full"}},
		{"en dash range", "1 Corinthians 13:4–7", nil, []string{"1CO 13:4-7 full"}},
		{"context range", "verses 4 to 7", cor13, []string{"1CO 13:4-7 verse"}},
		{"ordinal chapter only", "First Corinthians thirteen is the love chapter", nil, []string{"1CO 13 chapter"}},
		{"psalm hundreds", "Psalm one hundred and nineteen verse one hundred and five", nil, []string{"PSA 119:105 full"}},
		{"psalm chapter", "Psalm 23", nil, []string{"PSA 23 chapter"}},
		{"single chapter book", "Jude 5", nil, []string{"JUD 1:5 full"}},
		{"numbered john", "1 John 4:8", nil, []string{"1JN 4:8 full"}},
		{"song of solomon", "Song of Solomon 2:4", nil, []string{"SNG 2:4 full"}},
		{"malayalam name", "യോഹന്നാൻ 3:16", nil, []string{"JHN 3:16 full"}},
		{"abbreviation", "rom 8:28", nil, []string{"ROM 8:28 full"}},
		{"context next verse", "Now look at verse seventeen.", jhn316, []string{"JHN 3:17 verse"}},
		{"context chapter verse", "chapter 12 verse 1", rom828, []string{"ROM 12:1 verse"}},
		{"no context verse", "verse 17", nil, []string{}},
		{"chapter then verse", "Turn to John 3 and read verse 16", nil, []string{"JHN 3 chapter", "JHN 3:16 verse"}},
		{"chapter out of range", "John 30:1", nil, []string{}},
		{"verse out of range", "John 3:99", nil, []string{}},
		{"mark my words", "Mark my words, there are 3 things", nil, []string{}},
		{"mark colon", "Mark 4:39", nil, []string{"MRK 4:39 full"}},
		{"mark chapter", "Mark chapter 4", nil, []string{"MRK 4 chapter"}},
		{"mark ambiguous", "mark 4", nil, []string{}},
		{"clock time", "the time is 5:30", nil, []string{}},
		{"plain number", "it took 40 days", nil, []string{}},
		{"two letter abbr", "is 53:5", nil, []string{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := hitStrings(ParseExplicit(c.text, c.ctx, kjv()))
			if strings.Join(got, "|") != strings.Join(c.want, "|") {
				t.Errorf("ParseExplicit(%q, ctx=%v) = %v, want %v", c.text, c.ctx, got, c.want)
			}
		})
	}
}

func TestParseExplicitContextNotMutated(t *testing.T) {
	ctx := &Ref{Book: "JHN", Chapter: 3, Verse: 16}
	ParseExplicit("Romans 8:28 and verse 29", ctx, kjv())
	if *ctx != (Ref{Book: "JHN", Chapter: 3, Verse: 16}) {
		t.Errorf("caller ctx mutated: %+v", *ctx)
	}
}
