package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"
)

// Team-account auth: three roles (admin/media/worship), bcrypt passwords in
// Postgres, stateless HMAC-signed bearer tokens (no external dependency).

type claims struct {
	Username string `json:"u"`
	Role     string `json:"r"`
	Exp      int64  `json:"e"`
}

type Service struct {
	db     *sql.DB
	secret []byte
}

func New(db *sql.DB) *Service {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		secret = "insecure-dev-secret-set-AUTH_SECRET"
		log.Println("⚠️  AUTH_SECRET not set — using an insecure dev secret")
	}
	return &Service{db: db, secret: []byte(secret)}
}

// Bootstrap ensures the users table and three team accounts exist, using
// AUTH_<ROLE>_PASSWORD env vars (falling back to changeme-<role>).
func (s *Service) Bootstrap() {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL CHECK (role IN ('admin', 'media', 'worship')),
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`); err != nil {
		log.Printf("⚠️  auth bootstrap (create table): %v", err)
		return
	}
	for _, role := range []string{"admin", "media", "worship"} {
		var n int
		if err := s.db.QueryRow(`SELECT count(*) FROM users WHERE username=$1`, role).Scan(&n); err != nil || n > 0 {
			continue
		}
		pw := os.Getenv("AUTH_" + strings.ToUpper(role) + "_PASSWORD")
		if pw == "" {
			pw = "changeme-" + role
			log.Printf("⚠️  user %q created with DEFAULT password %q — change it!", role, pw)
		}
		hash, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		if _, err := s.db.Exec(`INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$1)`, role, string(hash)); err != nil {
			log.Printf("⚠️  auth bootstrap insert %s: %v", role, err)
		} else {
			log.Printf("✅ auth: created %q account", role)
		}
	}
}

func (s *Service) sign(b []byte) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write(b)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Service) token(c claims) string {
	b, _ := json.Marshal(c)
	p := base64.RawURLEncoding.EncodeToString(b)
	return p + "." + s.sign([]byte(p))
}

func (s *Service) parse(tok string) (*claims, error) {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 || !hmac.Equal([]byte(s.sign([]byte(parts[0]))), []byte(parts[1])) {
		return nil, fmt.Errorf("bad signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if time.Now().Unix() > c.Exp {
		return nil, fmt.Errorf("expired")
	}
	return &c, nil
}

// Login handles POST /api/auth/login.
func (s *Service) Login(c *fiber.Ctx) error {
	var req struct{ Username, Password string }
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}
	var hash, role string
	err := s.db.QueryRow(`SELECT password_hash, role FROM users WHERE username=$1`, strings.ToLower(strings.TrimSpace(req.Username))).Scan(&hash, &role)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid username or password"})
	}
	cl := claims{Username: strings.ToLower(strings.TrimSpace(req.Username)), Role: role, Exp: time.Now().Add(30 * 24 * time.Hour).Unix()}
	return c.JSON(fiber.Map{"token": s.token(cl), "role": role, "username": cl.Username})
}

// Me handles GET /api/auth/me.
func (s *Service) Me(c *fiber.Ctx) error {
	cl := c.Locals("claims").(*claims)
	return c.JSON(fiber.Map{"role": cl.Role, "username": cl.Username})
}

// Middleware guards everything except login/health and endpoints that carry
// their own API-key auth (remote caption parser, caption SSE stream).
func (s *Service) Middleware() fiber.Handler {
	open := map[string]bool{
		"/api/health":           true,
		"/api/auth/login":       true,
		"/api/caption":          true,
		"/api/bible-references": true,
		"/api/bible/sse":        true,
	}
	return func(c *fiber.Ctx) error {
		if open[c.Path()] {
			return c.Next()
		}
		// Scripture output is read by the Resolume/OBS browser-capture page,
		// which cannot carry a session. Only the GET (read) is public; the
		// POST/DELETE that set or clear the wall stay authenticated.
		if c.Method() == fiber.MethodGet && c.Path() == "/api/live/scripture" {
			return c.Next()
		}
		tok := strings.TrimPrefix(c.Get("Authorization"), "Bearer ")
		if tok == "" {
			tok = c.Query("token")
		}
		cl, err := s.parse(tok)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Authentication required"})
		}
		c.Locals("claims", cl)
		c.Locals("role", cl.Role)
		c.Locals("username", cl.Username)
		return c.Next()
	}
}

// RequireAdmin gates destructive routes.
func RequireAdmin(c *fiber.Ctx) error {
	if r, _ := c.Locals("role").(string); r != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
	}
	return c.Next()
}

// SetPassword handles PUT /api/auth/users/:username/password (admin only):
// lets the admin reset any team account, including their own.
func (s *Service) SetPassword(c *fiber.Ctx) error {
	username := strings.ToLower(strings.TrimSpace(c.Params("username")))
	var req struct{ Password string }
	if err := c.BodyParser(&req); err != nil || len(req.Password) < 6 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 6 characters"})
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
	}
	res, err := s.db.Exec(`UPDATE users SET password_hash=$1 WHERE username=$2`, string(hash), username)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to update password"})
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Unknown account"})
	}
	return c.JSON(fiber.Map{"message": "Password updated"})
}
