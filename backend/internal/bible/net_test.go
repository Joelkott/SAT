package bible

import "testing"

func TestNetQuery(t *testing.T) {
	cases := []struct {
		passageID string
		want      string
	}{
		{"JHN.3.16", "John 3:16"},
		{"JHN.3.16-JHN.3.18", "John 3:16-18"},
		{"JHN.3.16-18", "John 3:16-18"},
		{"JHN.3", "John 3"},
		{"PSA.23", "Psalm 23"},
		{"SNG.2.1", "Song of Solomon 2:1"},
		{"1CO.13.4-1CO.13.7", "1 Corinthians 13:4-7"},
		{"GEN.1-GEN.3", "Genesis 1"}, // chapter range -> starting chapter
	}
	for _, c := range cases {
		got, err := netQuery(c.passageID)
		if err != nil {
			t.Errorf("netQuery(%q) unexpected error: %v", c.passageID, err)
			continue
		}
		if got != c.want {
			t.Errorf("netQuery(%q) = %q, want %q", c.passageID, got, c.want)
		}
	}

	for _, bad := range []string{"NOPE.1.1", "JHN", "", "JHN.3.16.4"} {
		if got, err := netQuery(bad); err == nil {
			t.Errorf("netQuery(%q) = %q, want error", bad, got)
		}
	}
}

func TestBuildNetPassage(t *testing.T) {
	got, err := buildNetPassage([]netVerse{
		{Chapter: "3", Verse: "16", Text: "a "},
		{Chapter: "3", Verse: "17", Text: "b"},
	}, "3")
	if err != nil {
		t.Fatalf("buildNetPassage unexpected error: %v", err)
	}
	if want := "[16] a [17] b"; got != want {
		t.Errorf("buildNetPassage = %q, want %q", got, want)
	}

	// Whitespace inside a verse collapses to single spaces.
	got, err = buildNetPassage([]netVerse{{Chapter: "3", Verse: "16", Text: "  a\n b "}}, "3")
	if err != nil {
		t.Fatalf("buildNetPassage unexpected error: %v", err)
	}
	if want := "[16] a b"; got != want {
		t.Errorf("buildNetPassage = %q, want %q", got, want)
	}

	// Empty response is an error, not empty content.
	if got, err := buildNetPassage(nil, "3"); err == nil {
		t.Errorf("buildNetPassage(nil) = %q, want error", got)
	}

	// labs.bible.org silently falls back to a different chapter for an
	// out-of-range reference; that must never surface as content.
	if got, err := buildNetPassage([]netVerse{{Chapter: "1", Verse: "1", Text: "x"}}, "99"); err == nil {
		t.Errorf("buildNetPassage with wrong chapter = %q, want error", got)
	}
}

func TestNetProviderConfiguration(t *testing.T) {
	p := NewNetProvider()
	if !p.IsConfigured() {
		t.Error("NewNetProvider().IsConfigured() = false, want true (no API key required)")
	}
	if !p.Has(NetBibleID) {
		t.Error("net provider should serve the net bible ID")
	}
	if p.Has("local-kjv") || p.Has("esv") {
		t.Error("net provider must not claim local-kjv or esv")
	}
	if meta := p.Meta(); meta.ID != "net" || meta.Abbreviation != "NET" {
		t.Errorf("Meta() = %+v, want ID net / abbreviation NET", meta)
	}
}

func TestNetBooksAndChaptersAreLocal(t *testing.T) {
	p := NewNetProvider() // no network: books/chapters come from static tables
	books, err := p.GetBooks(NetBibleID)
	if err != nil {
		t.Fatalf("GetBooks failed: %v", err)
	}
	if len(books) != 66 {
		t.Errorf("GetBooks returned %d books, want 66", len(books))
	}
	if books[0].ID != "GEN" || books[0].Name != "Genesis" || books[0].Abbreviation != "Gen" {
		t.Errorf("first book = %+v, want GEN/Genesis/Gen", books[0])
	}
	if books[65].ID != "REV" {
		t.Errorf("last book = %+v, want REV", books[65])
	}

	chapters, err := p.GetChapters(NetBibleID, "PSA")
	if err != nil {
		t.Fatalf("GetChapters failed: %v", err)
	}
	if len(chapters) != 150 {
		t.Errorf("PSA has %d chapters, want 150", len(chapters))
	}
	last := chapters[len(chapters)-1]
	if last.ID != "PSA.150" || last.Reference != "Psalms 150" {
		t.Errorf("last chapter = %+v, want PSA.150 / Psalms 150", last)
	}

	if _, err := p.GetChapters(NetBibleID, "NOPE"); err == nil {
		t.Error("GetChapters(NOPE) should error")
	}
}
