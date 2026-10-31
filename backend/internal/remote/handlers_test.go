package remote

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/yourusername/audience-stage-teleprompter/internal/auth"
)

const (
	testCtl   = "ctl_aaaaaaaaaaaaaaaaaa"
	testLease = "lease_bbbbbbbbbbbbbbbbb"
)

func newHTTPTestApp() (*fiber.App, *Hub) {
	hub := NewHub(NewMemStore())
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", c.Get("X-Test-Role"))
		c.Locals("username", c.Get("X-Test-User"))
		return c.Next()
	})
	Register(app.Group("/api"), NewHandler(hub), auth.RequireNonGuest)
	return app, hub
}

type reqOpts struct {
	role, user, pairToken string
}

func doReq(t *testing.T, app *fiber.App, method, path string, body any, o reqOpts) (*http.Response, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if o.role != "" {
		req.Header.Set("X-Test-Role", o.role)
	}
	user := o.user
	if user == "" && o.role != "" {
		user = o.role + "user"
	}
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	if o.pairToken != "" {
		req.Header.Set("X-Pair-Token", o.pairToken)
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func httpIssueCode(t *testing.T, app *fiber.App) string {
	t.Helper()
	resp, body := doReq(t, app, "POST", "/api/remote/control/code",
		map[string]any{"control_id": testCtl, "lease": testLease}, reqOpts{role: "worship"})
	if resp.StatusCode != 200 {
		t.Fatalf("issue code: %d %v", resp.StatusCode, body)
	}
	code, _ := body["code"].(string)
	if !regexp.MustCompile(`^[0-9]{6}$`).MatchString(code) {
		t.Fatalf("code %q is not 6 digits", code)
	}
	if _, ok := body["expires_at"].(float64); !ok {
		t.Fatalf("missing expires_at: %v", body)
	}
	return code
}

func httpPairPhone(t *testing.T, app *fiber.App) string {
	t.Helper()
	code := httpIssueCode(t, app)
	resp, body := doReq(t, app, "POST", "/api/remote/pair",
		map[string]any{"code": code, "label": "Joel's phone"}, reqOpts{role: "media"})
	if resp.StatusCode != 200 {
		t.Fatalf("claim: %d %v", resp.StatusCode, body)
	}
	tok, _ := body["pair_token"].(string)
	if tok == "" {
		t.Fatalf("no pair_token: %v", body)
	}
	if _, ok := body["control_label"]; !ok {
		t.Fatalf("no control_label: %v", body)
	}
	if _, ok := body["capabilities"].(map[string]any); !ok {
		t.Fatalf("no capabilities: %v", body)
	}
	return tok
}

func TestGuestForbiddenOnRemoteRoutes(t *testing.T) {
	app, _ := newHTTPTestApp()
	cases := []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/remote/control/poll?control_id=" + testCtl + "&lease=" + testLease + "&wait=0", nil},
		{"POST", "/api/remote/control/code", map[string]any{"control_id": testCtl, "lease": testLease}},
		{"POST", "/api/remote/pair", map[string]any{"code": "123456"}},
		{"POST", "/api/remote/commands", map[string]any{"id": "cmd_12345678", "type": "song.next"}},
		{"GET", "/api/remote/pair/status", nil},
		{"POST", "/api/live/song", map[string]any{"song_id": "1", "title": "x", "language": "english"}},
	}
	for _, role := range []string{"guest", ""} {
		for _, tc := range cases {
			resp, body := doReq(t, app, tc.method, tc.path, tc.body, reqOpts{role: role})
			if resp.StatusCode != 403 {
				t.Errorf("role %q %s %s: got %d, want 403", role, tc.method, tc.path, resp.StatusCode)
			}
			if s, _ := body["error"].(string); s == "" {
				t.Errorf("role %q %s %s: empty error", role, tc.method, tc.path)
			}
		}
	}
}

func TestGuestCanReadLiveState(t *testing.T) {
	app, _ := newHTTPTestApp()
	resp, body := doReq(t, app, "GET", "/api/live/state?wait=0", nil, reqOpts{role: "guest"})
	if resp.StatusCode != 200 {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	for _, k := range []string{"version", "song", "cleared", "source", "updated_at", "queue_version"} {
		if _, ok := body[k]; !ok {
			t.Errorf("live state missing key %q: %v", k, body)
		}
	}
}

func TestPublishLiveAndWait(t *testing.T) {
	app, _ := newHTTPTestApp()
	_, before := doReq(t, app, "GET", "/api/live/state", nil, reqOpts{role: "guest"})
	v := int64(before["version"].(float64))

	done := make(chan map[string]any, 1)
	go func() {
		_, body := doReq(t, app, "GET", fmt.Sprintf("/api/live/state?since=%d&wait=5", v), nil, reqOpts{role: "guest"})
		done <- body
	}()
	time.Sleep(100 * time.Millisecond)
	resp, pub := doReq(t, app, "POST", "/api/live/song",
		map[string]any{"song_id": "42", "title": "Amazing Grace", "language": "english"}, reqOpts{role: "worship"})
	if resp.StatusCode != 200 {
		t.Fatalf("publish: %d %v", resp.StatusCode, pub)
	}
	select {
	case body := <-done:
		song, _ := body["song"].(map[string]any)
		if song == nil || song["id"] != "42" || song["title"] != "Amazing Grace" {
			t.Fatalf("waiter got %v", body)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("live waiter was not woken")
	}

	resp, body := doReq(t, app, "POST", "/api/live/song", map[string]any{"cleared": true}, reqOpts{role: "media"})
	if resp.StatusCode != 200 || body["cleared"] != true {
		t.Fatalf("clear: %d %v", resp.StatusCode, body)
	}
}

func TestPublishLiveValidation(t *testing.T) {
	app, _ := newHTTPTestApp()
	bad := []map[string]any{
		{"title": "no id"},
		{"song_id": strings.Repeat("x", 65), "title": "t"},
		{"song_id": "1", "title": strings.Repeat("é", 301)},
		{"song_id": "1", "title": "t", "language": strings.Repeat("l", 33)},
	}
	for _, b := range bad {
		resp, _ := doReq(t, app, "POST", "/api/live/song", b, reqOpts{role: "worship"})
		if resp.StatusCode != 400 {
			t.Errorf("%v: got %d, want 400", b, resp.StatusCode)
		}
	}
}

func TestClaimWrongAndRightCode(t *testing.T) {
	app, _ := newHTTPTestApp()
	code := httpIssueCode(t, app)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for _, c := range []string{wrong, "abc"} {
		resp, body := doReq(t, app, "POST", "/api/remote/pair", map[string]any{"code": c}, reqOpts{role: "media"})
		if resp.StatusCode != 403 || body["code"] != "code_invalid" {
			t.Fatalf("code %q: got %d %v", c, resp.StatusCode, body)
		}
	}
	resp, body := doReq(t, app, "POST", "/api/remote/pair", map[string]any{"code": code}, reqOpts{role: "media"})
	if resp.StatusCode != 200 || body["pair_token"] == "" {
		t.Fatalf("right code: %d %v", resp.StatusCode, body)
	}
}

func TestClaimRateLimited(t *testing.T) {
	app, _ := newHTTPTestApp()
	httpIssueCode(t, app)
	var resp *http.Response
	var body map[string]any
	for i := 0; i < 8; i++ {
		resp, body = doReq(t, app, "POST", "/api/remote/pair", map[string]any{"code": "999999x"}, reqOpts{role: "media"})
		if resp.StatusCode == 429 {
			break
		}
	}
	if resp.StatusCode != 429 || body["code"] != "rate_limited" {
		t.Fatalf("expected 429 rate_limited, got %d %v", resp.StatusCode, body)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}
	if _, ok := body["retry_after"].(float64); !ok {
		t.Fatalf("missing retry_after: %v", body)
	}
}

func TestBogusPairTokenIs403NotLogout(t *testing.T) {
	app, _ := newHTTPTestApp()
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/remote/pair/status"},
		{"POST", "/api/remote/commands"},
	} {
		resp, body := doReq(t, app, tc.method, tc.path,
			map[string]any{"id": "cmd_12345678", "type": "song.next"}, reqOpts{role: "media", pairToken: "bogus"})
		if resp.StatusCode != 403 || body["code"] != "pair_invalid" {
			t.Fatalf("%s %s: got %d %v", tc.method, tc.path, resp.StatusCode, body)
		}
	}
	// Unpair with an invalid token is still OK.
	resp, _ := doReq(t, app, "DELETE", "/api/remote/pair", nil, reqOpts{role: "media", pairToken: "bogus"})
	if resp.StatusCode != 200 {
		t.Fatalf("unpair bogus: %d", resp.StatusCode)
	}
}

func TestPairStatus(t *testing.T) {
	app, _ := newHTTPTestApp()
	tok := httpPairPhone(t, app)
	resp, body := doReq(t, app, "GET", "/api/remote/pair/status", nil, reqOpts{role: "media", pairToken: tok})
	if resp.StatusCode != 200 || body["paired"] != true {
		t.Fatalf("status: %d %v", resp.StatusCode, body)
	}
	for _, k := range []string{"control_online", "control_label", "capabilities"} {
		if _, ok := body[k]; !ok {
			t.Errorf("status missing %q", k)
		}
	}
	// Unpair, then the token is dead.
	resp, _ = doReq(t, app, "DELETE", "/api/remote/pair", nil, reqOpts{role: "media", pairToken: tok})
	if resp.StatusCode != 200 {
		t.Fatalf("unpair: %d", resp.StatusCode)
	}
	resp, body = doReq(t, app, "GET", "/api/remote/pair/status", nil, reqOpts{role: "media", pairToken: tok})
	if resp.StatusCode != 403 || body["code"] != "pair_invalid" {
		t.Fatalf("after unpair: %d %v", resp.StatusCode, body)
	}
}

func TestFullRelay(t *testing.T) {
	app, _ := newHTTPTestApp()
	tok := httpPairPhone(t, app)

	result := make(chan map[string]any, 1)
	go func() {
		_, body := doReq(t, app, "POST", "/api/remote/commands",
			map[string]any{"id": "cmd_relay_0001", "type": "song.next", "args": map[string]any{}},
			reqOpts{role: "media", pairToken: tok})
		result <- body
	}()

	var seq int64
	deadline := time.Now().Add(3 * time.Second)
	for seq == 0 && time.Now().Before(deadline) {
		resp, body := doReq(t, app, "GET",
			"/api/remote/control/poll?control_id="+testCtl+"&lease="+testLease+"&wait=2", nil, reqOpts{role: "worship"})
		if resp.StatusCode != 200 {
			t.Fatalf("poll: %d %v", resp.StatusCode, body)
		}
		for _, k := range []string{"commands", "pairs", "code", "notice", "queue_version", "live_updated_at"} {
			if _, ok := body[k]; !ok {
				t.Fatalf("poll missing %q: %v", k, body)
			}
		}
		cmds, _ := body["commands"].([]any)
		if len(cmds) > 0 {
			cmd := cmds[0].(map[string]any)
			if cmd["type"] != "song.next" || cmd["id"] != "cmd_relay_0001" {
				t.Fatalf("unexpected command %v", cmd)
			}
			seq = int64(cmd["seq"].(float64))
		}
	}
	if seq == 0 {
		t.Fatal("command never delivered to the control window")
	}
	resp, body := doReq(t, app, "POST", "/api/remote/control/ack",
		map[string]any{"control_id": testCtl, "lease": testLease, "seq": seq, "ok": true}, reqOpts{role: "worship"})
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("ack: %d %v", resp.StatusCode, body)
	}
	select {
	case r := <-result:
		if r["status"] != "done" {
			t.Fatalf("command result %v, want done", r)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("command response never arrived")
	}
}

func TestSubmitBadCommandID(t *testing.T) {
	app, _ := newHTTPTestApp()
	tok := httpPairPhone(t, app)
	for _, id := range []string{"short", strings.Repeat("a", 65), "bad/id_12345"} {
		resp, _ := doReq(t, app, "POST", "/api/remote/commands",
			map[string]any{"id": id, "type": "song.next"}, reqOpts{role: "media", pairToken: tok})
		if resp.StatusCode != 400 {
			t.Errorf("id %q: got %d, want 400", id, resp.StatusCode)
		}
	}
}

func TestHTTPLeaseConflict(t *testing.T) {
	app, _ := newHTTPTestApp()
	resp, _ := doReq(t, app, "GET",
		"/api/remote/control/poll?control_id="+testCtl+"&lease="+testLease+"&wait=0", nil, reqOpts{role: "worship"})
	if resp.StatusCode != 200 {
		t.Fatalf("first poll: %d", resp.StatusCode)
	}
	resp, body := doReq(t, app, "GET",
		"/api/remote/control/poll?control_id="+testCtl+"&lease=lease_ccccccccccccccccc&wait=0", nil, reqOpts{role: "worship"})
	if resp.StatusCode != 409 || body["code"] != "lease_conflict" {
		t.Fatalf("second lease: %d %v", resp.StatusCode, body)
	}
}

func TestInvalidControlID(t *testing.T) {
	app, _ := newHTTPTestApp()
	for _, id := range []string{"x", strings.Repeat("a", 65), "ctl_aaaaaaaa/aaaaaaaaa"} {
		resp, _ := doReq(t, app, "POST", "/api/remote/control/code",
			map[string]any{"control_id": id, "lease": testLease}, reqOpts{role: "worship"})
		if resp.StatusCode != 400 {
			t.Errorf("control_id %q: got %d, want 400", id, resp.StatusCode)
		}
		resp, _ = doReq(t, app, "GET",
			"/api/remote/control/poll?control_id="+id+"&lease="+testLease+"&wait=0", nil, reqOpts{role: "worship"})
		if resp.StatusCode != 400 {
			t.Errorf("poll control_id %q: got %d, want 400", id, resp.StatusCode)
		}
	}
}

func TestCancelCodeAndUnpairPhone(t *testing.T) {
	app, _ := newHTTPTestApp()
	tok := httpPairPhone(t, app)
	_, poll := doReq(t, app, "GET",
		"/api/remote/control/poll?control_id="+testCtl+"&lease="+testLease+"&wait=0", nil, reqOpts{role: "worship"})
	pairs, _ := poll["pairs"].([]any)
	if len(pairs) != 1 {
		t.Fatalf("pairs = %v", poll["pairs"])
	}
	id := int64(pairs[0].(map[string]any)["id"].(float64))

	resp, body := doReq(t, app, "DELETE", "/api/remote/control/code?control_id="+testCtl+"&lease="+testLease, nil, reqOpts{role: "worship"})
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("cancel code: %d %v", resp.StatusCode, body)
	}
	resp, _ = doReq(t, app, "DELETE", "/api/remote/control/pairs/notanumber?control_id="+testCtl+"&lease="+testLease, nil, reqOpts{role: "worship"})
	if resp.StatusCode != 400 {
		t.Fatalf("bad pair id: %d", resp.StatusCode)
	}
	resp, body = doReq(t, app, "DELETE", fmt.Sprintf("/api/remote/control/pairs/%d?control_id=%s&lease=%s", id, testCtl, testLease), nil, reqOpts{role: "worship"})
	if resp.StatusCode != 200 || body["ok"] != true {
		t.Fatalf("unpair phone: %d %v", resp.StatusCode, body)
	}
	resp, body = doReq(t, app, "GET", "/api/remote/pair/status", nil, reqOpts{role: "media", pairToken: tok})
	if resp.StatusCode != 403 || body["code"] != "pair_invalid" {
		t.Fatalf("status after unpair: %d %v", resp.StatusCode, body)
	}
}
