package remote

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func fakeLimiter() (*Limiter, *time.Time) {
	now := time.Unix(1700000000, 0)
	l := NewLimiter(func() time.Time { return now })
	return l, &now
}

func retryAfter(t *testing.T, err error) time.Duration {
	t.Helper()
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("expected *RateLimitError, got %v", err)
	}
	return rl.RetryAfter
}

func TestLimiterIPBlockDoubling(t *testing.T) {
	l, now := fakeLimiter()
	for i := 0; i < IPFailLimit; i++ {
		if err := l.Allow("1.1.1.1", fmt.Sprintf("u%d", i)); err != nil {
			t.Fatalf("attempt %d unexpectedly blocked: %v", i, err)
		}
		l.Fail("1.1.1.1", fmt.Sprintf("u%d", i))
		*now = now.Add(7 * time.Second) // stay under the 10/min request rate
	}
	ra := retryAfter(t, l.Allow("1.1.1.1", "x"))
	if ra < IPBlockBase-time.Minute || ra > IPBlockBase {
		t.Fatalf("first block retry=%v want ~%v", ra, IPBlockBase)
	}
	*now = now.Add(IPBlockBase + time.Second)
	for i := 0; i < IPFailLimit; i++ {
		if err := l.Allow("1.1.1.1", "y"); err != nil {
			t.Fatalf("post-block attempt %d blocked: %v", i, err)
		}
		l.Fail("1.1.1.1", fmt.Sprintf("y%d", i))
		*now = now.Add(7 * time.Second)
	}
	ra = retryAfter(t, l.Allow("1.1.1.1", "x"))
	if ra < 2*IPBlockBase-time.Minute || ra > 2*IPBlockBase {
		t.Fatalf("second block retry=%v want ~%v", ra, 2*IPBlockBase)
	}
}

func TestLimiterIPBlockCap(t *testing.T) {
	l, now := fakeLimiter()
	for round := 0; round < 12; round++ {
		for i := 0; i < IPFailLimit; i++ {
			l.Fail("2.2.2.2", fmt.Sprintf("r%d-%d", round, i))
		}
		ra := retryAfter(t, l.Allow("2.2.2.2", "z"))
		if ra > IPBlockMax {
			t.Fatalf("round %d: block %v exceeds cap", round, ra)
		}
		*now = now.Add(ra + GlobalPause + time.Second)
	}
	for i := 0; i < IPFailLimit; i++ {
		l.Fail("2.2.2.2", "final")
	}
	if ra := retryAfter(t, l.Allow("2.2.2.2", "z")); ra != IPBlockMax {
		t.Fatalf("capped block=%v want %v", ra, IPBlockMax)
	}
}

func TestLimiterUserBlock(t *testing.T) {
	l, now := fakeLimiter()
	for i := 0; i < UserFailLimit; i++ {
		ip := fmt.Sprintf("10.0.0.%d", i)
		if err := l.Allow(ip, "alice"); err != nil {
			t.Fatalf("attempt %d blocked early: %v", i, err)
		}
		l.Fail(ip, "alice")
		*now = now.Add(time.Second)
	}
	ra := retryAfter(t, l.Allow("10.9.9.9", "alice"))
	if ra < UserBlock-time.Minute || ra > UserBlock {
		t.Fatalf("user block=%v", ra)
	}
	if err := l.Allow("10.9.9.9", "bob"); err != nil {
		t.Fatalf("other user should not be blocked: %v", err)
	}
}

func TestLimiterGlobalTrip(t *testing.T) {
	l, now := fakeLimiter()
	for i := 0; i < GlobalFailLimit-1; i++ {
		if l.Fail(fmt.Sprintf("172.16.0.%d", i), fmt.Sprintf("u%d", i)) {
			t.Fatalf("tripped early at %d", i)
		}
	}
	if p, _ := l.Paused(); p {
		t.Fatal("paused too early")
	}
	if !l.Fail("172.16.1.1", "last") {
		t.Fatal("20th failure should trip globally")
	}
	p, d := l.Paused()
	if !p || d != GlobalPause {
		t.Fatalf("paused=%v d=%v", p, d)
	}
	retryAfter(t, l.Allow("192.168.5.5", "fresh"))
	*now = now.Add(GlobalPause + time.Second)
	if p, _ := l.Paused(); p {
		t.Fatal("pause should have ended")
	}
	if err := l.Allow("192.168.5.5", "fresh"); err != nil {
		t.Fatalf("after pause: %v", err)
	}
}

func TestLimiterIPRate(t *testing.T) {
	l, now := fakeLimiter()
	for i := 0; i < IPRateLimit; i++ {
		if err := l.Allow("3.3.3.3", "u"); err != nil {
			t.Fatalf("request %d blocked: %v", i, err)
		}
	}
	retryAfter(t, l.Allow("3.3.3.3", "u"))
	*now = now.Add(IPRateWindow + time.Second)
	if err := l.Allow("3.3.3.3", "u"); err != nil {
		t.Fatalf("after window: %v", err)
	}
}

func TestLimiterSweep(t *testing.T) {
	l, now := fakeLimiter()
	l.Fail("4.4.4.4", "u")
	l.Allow("4.4.4.4", "u")
	*now = now.Add(FailWindow + time.Minute)
	l.Sweep()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.ipFails) != 0 || len(l.userFails) != 0 || len(l.ipReqs) != 0 || len(l.globalFails) != 0 {
		t.Fatalf("sweep left entries: %v %v %v %v", l.ipFails, l.userFails, l.ipReqs, l.globalFails)
	}
}

func TestNotifier(t *testing.T) {
	n := newNotifier()
	before := n.C()
	n.Bump()
	select {
	case <-before:
	default:
		t.Fatal("channel captured before Bump should be closed")
	}
	after := n.C()
	select {
	case <-after:
		t.Fatal("channel captured after Bump should be open")
	default:
	}
}

func TestMemStore(t *testing.T) {
	s := NewMemStore()
	if err := s.Ensure(); err != nil {
		t.Fatal(err)
	}
	h1 := []byte("hash-one")
	h2 := []byte("hash-two")
	h3 := []byte("hash-three")
	p1, err := s.Insert("ctl", h1, "Phone A", "alice", "worship")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Insert("ctl", h2, "Phone B", "alice", "worship"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Insert("other", h3, "Phone C", "bob", "media"); err != nil {
		t.Fatal(err)
	}
	got, err := s.ByTokenHash(h1)
	if err != nil || got.ID != p1.ID || got.Label != "Phone A" || got.ControlID != "ctl" {
		t.Fatalf("ByTokenHash=%+v err=%v", got, err)
	}
	if n, _ := s.CountActive("ctl"); n != 2 {
		t.Fatalf("CountActive=%d", n)
	}
	if ok, _ := s.Revoke("other", p1.ID); ok {
		t.Fatal("revoke via wrong control must fail")
	}
	if ok, _ := s.Revoke("ctl", p1.ID); !ok {
		t.Fatal("revoke failed")
	}
	if _, err := s.ByTokenHash(h1); !errors.Is(err, ErrPairNotFound) {
		t.Fatalf("revoked pair: %v", err)
	}
	if n, _ := s.CountActive("ctl"); n != 1 {
		t.Fatalf("CountActive after revoke=%d", n)
	}
	if err := s.RevokeByTokenHash(h3); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ByTokenHash(h3); !errors.Is(err, ErrPairNotFound) {
		t.Fatalf("revoked by hash: %v", err)
	}
	if err := s.RevokeAll("ctl"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ByTokenHash(h2); !errors.Is(err, ErrPairNotFound) {
		t.Fatalf("RevokeAll: %v", err)
	}
	if l, _ := s.ListActive("ctl"); len(l) != 0 {
		t.Fatalf("ListActive=%v", l)
	}
	if err := s.PurgeIdle(time.Hour); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	n := len(s.rows)
	s.mu.Unlock()
	if n != 0 {
		t.Fatalf("PurgeIdle left %d revoked rows", n)
	}
}
