package remote

import (
	"bytes"
	"sort"
	"sync"
	"time"
)

// MemStore is an in-memory PairStore with the same semantics as PGStore.
// Used by tests (including the HTTP handler tests).
type MemStore struct {
	mu     sync.Mutex
	nextID int64
	rows   map[int64]*memRow
}

type memRow struct {
	Pair
	hash    []byte
	revoked bool
}

func NewMemStore() *MemStore { return &MemStore{rows: map[int64]*memRow{}} }

func (s *MemStore) Ensure() error { return nil }

func (s *MemStore) Insert(controlID string, tokenHash []byte, label, username, role string) (Pair, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	now := time.Now()
	r := &memRow{
		Pair: Pair{ID: s.nextID, ControlID: controlID, Label: label, Username: username, Role: role, CreatedAt: now, LastSeenAt: now},
		hash: append([]byte(nil), tokenHash...),
	}
	s.rows[r.ID] = r
	return r.Pair, nil
}

func (s *MemStore) ByTokenHash(tokenHash []byte) (Pair, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rows {
		if !r.revoked && bytes.Equal(r.hash, tokenHash) {
			return r.Pair, nil
		}
	}
	return Pair{}, ErrPairNotFound
}

func (s *MemStore) ListActive(controlID string) ([]Pair, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Pair{}
	for _, r := range s.rows {
		if !r.revoked && r.ControlID == controlID {
			out = append(out, r.Pair)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out, nil
}

func (s *MemStore) CountActive(controlID string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.rows {
		if !r.revoked && r.ControlID == controlID {
			n++
		}
	}
	return n, nil
}

func (s *MemStore) Revoke(controlID string, pairID int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rows[pairID]
	if !ok || r.revoked || r.ControlID != controlID {
		return false, nil
	}
	r.revoked = true
	return true, nil
}

func (s *MemStore) RevokeAll(controlID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rows {
		if r.ControlID == controlID {
			r.revoked = true
		}
	}
	return nil
}

func (s *MemStore) RevokeByTokenHash(tokenHash []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rows {
		if bytes.Equal(r.hash, tokenHash) {
			r.revoked = true
		}
	}
	return nil
}

func (s *MemStore) Touch(pairID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.rows[pairID]; ok {
		r.LastSeenAt = time.Now()
	}
	return nil
}

func (s *MemStore) PurgeIdle(olderThan time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-olderThan)
	for id, r := range s.rows {
		if r.revoked || r.LastSeenAt.Before(cutoff) {
			delete(s.rows, id)
		}
	}
	return nil
}
