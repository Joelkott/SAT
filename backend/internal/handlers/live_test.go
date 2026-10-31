package handlers

import (
	"strings"
	"testing"
)

func TestClampOutputConfigLayout(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"fullscreen", "fullscreen"},
		{" Fullscreen ", "fullscreen"},
		{"FULLSCREEN", "fullscreen"},
		{"imag", "imag"},
		{"", "imag"},
		{"FULLSCREEN-ish", "imag"},
		{"foo", "imag"},
	}
	for _, tc := range cases {
		got := clampOutputConfig(OutputConfig{Layout: tc.in, TextScale: 1.0}).Layout
		if got != tc.want {
			t.Errorf("clampOutputConfig(Layout=%q).Layout = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestClampOutputConfigExistingClamps(t *testing.T) {
	cfg := clampOutputConfig(OutputConfig{Blur: 100, TextScale: 2.0, Layout: "fullscreen"})
	if cfg.Blur != 60 {
		t.Errorf("Blur = %d, want 60", cfg.Blur)
	}
	if cfg.TextScale != 1.0 {
		t.Errorf("TextScale = %v, want 1.0", cfg.TextScale)
	}
}

func TestDefaultOutputConfigLayout(t *testing.T) {
	if got := defaultOutputConfig().Layout; got != "imag" {
		t.Errorf("defaultOutputConfig().Layout = %q, want %q", got, "imag")
	}
}

func TestNormalizeWallPreset(t *testing.T) {
	long60 := strings.Repeat("a", 60)
	long61 := strings.Repeat("a", 61)
	cases := []struct {
		name     string
		in       string
		wantName string
		wantErr  bool
	}{
		{"builtin name", "With IMAG", "With IMAG", false},
		{"trims whitespace", "  Sunday AM  ", "Sunday AM", false},
		{"empty", "", "", true},
		{"whitespace only", "   ", "", true},
		{"61 chars", long61, "", true},
		{"60 chars", long60, long60, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _, err := normalizeWallPreset(tc.in, OutputConfig{TextScale: 1.0})
			if tc.wantErr {
				if err == nil {
					t.Fatalf("normalizeWallPreset(%q) err = nil, want error", tc.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeWallPreset(%q) unexpected err: %v", tc.in, err)
			}
			if got != tc.wantName {
				t.Errorf("normalizeWallPreset(%q) name = %q, want %q", tc.in, got, tc.wantName)
			}
		})
	}
}

func TestNormalizeWallPresetClamps(t *testing.T) {
	_, cfg, err := normalizeWallPreset("Clamp", OutputConfig{Layout: "FULLSCREEN", Blur: 100, TextScale: 2, BoxWpx: -5, BoxHpx: -5})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if cfg.Layout != "fullscreen" {
		t.Errorf("Layout = %q, want fullscreen", cfg.Layout)
	}
	if cfg.Blur != 60 {
		t.Errorf("Blur = %d, want 60", cfg.Blur)
	}
	if cfg.TextScale != 1.0 {
		t.Errorf("TextScale = %v, want 1.0", cfg.TextScale)
	}
	if cfg.BoxWpx != 0 || cfg.BoxHpx != 0 {
		t.Errorf("Box = %dx%d, want 0x0", cfg.BoxWpx, cfg.BoxHpx)
	}
}
