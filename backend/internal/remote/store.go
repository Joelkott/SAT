package remote

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrPairNotFound is returned for unknown or revoked pair tokens.
var ErrPairNotFound = errors.New("pair not found")

// Pair is one phone paired to one control window. The session token itself is
// never stored — only its SHA-256.
type Pair struct {
	ID         int64     `json:"id"`
	ControlID  string    `json:"-"`
	Label      string    `json:"label"`
	Username   string    `json:"username"`
	Role       string    `json:"role"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// PairStore persists pair sessions so pairs survive a backend restart.
type PairStore interface {
	Ensure() error
	Insert(controlID string, tokenHash []byte, label, username, role string) (Pair, error)
	ByTokenHash(tokenHash []byte) (Pair, error)  // revoked rows → ErrPairNotFound
	ListActive(controlID string) ([]Pair, error) // revoked_at IS NULL, ORDER BY created_at
	CountActive(controlID string) (int, error)
	Revoke(controlID string, pairID int64) (bool, error) // only if the row belongs to controlID
	RevokeAll(controlID string) error
	RevokeByTokenHash(tokenHash []byte) error
	Touch(pairID int64) error                // last_seen_at = NOW()
	PurgeIdle(olderThan time.Duration) error // DELETE rows revoked, or last_seen_at older than cutoff
}

// PGStore is the Postgres-backed PairStore (table remote_pairs, created on boot).
type PGStore struct{ db *sql.DB }

func NewPGStore(db *sql.DB) *PGStore { return &PGStore{db: db} }

func (s *PGStore) Ensure() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS remote_pairs (
  id BIGSERIAL PRIMARY KEY,
  control_id TEXT NOT NULL,
  token_hash BYTEA UNIQUE NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
)`); err != nil {
		return fmt.Errorf("create remote_pairs: %w", err)
	}
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS remote_pairs_control_idx ON remote_pairs (control_id) WHERE revoked_at IS NULL`); err != nil {
		return fmt.Errorf("create remote_pairs index: %w", err)
	}
	return nil
}

func (s *PGStore) Insert(controlID string, tokenHash []byte, label, username, role string) (Pair, error) {
	p := Pair{ControlID: controlID, Label: label, Username: username, Role: role}
	err := s.db.QueryRow(
		`INSERT INTO remote_pairs (control_id, token_hash, label, username, role)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, last_seen_at`,
		controlID, tokenHash, label, username, role,
	).Scan(&p.ID, &p.CreatedAt, &p.LastSeenAt)
	if err != nil {
		return Pair{}, err
	}
	return p, nil
}

const pairCols = `id, control_id, label, username, role, created_at, last_seen_at`

func scanPair(sc interface{ Scan(...any) error }) (Pair, error) {
	var p Pair
	err := sc.Scan(&p.ID, &p.ControlID, &p.Label, &p.Username, &p.Role, &p.CreatedAt, &p.LastSeenAt)
	return p, err
}

func (s *PGStore) ByTokenHash(tokenHash []byte) (Pair, error) {
	p, err := scanPair(s.db.QueryRow(
		`SELECT `+pairCols+` FROM remote_pairs WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash))
	if errors.Is(err, sql.ErrNoRows) {
		return Pair{}, ErrPairNotFound
	}
	return p, err
}

func (s *PGStore) ListActive(controlID string) ([]Pair, error) {
	rows, err := s.db.Query(
		`SELECT `+pairCols+` FROM remote_pairs WHERE control_id=$1 AND revoked_at IS NULL ORDER BY created_at`, controlID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Pair{}
	for rows.Next() {
		p, err := scanPair(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *PGStore) CountActive(controlID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM remote_pairs WHERE control_id=$1 AND revoked_at IS NULL`, controlID).Scan(&n)
	return n, err
}

func (s *PGStore) Revoke(controlID string, pairID int64) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE remote_pairs SET revoked_at = NOW() WHERE id=$1 AND control_id=$2 AND revoked_at IS NULL`,
		pairID, controlID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (s *PGStore) RevokeAll(controlID string) error {
	_, err := s.db.Exec(
		`UPDATE remote_pairs SET revoked_at = NOW() WHERE control_id=$1 AND revoked_at IS NULL`, controlID)
	return err
}

func (s *PGStore) RevokeByTokenHash(tokenHash []byte) error {
	_, err := s.db.Exec(
		`UPDATE remote_pairs SET revoked_at = NOW() WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash)
	return err
}

func (s *PGStore) Touch(pairID int64) error {
	_, err := s.db.Exec(`UPDATE remote_pairs SET last_seen_at = NOW() WHERE id=$1`, pairID)
	return err
}

func (s *PGStore) PurgeIdle(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan)
	_, err := s.db.Exec(
		`DELETE FROM remote_pairs WHERE revoked_at IS NOT NULL OR last_seen_at < $1`, cutoff)
	return err
}
