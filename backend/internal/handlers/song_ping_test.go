package handlers

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestValidateSongPing(t *testing.T) {
	long := strings.Repeat("മ", 250)
	cases := []struct {
		name      string
		songID    string
		title     string
		wantErr   bool
		wantID    string
		wantRunes int
	}{
		{"empty id", "", "x", true, "", 0},
		{"blank title", "abc", "   ", true, "", 0},
		{"id too long", strings.Repeat("a", 65), "t", true, "", 0},
		{"trims", "  abc ", "  Amazing Grace  ", false, "abc", 13},
		{"truncates long malayalam title", "abc", long, false, "abc", 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, title, err := validateSongPing(tc.songID, tc.title)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr {
				return
			}
			if id != tc.wantID {
				t.Errorf("id = %q, want %q", id, tc.wantID)
			}
			if !utf8.ValidString(title) {
				t.Errorf("title is not valid UTF-8")
			}
			if n := utf8.RuneCountInString(title); n != tc.wantRunes {
				t.Errorf("title runes = %d, want %d", n, tc.wantRunes)
			}
		})
	}
}

func TestSongPingFresh(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	cases := []struct {
		name string
		p    songPing
		want bool
	}{
		{"zero value", songPing{}, false},
		{"119s old", songPing{CreatedAt: now.Add(-119 * time.Second).UnixMilli()}, true},
		{"121s old", songPing{CreatedAt: now.Add(-121 * time.Second).UnixMilli()}, false},
	}
	for _, tc := range cases {
		if got := songPingFresh(tc.p, now); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestSongPingLimiter(t *testing.T) {
	t0 := time.UnixMilli(1_800_000_000_000)
	var lim songPingLimiter
	steps := []struct {
		user string
		at   time.Duration
		want bool
	}{
		{"worship", 0, true},
		{"worship", time.Second, false},
		{"media", time.Second, true},
		{"worship", 3 * time.Second, true},
	}
	for i, s := range steps {
		if got := lim.allow(s.user, t0.Add(s.at)); got != s.want {
			t.Errorf("step %d (%s @%v): got %v, want %v", i, s.user, s.at, got, s.want)
		}
	}
}

func TestVisibleSongPing(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	p := songPing{ID: "1-1", SongID: "s1", Title: "T", FromRole: "worship", FromUser: "worship", CreatedAt: now.Add(-10 * time.Second).UnixMilli()}
	stale := p
	stale.CreatedAt = now.Add(-200 * time.Second).UnixMilli()
	cases := []struct {
		name   string
		p      songPing
		viewer string
		wantID string
	}{
		{"other account sees it", p, "media", "1-1"},
		{"sender does not", p, "worship", ""},
		{"stale hidden", stale, "media", ""},
		{"empty hidden", songPing{}, "media", ""},
	}
	for _, tc := range cases {
		if got := visibleSongPing(tc.p, tc.viewer, now); got.ID != tc.wantID {
			t.Errorf("%s: got id %q, want %q", tc.name, got.ID, tc.wantID)
		}
	}
}
