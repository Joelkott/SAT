package remote

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newFakeHub() (*Hub, *fakeClock) {
	clk := &fakeClock{t: time.Unix(1700000000, 0)}
	h := NewHub(NewMemStore())
	h.now = clk.Now
	return h, clk
}

var sixDigits = regexp.MustCompile(`^[0-9]{6}$`)

func otherCode(code string) string {
	n, _ := strconv.Atoi(code)
	return fmt.Sprintf("%06d", (n+1)%1_000_000)
}

// pairPhone issues a code for ctl and claims it from ip, returning the token.
func pairPhone(t *testing.T, h *Hub, ctl, ip string) (string, Pair) {
	t.Helper()
	ci, err := h.IssueCode(ctl, "lease-"+ctl, "worship", "alice", false)
	if err != nil {
		t.Fatalf("IssueCode: %v", err)
	}
	tok, p, err := h.Claim(ip, "alice", "worship", ci.Code, "My Phone")
	if err != nil {
		t.Fatalf("Claim: %v", err)
	}
	return tok, p
}

func TestIssueCodeFormatAndReplace(t *testing.T) {
	h, _ := newFakeHub()
	first, err := h.IssueCode("ctl", "L", "worship", "alice", false)
	if err != nil {
		t.Fatal(err)
	}
	if !sixDigits.MatchString(first.Code) {
		t.Fatalf("code %q is not 6 digits", first.Code)
	}
	second, err := h.IssueCode("ctl", "L", "worship", "alice", false)
	if err != nil {
		t.Fatal(err)
	}
	if second.Code == first.Code {
		t.Skip("random collision between consecutive codes")
	}
	if _, _, err := h.Claim("1.1.1.1", "alice", "worship", first.Code, ""); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("replaced code should be invalid, got %v", err)
	}
	if _, _, err := h.Claim("1.1.1.2", "alice", "worship", second.Code, ""); err != nil {
		t.Fatalf("current code should work: %v", err)
	}
}

func TestIssueCodeGuestForbidden(t *testing.T) {
	h, _ := newFakeHub()
	for _, role := range []string{"guest", ""} {
		if _, err := h.IssueCode("ctl", "L", role, "x", false); !errors.Is(err, ErrForbiddenRole) {
			t.Fatalf("role %q: %v", role, err)
		}
	}
}

func TestClaimSingleUseCode(t *testing.T) {
	h, _ := newFakeHub()
	ci, _ := h.IssueCode("ctl", "L", "worship", "alice", false)
	tok, p, err := h.Claim("1.1.1.1", "alice", "worship", ci.Code, "  ")
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) != 43 {
		t.Fatalf("token length %d want 43", len(tok))
	}
	if p.Label != "alice phone" || p.ControlID != "ctl" || p.Role != "worship" {
		t.Fatalf("pair=%+v", p)
	}
	if _, _, err := h.Claim("1.1.1.1", "alice", "worship", ci.Code, ""); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("second claim of same code: %v", err)
	}
}

func TestClaimCodeTTL(t *testing.T) {
	h, clk := newFakeHub()
	ci, _ := h.IssueCode("ctl", "L", "worship", "alice", false)
	if ci.ExpiresAt != clk.Now().Add(CodeTTL).UnixMilli() {
		t.Fatalf("ExpiresAt=%d", ci.ExpiresAt)
	}
	clk.Add(CodeTTL + time.Second)
	if _, _, err := h.Claim("1.1.1.1", "alice", "worship", ci.Code, ""); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("expired code: %v", err)
	}
}

func TestClaimGlobalLockout(t *testing.T) {
	h, clk := newFakeHub()
	ci, _ := h.IssueCode("ctl", "L", "worship", "alice", false)
	wrong := otherCode(ci.Code)
	for i := 0; i < GlobalFailLimit; i++ {
		_, _, err := h.Claim(fmt.Sprintf("10.0.0.%d", i), fmt.Sprintf("user%d", i), "worship", wrong, "")
		if !errors.Is(err, ErrCodeInvalid) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	res, err := h.Poll("ctl", "L", "worship", "alice", 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Notice != "Too many wrong attempts — the code was cancelled. Generate a new one in 5 minutes." {
		t.Fatalf("notice=%q", res.Notice)
	}
	if res.Code != nil {
		t.Fatalf("code should be cancelled, got %+v", res.Code)
	}
	if _, _, err := h.Claim("10.1.1.1", "zed", "worship", ci.Code, ""); err == nil {
		t.Fatal("cancelled code must not be claimable")
	}
	var rl *RateLimitError
	if _, err := h.IssueCode("ctl", "L", "worship", "alice", false); !errors.As(err, &rl) {
		t.Fatalf("IssueCode during pause: %v", err)
	}
	clk.Add(GlobalPause + time.Second)
	if _, err := h.IssueCode("ctl", "L", "worship", "alice", false); err != nil {
		t.Fatalf("IssueCode after pause: %v", err)
	}
}

func TestClaimGuestForbidden(t *testing.T) {
	h, _ := newFakeHub()
	ci, _ := h.IssueCode("ctl", "L", "worship", "alice", false)
	for _, role := range []string{"guest", ""} {
		if _, _, err := h.Claim("1.1.1.1", "g", role, ci.Code, ""); !errors.Is(err, ErrForbiddenRole) {
			t.Fatalf("role %q: %v", role, err)
		}
	}
	// The code was not consumed by the rejected attempts.
	if _, _, err := h.Claim("1.1.1.1", "alice", "worship", ci.Code, ""); err != nil {
		t.Fatalf("code consumed by guest attempt: %v", err)
	}
}

func TestClaimTooManyPairs(t *testing.T) {
	h, _ := newFakeHub()
	for i := 0; i < MaxPairsPerControl; i++ {
		pairPhone(t, h, "ctl", fmt.Sprintf("10.2.0.%d", i))
	}
	ci, _ := h.IssueCode("ctl", "lease-ctl", "worship", "alice", false)
	if _, _, err := h.Claim("10.3.0.1", "alice", "worship", ci.Code, ""); !errors.Is(err, ErrTooManyPairs) {
		t.Fatalf("11th pair: %v", err)
	}
	if _, _, err := h.Claim("10.3.0.2", "alice", "worship", ci.Code, ""); !errors.Is(err, ErrTooManyPairs) {
		t.Fatalf("code should survive ErrTooManyPairs, got %v", err)
	}
}

func TestRotateRevokesPairs(t *testing.T) {
	h, _ := newFakeHub()
	tok, _ := pairPhone(t, h, "ctl", "1.1.1.1")
	if _, err := h.ResolvePair(tok, "alice", "worship"); err != nil {
		t.Fatal(err)
	}
	if _, err := h.IssueCode("ctl", "lease-ctl", "worship", "alice", true); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolvePair(tok, "alice", "worship"); !errors.Is(err, ErrPairInvalid) {
		t.Fatalf("rotated pair still valid: %v", err)
	}
}

func TestResolvePair(t *testing.T) {
	h, _ := newFakeHub()
	tok, p := pairPhone(t, h, "ctl", "1.1.1.1")
	got, err := h.ResolvePair(tok, "alice", "worship")
	if err != nil || got.ID != p.ID {
		t.Fatalf("ResolvePair=%+v err=%v", got, err)
	}
	// Account role may differ from the pairing role (e.g. admin), but must not be guest.
	if _, err := h.ResolvePair(tok, "alice", "admin"); err != nil {
		t.Fatalf("non-guest role: %v", err)
	}
	cases := []struct{ tok, user, role string }{
		{tok, "alice", "guest"},
		{tok, "alice", ""},
		{tok, "bob", "worship"},
		{"bogus-token", "alice", "worship"},
	}
	for _, tc := range cases {
		if _, err := h.ResolvePair(tc.tok, tc.user, tc.role); !errors.Is(err, ErrPairInvalid) {
			t.Fatalf("ResolvePair(%q,%q,%q)=%v want ErrPairInvalid", tc.tok, tc.user, tc.role, err)
		}
	}
}

func TestUnpair(t *testing.T) {
	h, _ := newFakeHub()
	tok1, _ := pairPhone(t, h, "ctl", "1.1.1.1")
	tok2, p2 := pairPhone(t, h, "ctl", "1.1.1.2")
	h.ResolvePair(tok1, "alice", "worship") // warm the cache
	h.ResolvePair(tok2, "alice", "worship")
	if err := h.UnpairToken(tok1); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolvePair(tok1, "alice", "worship"); !errors.Is(err, ErrPairInvalid) {
		t.Fatalf("UnpairToken: %v", err)
	}
	if err := h.UnpairPhone("ctl", "wrong-lease", p2.ID); !errors.Is(err, ErrLeaseConflict) {
		t.Fatalf("UnpairPhone wrong lease: %v", err)
	}
	if err := h.UnpairPhone("ctl", "lease-ctl", p2.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ResolvePair(tok2, "alice", "worship"); !errors.Is(err, ErrPairInvalid) {
		t.Fatalf("UnpairPhone: %v", err)
	}
}

func TestStatusAndCapabilities(t *testing.T) {
	h, clk := newFakeHub()
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	st := h.Status(p)
	if !st.Paired || !st.ControlOnline || st.ControlLabel != "worship" || !st.Capabilities.Songs || !st.Capabilities.Display || st.Capabilities.Wall {
		t.Fatalf("status=%+v", st)
	}
	clk.Add(OnlineWindow + time.Second)
	if h.Status(p).ControlOnline {
		t.Fatal("control should be offline after OnlineWindow")
	}
	if c := CapabilitiesFor("media"); !c.Songs || c.Display || !c.Wall {
		t.Fatalf("media caps=%+v", c)
	}
	if c := CapabilitiesFor("admin"); !c.Songs || !c.Display || !c.Wall {
		t.Fatalf("admin caps=%+v", c)
	}
	if c := CapabilitiesFor("guest"); c.Songs || c.Display || c.Wall {
		t.Fatalf("guest caps=%+v", c)
	}
}

func TestSubmitOffline(t *testing.T) {
	h, clk := newFakeHub()
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	clk.Add(OnlineWindow + time.Second)
	res := h.Submit(p, "c1", "song.next", nil)
	if res.Status != "offline" || res.Message != "Control window is offline" {
		t.Fatalf("res=%+v", res)
	}
	ghost := Pair{ID: 99, ControlID: "nope"}
	if res := h.Submit(ghost, "c1", "song.next", nil); res.Status != "offline" {
		t.Fatalf("unknown control: %+v", res)
	}
}

func TestSubmitValidation(t *testing.T) {
	h, _ := newFakeHub()
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	if res := h.Submit(p, "c1", "rm.rf", nil); res.Status != "error" || res.Message != "Unknown command" {
		t.Fatalf("unknown type: %+v", res)
	}
	big := json.RawMessage(`"` + strings.Repeat("a", 1100) + `"`)
	if res := h.Submit(p, "c2", "song.live", big); res.Status != "error" || res.Message != "Command too large" {
		t.Fatalf("oversize: %+v", res)
	}
}

// submitAsync runs Submit in a goroutine and returns its result channel.
func submitAsync(h *Hub, p Pair, id, typ string) <-chan AckResult {
	ch := make(chan AckResult, 1)
	go func() { ch <- h.Submit(p, id, typ, json.RawMessage(`{"n":1}`)) }()
	return ch
}

func pollOne(t *testing.T, h *Hub, ctl, lease string) Command {
	t.Helper()
	res, err := h.Poll(ctl, lease, "worship", "alice", 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Commands) != 1 {
		t.Fatalf("expected 1 command, got %+v", res.Commands)
	}
	return res.Commands[0]
}

func TestSubmitPollAckDone(t *testing.T) {
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	resCh := submitAsync(h, p, "c1", "song.next")
	cmd := pollOne(t, h, "ctl", "lease-ctl")
	if cmd.Type != "song.next" || cmd.ID != "c1" || cmd.From != "My Phone" || string(cmd.Args) != `{"n":1}` {
		t.Fatalf("cmd=%+v", cmd)
	}
	if err := h.Ack("ctl", "lease-ctl", cmd.Seq, true, ""); err != nil {
		t.Fatal(err)
	}
	if res := <-resCh; res.Status != "done" {
		t.Fatalf("res=%+v", res)
	}
}

func TestSubmitPollAckError(t *testing.T) {
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	resCh := submitAsync(h, p, "c1", "song.live")
	cmd := pollOne(t, h, "ctl", "lease-ctl")
	if err := h.Ack("ctl", "lease-ctl", cmd.Seq, false, "x"); err != nil {
		t.Fatal(err)
	}
	if res := <-resCh; res.Status != "error" || res.Message != "x" {
		t.Fatalf("res=%+v", res)
	}
	// Unknown seq is idempotent.
	if err := h.Ack("ctl", "lease-ctl", 9999, true, ""); err != nil {
		t.Fatalf("unknown seq: %v", err)
	}
}

func TestAtMostOnceDelivery(t *testing.T) {
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	resCh := submitAsync(h, p, "c1", "song.next")
	cmd := pollOne(t, h, "ctl", "lease-ctl")
	again, err := h.Poll("ctl", "lease-ctl", "worship", "alice", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Commands) != 0 {
		t.Fatalf("delivered command redelivered: %+v", again.Commands)
	}
	h.Ack("ctl", "lease-ctl", cmd.Seq, true, "")
	<-resCh
}

func TestSubmitDedupe(t *testing.T) {
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	resCh := submitAsync(h, p, "same", "song.next")
	cmd := pollOne(t, h, "ctl", "lease-ctl")
	h.Ack("ctl", "lease-ctl", cmd.Seq, false, "first")
	first := <-resCh
	second := h.Submit(p, "same", "song.next", nil)
	if second != first {
		t.Fatalf("dedupe returned %+v want %+v", second, first)
	}
	res, _ := h.Poll("ctl", "lease-ctl", "worship", "alice", 0)
	if len(res.Commands) != 0 {
		t.Fatalf("duplicate was enqueued: %+v", res.Commands)
	}
}

func TestSubmitNotPickedUp(t *testing.T) {
	t.Parallel()
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	if _, err := h.Poll("ctl", "lease-ctl", "worship", "alice", 0); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	res := h.Submit(p, "c1", "song.next", nil)
	if res.Status != "offline" || res.Message != "The control window didn't pick it up" {
		t.Fatalf("res=%+v", res)
	}
	if time.Since(start) < AckWait {
		t.Fatal("returned before AckWait")
	}
	// The stale command must never execute late.
	later, _ := h.Poll("ctl", "lease-ctl", "worship", "alice", 0)
	if len(later.Commands) != 0 {
		t.Fatalf("stale command delivered late: %+v", later.Commands)
	}
}

func TestSubmitDeliveredUnackedTimeout(t *testing.T) {
	t.Parallel()
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	resCh := submitAsync(h, p, "c1", "song.next")
	pollOne(t, h, "ctl", "lease-ctl")
	if res := <-resCh; res.Status != "timeout" {
		t.Fatalf("res=%+v", res)
	}
}

func TestLeaseConflict(t *testing.T) {
	h, clk := newFakeHub()
	if _, err := h.Poll("ctl", "A", "worship", "alice", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Poll("ctl", "B", "worship", "alice", 0); !errors.Is(err, ErrLeaseConflict) {
		t.Fatalf("second lease: %v", err)
	}
	if _, err := h.IssueCode("ctl", "B", "worship", "alice", false); !errors.Is(err, ErrLeaseConflict) {
		t.Fatalf("IssueCode with other lease: %v", err)
	}
	if err := h.CancelCode("ctl", "B"); !errors.Is(err, ErrLeaseConflict) {
		t.Fatalf("CancelCode with other lease: %v", err)
	}
	clk.Add(LeaseStale + time.Second)
	if _, err := h.Poll("ctl", "B", "worship", "alice", 0); err != nil {
		t.Fatalf("takeover after silence: %v", err)
	}
	if _, err := h.Poll("ctl", "A", "worship", "alice", 0); !errors.Is(err, ErrLeaseConflict) {
		t.Fatalf("old lease after takeover: %v", err)
	}
}

func TestCancelCode(t *testing.T) {
	h, _ := newFakeHub()
	ci, _ := h.IssueCode("ctl", "L", "worship", "alice", false)
	if err := h.CancelCode("ctl", "L"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.Claim("1.1.1.1", "alice", "worship", ci.Code, ""); !errors.Is(err, ErrCodeInvalid) {
		t.Fatalf("cancelled code: %v", err)
	}
}

func TestPollReportsState(t *testing.T) {
	h, _ := newFakeHub()
	pairPhone(t, h, "ctl", "1.1.1.1")
	ci, _ := h.IssueCode("ctl", "lease-ctl", "worship", "alice", false)
	h.BumpQueueVersion()
	res, err := h.Poll("ctl", "lease-ctl", "worship", "alice", 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Commands == nil || len(res.Commands) != 0 {
		t.Fatalf("commands=%#v", res.Commands)
	}
	if len(res.Pairs) != 1 || res.Pairs[0].Label != "My Phone" {
		t.Fatalf("pairs=%+v", res.Pairs)
	}
	if res.Code == nil || res.Code.Code != ci.Code {
		t.Fatalf("code=%+v", res.Code)
	}
	if res.QueueVersion != 1 || res.LiveUpdatedAt != 0 {
		t.Fatalf("qv=%d live=%d", res.QueueVersion, res.LiveUpdatedAt)
	}
}

func TestPollWakesOnSubmit(t *testing.T) {
	h := NewHub(NewMemStore())
	_, p := pairPhone(t, h, "ctl", "1.1.1.1")
	go func() {
		time.Sleep(50 * time.Millisecond)
		h.Submit(p, "c1", "song.prev", nil)
	}()
	start := time.Now()
	res, err := h.Poll("ctl", "lease-ctl", "worship", "alice", 5*time.Second)
	if err != nil || len(res.Commands) != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("poll did not wake promptly")
	}
	h.Ack("ctl", "lease-ctl", res.Commands[0].Seq, true, "")
}

func TestPublishLive(t *testing.T) {
	h, clk := newFakeHub()
	before := h.LiveSnapshot()
	st := h.PublishLive(&LiveSong{ID: "s1", Title: "Amazing Grace", Language: "english"}, LiveSource{Role: "worship", Username: "alice"})
	if st.Version != before.Version+1 || st.UpdatedAt != clk.Now().UnixMilli() || st.Cleared || st.Song == nil || st.Song.Title != "Amazing Grace" {
		t.Fatalf("state=%+v", st)
	}
	if st.Source == nil || st.Source.Role != "worship" || st.Source.Username != "alice" {
		t.Fatalf("source=%+v", st.Source)
	}
	clk.Add(time.Second)
	cl := h.PublishLive(nil, LiveSource{Role: "media", Username: "bob"})
	if !cl.Cleared || cl.Song != nil || cl.Version != st.Version+1 || cl.UpdatedAt <= st.UpdatedAt {
		t.Fatalf("cleared=%+v", cl)
	}
}

func TestWaitLiveWakeups(t *testing.T) {
	h := NewHub(NewMemStore())
	v := h.LiveSnapshot().Version

	go func() {
		time.Sleep(50 * time.Millisecond)
		h.PublishLive(&LiveSong{ID: "1"}, LiveSource{Role: "worship"})
	}()
	start := time.Now()
	st := h.WaitLive(v, 10*time.Second)
	if st.Version == v || time.Since(start) > 2*time.Second {
		t.Fatalf("PublishLive did not wake WaitLive: %+v", st)
	}

	v = st.Version
	go func() {
		time.Sleep(50 * time.Millisecond)
		h.BumpQueueVersion()
	}()
	start = time.Now()
	st = h.WaitLive(v, 10*time.Second)
	if st.Version == v || st.QueueVersion != 1 || time.Since(start) > 2*time.Second {
		t.Fatalf("BumpQueueVersion did not wake WaitLive: %+v", st)
	}

	// A stale "since" (e.g. from before a backend restart) returns immediately.
	start = time.Now()
	st2 := h.WaitLive(st.Version+100, MaxPollWait)
	if time.Since(start) > 500*time.Millisecond || st2.Version != st.Version {
		t.Fatalf("stale since should return immediately: %+v", st2)
	}
}
