package remote

import (
	"sync"
	"time"
)

// Brute-force limits for pair-code claims (see 04-RESEARCH "Brute-Force Protection").
const (
	IPFailLimit     = 5
	FailWindow      = 10 * time.Minute
	IPBlockBase     = 15 * time.Minute
	IPBlockMax      = 24 * time.Hour
	UserFailLimit   = 10
	UserBlock       = 15 * time.Minute
	GlobalFailLimit = 20
	GlobalPause     = 5 * time.Minute
	IPRateLimit     = 10 // claim requests per IP per minute
	IPRateWindow    = time.Minute
)

// RateLimitError means the caller must wait RetryAfter before trying again.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string { return "too many attempts" }

// Limiter tracks wrong pair-code attempts per IP, per account and globally,
// plus the raw claim request rate per IP. The clock is injected for tests.
type Limiter struct {
	mu          sync.Mutex
	now         func() time.Time
	ipFails     map[string][]time.Time
	ipBlocks    map[string]time.Time // blocked until
	ipStrikes   map[string]int       // number of blocks so far (for doubling)
	userFails   map[string][]time.Time
	userBlocks  map[string]time.Time
	globalFails []time.Time
	pausedUntil time.Time
	ipReqs      map[string][]time.Time
}

func NewLimiter(now func() time.Time) *Limiter {
	return &Limiter{
		now:        now,
		ipFails:    map[string][]time.Time{},
		ipBlocks:   map[string]time.Time{},
		ipStrikes:  map[string]int{},
		userFails:  map[string][]time.Time{},
		userBlocks: map[string]time.Time{},
		ipReqs:     map[string][]time.Time{},
	}
}

// prune keeps only timestamps newer than now-window.
func prune(ts []time.Time, now time.Time, window time.Duration) []time.Time {
	cutoff := now.Add(-window)
	i := 0
	for i < len(ts) && !ts[i].After(cutoff) {
		i++
	}
	if i == 0 {
		return ts
	}
	return append([]time.Time(nil), ts[i:]...)
}

// Allow is called once per claim attempt BEFORE the code is checked. It records the
// request for the per-IP rate and returns *RateLimitError if the IP or user is blocked,
// claims are globally paused, or the IP exceeded IPRateLimit within IPRateWindow.
func (l *Limiter) Allow(ip, user string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	reqs := append(prune(l.ipReqs[ip], now, IPRateWindow), now)
	l.ipReqs[ip] = reqs

	var wait time.Duration
	if now.Before(l.pausedUntil) {
		wait = maxDur(wait, l.pausedUntil.Sub(now))
	}
	if until, ok := l.ipBlocks[ip]; ok && now.Before(until) {
		wait = maxDur(wait, until.Sub(now))
	}
	if user != "" {
		if until, ok := l.userBlocks[user]; ok && now.Before(until) {
			wait = maxDur(wait, until.Sub(now))
		}
	}
	if len(reqs) > IPRateLimit {
		wait = maxDur(wait, reqs[len(reqs)-IPRateLimit-1].Add(IPRateWindow).Sub(now))
	}
	if wait > 0 {
		return &RateLimitError{RetryAfter: wait}
	}
	return nil
}

// Fail records a wrong code. Returns globalTripped=true exactly when this failure makes
// the global count reach GlobalFailLimit within FailWindow (the caller then cancels all codes).
func (l *Limiter) Fail(ip, user string) (globalTripped bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	fails := append(prune(l.ipFails[ip], now, FailWindow), now)
	if len(fails) >= IPFailLimit {
		strikes := l.ipStrikes[ip]
		d := IPBlockMax
		if strikes < 16 { // avoid shift overflow; 15min<<7 already exceeds the cap
			d = IPBlockBase << strikes
			if d > IPBlockMax {
				d = IPBlockMax
			}
		}
		l.ipBlocks[ip] = now.Add(d)
		l.ipStrikes[ip] = strikes + 1
		delete(l.ipFails, ip)
	} else {
		l.ipFails[ip] = fails
	}

	if user != "" {
		uf := append(prune(l.userFails[user], now, FailWindow), now)
		if len(uf) >= UserFailLimit {
			l.userBlocks[user] = now.Add(UserBlock)
			delete(l.userFails, user)
		} else {
			l.userFails[user] = uf
		}
	}

	l.globalFails = append(prune(l.globalFails, now, FailWindow), now)
	if len(l.globalFails) >= GlobalFailLimit {
		l.pausedUntil = now.Add(GlobalPause)
		l.globalFails = nil
		return true
	}
	return false
}

// Paused reports whether claims are globally paused and for how much longer.
func (l *Limiter) Paused() (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Before(l.pausedUntil) {
		return true, l.pausedUntil.Sub(now)
	}
	return false, 0
}

// Sweep drops timestamps older than FailWindow/IPRateWindow and expired blocks.
// Strike counts are kept while the IP still has a block or recent failures so
// that doubling works; they are forgotten once the IP is idle for a full IPBlockMax.
func (l *Limiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	for k, v := range l.ipFails {
		if v = prune(v, now, FailWindow); len(v) == 0 {
			delete(l.ipFails, k)
		} else {
			l.ipFails[k] = v
		}
	}
	for k, v := range l.userFails {
		if v = prune(v, now, FailWindow); len(v) == 0 {
			delete(l.userFails, k)
		} else {
			l.userFails[k] = v
		}
	}
	for k, v := range l.ipReqs {
		if v = prune(v, now, IPRateWindow); len(v) == 0 {
			delete(l.ipReqs, k)
		} else {
			l.ipReqs[k] = v
		}
	}
	l.globalFails = prune(l.globalFails, now, FailWindow)
	if len(l.globalFails) == 0 {
		l.globalFails = nil
	}
	for k, until := range l.ipBlocks {
		if !now.Before(until.Add(IPBlockMax)) {
			// Idle for a full day after the block ended: forget the strikes too.
			delete(l.ipBlocks, k)
			delete(l.ipStrikes, k)
		}
	}
	for k, until := range l.userBlocks {
		if !now.Before(until) {
			delete(l.userBlocks, k)
		}
	}
}

func maxDur(a, b time.Duration) time.Duration {
	if a > b {
		return a
	}
	return b
}
