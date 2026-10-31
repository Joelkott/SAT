package auth

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

// gateApp builds a throwaway Fiber app that injects a role the way
// Service.Middleware() does, then runs the gate under test. No database and no
// token signing are involved, so these tests run anywhere.
func gateApp(role string, gate fiber.Handler) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", role)
		return c.Next()
	})
	app.Use(gate)
	app.Get("/*", func(c *fiber.Ctx) error {
		return c.SendString("ok")
	})
	return app
}

func TestRequireAdmin(t *testing.T) {
	cases := []struct {
		role string
		want int
	}{
		{"admin", 200},
		{"media", 403},
		{"worship", 403},
		{"guest", 403},
		{"", 403},
	}
	for _, tc := range cases {
		t.Run("role="+tc.role, func(t *testing.T) {
			resp, err := gateApp(tc.role, RequireAdmin).Test(httptest.NewRequest("GET", "/api/admin/reindex", nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != tc.want {
				t.Fatalf("role %q: got %d, want %d", tc.role, resp.StatusCode, tc.want)
			}
		})
	}
}

func TestRequireProPresenter(t *testing.T) {
	cases := []struct {
		role string
		want int
	}{
		{"admin", 200},
		{"media", 200},
		{"worship", 200},
		{"guest", 403},
	}
	for _, tc := range cases {
		t.Run("role="+tc.role, func(t *testing.T) {
			resp, err := gateApp(tc.role, RequireProPresenter).Test(httptest.NewRequest("GET", "/api/propresenter/status", nil))
			if err != nil {
				t.Fatalf("app.Test: %v", err)
			}
			if resp.StatusCode != tc.want {
				t.Fatalf("role %q: got %d, want %d", tc.role, resp.StatusCode, tc.want)
			}
		})
	}
}

func TestRequireProPresenterDeniedBodyExplains(t *testing.T) {
	resp, err := gateApp("guest", RequireProPresenter).Test(httptest.NewRequest("GET", "/api/propresenter/trigger", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("body is not JSON (%s): %v", body, err)
	}
	msg, ok := payload["error"].(string)
	if !ok || msg == "" {
		t.Fatalf("expected a non-empty %q field, got %s", "error", body)
	}
}

func TestReadOnlyViolation(t *testing.T) {
	cases := []struct {
		role, method string
		want         bool
	}{
		{"guest", "GET", false},
		{"guest", "HEAD", false},
		{"guest", "OPTIONS", false},
		{"guest", "POST", true},
		{"guest", "PUT", true},
		{"guest", "DELETE", true},
		{"guest", "PATCH", true},
		{"guest", "post", true},
		{"guest", "get", false},
	}
	for _, role := range []string{"admin", "media", "worship", ""} {
		for _, m := range []string{"GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"} {
			cases = append(cases, struct {
				role, method string
				want         bool
			}{role, m, false})
		}
	}
	for _, tc := range cases {
		if got := readOnlyViolation(tc.role, tc.method); got != tc.want {
			t.Errorf("readOnlyViolation(%q, %q) = %v, want %v", tc.role, tc.method, got, tc.want)
		}
	}
}

// TestMiddlewareGuestReadOnly signs a real guest token and runs it through
// Service.Middleware(): writes are refused with an explanatory 403, reads pass.
func TestMiddlewareGuestReadOnly(t *testing.T) {
	s := New(nil)
	tok := s.token(claims{Username: "guest", Role: "guest", Exp: time.Now().Add(time.Hour).Unix()})
	app := fiber.New()
	app.Use(s.Middleware())
	app.All("/*", func(c *fiber.Ctx) error { return c.SendString("ok") })

	for _, tc := range []struct {
		method string
		want   int
	}{
		{"GET", 200},
		{"POST", 403},
		{"PUT", 403},
		{"DELETE", 403},
	} {
		req := httptest.NewRequest(tc.method, "/api/queue/clear", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatalf("app.Test: %v", err)
		}
		if resp.StatusCode != tc.want {
			t.Fatalf("guest %s: got %d, want %d", tc.method, resp.StatusCode, tc.want)
		}
		if tc.want == 403 {
			body, _ := io.ReadAll(resp.Body)
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil || payload["error"] != "Guest access is read-only" {
				t.Fatalf("guest %s: unexpected body %s", tc.method, body)
			}
		}
	}

	// Other roles may still write.
	wtok := s.token(claims{Username: "worship", Role: "worship", Exp: time.Now().Add(time.Hour).Unix()})
	req := httptest.NewRequest("POST", "/api/queue/clear", nil)
	req.Header.Set("Authorization", "Bearer "+wtok)
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("worship POST: got %v %v, want 200", resp.StatusCode, err)
	}
}
