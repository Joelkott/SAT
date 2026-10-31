package versedetect

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/jev"
	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/sse"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// fakeJev is an httptest System One server that counts requests and answers
// via a script keyed by the question ids present.
type fakeJev struct {
	srv   *httptest.Server
	count atomic.Int64
}

func newFakeJev(t *testing.T, script func(ids map[string]bool) map[string]jev.Answer) *fakeJev {
	f := &fakeJev{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.count.Add(1)
		var req jev.Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		ids := map[string]bool{}
		for id := range req.Questions {
			ids[id] = true
		}
		answers := map[string]jev.Answer{}
		if script != nil {
			answers = script(ids)
		}
		_ = json.NewEncoder(w).Encode(jev.Response{Model: "jev-test", Answers: answers})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// nextVerseScript answers round 1 as "same book, verse 29 of the current chapter".
func nextVerseScript(ids map[string]bool) map[string]jev.Answer {
	out := map[string]jev.Answer{}
	if ids["cites"] {
		out["cites"] = noul(0.95)
	}
	if ids["book"] {
		out["book"] = choice("same_as_current", 0.9)
	}
	if ids["verse_here"] {
		out["verse_here"] = choice("29", 0.92)
	}
	return out
}

func newTestDetector(t *testing.T, key string, fj *fakeJev, mod func(*Options)) (*Detector, *fakeClock) {
	t.Helper()
	clk := &fakeClock{t: time.Date(2026, 10, 31, 10, 0, 0, 0, time.UTC)}
	o := Options{StreamURL: "off", JevAPIKey: key, Canon: kjv(), Now: clk.Now}
	if fj != nil {
		o.JevURL = fj.srv.URL
	}
	if mod != nil {
		mod(&o)
	}
	return New(o), clk
}

func capEv(text string) sse.Event    { return sse.Event{Type: "caption", Text: text} }
func replayEv(text string) sse.Event { return sse.Event{Type: "caption", Text: text, Replay: true} }
func statusEv(s string) sse.Event    { return sse.Event{Type: "status", Status: s} }

func dets(d *Detector) []Detection { return d.Poll(-1, 0).Detections }

func TestDetectorExplicitAndContext(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, _ := newTestDetector(t, "test-key", fj, nil)
	cap1 := "Please turn to John chapter 3 verse 16."
	d.Handle(capEv(cap1))
	got := dets(d)
	if len(got) != 1 {
		t.Fatalf("detections %+v", got)
	}
	g := got[0]
	if g.Passage != "JHN 3:16" || g.Reference != "John 3:16" || g.Source != SourceExplicit || g.Confidence != 1.0 || g.Snippet != cap1 {
		t.Fatalf("got %+v", g)
	}
	if s := d.Status(); s.CurrentPassage != "JHN 3:16" || s.LastCaptionAt == 0 {
		t.Fatalf("status %+v", s)
	}
	d.Handle(capEv("Now look at verse seventeen."))
	got = dets(d)
	if len(got) != 2 || got[1].Passage != "JHN 3:17" || got[1].Source != SourceContext || got[1].Confidence != 0.95 {
		t.Fatalf("got %+v", got)
	}
	if fj.count.Load() != 0 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
}

func TestDetectorReplaySeedsContextOnly(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	d.Handle(replayEv("John 3:16"))
	if len(dets(d)) != 0 {
		t.Fatal("replay produced a detection")
	}
	if s := d.Status(); s.CurrentPassage != "JHN 3:16" || s.LastCaptionAt != 0 {
		t.Fatalf("status %+v", s)
	}
}

func TestDetectorStatusGating(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	v0 := d.Poll(-1, 0).Version
	d.Handle(statusEv("paused"))
	if d.Poll(-1, 0).Version == v0 {
		t.Fatal("status change did not bump version")
	}
	d.Handle(capEv("John 3:16"))
	if len(dets(d)) != 0 {
		t.Fatal("detected while paused")
	}
	d.Handle(statusEv("live"))
	d.Handle(capEv("John 3:16"))
	if got := dets(d); len(got) != 1 || got[0].Passage != "JHN 3:16" {
		t.Fatalf("got %+v", got)
	}
	if s := d.Status(); s.ServiceStatus != "live" {
		t.Fatalf("status %+v", s)
	}
}

func TestDetectorEndedResetsContext(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("John 3:16"))
	d.Handle(statusEv("ended"))
	if s := d.Status(); s.CurrentPassage != "" {
		t.Fatalf("context not reset: %+v", s)
	}
	d.Handle(capEv("verse 5"))
	if got := dets(d); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestDetectorClearResetsContext(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("John 3:16"))
	d.Handle(sse.Event{Type: "clear"})
	if s := d.Status(); s.CurrentPassage != "" {
		t.Fatalf("context not reset: %+v", s)
	}
	d.Handle(capEv("verse 5"))
	if got := dets(d); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
	// Edit/delete/unknown events are ignored.
	d.Handle(sse.Event{Type: "edit"}, sse.Event{Type: "delete"}, sse.Event{Type: "weird"})
}

func TestDetectorGapResetsContext(t *testing.T) {
	d, clk := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("John 3:16"))
	clk.Advance(21 * time.Minute)
	d.Handle(capEv("verse 17"))
	if got := dets(d); len(got) != 0 {
		// The first detection is past TTL; the second must not exist.
		t.Fatalf("got %+v", got)
	}
	if s := d.Status(); s.CurrentPassage != "" {
		t.Fatalf("context not reset: %+v", s)
	}
}

func TestDetectorDedup(t *testing.T) {
	d, clk := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("Romans 8:28"))
	clk.Advance(10 * time.Second)
	d.Handle(capEv("Romans 8:28"))
	if got := dets(d); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
	clk.Advance(61 * time.Second)
	d.Handle(capEv("Romans 8:28"))
	if got := dets(d); len(got) != 2 || got[1].Passage != "ROM 8:28" {
		t.Fatalf("got %+v", got)
	}
}

func TestDetectorDisabled(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("John 3:16"))
	st := d.SetEnabled(false)
	if st.Enabled {
		t.Fatal("still enabled")
	}
	d.Handle(capEv("Romans 8:28"))
	p := d.Poll(-1, 0)
	if p.Detections == nil || len(p.Detections) != 0 || p.Status.Enabled {
		t.Fatalf("poll %+v", p)
	}
	b, _ := json.Marshal(p)
	if string(b) == "" || !json.Valid(b) {
		t.Fatal("bad json")
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(b, &raw)
	if string(raw["detections"]) != "[]" {
		t.Fatalf("detections json %s", raw["detections"])
	}
	d.SetEnabled(true)
	d.Handle(capEv("Romans 8:28"))
	if got := dets(d); len(got) != 1 || got[0].Passage != "ROM 8:28" {
		t.Fatalf("got %+v", got)
	}
}

func TestDetectorNonLatinSkipsJev(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, _ := newTestDetector(t, "test-key", fj, nil)
	d.Handle(capEv("Romans 8:28"))
	d.Handle(capEv("ദൈവം ലോകത്തെ അത്രമാത്രം സ്നേഹിച്ചു അടുത്ത വാക്യം"))
	if fj.count.Load() != 0 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
}

func TestDetectorJevPath(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, clk := newTestDetector(t, "test-key", fj, nil)
	d.Handle(capEv("Romans 8:28"))
	clk.Advance(5 * time.Second)
	d.Handle(capEv("And the very next verse says"))
	got := dets(d)
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	g := got[1]
	if g.Passage != "ROM 8:29" || g.Source != SourceJev || g.Confidence != 0.9 || g.Snippet != "And the very next verse says" {
		t.Fatalf("got %+v", g)
	}
	if fj.count.Load() != 1 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
	if s := d.Status(); !s.Jev || s.CurrentPassage != "ROM 8:29" {
		t.Fatalf("status %+v", s)
	}
}

func TestDetectorNoKeyNoJev(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, _ := newTestDetector(t, "", fj, nil)
	d.Handle(capEv("Romans 8:28"))
	d.Handle(capEv("And the very next verse says"))
	if fj.count.Load() != 0 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
	if got := dets(d); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
	if d.Status().Jev {
		t.Fatal("Status.Jev true without key")
	}
}

func TestDetectorNotReferenceLikeSkipsJev(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, _ := newTestDetector(t, "test-key", fj, nil)
	d.Handle(capEv("Good morning church"))
	if fj.count.Load() != 0 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
}

func TestDetectorLocalHitSuppressesJev(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, _ := newTestDetector(t, "test-key", fj, nil)
	d.Handle(capEv("First Corinthians thirteen is the love chapter"))
	if fj.count.Load() != 0 {
		t.Fatalf("jev called %d times", fj.count.Load())
	}
	if got := dets(d); len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
	if s := d.Status(); s.CurrentPassage != "1CO 13" {
		t.Fatalf("status %+v", s)
	}
}

func TestDetectorJevRateLimit(t *testing.T) {
	fj := newFakeJev(t, nextVerseScript)
	d, clk := newTestDetector(t, "test-key", fj, func(o *Options) { o.JevPerMinute = 2 })
	d.Handle(capEv("Romans 8:28"))
	for i := 0; i < 3; i++ {
		clk.Advance(5 * time.Second)
		d.Handle(capEv("And the very next verse says"))
	}
	if n := fj.count.Load(); n != 2 {
		t.Fatalf("jev called %d times, want 2", n)
	}
	clk.Advance(61 * time.Second)
	d.Handle(capEv("And the very next verse says"))
	if n := fj.count.Load(); n != 3 {
		t.Fatalf("jev called %d times after window, want 3", n)
	}
}

func TestDetectorLongPoll(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	v := d.Poll(-1, 0).Version

	done := make(chan PollResponse, 1)
	go func() { done <- d.Poll(v, 2*time.Second) }()
	time.Sleep(50 * time.Millisecond)
	start := time.Now()
	d.Handle(capEv("John 3:16"))
	select {
	case p := <-done:
		if time.Since(start) > 200*time.Millisecond {
			t.Fatalf("woke late: %s", time.Since(start))
		}
		if p.Version == v || len(p.Detections) != 1 {
			t.Fatalf("poll %+v", p)
		}
	case <-time.After(time.Second):
		t.Fatal("long-poll did not wake")
	}

	v = d.Poll(-1, 0).Version
	start = time.Now()
	p := d.Poll(v, 100*time.Millisecond)
	el := time.Since(start)
	if p.Version != v || el < 90*time.Millisecond || el > 600*time.Millisecond {
		t.Fatalf("idle poll returned version %d (want %d) after %s", p.Version, v, el)
	}

	// A stale since returns immediately.
	start = time.Now()
	d.Poll(v-1, 2*time.Second)
	if time.Since(start) > 100*time.Millisecond {
		t.Fatal("stale since did not return immediately")
	}
}

func TestDetectorTTLAndLimit(t *testing.T) {
	d, clk := newTestDetector(t, "", nil, nil)
	d.Handle(capEv("John 3:16"))
	clk.Advance(91 * time.Second)
	if got := dets(d); len(got) != 0 {
		t.Fatalf("expired detection returned: %+v", got)
	}
	refs := []string{"Romans 8:28", "Romans 8:29", "Romans 8:30", "Romans 8:31", "Romans 8:32", "Romans 8:33", "Romans 8:34"}
	for _, r := range refs {
		d.Handle(capEv(r))
		clk.Advance(time.Second)
	}
	got := dets(d)
	if len(got) != 5 {
		t.Fatalf("got %d detections", len(got))
	}
	if got[0].Passage != "ROM 8:30" || got[4].Passage != "ROM 8:34" {
		t.Fatalf("order %+v", got)
	}
	now := clk.Now().UnixMilli()
	for _, g := range got {
		if g.AgeMs != now-g.CreatedAt {
			t.Fatalf("age %d want %d", g.AgeMs, now-g.CreatedAt)
		}
	}
}

func TestDetectorSnippetTruncated(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	long := "John 3:16 "
	for i := 0; i < 30; i++ {
		long += "and so on "
	}
	d.Handle(capEv(long))
	got := dets(d)
	if len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
	r := []rune(got[0].Snippet)
	if len(r) != 141 || r[140] != '…' {
		t.Fatalf("snippet %q (%d runes)", got[0].Snippet, len(r))
	}
}

func TestDetectorNotConfigured(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, nil)
	s := d.Status()
	if s.Configured || s.Stream != "disabled" || s.Listening || !s.Enabled {
		t.Fatalf("status %+v", s)
	}
	d.Handle(sse.Event{Type: "connected"})
	if s := d.Status(); s.Listening {
		t.Fatalf("listening while not configured: %+v", s)
	}
}

func TestDetectorStreamStatus(t *testing.T) {
	d, _ := newTestDetector(t, "", nil, func(o *Options) { o.StreamURL = "http://127.0.0.1:1/audience/stream" })
	if s := d.Status(); !s.Configured {
		t.Fatalf("status %+v", s)
	}
	d.Handle(sse.Event{Type: "connected"})
	if s := d.Status(); s.Stream != "connected" || !s.Listening {
		t.Fatalf("status %+v", s)
	}
	d.Handle(statusEv("paused"))
	if s := d.Status(); s.Listening {
		t.Fatalf("listening while paused: %+v", s)
	}
	d.Handle(statusEv("live"), sse.Event{Type: "disconnected"})
	if s := d.Status(); s.Stream != "offline" || s.Listening {
		t.Fatalf("status %+v", s)
	}
}
