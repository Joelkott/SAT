package bible

import "testing"

func TestEsvQuery(t *testing.T) {
	cases := []struct {
		passageID string
		want      string
	}{
		{"JHN.3.16", "John 3:16"},
		{"JHN.3.16-JHN.3.18", "John 3:16-18"},
		{"JHN.3.16-18", "John 3:16-18"},
		{"JHN.3", "John 3"},
		{"PSA.23", "Psalm 23"},
		{"PSA.23.1", "Psalm 23:1"},
		{"SNG.2.1", "Song of Solomon 2:1"},
		{"GEN.1.1-GEN.1.3", "Genesis 1:1-3"},
		{"GEN.1-GEN.3", "Genesis 1"},          // chapter range -> starting chapter
		{"JHN.3.18-JHN.3.16", "John 3:16-18"}, // reversed range normalizes
		{"1CO.13.4-1CO.13.7", "1 Corinthians 13:4-7"},
	}
	for _, c := range cases {
		got, err := esvQuery(c.passageID)
		if err != nil {
			t.Errorf("esvQuery(%q) unexpected error: %v", c.passageID, err)
			continue
		}
		if got != c.want {
			t.Errorf("esvQuery(%q) = %q, want %q", c.passageID, got, c.want)
		}
	}

	for _, bad := range []string{"NOPE.1.1", "JHN", "", "..-..", "JHN.3.16.4"} {
		if got, err := esvQuery(bad); err == nil {
			t.Errorf("esvQuery(%q) = %q, want error", bad, got)
		}
	}
}

func TestLocalReference(t *testing.T) {
	cases := []struct{ passageID, want string }{
		{"JHN.3.16", "John 3:16"},
		{"JHN.3.16-JHN.3.18", "John 3:16-18"},
		{"JHN.3", "John 3"},
		{"PSA.23", "Psalms 23"}, // display reference keeps the shared "Psalms"
		{"SNG.2.1", "Song of Songs 2:1"},
		{"NOPE.1.1", "NOPE.1.1"}, // unknown book falls back to the raw ID
	}
	for _, c := range cases {
		if got := localReference(c.passageID); got != c.want {
			t.Errorf("localReference(%q) = %q, want %q", c.passageID, got, c.want)
		}
	}
}

func TestCleanESVText(t *testing.T) {
	cases := []struct{ in, want string }{
		{
			"John 3:16\n\n  [16] For God so loved the world...\n\n  (ESV)",
			"[16] For God so loved the world...",
		},
		{
			"  [1] The LORD is my shepherd; I shall not want.\n  [2] He makes me lie down.\n\n (ESV)",
			"[1] The LORD is my shepherd; I shall not want. [2] He makes me lie down.",
		},
		{"[16] Plain text already", "[16] Plain text already"},
		{"", ""},
	}
	for _, c := range cases {
		if got := cleanESVText(c.in); got != c.want {
			t.Errorf("cleanESVText(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestEsvProviderConfiguration(t *testing.T) {
	unconfigured := NewEsvProvider("")
	if unconfigured.IsConfigured() {
		t.Error("NewEsvProvider(\"\").IsConfigured() = true, want false")
	}
	if unconfigured.Has(EsvBibleID) {
		t.Error("unconfigured provider should not claim the esv bible ID")
	}
	if _, err := unconfigured.GetPassage(EsvBibleID, "JHN.3.16"); err == nil {
		t.Error("unconfigured GetPassage should error, not attempt a request")
	}

	p := NewEsvProvider("k")
	if !p.IsConfigured() || !p.Has("esv") {
		t.Error("configured provider should serve the esv bible ID")
	}
	if p.Has("local-kjv") {
		t.Error("esv provider must not claim local-kjv")
	}
	if meta := p.Meta(); meta.ID != "esv" || meta.Abbreviation != "ESV" {
		t.Errorf("Meta() = %+v, want ID esv / abbreviation ESV", meta)
	}
}

func TestEsvBooksAndChaptersAreLocal(t *testing.T) {
	if len(esvChapterCounts) != len(usfmBooks) {
		t.Fatalf("esvChapterCounts has %d entries, want %d", len(esvChapterCounts), len(usfmBooks))
	}

	p := NewEsvProvider("k") // no network: books/chapters come from static tables
	books, err := p.GetBooks(EsvBibleID)
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

	chapters, err := p.GetChapters(EsvBibleID, "PSA")
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

	if _, err := p.GetChapters(EsvBibleID, "NOPE"); err == nil {
		t.Error("GetChapters(NOPE) should error")
	}

	// The static table must agree with the bundled KJV, which shares the
	// Protestant canon — a typo there would silently hide chapters.
	lp := NewLocalProvider()
	for i, usfm := range usfmBooks {
		kjv, err := lp.GetChapters("local-kjv", usfm)
		if err != nil {
			t.Fatalf("KJV GetChapters(%s) failed: %v", usfm, err)
		}
		if len(kjv) != esvChapterCounts[i] {
			t.Errorf("esvChapterCounts[%s] = %d, KJV has %d", usfm, esvChapterCounts[i], len(kjv))
		}
	}
}
