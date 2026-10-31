package versedetect

import (
	"context"
	"errors"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/jev"
	"github.com/yourusername/audience-stage-teleprompter/internal/versedetect/sse"
)

// DefaultStreamURL is the public Jgm-live-captions audience SSE stream.
const DefaultStreamURL = "https://jgm-sermon-translate.duckdns.org/audience/stream"

const (
	maxKeptDetections   = 20
	maxReturned         = 5
	maxRecentRefs       = 5
	maxEarlierCaptions  = 5
	maxLatestRunes      = 400
	maxSnippetRunes     = 140
	maxPollWait         = 20 * time.Second
	eventBuffer         = 256
	jevOverallTimeout   = 8 * time.Second
	jevRateLimitCooloff = time.Minute
	jevErrorLogEvery    = time.Minute
)

// Options configures a Detector. Zero values use defaults.
type Options struct {
	StreamURL     string        // "" -> DefaultStreamURL; "off"/"false"/"disabled" (case-insensitive) -> not configured
	JevAPIKey     string        // "" -> local-only mode (log once)
	JevURL        string        // "" -> jev.DefaultURL (tests point at httptest)
	Canon         Canon         // required (*bible.LocalProvider)
	MinConfidence float64       // default 0.80
	Dedup         time.Duration // default 60s
	JevPerMinute  int           // default 30 (counts every HTTP ask, i.e. every round)
	DetectionTTL  time.Duration // default 90s
	ContextGap    time.Duration // default 20m
	WindowLines   int           // default 6 (latest + 5 earlier)
	Now           func() time.Time
	HTTPClient    *http.Client // optional, for the SSE reader
}

type windowLine struct {
	id   int64
	text string
}

// Detector turns caption-stream events into gated, deduplicated verse
// suggestions and exposes them through a long-poll friendly API.
type Detector struct {
	o          Options
	url        string
	configured bool
	jev        *jev.Client
	n          *notifier

	mu             sync.Mutex
	version        int64
	seq            int64
	enabled        bool
	stream         string
	serviceStatus  string
	lastLive       time.Time
	lastCaptionAt  int64
	ctx            *Ref
	recent         []string             // display references, most recent last
	lastEmit       map[string]time.Time // passage -> last emission
	detections     []Detection
	window         []windowLine
	lineSeq        int64
	askTimes       []time.Time
	jevCooloffTill time.Time
	lastJevErrLog  time.Time
	baseCtx        context.Context
	droppedLogged  bool
}

// New builds a Detector. It does not connect until Start.
func New(o Options) *Detector {
	if o.MinConfidence <= 0 {
		o.MinConfidence = 0.80
	}
	if o.Dedup <= 0 {
		o.Dedup = 60 * time.Second
	}
	if o.JevPerMinute <= 0 {
		o.JevPerMinute = 30
	}
	if o.DetectionTTL <= 0 {
		o.DetectionTTL = 90 * time.Second
	}
	if o.ContextGap <= 0 {
		o.ContextGap = 20 * time.Minute
	}
	if o.WindowLines <= 0 {
		o.WindowLines = 6
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	d := &Detector{
		o:        o,
		n:        newNotifier(),
		enabled:  true,
		lastEmit: map[string]time.Time{},
		jev:      jev.New(o.JevAPIKey, o.JevURL),
		baseCtx:  context.Background(),
	}
	u := strings.TrimSpace(o.StreamURL)
	switch strings.ToLower(u) {
	case "off", "false", "disabled":
		d.stream = "disabled"
	case "":
		d.url, d.configured, d.stream = DefaultStreamURL, true, "connecting"
	default:
		d.url, d.configured, d.stream = u, true, "connecting"
	}
	return d
}

// Start connects to the caption stream in the background. No-op when not configured.
func (d *Detector) Start(ctx context.Context) {
	if d.jev.Enabled() {
		log.Printf("verse-detect: Jev enabled")
	} else {
		log.Printf("verse-detect: Jev disabled — TYPESAFE_API_KEY not set (local parsing only)")
	}
	if !d.configured {
		log.Printf("verse-detect: caption stream disabled")
		return
	}
	log.Printf("verse-detect: caption stream %s", d.url)
	d.mu.Lock()
	d.stream = "connecting"
	d.baseCtx = ctx
	d.mu.Unlock()

	events := make(chan sse.Event, eventBuffer)
	emit := func(ev sse.Event) {
		select {
		case events <- ev:
		default:
			d.mu.Lock()
			first := !d.droppedLogged
			d.droppedLogged = true
			d.mu.Unlock()
			if first {
				log.Printf("verse-detect: event buffer full, dropping events")
			}
		}
	}
	go (&sse.Reader{URL: d.url, Client: d.o.HTTPClient}).Run(ctx, emit)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-events:
				batch := []sse.Event{ev}
				for n := len(events); n > 0; n-- {
					batch = append(batch, <-events)
				}
				d.Handle(batch...)
			}
		}
	}()
}

func liveServiceStatus(s string) bool { return s == "" || s == "ready" || s == "live" }

// Handle processes events synchronously (used by the worker and by tests).
func (d *Detector) Handle(evs ...sse.Event) {
	d.mu.Lock()
	type liveLine struct {
		id   int64
		text string
	}
	var live []liveLine
	for _, ev := range evs {
		switch ev.Type {
		case "connected":
			if d.stream != "connected" {
				d.stream = "connected"
				d.bump()
			}
		case "disconnected":
			if d.stream != "offline" {
				d.stream = "offline"
				d.bump()
			}
		case "status":
			if ev.Status != d.serviceStatus {
				d.serviceStatus = ev.Status
				d.bump()
			}
			if ev.Status == "ended" {
				d.resetContext()
			}
		case "clear":
			d.resetContext()
		case "caption":
			text := strings.TrimSpace(ev.Text)
			if text == "" {
				continue
			}
			id := d.pushWindow(text)
			if ev.Replay {
				d.seedContext(text)
				continue
			}
			if !d.enabled || !liveServiceStatus(d.serviceStatus) {
				continue
			}
			now := d.o.Now()
			if !d.lastLive.IsZero() && now.Sub(d.lastLive) > d.o.ContextGap {
				d.resetContext()
			}
			d.lastLive = now
			d.lastCaptionAt = now.UnixMilli()
			live = append(live, liveLine{id, text})
		}
	}
	if len(live) == 0 {
		d.mu.Unlock()
		return
	}

	anyHit := false
	texts := make([]string, 0, len(live))
	liveIDs := map[int64]bool{}
	for _, l := range live {
		texts = append(texts, l.text)
		liveIDs[l.id] = true
		for _, h := range ParseExplicit(l.text, d.ctx, d.o.Canon) {
			anyHit = true
			switch h.Kind {
			case KindChapter:
				r := Ref{Book: h.Ref.Book, Chapter: h.Ref.Chapter}
				d.ctx = &r
			case KindFull:
				d.emit(h.Ref, SourceExplicit, 1.0, l.text)
			case KindVerse:
				d.emit(h.Ref, SourceContext, 0.95, l.text)
			}
		}
	}
	joined := strings.Join(texts, " ")
	if anyHit || !d.jev.Enabled() || mostlyNonLatin(joined) || !looksLikeReference(joined) {
		d.mu.Unlock()
		return
	}

	// Stage 2: Jev. Build state under the lock, call without it.
	st := jevState{
		Task:             jevTask,
		EarlierCaptions:  []string{},
		LatestCaption:    lastRunes(joined, maxLatestRunes),
		CurrentPassage:   "none",
		RecentReferences: append([]string{}, d.recent...),
	}
	for _, w := range d.window {
		if !liveIDs[w.id] {
			st.EarlierCaptions = append(st.EarlierCaptions, w.text)
		}
	}
	if n := len(st.EarlierCaptions); n > maxEarlierCaptions {
		st.EarlierCaptions = st.EarlierCaptions[n-maxEarlierCaptions:]
	}
	var cur *Ref
	if d.ctx != nil {
		c := *d.ctx
		cur = &c
		st.CurrentPassage = c.Reference()
	}
	base := d.baseCtx
	d.mu.Unlock()

	ctx, cancel := context.WithTimeout(base, jevOverallTimeout)
	res, err := resolveWithJev(ctx, d.jev, st, cur, d.o.Canon, d.o.MinConfidence, d.jevBudget)
	cancel()

	d.mu.Lock()
	defer d.mu.Unlock()
	if err != nil {
		now := d.o.Now()
		if errors.Is(err, jev.ErrRateLimited) {
			d.jevCooloffTill = now.Add(jevRateLimitCooloff)
		}
		if d.lastJevErrLog.IsZero() || now.Sub(d.lastJevErrLog) >= jevErrorLogEvery {
			d.lastJevErrLog = now
			log.Printf("verse-detect: Jev error: %v", err)
		}
		return
	}
	if !d.enabled {
		return
	}
	switch {
	case res.Found:
		d.emit(res.Ref, SourceJev, res.Confidence, joined)
	case res.ContextOnly:
		r := res.Ref
		d.ctx = &r
	}
}

// jevBudget reports whether another Jev ask is allowed now and records it.
func (d *Detector) jevBudget() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.o.Now()
	if now.Before(d.jevCooloffTill) {
		return false
	}
	kept := d.askTimes[:0]
	for _, t := range d.askTimes {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	d.askTimes = kept
	if len(d.askTimes) >= d.o.JevPerMinute {
		return false
	}
	d.askTimes = append(d.askTimes, now)
	return true
}

// pushWindow appends a caption to the rolling transcript window. Caller holds mu.
func (d *Detector) pushWindow(text string) int64 {
	d.lineSeq++
	d.window = append(d.window, windowLine{id: d.lineSeq, text: text})
	if n := len(d.window); n > d.o.WindowLines {
		d.window = append([]windowLine(nil), d.window[n-d.o.WindowLines:]...)
	}
	return d.lineSeq
}

// seedContext updates the discourse context from a replayed caption. Caller holds mu.
func (d *Detector) seedContext(text string) {
	hits := ParseExplicit(text, d.ctx, d.o.Canon)
	if len(hits) == 0 {
		return
	}
	h := hits[len(hits)-1]
	r := contextRef(h.Ref)
	if h.Kind == KindChapter {
		r = Ref{Book: h.Ref.Book, Chapter: h.Ref.Chapter}
	}
	d.ctx = &r
}

// contextRef makes a range point at its last verse so "the next verse" follows it.
func contextRef(r Ref) Ref {
	if r.EndVerse > r.Verse {
		r.Verse = r.EndVerse
	}
	r.EndVerse = 0
	return r
}

// emit records a detection unless the passage was suggested within Dedup. Caller holds mu.
func (d *Detector) emit(ref Ref, source string, conf float64, snippet string) {
	c := contextRef(ref)
	d.ctx = &c
	now := d.o.Now()
	passage := ref.Passage()
	if t, ok := d.lastEmit[passage]; ok && now.Sub(t) < d.o.Dedup {
		return
	}
	d.lastEmit[passage] = now
	d.seq++
	conf = math.Round(conf*100) / 100
	d.detections = append(d.detections, Detection{
		ID:         d.seq,
		Passage:    passage,
		Reference:  ref.Reference(),
		Confidence: conf,
		Source:     source,
		Snippet:    truncateRunes(snippet, maxSnippetRunes),
		CreatedAt:  now.UnixMilli(),
	})
	if n := len(d.detections); n > maxKeptDetections {
		d.detections = append([]Detection(nil), d.detections[n-maxKeptDetections:]...)
	}
	d.recent = append(d.recent, ref.Reference())
	if n := len(d.recent); n > maxRecentRefs {
		d.recent = append([]string(nil), d.recent[n-maxRecentRefs:]...)
	}
	d.bump()
	log.Printf("verse-detect: %s (%s %.2f)", passage, source, conf)
}

// resetContext forgets the sermon's discourse state. Caller holds mu.
func (d *Detector) resetContext() {
	d.ctx = nil
	d.recent = nil
	d.lastEmit = map[string]time.Time{}
	d.bump()
}

// bump marks a visible change and wakes long-polls. Caller holds mu.
func (d *Detector) bump() {
	d.version++
	d.n.Bump()
}

// SetEnabled turns detection on or off (off clears pending detections).
func (d *Detector) SetEnabled(on bool) Status {
	d.mu.Lock()
	d.enabled = on
	if !on {
		d.detections = nil
	}
	d.bump()
	d.mu.Unlock()
	return d.Status()
}

// Status returns the current indicator state.
func (d *Detector) Status() Status {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.statusLocked()
}

func (d *Detector) statusLocked() Status {
	s := Status{
		Configured:    d.configured,
		Enabled:       d.enabled,
		Stream:        d.stream,
		ServiceStatus: d.serviceStatus,
		Jev:           d.jev.Enabled(),
		LastCaptionAt: d.lastCaptionAt,
	}
	if !d.configured {
		s.Stream = "disabled"
	}
	s.Listening = s.Configured && s.Enabled && s.Stream == "connected" && liveServiceStatus(s.ServiceStatus)
	if d.ctx != nil {
		s.CurrentPassage = d.ctx.Passage()
	}
	return s
}

func (d *Detector) snapshot() PollResponse {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.o.Now().UnixMilli()
	ttl := d.o.DetectionTTL.Milliseconds()
	fresh := []Detection{}
	for _, det := range d.detections {
		if now-det.CreatedAt <= ttl {
			det.AgeMs = now - det.CreatedAt
			fresh = append(fresh, det)
		}
	}
	if n := len(fresh); n > maxReturned {
		fresh = fresh[n-maxReturned:]
	}
	return PollResponse{Version: d.version, Detections: fresh, Status: d.statusLocked()}
}

// Poll returns the current snapshot, waiting up to wait (max 20s) for the
// version to move past since.
func (d *Detector) Poll(since int64, wait time.Duration) PollResponse {
	ch := d.n.C() // capture BEFORE the snapshot so no Bump is lost
	snap := d.snapshot()
	if snap.Version != since || wait <= 0 {
		return snap
	}
	if wait > maxPollWait {
		wait = maxPollWait
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-ch:
	case <-t.C:
	}
	return d.snapshot()
}

// looksLikeReference is a cheap pre-filter so Jev is only asked about
// captions that could plausibly point to a Bible location.
func looksLikeReference(s string) bool {
	norm := " " + normalizeNumbers(strings.ToLower(s)) + " "
	for _, r := range norm {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	words := strings.FieldsFunc(norm, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && r != '\''
	})
	for _, w := range words {
		if refWords[w] {
			return true
		}
	}
	spaced := " " + strings.Join(words, " ") + " "
	for _, b := range books {
		if b.Ambiguous {
			continue
		}
		for _, n := range b.Names {
			if strings.Contains(spaced, " "+n+" ") {
				return true
			}
		}
	}
	return false
}

var refWords = map[string]bool{
	"verse": true, "verses": true, "chapter": true, "chapters": true,
	"next": true, "previous": true, "before": true, "back": true,
	"following": true, "turn": true, "open": true, "psalm": true, "psalms": true,
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func lastRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[len(r)-n:])
}
