package remote

import (
	"encoding/json"
	"errors"
	"log"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

// HTTP layer for phone pairing, remote control and the live-song state.
// A bad pair token is always 403 pair_invalid — never 401, which the frontend
// treats as "signed out" and would log the phone out of SAT entirely.

const (
	defaultPollWait   = 20
	maxWaitSeconds    = 20
	maxSongIDLen      = 64
	maxTitleRunes     = 300
	maxLanguageLen    = 32
	pairTokenHeader   = "X-Pair-Token"
	msgRemoteError    = "Remote control error"
	msgPairInvalid    = "This phone is no longer paired"
	msgBadControlID   = "Invalid control id"
	msgBadRequestBody = "Invalid request body"
)

var (
	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)
	cmdIDPatt   = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
	codePattern = regexp.MustCompile(`^[0-9]{6}$`)
)

// Handler exposes the Hub over HTTP.
type Handler struct{ hub *Hub }

// NewHandler wraps a hub for HTTP.
func NewHandler(h *Hub) *Handler { return &Handler{hub: h} }

// Register mounts every remote route. nonGuest is auth.RequireNonGuest (passed in to
// avoid importing auth here). /live/state is deliberately OUTSIDE the gated group:
// guest viewers need it.
func Register(api fiber.Router, rh *Handler, nonGuest fiber.Handler) {
	api.Get("/live/state", rh.LiveState)
	api.Post("/live/song", nonGuest, rh.PublishLive)
	g := api.Group("/remote", nonGuest)
	g.Post("/control/code", rh.IssueCode)
	g.Delete("/control/code", rh.CancelCode)
	g.Get("/control/poll", rh.Poll)
	g.Post("/control/ack", rh.Ack)
	g.Delete("/control/pairs/:id", rh.UnpairPhone)
	g.Post("/pair", rh.Claim)
	g.Delete("/pair", rh.Unpair)
	g.Get("/pair/status", rh.PairStatus)
	g.Post("/commands", rh.Submit)
}

// Fiber strings from headers, query params and route params are zero-copy views
// of a request buffer that is reused after the handler returns. Anything the hub
// keeps (map keys, pair records) must be cloned first.

func role(c *fiber.Ctx) string {
	r, _ := c.Locals("role").(string)
	return strings.Clone(r)
}

func user(c *fiber.Ctx) string {
	u, _ := c.Locals("username").(string)
	return strings.Clone(u)
}

func validID(s string) bool { return idPattern.MatchString(s) }

func badRequest(c *fiber.Ctx, msg string) error {
	return c.Status(400).JSON(fiber.Map{"error": msg})
}

func pairInvalid(c *fiber.Ctx) error {
	return c.Status(403).JSON(fiber.Map{"error": msgPairInvalid, "code": "pair_invalid"})
}

// respondErr maps hub errors to HTTP responses in one place.
func respondErr(c *fiber.Ctx, err error) error {
	var rl *RateLimitError
	switch {
	case errors.As(err, &rl):
		secs := int(math.Ceil(rl.RetryAfter.Seconds()))
		if secs < 1 {
			secs = 1
		}
		c.Set("Retry-After", strconv.Itoa(secs))
		return c.Status(429).JSON(fiber.Map{
			"error":       "Too many attempts. Try again later.",
			"code":        "rate_limited",
			"retry_after": secs,
		})
	case errors.Is(err, ErrLeaseConflict):
		return c.Status(409).JSON(fiber.Map{"error": "Another window is using this control id", "code": "lease_conflict"})
	case errors.Is(err, ErrCodeInvalid):
		return c.Status(403).JSON(fiber.Map{"error": "That code didn't work", "code": "code_invalid"})
	case errors.Is(err, ErrTooManyPairs):
		return c.Status(409).JSON(fiber.Map{"error": "Too many phones are paired with this window", "code": "too_many_pairs"})
	case errors.Is(err, ErrForbiddenRole):
		return c.Status(403).JSON(fiber.Map{"error": "Remote control requires a team account"})
	case errors.Is(err, ErrPairInvalid):
		return pairInvalid(c)
	default:
		log.Printf("remote: %s %s: %v", c.Method(), c.Path(), err)
		return c.Status(500).JSON(fiber.Map{"error": msgRemoteError})
	}
}

// pairFrom resolves the X-Pair-Token header to a live pair session.
func (rh *Handler) pairFrom(c *fiber.Ctx) (Pair, error) {
	tok := c.Get(pairTokenHeader)
	if tok == "" {
		return Pair{}, ErrPairInvalid
	}
	return rh.hub.ResolvePair(tok, user(c), role(c))
}

// waitParam parses a seconds query param clamped to 0..maxWaitSeconds.
func waitParam(c *fiber.Ctx, def int) time.Duration {
	w := def
	if s := c.Query("wait"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			w = n
		}
	}
	if w < 0 {
		w = 0
	}
	if w > maxWaitSeconds {
		w = maxWaitSeconds
	}
	return time.Duration(w) * time.Second
}

// controlQuery reads and validates control_id + lease from the query string.
func controlQuery(c *fiber.Ctx) (string, string, bool) {
	id, lease := strings.Clone(c.Query("control_id")), strings.Clone(c.Query("lease"))
	return id, lease, validID(id) && validID(lease)
}

// IssueCode handles POST /api/remote/control/code.
func (rh *Handler) IssueCode(c *fiber.Ctx) error {
	var req struct {
		ControlID string `json:"control_id"`
		Lease     string `json:"lease"`
		Rotate    bool   `json:"rotate"`
	}
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, msgBadRequestBody)
	}
	if !validID(req.ControlID) || !validID(req.Lease) {
		return badRequest(c, msgBadControlID)
	}
	info, err := rh.hub.IssueCode(req.ControlID, req.Lease, role(c), user(c), req.Rotate)
	if err != nil {
		return respondErr(c, err)
	}
	return c.JSON(info)
}

// CancelCode handles DELETE /api/remote/control/code.
func (rh *Handler) CancelCode(c *fiber.Ctx) error {
	id, lease, ok := controlQuery(c)
	if !ok {
		return badRequest(c, msgBadControlID)
	}
	if err := rh.hub.CancelCode(id, lease); err != nil {
		return respondErr(c, err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Poll handles GET /api/remote/control/poll (control-window long-poll).
func (rh *Handler) Poll(c *fiber.Ctx) error {
	id, lease, ok := controlQuery(c)
	if !ok {
		return badRequest(c, msgBadControlID)
	}
	res, err := rh.hub.Poll(id, lease, role(c), user(c), waitParam(c, defaultPollWait))
	if err != nil {
		return respondErr(c, err)
	}
	return c.JSON(res)
}

// Ack handles POST /api/remote/control/ack.
func (rh *Handler) Ack(c *fiber.Ctx) error {
	var req struct {
		ControlID string `json:"control_id"`
		Lease     string `json:"lease"`
		Seq       int64  `json:"seq"`
		OK        bool   `json:"ok"`
		Message   string `json:"message"`
	}
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, msgBadRequestBody)
	}
	if !validID(req.ControlID) || !validID(req.Lease) {
		return badRequest(c, msgBadControlID)
	}
	if err := rh.hub.Ack(req.ControlID, req.Lease, req.Seq, req.OK, req.Message); err != nil {
		return respondErr(c, err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

// UnpairPhone handles DELETE /api/remote/control/pairs/:id.
func (rh *Handler) UnpairPhone(c *fiber.Ctx) error {
	id, lease, ok := controlQuery(c)
	if !ok {
		return badRequest(c, msgBadControlID)
	}
	pairID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || pairID <= 0 {
		return badRequest(c, "Invalid pair id")
	}
	if err := rh.hub.UnpairPhone(id, lease, pairID); err != nil {
		return respondErr(c, err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

// Claim handles POST /api/remote/pair: exchange a 6-digit code for a pair token.
func (rh *Handler) Claim(c *fiber.Ctx) error {
	var req struct {
		Code  string `json:"code"`
		Label string `json:"label"`
	}
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, msgBadRequestBody)
	}
	code := req.Code
	if !codePattern.MatchString(code) {
		// Malformed codes still go through the hub so they count as failures
		// toward the brute-force limits; this value can never match a code.
		code = "-"
	}
	tok, pair, err := rh.hub.Claim(ClientIP(c), user(c), role(c), code, req.Label)
	if err != nil {
		return respondErr(c, err)
	}
	st := rh.hub.Status(pair)
	return c.JSON(fiber.Map{
		"pair_token":    tok,
		"control_label": st.ControlLabel,
		"capabilities":  st.Capabilities,
	})
}

// Unpair handles DELETE /api/remote/pair (phone forgets itself). Always 200:
// an already-invalid token is the desired end state.
func (rh *Handler) Unpair(c *fiber.Ctx) error {
	if tok := c.Get(pairTokenHeader); tok != "" {
		if err := rh.hub.UnpairToken(tok); err != nil && !errors.Is(err, ErrPairInvalid) {
			log.Printf("remote: unpair: %v", err)
		}
	}
	return c.JSON(fiber.Map{"ok": true})
}

// PairStatus handles GET /api/remote/pair/status.
func (rh *Handler) PairStatus(c *fiber.Ctx) error {
	pair, err := rh.pairFrom(c)
	if err != nil {
		if errors.Is(err, ErrPairInvalid) || errors.Is(err, ErrForbiddenRole) {
			return pairInvalid(c)
		}
		return respondErr(c, err)
	}
	return c.JSON(rh.hub.Status(pair))
}

// Submit handles POST /api/remote/commands. It holds the request until the
// control window acks (or AckWait passes); the outcome is in the body's status.
func (rh *Handler) Submit(c *fiber.Ctx) error {
	pair, err := rh.pairFrom(c)
	if err != nil {
		if errors.Is(err, ErrPairInvalid) || errors.Is(err, ErrForbiddenRole) {
			return pairInvalid(c)
		}
		return respondErr(c, err)
	}
	var req struct {
		ID   string          `json:"id"`
		Type string          `json:"type"`
		Args json.RawMessage `json:"args"`
	}
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, msgBadRequestBody)
	}
	if !cmdIDPatt.MatchString(req.ID) {
		return badRequest(c, "Invalid command id")
	}
	return c.JSON(rh.hub.Submit(pair, req.ID, req.Type, req.Args))
}

// PublishLive handles POST /api/live/song. Last write wins across control windows.
func (rh *Handler) PublishLive(c *fiber.Ctx) error {
	var req struct {
		SongID   string `json:"song_id"`
		Title    string `json:"title"`
		Language string `json:"language"`
		Cleared  bool   `json:"cleared"`
	}
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, msgBadRequestBody)
	}
	src := LiveSource{Role: role(c), Username: user(c)}
	if req.Cleared {
		return c.JSON(rh.hub.PublishLive(nil, src))
	}
	if req.SongID == "" {
		return badRequest(c, "song_id is required")
	}
	if len(req.SongID) > maxSongIDLen || utf8.RuneCountInString(req.Title) > maxTitleRunes || len(req.Language) > maxLanguageLen {
		return badRequest(c, "Live song fields are too long")
	}
	song := &LiveSong{ID: req.SongID, Title: req.Title, Language: req.Language}
	return c.JSON(rh.hub.PublishLive(song, src))
}

// LiveState handles GET /api/live/state — the viewer's long-poll. Open to every
// signed-in role, including guest.
func (rh *Handler) LiveState(c *fiber.Ctx) error {
	since := int64(-1)
	if s := c.Query("since"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			since = n
		}
	}
	return c.JSON(rh.hub.WaitLive(since, waitParam(c, 0)))
}
