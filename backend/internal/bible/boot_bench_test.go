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

	if n := len(lp.Bibles()); n != 4 {
		t.Errorf("bundled bibles = %d, want 4", n)
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
