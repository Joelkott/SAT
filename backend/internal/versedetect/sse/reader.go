// Package sse reads the Jgm-live-captions /audience/stream Server-Sent Events
// feed. It reconnects forever with exponential backoff, watches for idle
// connections, and flags captions replayed on connect as history (Replay=true)
// so they never trigger verse detections.
package sse

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// Event is one caption-stream event, or a synthesized connection event.
type Event struct {
	Type      string    // "caption" | "status" | "clear" | "delete" | "edit" | "connected" | "disconnected" (last two synthesized)
	Text      string    // caption text
	Timestamp string    // as sent
	Status    string    // for Type=="status"
	Replay    bool      // caption is history from the connect burst / older than connect
	Err       string    // for Type=="disconnected"
	At        time.Time // receive time (Now())
}

// Reader connects to an SSE caption stream. Zero-valued fields use defaults.
type Reader struct {
	URL          string
	Client       *http.Client     // nil -> &http.Client{} (NO overall Timeout: SSE is long-lived)
	IdleTimeout  time.Duration    // default 75s (server heartbeats every 30s)
	MinBackoff   time.Duration    // default 1s
	MaxBackoff   time.Duration    // default 30s
	ReplayGrace  time.Duration    // default 2s: burst also ends this long after connect if no comment arrives
	MaxReplayAge time.Duration    // default 10s: captions timestamped earlier than connect-MaxReplayAge are Replay even after the burst
	Now          func() time.Time // default time.Now
}

var errIdle = errors.New("idle timeout")

func (r *Reader) defaults() {
	if r.Client == nil {
		r.Client = &http.Client{}
	}
	if r.IdleTimeout <= 0 {
		r.IdleTimeout = 75 * time.Second
	}
	if r.MinBackoff <= 0 {
		r.MinBackoff = time.Second
	}
	if r.MaxBackoff <= 0 {
		r.MaxBackoff = 30 * time.Second
	}
	if r.MaxBackoff < r.MinBackoff {
		r.MaxBackoff = r.MinBackoff
	}
	if r.ReplayGrace <= 0 {
		r.ReplayGrace = 2 * time.Second
	}
	if r.MaxReplayAge <= 0 {
		r.MaxReplayAge = 10 * time.Second
	}
	if r.Now == nil {
		r.Now = time.Now
	}
}

// Run connects and reconnects until ctx is done, calling emit synchronously for each event.
func (r *Reader) Run(ctx context.Context, emit func(Event)) {
	r.defaults()
	backoff := r.MinBackoff
	for {
		if ctx.Err() != nil {
			return
		}
		progressed, err := r.connectOnce(ctx, emit)
		if ctx.Err() != nil {
			return
		}
		if progressed {
			backoff = r.MinBackoff
		}
		msg := r.sanitize(err)
		emit(Event{Type: "disconnected", Err: msg, At: r.Now()})
		log.Printf("verse-detect: caption stream %s (retry in %s)", msg, backoff)

		t := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
		backoff *= 2
		if backoff > r.MaxBackoff {
			backoff = r.MaxBackoff
		}
	}
}

// sanitize renders err without the URL's query string (may carry tokens).
func (r *Reader) sanitize(err error) string {
	if err == nil {
		return "stream closed"
	}
	msg := err.Error()
	if u, perr := url.Parse(r.URL); perr == nil && u.RawQuery != "" {
		stripped := *u
		stripped.RawQuery = ""
		msg = strings.ReplaceAll(msg, r.URL, stripped.String())
		msg = strings.ReplaceAll(msg, u.RawQuery, "")
	}
	return msg
}

// connectOnce runs a single connection. progressed reports whether the
// connection delivered at least one event or comment (resets backoff).
func (r *Reader) connectOnce(ctx context.Context, emit func(Event)) (progressed bool, err error) {
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	req, err := http.NewRequestWithContext(connCtx, http.MethodGet, r.URL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	var idleFired atomic.Bool
	watchdog := time.AfterFunc(r.IdleTimeout, func() {
		idleFired.Store(true)
		cancel()
	})
	defer watchdog.Stop()

	resp, err := r.Client.Do(req)
	if err != nil {
		if idleFired.Load() {
			return false, errIdle
		}
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	connectedAt := r.Now()
	inBurst := true
	loggedBadJSON := false
	emit(Event{Type: "connected", At: connectedAt})

	br := bufio.NewReader(resp.Body)
	var data []string
	hasData := false

	dispatch := func() {
		if !hasData {
			return
		}
		payload := strings.Join(data, "\n")
		data = data[:0]
		hasData = false

		var msg struct {
			Type      string `json:"type"`
			Text      string `json:"text"`
			Timestamp string `json:"timestamp"`
			Status    string `json:"status"`
		}
		if err := json.Unmarshal([]byte(payload), &msg); err != nil {
			if !loggedBadJSON {
				log.Printf("verse-detect: caption stream: skipping malformed event: %v", err)
				loggedBadJSON = true
			}
			return
		}
		if msg.Type == "" && msg.Text != "" {
			msg.Type = "caption"
		}
		if msg.Type == "" {
			return
		}
		now := r.Now()
		ev := Event{Type: msg.Type, Text: msg.Text, Timestamp: msg.Timestamp, Status: msg.Status, At: now}
		if msg.Type == "caption" {
			if inBurst && now.Sub(connectedAt) > r.ReplayGrace {
				inBurst = false
			}
			replay := inBurst
			if !replay {
				if ts, perr := time.Parse(time.RFC3339Nano, msg.Timestamp); perr == nil &&
					ts.Before(connectedAt.Add(-r.MaxReplayAge)) {
					replay = true
				}
			}
			ev.Replay = replay
		}
		emit(ev)
	}

	for {
		line, rerr := br.ReadString('\n')
		if len(line) > 0 {
			watchdog.Reset(r.IdleTimeout)
		}
		if rerr != nil {
			// A partial trailing line without newline is discarded (incomplete frame).
			if idleFired.Load() {
				return progressed, errIdle
			}
			return progressed, rerr
		}
		line = strings.TrimRight(line, "\r\n")

		switch {
		case line == "":
			dispatch()
		case strings.HasPrefix(line, ":"):
			// Comment (": heartbeat"): marks the end of the replay burst.
			inBurst = false
			progressed = true
		case strings.HasPrefix(line, "data:"):
			v := strings.TrimPrefix(line, "data:")
			v = strings.TrimPrefix(v, " ")
			data = append(data, v)
			hasData = true
			progressed = true
		default:
			// event:, id:, retry: and unknown fields are ignored.
		}
	}
}
