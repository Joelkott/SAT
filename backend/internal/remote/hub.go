package remote

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// The hub is the in-memory core of phone pairing and remote control:
// pair codes, control-window leases, per-control command queues with acks,
// the published live song and a queue version, plus long-poll wake-ups.
// Pair sessions themselves live in a PairStore (Postgres in production).

const (
	CodeTTL            = 10 * time.Minute
	AckWait            = 5 * time.Second
	LeaseStale         = 10 * time.Second
	OnlineWindow       = 15 * time.Second
	MaxPollWait        = 20 * time.Second
	DedupeTTL          = 2 * time.Minute
	MaxPairsPerControl = 10
	MaxQueuedCommands  = 50
	PairIdleTTL        = 30 * 24 * time.Hour

	maxArgsBytes      = 1024
	maxLabelRunes     = 40
	maxAckMsgRunes    = 200
	pairCacheTTL      = 30 * time.Second
	touchInterval     = 60 * time.Second
	unackedTTL        = 60 * time.Second
	idleControlTTL    = time.Hour
	sweepInterval     = 30 * time.Second
	purgeInterval     = 24 * time.Hour
	globalTripNotice  = "Too many wrong attempts — the code was cancelled. Generate a new one in 5 minutes."
	controlLabelFallb = "control window"
)

var (
	ErrCodeInvalid    = errors.New("code invalid") // same error for unknown, expired, cancelled
	ErrLeaseConflict  = errors.New("lease conflict")
	ErrPairInvalid    = errors.New("pair invalid")
	ErrForbiddenRole  = errors.New("role not allowed")
	ErrTooManyPairs   = errors.New("too many phones paired")
	ErrQueueFull      = errors.New("command queue full")
	ErrUnknownCommand = errors.New("unknown command")
)

// CommandTypes is the allow-list of commands a phone may send.
var CommandTypes = map[string]bool{
	"song.live": true, "song.next": true, "song.prev": true, "song.clear": true,
	"queue.add": true, "queue.remove": true,
	"bible.send": true, "bible.step": true, "bible.clear": true,
	"display.scroll": true, "display.zoom": true,
}

// Capabilities says which remote panels a phone gets, based on the control window's team.
type Capabilities struct {
	Songs   bool `json:"songs"`
	Display bool `json:"display"`
	Wall    bool `json:"wall"`
}

// CapabilitiesFor: songs for any non-guest; display for worship|admin; wall for media|admin.
func CapabilitiesFor(role string) Capabilities {
	if role == "" || role == "guest" {
		return Capabilities{}
	}
	return Capabilities{
		Songs:   true,
		Display: role == "worship" || role == "admin",
		Wall:    role == "media" || role == "admin",
	}
}

type CodeInfo struct {
	Code      string `json:"code"`
	ExpiresAt int64  `json:"expires_at"` // unix ms
}

type Command struct {
	Seq   int64           `json:"seq"`
	ID    string          `json:"id"`
	Type  string          `json:"type"`
	Args  json.RawMessage `json:"args"`
	AgeMs int64           `json:"age_ms"`
	From  string          `json:"from"` // pair label, for the control-window toast

	pairID    int64
	created   time.Time
	delivered bool
	resolved  chan struct{}
	done      bool
	result    AckResult
}

type AckResult struct {
	Status  string `json:"status"` // done|error|offline|timeout
	Message string `json:"message,omitempty"`
}

type PollResult struct {
	Commands      []Command `json:"commands"` // never nil (use empty slice)
	Pairs         []Pair    `json:"pairs"`    // never nil
	Code          *CodeInfo `json:"code"`
	Notice        string    `json:"notice"`
	QueueVersion  int64     `json:"queue_version"`
	LiveUpdatedAt int64     `json:"live_updated_at"` // 0 = nothing published since boot → control re-publishes
}

type PairStatus struct {
	Paired        bool         `json:"paired"`
	ControlOnline bool         `json:"control_online"`
	ControlLabel  string       `json:"control_label"`
	Capabilities  Capabilities `json:"capabilities"`
}

type LiveSong struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Language string `json:"language"`
}

type LiveSource struct {
	Role     string `json:"role"`
	Username string `json:"username"`
}

type LiveState struct {
	Version      int64       `json:"version"`
	Song         *LiveSong   `json:"song"`
	Cleared      bool        `json:"cleared"`
	Source       *LiveSource `json:"source"`
	UpdatedAt    int64       `json:"updated_at"` // unix ms of the last publish; 0 = none since boot
	QueueVersion int64       `json:"queue_version"`
}

type pendingCode struct {
	code string
	exp  time.Time
}

type control struct {
	id, lease, role, username string
	lastSeen                  time.Time
	activePolls               int
	code                      *pendingCode
	notice                    string
	nextSeq                   int64
	cmds                      []*Command
	recent                    map[string]*Command
	n                         *notifier
}

type cachedPair struct {
	pair    Pair
	exp     time.Time
	touched time.Time
}

type Hub struct {
	mu        sync.Mutex
	now       func() time.Time
	store     PairStore
	limiter   *Limiter
	controls  map[string]*control
	live      LiveState
	liveN     *notifier
	pairCache map[string]cachedPair // key hex(sha256(token)), pairCacheTTL
}

func NewHub(store PairStore) *Hub {
	h := &Hub{
		now:       time.Now,
		store:     store,
		controls:  map[string]*control{},
		liveN:     newNotifier(),
		pairCache: map[string]cachedPair{},
	}
	h.limiter = NewLimiter(func() time.Time { return h.now() })
	return h
}

func (h *Hub) Store() PairStore { return h.store }

// Start runs the periodic sweeper and the daily purge of idle/revoked pairs.
func (h *Hub) Start() {
	go func() {
		purge := func() {
			if err := h.store.PurgeIdle(PairIdleTTL); err != nil {
				log.Printf("remote: purge idle pairs: %v", err)
			}
		}
		purge()
		sweep := time.NewTicker(sweepInterval)
		daily := time.NewTicker(purgeInterval)
		defer sweep.Stop()
		defer daily.Stop()
		for {
			select {
			case <-sweep.C:
				h.Sweep()
			case <-daily.C:
				purge()
			}
		}
	}()
}

// Sweep drops expired codes, old dedupe entries, abandoned in-flight commands,
// idle controls and stale cache entries.
func (h *Hub) Sweep() {
	h.limiter.Sweep()
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	for id, c := range h.controls {
		if c.code != nil && !now.Before(c.code.exp) {
			c.code = nil
		}
		kept := c.cmds[:0]
		for _, cmd := range c.cmds {
			if cmd.delivered && now.Sub(cmd.created) > unackedTTL {
				resolveCmd(cmd, AckResult{Status: "timeout", Message: "Not confirmed"})
				continue
			}
			kept = append(kept, cmd)
		}
		for i := len(kept); i < len(c.cmds); i++ {
			c.cmds[i] = nil
		}
		c.cmds = kept
		for k, cmd := range c.recent {
			if now.Sub(cmd.created) > DedupeTTL {
				delete(c.recent, k)
			}
		}
		if c.activePolls == 0 && len(c.cmds) == 0 && now.Sub(c.lastSeen) > idleControlTTL {
			delete(h.controls, id)
		}
	}
	for k, cp := range h.pairCache {
		if !now.Before(cp.exp) {
			delete(h.pairCache, k)
		}
	}
}

func isGuest(role string) bool { return role == "" || role == "guest" }

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func resolveCmd(cmd *Command, res AckResult) {
	if cmd.done {
		return
	}
	cmd.done = true
	cmd.result = res
	close(cmd.resolved)
}

func (h *Hub) online(c *control, now time.Time) bool {
	return c.activePolls > 0 || now.Sub(c.lastSeen) < OnlineWindow
}

// checkin registers/refreshes a control window holding lease. Caller holds h.mu.
func (h *Hub) checkin(controlID, lease, role, username string) (*control, error) {
	now := h.now()
	c, ok := h.controls[controlID]
	if !ok {
		c = &control{id: controlID, lease: lease, recent: map[string]*Command{}, n: newNotifier()}
		h.controls[controlID] = c
	} else if c.lease != lease && (c.activePolls > 0 || now.Sub(c.lastSeen) < LeaseStale) {
		return nil, ErrLeaseConflict
	}
	c.lease = lease
	c.role = role
	c.username = username
	c.lastSeen = now
	return c, nil
}

// leased returns an existing control whose lease matches. Caller holds h.mu.
func (h *Hub) leased(controlID, lease string) (*control, error) {
	c, ok := h.controls[controlID]
	if !ok || c.lease != lease {
		return nil, ErrLeaseConflict
	}
	c.lastSeen = h.now()
	return c, nil
}

func (h *Hub) liveCodeTaken(code, except string) bool {
	now := h.now()
	for id, c := range h.controls {
		if id != except && c.code != nil && now.Before(c.code.exp) && c.code.code == code {
			return true
		}
	}
	return false
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// IssueCode creates (or replaces) the control's 6-digit pair code. rotate=true
// first revokes every phone paired to this control.
func (h *Hub) IssueCode(controlID, lease, role, username string, rotate bool) (CodeInfo, error) {
	if isGuest(role) {
		return CodeInfo{}, ErrForbiddenRole
	}
	if paused, d := h.limiter.Paused(); paused {
		return CodeInfo{}, &RateLimitError{RetryAfter: d}
	}
	h.mu.Lock()
	if _, err := h.checkin(controlID, lease, role, username); err != nil {
		h.mu.Unlock()
		return CodeInfo{}, err
	}
	h.mu.Unlock()

	if rotate {
		if err := h.store.RevokeAll(controlID); err != nil {
			return CodeInfo{}, err
		}
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.checkin(controlID, lease, role, username)
	if err != nil {
		return CodeInfo{}, err
	}
	if rotate {
		for k, cp := range h.pairCache {
			if cp.pair.ControlID == controlID {
				delete(h.pairCache, k)
			}
		}
	}
	var code string
	for {
		code, err = randomCode()
		if err != nil {
			return CodeInfo{}, err
		}
		if !h.liveCodeTaken(code, controlID) {
			break
		}
	}
	exp := h.now().Add(CodeTTL)
	c.code = &pendingCode{code: code, exp: exp}
	c.notice = ""
	c.n.Bump()
	return CodeInfo{Code: code, ExpiresAt: exp.UnixMilli()}, nil
}

// CancelCode withdraws the control's pending code.
func (h *Hub) CancelCode(controlID, lease string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.leased(controlID, lease)
	if err != nil {
		return err
	}
	c.code = nil
	c.n.Bump()
	return nil
}

func cleanLabel(label, username string) string {
	label = strings.TrimSpace(label)
	if label == "" {
		label = username + " phone"
	}
	if utf8.RuneCountInString(label) > maxLabelRunes {
		label = string([]rune(label)[:maxLabelRunes])
	}
	return label
}

// Claim exchanges a pair code for an opaque session token. Every attempt is
// rate limited; wrong codes count toward per-IP, per-account and global limits.
func (h *Hub) Claim(ip, username, role, code, label string) (string, Pair, error) {
	if isGuest(role) {
		return "", Pair{}, ErrForbiddenRole
	}
	if err := h.limiter.Allow(ip, username); err != nil {
		return "", Pair{}, err
	}

	h.mu.Lock()
	now := h.now()
	var match *control
	for _, c := range h.controls {
		if c.code == nil || !now.Before(c.code.exp) {
			continue
		}
		// Constant-time and no early exit: timing must not leak which codes exist.
		if subtle.ConstantTimeCompare([]byte(c.code.code), []byte(code)) == 1 {
			match = c
		}
	}
	if match == nil {
		log.Printf("remote: wrong pair code from %s (user %s)", ip, username)
		if h.limiter.Fail(ip, username) {
			for _, c := range h.controls {
				c.code = nil
				c.notice = globalTripNotice
				c.n.Bump()
			}
		}
		h.mu.Unlock()
		return "", Pair{}, ErrCodeInvalid
	}
	// Consume the code now (single-use) so a concurrent claim cannot also win.
	pc := match.code
	match.code = nil
	controlID := match.id
	h.mu.Unlock()

	restore := func() {
		h.mu.Lock()
		if c, ok := h.controls[controlID]; ok && c.code == nil {
			c.code = pc
		}
		h.mu.Unlock()
	}

	n, err := h.store.CountActive(controlID)
	if err != nil {
		restore()
		return "", Pair{}, err
	}
	if n >= MaxPairsPerControl {
		restore()
		return "", Pair{}, ErrTooManyPairs
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		restore()
		return "", Pair{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(token))
	pair, err := h.store.Insert(controlID, sum[:], cleanLabel(label, username), username, role)
	if err != nil {
		restore()
		return "", Pair{}, err
	}

	h.mu.Lock()
	if c, ok := h.controls[controlID]; ok {
		c.notice = ""
		c.n.Bump()
	}
	h.mu.Unlock()
	return token, pair, nil
}

// ResolvePair authenticates a phone request: the token must map to an active
// pair owned by the same (non-guest) account that is making the request.
func (h *Hub) ResolvePair(token, username, role string) (Pair, error) {
	if isGuest(role) || token == "" {
		return Pair{}, ErrPairInvalid
	}
	hash := hashToken(token)
	key := hex.EncodeToString(hash)

	h.mu.Lock()
	now := h.now()
	cp, hit := h.pairCache[key]
	if hit && !now.Before(cp.exp) {
		hit = false
	}
	h.mu.Unlock()

	if !hit {
		p, err := h.store.ByTokenHash(hash)
		if err != nil {
			if !errors.Is(err, ErrPairNotFound) {
				log.Printf("remote: resolve pair: %v", err)
			}
			return Pair{}, ErrPairInvalid
		}
		cp = cachedPair{pair: p, exp: now.Add(pairCacheTTL)}
	}
	if cp.pair.Username != username {
		return Pair{}, ErrPairInvalid
	}

	doTouch := now.Sub(cp.touched) >= touchInterval
	if doTouch {
		cp.touched = now
	}
	h.mu.Lock()
	h.pairCache[key] = cp
	h.mu.Unlock()
	if doTouch {
		if err := h.store.Touch(cp.pair.ID); err != nil {
			log.Printf("remote: touch pair: %v", err)
		}
	}
	return cp.pair, nil
}

// UnpairToken revokes the phone's own pair (phone-initiated unpair).
func (h *Hub) UnpairToken(token string) error {
	hash := hashToken(token)
	key := hex.EncodeToString(hash)
	var controlID string
	if p, err := h.store.ByTokenHash(hash); err == nil {
		controlID = p.ControlID
	}
	if err := h.store.RevokeByTokenHash(hash); err != nil {
		return err
	}
	h.mu.Lock()
	if cp, ok := h.pairCache[key]; ok && controlID == "" {
		controlID = cp.pair.ControlID
	}
	delete(h.pairCache, key)
	if c, ok := h.controls[controlID]; ok {
		c.n.Bump()
	}
	h.mu.Unlock()
	return nil
}

// UnpairPhone revokes one phone from the control window that holds the lease.
func (h *Hub) UnpairPhone(controlID, lease string, pairID int64) error {
	h.mu.Lock()
	_, err := h.leased(controlID, lease)
	h.mu.Unlock()
	if err != nil {
		return err
	}
	if _, err := h.store.Revoke(controlID, pairID); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for k, cp := range h.pairCache {
		if cp.pair.ID == pairID {
			delete(h.pairCache, k)
		}
	}
	if c, ok := h.controls[controlID]; ok {
		c.n.Bump()
	}
	return nil
}

// Status describes the paired control window to the phone.
func (h *Hub) Status(p Pair) PairStatus {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := PairStatus{Paired: true, ControlLabel: controlLabelFallb}
	if c, ok := h.controls[p.ControlID]; ok {
		st.ControlOnline = h.online(c, h.now())
		if c.role != "" {
			st.ControlLabel = c.role
		}
		st.Capabilities = CapabilitiesFor(c.role)
	}
	return st
}

// Submit relays a phone command to the control window and waits for its ack.
// Delivery is at most once; a command not picked up within AckWait is dropped
// so it can never execute late.
func (h *Hub) Submit(p Pair, cmdID, typ string, args json.RawMessage) AckResult {
	if !CommandTypes[typ] {
		return AckResult{Status: "error", Message: "Unknown command"}
	}
	if len(args) > maxArgsBytes {
		return AckResult{Status: "error", Message: "Command too large"}
	}
	key := fmt.Sprintf("%d:%s", p.ID, cmdID)

	h.mu.Lock()
	c, ok := h.controls[p.ControlID]
	if ok {
		if prev, dup := c.recent[key]; dup {
			h.mu.Unlock()
			return h.awaitExisting(prev)
		}
	}
	now := h.now()
	if !ok || !h.online(c, now) {
		h.mu.Unlock()
		return AckResult{Status: "offline", Message: "Control window is offline"}
	}
	if len(c.cmds) >= MaxQueuedCommands {
		h.mu.Unlock()
		return AckResult{Status: "error", Message: "Control window is busy"}
	}
	c.nextSeq++
	cmd := &Command{
		Seq:      c.nextSeq,
		ID:       cmdID,
		Type:     typ,
		Args:     append(json.RawMessage(nil), args...),
		From:     p.Label,
		pairID:   p.ID,
		created:  now,
		resolved: make(chan struct{}),
	}
	c.cmds = append(c.cmds, cmd)
	c.recent[key] = cmd
	c.n.Bump()
	h.mu.Unlock()

	timer := time.NewTimer(AckWait)
	defer timer.Stop()
	select {
	case <-cmd.resolved:
		return cmd.result
	case <-timer.C:
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if cmd.done {
		return cmd.result
	}
	if !cmd.delivered {
		removeCmd(c, cmd)
		resolveCmd(cmd, AckResult{Status: "offline", Message: "The control window didn't pick it up"})
		return cmd.result
	}
	// Delivered but not acked: leave it in flight so a late ack still resolves it.
	return AckResult{Status: "timeout", Message: "Not confirmed"}
}

func (h *Hub) awaitExisting(cmd *Command) AckResult {
	timer := time.NewTimer(AckWait)
	defer timer.Stop()
	select {
	case <-cmd.resolved:
		return cmd.result
	case <-timer.C:
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if cmd.done {
		return cmd.result
	}
	return AckResult{Status: "timeout", Message: "Not confirmed"}
}

func removeCmd(c *control, cmd *Command) {
	for i, x := range c.cmds {
		if x == cmd {
			copy(c.cmds[i:], c.cmds[i+1:])
			c.cmds[len(c.cmds)-1] = nil
			c.cmds = c.cmds[:len(c.cmds)-1]
			return
		}
	}
}

// collect marks every undelivered command delivered and returns copies. Caller holds h.mu.
func (h *Hub) collect(c *control) []Command {
	now := h.now()
	out := []Command{}
	for _, cmd := range c.cmds {
		if cmd.delivered {
			continue
		}
		cmd.delivered = true
		cp := *cmd
		cp.AgeMs = now.Sub(cmd.created).Milliseconds()
		cp.resolved = nil
		out = append(out, cp)
	}
	return out
}

// Poll is the control window's long-poll: it returns pending commands as soon
// as any arrive (or any control-visible state changes), else after wait.
func (h *Hub) Poll(controlID, lease, role, username string, wait time.Duration) (PollResult, error) {
	if wait < 0 {
		wait = 0
	}
	if wait > MaxPollWait {
		wait = MaxPollWait
	}
	h.mu.Lock()
	c, err := h.checkin(controlID, lease, role, username)
	if err != nil {
		h.mu.Unlock()
		return PollResult{}, err
	}
	c.activePolls++
	defer func() {
		h.mu.Lock()
		c.activePolls--
		c.lastSeen = h.now()
		h.mu.Unlock()
	}()
	ch := c.n.C() // capture BEFORE collecting so no wake-up is lost
	cmds := h.collect(c)
	h.mu.Unlock()

	if len(cmds) == 0 && wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ch:
		case <-timer.C:
		}
		timer.Stop()
		h.mu.Lock()
		cmds = h.collect(c)
		h.mu.Unlock()
	}

	pairs, err := h.store.ListActive(controlID)
	if err != nil || pairs == nil {
		if err != nil {
			log.Printf("remote: list pairs: %v", err)
		}
		pairs = []Pair{}
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	res := PollResult{
		Commands:      cmds,
		Pairs:         pairs,
		Notice:        c.notice,
		QueueVersion:  h.live.QueueVersion,
		LiveUpdatedAt: h.live.UpdatedAt,
	}
	if c.code != nil && h.now().Before(c.code.exp) {
		res.Code = &CodeInfo{Code: c.code.code, ExpiresAt: c.code.exp.UnixMilli()}
	}
	return res, nil
}

// Ack resolves a delivered command. Unknown seqs are ignored (idempotent).
func (h *Hub) Ack(controlID, lease string, seq int64, ok bool, message string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.leased(controlID, lease)
	if err != nil {
		return err
	}
	for _, cmd := range c.cmds {
		if cmd.Seq != seq {
			continue
		}
		res := AckResult{Status: "done"}
		if !ok {
			if utf8.RuneCountInString(message) > maxAckMsgRunes {
				message = string([]rune(message)[:maxAckMsgRunes])
			}
			res = AckResult{Status: "error", Message: message}
		}
		resolveCmd(cmd, res)
		removeCmd(c, cmd)
		return nil
	}
	return nil
}

func (h *Hub) snapshotLocked() LiveState {
	s := h.live
	if s.Song != nil {
		song := *s.Song
		s.Song = &song
	}
	if s.Source != nil {
		src := *s.Source
		s.Source = &src
	}
	return s
}

// PublishLive records the song now live (last write wins). song==nil → cleared.
func (h *Hub) PublishLive(song *LiveSong, src LiveSource) LiveState {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.live.Version++
	h.live.UpdatedAt = h.now().UnixMilli()
	if song == nil {
		h.live.Song = nil
		h.live.Cleared = true
	} else {
		s := *song
		h.live.Song = &s
		h.live.Cleared = false
	}
	h.live.Source = &LiveSource{Role: src.Role, Username: src.Username}
	h.liveN.Bump()
	return h.snapshotLocked()
}

func (h *Hub) LiveSnapshot() LiveState {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked()
}

// WaitLive returns immediately if the live version differs from since (this also
// covers a backend restart resetting Version); otherwise it waits for a change.
func (h *Hub) WaitLive(since int64, wait time.Duration) LiveState {
	ch := h.liveN.C()
	snap := h.LiveSnapshot()
	if snap.Version != since || wait <= 0 {
		return snap
	}
	if wait > MaxPollWait {
		wait = MaxPollWait
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ch:
	case <-timer.C:
	}
	return h.LiveSnapshot()
}

// BumpQueueVersion signals that the shared song queue changed.
func (h *Hub) BumpQueueVersion() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.live.QueueVersion++
	h.live.Version++
	h.liveN.Bump()
	for _, c := range h.controls {
		c.n.Bump()
	}
}
