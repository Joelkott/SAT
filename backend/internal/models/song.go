package models

import "time"

type Song struct {
	ID        string    `json:"id" db:"id"`
	Title     string    `json:"title" db:"title"`
	Artist    *string   `json:"artist,omitempty" db:"artist"`
	Lyrics    string    `json:"lyrics" db:"lyrics"`
	Language  string    `json:"language" db:"language"`
	Content   string    `json:"content" db:"content"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type CreateSongRequest struct {
	Title    string  `json:"title"`
	Artist   *string `json:"artist,omitempty"`
	Lyrics   string  `json:"lyrics"`
	Language string  `json:"language"`
	Content  string  `json:"content"`
}

type UpdateSongRequest struct {
	Title    *string `json:"title,omitempty"`
	Artist   *string `json:"artist,omitempty"`
	Lyrics   *string `json:"lyrics,omitempty"`
	Language *string `json:"language,omitempty"`
	Content  *string `json:"content,omitempty"`
}

type SearchRequest struct {
	Query    string `json:"query"`
	Language string `json:"language,omitempty"`
}
