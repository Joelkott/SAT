package versedetect

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func newHTTPTestApp(t *testing.T) (*fiber.App, *Detector) {
	t.Helper()
	d := New(Options{StreamURL: "off", Canon: kjv()})
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", c.Get("X-Test-Role"))
		return c.Next()
	})
	Register(app.Group("/api"), d)
	return app, d
}

func doHTTP(t *testing.T, app *fiber.App, method, path, role, body string, timeoutMs int) (int, []byte) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if role != "" {
		req.Header.Set("X-Test-Role", role)
	}
	resp, err := app.Test(req, timeoutMs)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func TestHTTPForbiddenRoles(t *testing.T) {
	app, _ := newHTTPTestApp(t)
	routes := []struct{ method, path, body string }{
		{http.MethodGet, "/api/verse-detect/suggestions", ""},
		{http.MethodGet, "/api/verse-detect/status", ""},
		{http.MethodPost, "/api/verse-detect/config", `{"enabled":false}`},
	}
	for _, role := range []string{"worship", "guest", ""} {
		for _, rt := range routes {
			code, _ := doHTTP(t, app, rt.method, rt.path, role, rt.body, 2000)
			if code != http.StatusForbidden {
				t.Fatalf("role %q %s %s: got %d, want 403", role, rt.method, rt.path, code)
			}
		}
	}
}

func TestHTTPStatusMediaAndAdmin(t *testing.T) {
	app, _ := newHTTPTestApp(t)
	for _, role := range []string{"media", "admin"} {
		code, body := doHTTP(t, app, http.MethodGet, "/api/verse-detect/status", role, "", 2000)
		if code != http.StatusOK {
			t.Fatalf("role %s: status %d", role, code)
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			t.Fatalf("json: %v (%s)", err, body)
		}
		for _, k := range []string{"configured", "enabled", "stream", "service_status", "listening", "jev", "last_caption_at", "current_passage"} {
			if _, ok := m[k]; !ok {
				t.Fatalf("role %s: missing key %q in %s", role, k, body)
			}
		}
	}
}

func TestHTTPSuggestions(t *testing.T) {
	app, d := newHTTPTestApp(t)

	code, body := doHTTP(t, app, http.MethodGet, "/api/verse-detect/suggestions?since=-1", "media", "", 2000)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if !strings.Contains(string(body), `"detections":[]`) {
		t.Fatalf("empty detections should be [], got %s", body)
	}

	d.Handle(capEv("Please turn to John 3:16"))
	code, body = doHTTP(t, app, http.MethodGet, "/api/verse-detect/suggestions?since=-1", "media", "", 2000)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	var pr struct {
		Version    *float64 `json:"version"`
		Detections []struct {
			Passage string `json:"passage"`
		} `json:"detections"`
		Status map[string]any `json:"status"`
	}
	if err := json.Unmarshal(body, &pr); err != nil {
		t.Fatalf("json: %v (%s)", err, body)
	}
	if pr.Version == nil {
		t.Fatalf("version missing: %s", body)
	}
	if len(pr.Detections) == 0 || pr.Detections[0].Passage != "JHN 3:16" {
		t.Fatalf("detections %s", body)
	}
	if pr.Status == nil {
		t.Fatalf("status missing: %s", body)
	}
}

func TestHTTPWaitClamped(t *testing.T) {
	app, d := newHTTPTestApp(t)
	v := d.Poll(-1, 0).Version
	start := time.Now()
	code, _ := doHTTP(t, app, http.MethodGet, "/api/verse-detect/suggestions?since="+strconv.FormatInt(v, 10)+"&wait=1", "media", "", 5000)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if el := time.Since(start); el < 900*time.Millisecond || el > 3*time.Second {
		t.Fatalf("wait=1 took %v", el)
	}
	if got := waitSeconds("999"); got != maxPollWait {
		t.Fatalf("wait=999 -> %d, want %d", got, maxPollWait)
	}
	if got := waitSeconds("-5"); got != 0 {
		t.Fatalf("wait=-5 -> %d", got)
	}
	if got := waitSeconds("abc"); got != 0 {
		t.Fatalf("wait=abc -> %d", got)
	}
}

func TestHTTPConfig(t *testing.T) {
	app, d := newHTTPTestApp(t)
	code, body := doHTTP(t, app, http.MethodPost, "/api/verse-detect/config", "admin", `{"enabled":false}`, 2000)
	if code != http.StatusOK {
		t.Fatalf("status %d (%s)", code, body)
	}
	var s Status
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatalf("json: %v", err)
	}
	if s.Enabled || d.Status().Enabled {
		t.Fatalf("not disabled: %s", body)
	}
	for _, bad := range []string{`not json`, `{}`, `{"enabled":"yes"}`} {
		code, body = doHTTP(t, app, http.MethodPost, "/api/verse-detect/config", "media", bad, 2000)
		if code != http.StatusBadRequest {
			t.Fatalf("body %q: got %d (%s)", bad, code, body)
		}
	}
	code, _ = doHTTP(t, app, http.MethodPost, "/api/verse-detect/config", "media", `{"enabled":true}`, 2000)
	if code != http.StatusOK || !d.Status().Enabled {
		t.Fatalf("re-enable failed: %d", code)
	}
}
