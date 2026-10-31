package models

import "time"

// WallPreset is a named, saved snapshot of the wall-output layout config.
type WallPreset struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Layout    string    `json:"layout"`
	Blur      int       `json:"blur"`
	BoxWpx    int       `json:"box_w_px"`
	BoxHpx    int       `json:"box_h_px"`
	TextScale float64   `json:"text_scale"`
	Builtin   bool      `json:"builtin"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
