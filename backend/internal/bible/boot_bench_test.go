package bible

import (
	"strings"
	"testing"
	"time"
)

func TestLocalProviderLoadTime(t *testing.T) {
	start := time.Now()
	lp := NewLocalProvider()
	elapsed := time.Since(start)
	t.Logf("NewLocalProvider took %v, %d bibles loaded", elapsed, len(lp.Bibles()))
	if elapsed > 2*time.Second {
		t.Errorf("local provider load too slow: %v", elapsed)
	}
	// sanity: KJV John 3:16 must exist
	v, err := lp.GetVerse("local-kjv", "JHN.3.16")
	if err != nil || v.Text == "" {
		t.Errorf("KJV JHN.3.16 lookup failed: %v", err)
	}
	// MOV references must use Malayalam book names.
	mv, err := lp.GetVerse("local-mal-ov", "JHN.3.16")
	if err != nil || mv.Reference != "യോഹന്നാൻ 3:16" {
		t.Errorf("MOV JHN.3.16 reference = %q, err %v; want Malayalam book name", mv.Reference, err)
	}
	if len(bookNamesMal) != len(usfmBooks) {
		t.Errorf("bookNamesMal has %d entries, want %d", len(bookNamesMal), len(usfmBooks))
	}

	// AMPC: present, English references, cross-refs stripped, amplification kept.
	av, err := lp.GetVerse("local-ampc", "JHN.3.16")
	if err != nil || av.Text == "" || av.Reference != "John 3:16" {
		t.Errorf("AMPC JHN.3.16 = %+v, err %v; want non-empty text and reference %q", av, err, "John 3:16")
	}
	gen, err := lp.GetVerse("local-ampc", "GEN.1.1")
	if err != nil {
		t.Fatalf("AMPC GEN.1.1 lookup failed: %v", err)
	}
	if strings.Contains(gen.Text, "[Heb.") {
		t.Errorf("AMPC GEN.1.1 still has a cross-reference bracket: %q", gen.Text)
	}
	if gen.Text != strings.TrimSpace(gen.Text) {
		t.Errorf("AMPC GEN.1.1 has surrounding whitespace: %q", gen.Text)
	}
	psa, err := lp.GetVerse("local-ampc", "PSA.23.1")
	if err != nil || !strings.Contains(psa.Text, "[to feed, guide, and shield me]") {
		t.Errorf("AMPC PSA.23.1 lost its amplification bracket: %q (err %v)", psa.Text, err)
	}

	// ASV: present with the expected 1901 wording.
	sv, err := lp.GetVerse("local-asv", "JHN.3.16")
	if err != nil || !strings.Contains(sv.Text, "whosoever believeth on him") {
		t.Errorf("ASV JHN.3.16 = %q, err %v; want ASV wording", sv.Text, err)
	}

	// BBE: 1949/1964 basic-English wording.
	bv, err := lp.GetVerse("local-bbe", "JHN.3.16")
	if err != nil || !strings.Contains(bv.Text, "For God had such love for the world") {
		t.Errorf("BBE JHN.3.16 = %q, err %v; want BBE wording", bv.Text, err)
	}

	// MKJV: modern-literal wording, with supplied-word braces unwrapped.
	mkv, err := lp.GetVerse("local-mkjv", "JHN.3.16")
	if err != nil || !strings.Contains(mkv.Text, "only-begotten Son") {
		t.Errorf("MKJV JHN.3.16 = %q, err %v; want MKJV wording", mkv.Text, err)
	}
	jos, err := lp.GetVerse("local-mkjv", "JOS.7.13")
	if err != nil {
		t.Fatalf("MKJV JOS.7.13 lookup failed: %v", err)
	}
	if strings.Contains(jos.Text, "{") || strings.Contains(jos.Text, "}") {
		t.Errorf("MKJV JOS.7.13 still has supplied-word braces: %q", jos.Text)
	}

	// CEB: contemporary wording with curly apostrophes preserved.
	cv, err := lp.GetVerse("local-ceb", "JHN.3.16")
	if err != nil || !strings.Contains(cv.Text, "God so loved the world") || !strings.Contains(cv.Text, "won’t perish") {
		t.Errorf("CEB JHN.3.16 = %q, err %v; want CEB wording with curly apostrophe", cv.Text, err)
	}

	if n := len(lp.Bibles()); n != 7 {
		t.Errorf("bundled bibles = %d, want 7", n)
	}
}

// Crafted/malformed IDs must return errors, never panic.
func TestLocalProviderMalformedIDs(t *testing.T) {
	lp := NewLocalProvider()
	cases := []struct{ verse, chapter, passage string }{
		{"JHN", "JHN", "JHN"},
		{"JHN.3.16.4", "JHN.3.16", "GEN.1-GEN.3"}, // chapter-range passage previously panicked
		{"NOPE.1.1", "NOPE.1", "NOPE.1.1"},
		{"JHN.99.1", "JHN.99", "JHN.3.99-JHN.3.98"},
		{"", "", "..-.."},
	}
	for _, c := range cases {
		if _, err := lp.GetVerse("local-kjv", c.verse); err == nil {
			t.Errorf("GetVerse(%q) expected error", c.verse)
		}
		lp.GetChapterContent("local-kjv", c.chapter) // must not panic
		lp.GetPassage("local-kjv", c.passage)        // must not panic
	}
	// Valid chapter-range form serves the starting chapter.
	p, err := lp.GetPassage("local-kjv", "GEN.1-GEN.3")
	if err != nil || p.Reference != "Genesis 1" {
		t.Errorf("chapter-range passage: got %+v, err %v", p, err)
	}
	// Reversed verse range normalizes and still returns verses.
	if p, err := lp.GetPassage("local-kjv", "JHN.3.18-JHN.3.16"); err != nil || p.Content == "" {
		t.Errorf("reversed range should normalize, err %v", err)
	}
}
