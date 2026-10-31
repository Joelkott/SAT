package bible

import (
	"strings"
	"sync"
	"testing"
)

var (
	canonLPOnce sync.Once
	canonLP     *LocalProvider
)

func canonProvider() *LocalProvider {
	canonLPOnce.Do(func() { canonLP = NewLocalProvider() })
	return canonLP
}

func TestCanonChapterCount(t *testing.T) {
	lp := canonProvider()
	cases := map[string]int{"PSA": 150, "JUD": 1, "XYZ": 0, "JHN": 21}
	for book, want := range cases {
		if got := lp.ChapterCount(book); got != want {
			t.Errorf("ChapterCount(%q) = %d, want %d", book, got, want)
		}
	}
}

func TestCanonVerseCount(t *testing.T) {
	lp := canonProvider()
	cases := []struct {
		book    string
		chapter int
		want    int
	}{
		{"JHN", 3, 36},
		{"PSA", 119, 176},
		{"JHN", 99, 0},
		{"XYZ", 1, 0},
		{"JHN", 0, 0},
	}
	for _, c := range cases {
		if got := lp.VerseCount(c.book, c.chapter); got != c.want {
			t.Errorf("VerseCount(%q, %d) = %d, want %d", c.book, c.chapter, got, c.want)
		}
	}
}

func TestCanonVerseText(t *testing.T) {
	lp := canonProvider()
	if got := lp.VerseText("JHN", 3, 16); !strings.HasPrefix(got, "For God so loved") {
		t.Errorf("VerseText(JHN 3:16) = %q, want prefix %q", got, "For God so loved")
	}
	if got := lp.VerseText("JHN", 3, 99); got != "" {
		t.Errorf("VerseText(JHN 3:99) = %q, want empty", got)
	}
	if got := lp.VerseText("XYZ", 1, 1); got != "" {
		t.Errorf("VerseText(XYZ 1:1) = %q, want empty", got)
	}
}
