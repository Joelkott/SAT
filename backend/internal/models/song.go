package models

import "time"

type Song struct {
	ID                  string    `json:"id" db:"id"`
	Title               string    `json:"title" db:"title"`
	FileName            *string   `json:"file_name,omitempty" db:"file_name"`
	Library             string    `json:"library" db:"library"`
	Language            string    `json:"language" db:"language"`
	ProUUID             *string   `json:"pro_uuid,omitempty" db:"pro_uuid"`
	DisplayLyrics       string    `json:"display_lyrics" db:"display_lyrics"`
	MusicMinistryLyrics string    `json:"music_ministry_lyrics" db:"music_ministry_lyrics"`
	Artist              *string   `json:"artist,omitempty" db:"artist"`
	CreatedAt           time.Time `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time `json:"updated_at" db:"updated_at"`
}

type CreateSongRequest struct {
	Title               string  `json:"title"`
	FileName            *string `json:"file_name,omitempty"`
	Library             string  `json:"library"`
	Language            string  `json:"language"`
	ProUUID             *string `json:"pro_uuid,omitempty"`
	DisplayLyrics       string  `json:"display_lyrics"`
	MusicMinistryLyrics string  `json:"music_ministry_lyrics"`
	Artist              *string `json:"artist,omitempty"`
}

type UpdateSongRequest struct {
	Title               *string `json:"title,omitempty"`
	Library             *string `json:"library,omitempty"`
	Language            *string `json:"language,omitempty"`
	DisplayLyrics       *string `json:"display_lyrics,omitempty"`
	MusicMinistryLyrics *string `json:"music_ministry_lyrics,omitempty"`
	Artist              *string `json:"artist,omitempty"`
}

type SearchRequest struct {
	Query    string `json:"query"`
	Language string `json:"language,omitempty"`
}

type Settings struct {
	ID                       int       `json:"id" db:"id"`
	LaptopBIP                string    `json:"laptop_b_ip" db:"laptop_b_ip"`
	LaptopBPort              int       `json:"laptop_b_port" db:"laptop_b_port"`
	LivePlaylistUUID         string    `json:"live_playlist_uuid" db:"live_playlist_uuid"`
	ProPresenterHost         string    `json:"propresenter_host" db:"propresenter_host"`
	ProPresenterPort         int       `json:"propresenter_port" db:"propresenter_port"`
	ProPresenterPlaylist     string    `json:"propresenter_playlist" db:"propresenter_playlist"`
	ProPresenterPlaylistUUID string    `json:"propresenter_playlist_uuid" db:"propresenter_playlist_uuid"`
	UpdatedAt                time.Time `json:"updated_at" db:"updated_at"`
}

type UpdateSettingsRequest struct {
	ProPresenterHost         *string `json:"propresenter_host,omitempty"`
	ProPresenterPort         *int    `json:"propresenter_port,omitempty"`
	ProPresenterPlaylist     *string `json:"propresenter_playlist,omitempty"`
	ProPresenterPlaylistUUID *string `json:"propresenter_playlist_uuid,omitempty"`
}

// Queue Models
type QueueItem struct {
	ID        int       `json:"id" db:"id"`
	SongID    string    `json:"song_id" db:"song_id"`
	Position  int       `json:"position" db:"position"`
	Song      *Song     `json:"song,omitempty" db:"-"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type AddToQueueRequest struct {
	SongID string `json:"song_id"`
}

type ReorderQueueRequest struct {
	Items []QueueItemPosition `json:"items"`
}

type QueueItemPosition struct {
	ID       int `json:"id"`
	Position int `json:"position"`
}
