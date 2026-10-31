// Command fake-captions is a local stand-in for the Jgm-live-captions
// /audience/stream SSE endpoint, used to manually test live verse detection.
//
// It is a dev tool only: the Dockerfiles build ./cmd/server/main.go only.
//
// Usage:
//
//	cd backend && go run ./cmd/fake-captions -interval 4s
//
// then run the backend with
//
//	VERSE_DETECT_SSE_URL=http://localhost:8090/audience/stream
//
// Each client receives: the current status (live), a 3-caption history burst
// timestamped 10 minutes ago (must NOT produce suggestions), a ": heartbeat"
// comment, then a scripted sermon, one line per -interval. Each scripted line is
// printed to stdout with the expected detector outcome.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type step struct {
	text   string // caption text (ignored when status != "")
	status string // non-empty -> send a status event instead of a caption
	expect string
}

var history = []string{
	"Welcome everyone.",
	"Open with me to John chapter 1 verse 1.", // replay: MUST NOT produce a suggestion
	"In the beginning was the Word.",
}

var script = []step{
	{text: "Good morning church, let us open our Bibles.", expect: "nothing"},
	{text: "Please turn to John chapter 3 verse 16.", expect: "JHN 3:16 explicit"},
	{text: "For God so loved the world that he gave his only begotten Son.", expect: "nothing"},
	{text: "Now look at verse seventeen.", expect: "JHN 3:17 context"},
	{text: "ദൈവം ലോകത്തെ അത്രമേൽ സ്നേഹിച്ചു", expect: "nothing (Malayalam fallback line, no Jev call)"},
	{text: "Paul writes in Romans 8:28 that all things work together for good.", expect: "ROM 8:28 explicit"},
	{text: "And the very next verse says, for whom he did foreknow.", expect: "ROM 8:29 via Jev only when TYPESAFE_API_KEY is set; nothing in local-only mode"},
	{text: "Let us go back to Romans 8:28 again.", expect: "suppressed (same reference within 60s)"},
	{text: "First Corinthians thirteen is the love chapter.", expect: "context only, no suggestion"},
	{text: "Verse four, love is patient, love is kind.", expect: "1CO 13:4 context"},
	{status: "ended", expect: "context reset, indicator stops Listening"},
	{text: "verse five", expect: "nothing (sent while ended)"},
}

// clock hands out unique, strictly increasing ISO timestamps (like the real
// server's new Date().toISOString(), millisecond precision).
type clock struct {
	mu   sync.Mutex
	last time.Time
}

func (c *clock) next() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := time.Now().UTC().Truncate(time.Millisecond)
	if !t.After(c.last) {
		t = c.last.Add(time.Millisecond)
	}
	c.last = t
	return iso(t)
}

func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func main() {
	addr := flag.String("addr", ":8090", "listen address")
	interval := flag.Duration("interval", 4*time.Second, "delay between scripted captions")
	loop := flag.Bool("loop", true, "repeat the script after it ends")
	flag.Parse()

	clk := &clock{}
	var clientSeq int
	var seqMu sync.Mutex

	http.HandleFunc("/audience/stream", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		seqMu.Lock()
		clientSeq++
		id := clientSeq
		seqMu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)

		send := func(v map[string]any) {
			b, _ := json.Marshal(v)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
		comment := func() {
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
		status := func(s string) {
			send(map[string]any{"type": "status", "status": s, "message": "fake", "timestamp": clk.next()})
		}

		log.Printf("client #%d connected from %s", id, r.RemoteAddr)
		defer log.Printf("client #%d disconnected", id)

		// 1. current status, 2. history burst, 3. heartbeat ends the burst.
		status("live")
		past := time.Now().Add(-10 * time.Minute)
		for i, h := range history {
			send(map[string]any{"type": "caption", "text": h, "timestamp": iso(past.Add(time.Duration(i) * time.Second))})
		}
		comment()

		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		tick := time.NewTimer(*interval)
		defer tick.Stop()

		// wait blocks for d, sending heartbeats; false when the client is gone.
		wait := func(d time.Duration) bool {
			tick.Reset(d)
			for {
				select {
				case <-r.Context().Done():
					return false
				case <-heartbeat.C:
					comment()
				case <-tick.C:
					return true
				}
			}
		}

		for round := 1; ; round++ {
			for i, s := range script {
				if !wait(*interval) {
					return
				}
				if s.status != "" {
					status(s.status)
					fmt.Printf("[client %d round %d] %2d. status=%s  -> expect: %s\n", id, round, i+1, s.status, s.expect)
					continue
				}
				send(map[string]any{"type": "caption", "text": s.text, "timestamp": clk.next()})
				fmt.Printf("[client %d round %d] %2d. %q  -> expect: %s\n", id, round, i+1, s.text, s.expect)
			}
			if !*loop {
				// Keep the connection open with heartbeats until the client leaves.
				for wait(time.Hour) {
				}
				return
			}
			if !wait(10 * time.Second) {
				return
			}
			status("live")
			fmt.Printf("[client %d] status=live, restarting script\n", id)
		}
	})

	log.Printf("fake-captions listening on %s (GET /audience/stream, interval %s, loop %v)", *addr, *interval, *loop)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
