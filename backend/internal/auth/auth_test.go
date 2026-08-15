package auth

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"testing"

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
