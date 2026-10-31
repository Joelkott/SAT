package sse

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// collector gathers emitted events safely across goroutines.
type collector struct {
	mu     sync.Mutex
	events []Event
}

func (c *collector) emit(e Event) {
	c.mu.Lock()
	c.events = append(c.events, e)
	c.mu.Unlock()
}

func (c *collector) snapshot() []Event {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]Event, len(c.events))
	copy(out, c.events)
	return out
}

// waitFor polls until cond is true or the deadline passes.
func (c *collector) waitFor(t *testing.T, what string, cond func([]Event) bool) []Event {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		evs := c.snapshot()
		if cond(evs) {
			return evs
		}
		time.Sleep(5 * time.Millisecond)
	}
	evs := c.snapshot()
	t.Fatalf("timed out waiting for %s; got %+v", what, evs)
	return nil
}

func ofType(evs []Event, typ string) []Event {
	var out []Event
	for _, e := range evs {
		if e.Type == typ {
			out = append(out, e)
		}
	}
	return out
}

func sseWrite(w http.ResponseWriter, s string) {
	fmt.Fprint(w, s)
	w.(http.Flusher).Flush()
}

func sseHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	w.(http.Flusher).Flush()
}

func caption(text string, ts time.Time) string {
	return fmt.Sprintf("data: {\"type\":\"caption\",\"text\":%q,\"timestamp\":%q}\n\n", text, ts.UTC().Format(time.RFC3339Nano))
}

// startReader runs a Reader against url and returns the collector and a stop func.
func startReader(t *testing.T, r *Reader) (*collector, func()) {
	t.Helper()
	col := &collector{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.Run(ctx, col.emit)
		close(done)
	}()
	return col, func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Errorf("Run did not return after cancel")
		}
	}
}

func TestReplayBurstEndsAtHeartbeat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("Accept header = %q", r.Header.Get("Accept"))
		}
		sseHeaders(w)
		now := time.Now()
		sseWrite(w, "data: {\"type\":\"status\",\"status\":\"live\",\"message\":\"x\",\"timestamp\":\""+now.UTC().Format(time.RFC3339Nano)+"\"}\n\n")
		for i := 0; i < 3; i++ {
			sseWrite(w, caption(fmt.Sprintf("old %d", i), now.Add(-time.Minute)))
		}
		sseWrite(w, ": heartbeat\n\n")
		sseWrite(w, caption("fresh", time.Now()))
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, ReplayGrace: time.Minute})
	defer stop()
	evs := col.waitFor(t, "4 captions", func(e []Event) bool { return len(ofType(e, "caption")) >= 4 })

	if evs[0].Type != "connected" {
		t.Fatalf("first event = %q, want connected", evs[0].Type)
	}
	st := ofType(evs, "status")
	if len(st) != 1 || st[0].Status != "live" {
		t.Fatalf("status events = %+v", st)
	}
	caps := ofType(evs, "caption")
	for i := 0; i < 3; i++ {
		if !caps[i].Replay {
			t.Errorf("caption %d (%q) Replay=false, want true", i, caps[i].Text)
		}
	}
	if caps[3].Replay || caps[3].Text != "fresh" {
		t.Errorf("live caption = %+v, want fresh Replay=false", caps[3])
	}
}

func TestOldTimestampAfterBurstIsReplay(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sseHeaders(w)
		sseWrite(w, ": heartbeat\n\n")
		sseWrite(w, caption("stale", time.Now().Add(-time.Hour)))
		sseWrite(w, caption("fresh", time.Now()))
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, ReplayGrace: time.Minute})
	defer stop()
	evs := col.waitFor(t, "2 captions", func(e []Event) bool { return len(ofType(e, "caption")) >= 2 })
	caps := ofType(evs, "caption")
	if !caps[0].Replay {
		t.Errorf("stale caption Replay=false, want true")
	}
	if caps[1].Replay {
		t.Errorf("fresh caption Replay=true, want false")
	}
}

func TestBurstEndsAfterReplayGraceWithoutHeartbeat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sseHeaders(w)
		sseWrite(w, caption("history", time.Now()))
		select {
		case <-time.After(250 * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		sseWrite(w, caption("live", time.Now()))
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, ReplayGrace: 100 * time.Millisecond})
	defer stop()
	evs := col.waitFor(t, "2 captions", func(e []Event) bool { return len(ofType(e, "caption")) >= 2 })
	caps := ofType(evs, "caption")
	if !caps[0].Replay {
		t.Errorf("first caption Replay=false, want true (in burst)")
	}
	if caps[1].Replay {
		t.Errorf("caption after grace Replay=true, want false")
	}
}

func TestParseMultilineAndMalformed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sseHeaders(w)
		sseWrite(w, ": heartbeat\r\n\r\n")
		// multi-line data, "data:" without space, unknown fields, other SSE fields
		sseWrite(w, "event: message\nid: 7\ndata: {\"type\":\"caption\",\ndata:\"text\":\"multi\",\"extra\":{\"a\":1}}\n\n")
		sseWrite(w, "data: {not json\n\n")
		sseWrite(w, "retry: 1000\ndata:{\"text\":\"untyped\"}\n\n")
		sseWrite(w, "data: {\"type\":\"clear\"}\n\n")
		sseWrite(w, "data: {\"type\":\"delete\",\"timestamp\":\"2026-10-31T10:15:02.123Z\"}\n\n")
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, ReplayGrace: time.Minute})
	defer stop()
	evs := col.waitFor(t, "delete event", func(e []Event) bool { return len(ofType(e, "delete")) >= 1 })
	caps := ofType(evs, "caption")
	if len(caps) != 2 || caps[0].Text != "multi" || caps[1].Text != "untyped" {
		t.Fatalf("captions = %+v", caps)
	}
	if len(ofType(evs, "clear")) != 1 {
		t.Errorf("expected 1 clear event")
	}
	if d := ofType(evs, "delete"); d[0].Timestamp != "2026-10-31T10:15:02.123Z" {
		t.Errorf("delete timestamp = %q", d[0].Timestamp)
	}
	if len(ofType(evs, "disconnected")) != 0 {
		t.Errorf("malformed JSON must not drop the connection")
	}
}

func TestReconnectAfterServerClose(t *testing.T) {
	var conns int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&conns, 1)
		sseHeaders(w)
		if n == 1 {
			sseWrite(w, ": heartbeat\n\n")
			sseWrite(w, caption("first-live", time.Now()))
			return // server closes
		}
		sseWrite(w, caption("second-history", time.Now()))
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, MinBackoff: 10 * time.Millisecond, ReplayGrace: time.Minute})
	defer stop()
	evs := col.waitFor(t, "second-connection caption", func(e []Event) bool { return len(ofType(e, "caption")) >= 2 })

	var seq []string
	for _, e := range evs {
		seq = append(seq, e.Type)
	}
	got := strings.Join(seq, ",")
	if !strings.HasPrefix(got, "connected,caption,disconnected,connected,caption") {
		t.Fatalf("event sequence = %s", got)
	}
	caps := ofType(evs, "caption")
	if caps[0].Replay {
		t.Errorf("first live caption Replay=true")
	}
	if !caps[1].Replay {
		t.Errorf("second connection burst caption Replay=false, want true")
	}
}

func TestIdleTimeoutReconnects(t *testing.T) {
	var conns int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&conns, 1)
		sseHeaders(w)
		<-r.Context().Done()
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL, IdleTimeout: 100 * time.Millisecond, MinBackoff: 10 * time.Millisecond})
	defer stop()
	evs := col.waitFor(t, "reconnect after idle", func(e []Event) bool { return len(ofType(e, "connected")) >= 2 })
	d := ofType(evs, "disconnected")
	if len(d) == 0 || d[0].Err == "" || !strings.Contains(d[0].Err, "idle") {
		t.Fatalf("disconnected events = %+v", d)
	}
}

func TestNon200Retried(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	col, stop := startReader(t, &Reader{URL: srv.URL + "/audience/stream?token=secret", MinBackoff: 10 * time.Millisecond, MaxBackoff: 20 * time.Millisecond})
	defer stop()
	evs := col.waitFor(t, "two disconnects", func(e []Event) bool { return len(ofType(e, "disconnected")) >= 2 })
	d := ofType(evs, "disconnected")
	if !strings.Contains(d[0].Err, "503") {
		t.Errorf("Err = %q, want mention of 503", d[0].Err)
	}
	if strings.Contains(d[0].Err, "secret") {
		t.Errorf("Err leaks query string: %q", d[0].Err)
	}
	if len(ofType(evs, "connected")) != 0 {
		t.Errorf("non-200 must not emit connected")
	}
	if atomic.LoadInt32(&hits) < 2 {
		t.Errorf("expected retries, hits=%d", hits)
	}
}

func TestRunReturnsPromptlyOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sseHeaders(w)
		<-r.Context().Done()
	}))
	defer srv.Close()

	col := &collector{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		(&Reader{URL: srv.URL}).Run(ctx, col.emit)
		close(done)
	}()
	col.waitFor(t, "connected", func(e []Event) bool { return len(ofType(e, "connected")) >= 1 })
	start := time.Now()
	cancel()
	select {
	case <-done:
		if el := time.Since(start); el > time.Second {
			t.Errorf("Run took %s to return", el)
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not return within 1s of cancel")
	}
}

func TestRunReturnsDuringBackoff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	col := &collector{}
	go func() {
		// Unroutable / closed port: immediate connection error, then long backoff.
		(&Reader{URL: "http://127.0.0.1:1/audience/stream", MinBackoff: time.Hour}).Run(ctx, col.emit)
		close(done)
	}()
	col.waitFor(t, "disconnected", func(e []Event) bool { return len(ofType(e, "disconnected")) >= 1 })
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return during backoff")
	}
}
