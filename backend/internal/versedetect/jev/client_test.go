package jev

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testKey = "test-key"

func TestAskRequestShapeAndDecode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if r.URL.Path != "/v1/systemone" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+testKey {
			t.Errorf("Authorization = %q", got)
		}
		if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("Content-Type = %q", ct)
		}
		body, _ := io.ReadAll(r.Body)
		var req struct {
			State     any                 `json:"state"`
			Model     string              `json:"model"`
			Questions map[string]Question `json:"questions"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("bad body: %v", err)
		}
		if req.Model != "jev-latest" {
			t.Errorf("model = %q", req.Model)
		}
		if req.State != "transcript text" {
			t.Errorf("state = %v", req.State)
		}
		if q := req.Questions["cites"]; q.Type != "noul" || q.Instructions == "" {
			t.Errorf("cites question = %+v", q)
		}
		if q := req.Questions["book"]; q.Type != "choice" || q.Criteria["JHN"] != "Gospel of John" || q.Criteria["none"] == "" {
			t.Errorf("book question = %+v", q)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"model":"jev-1.13.0","answers":{
			"cites":{"type":"noul","noul":0.97},
			"book":{"type":"choice","choice":"JHN","probabilities":{"JHN":0.93,"none":0.07},"confidence":0.9}
		},"usage":{"input_tokens":428,"output_tokens":73}}`)
	}))
	defer srv.Close()

	c := New(testKey, srv.URL+"/v1/systemone")
	resp, err := c.Ask(context.Background(), "transcript text", map[string]Question{
		"cites": {Type: "noul", Instructions: "Is a Bible verse being cited?"},
		"book": {Type: "choice", Instructions: "Which book?", Criteria: map[string]string{
			"JHN": "Gospel of John", "none": "No book referenced"}},
	})
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if resp.Model != "jev-1.13.0" || resp.Usage.InputTokens != 428 || resp.Usage.OutputTokens != 73 {
		t.Errorf("resp meta = %+v", resp)
	}
	if got := resp.Answers["cites"].Noul; got != 0.97 {
		t.Errorf("cites.Noul = %v", got)
	}
	if got := resp.Answers["book"].Choice; got != "JHN" {
		t.Errorf("book.Choice = %q", got)
	}
	if got := resp.Answers["book"].Prob(); got != 0.93 {
		t.Errorf("book.Prob() = %v", got)
	}
}

func TestProbFallsBackToConfidence(t *testing.T) {
	a := Answer{Type: "choice", Choice: "ROM", Probabilities: map[string]float64{"JHN": 0.2}, Confidence: 0.85}
	if got := a.Prob(); got != 0.85 {
		t.Errorf("Prob() = %v, want 0.85", got)
	}
	b := Answer{Type: "choice", Choice: "ROM", Confidence: 0.6}
	if got := b.Prob(); got != 0.6 {
		t.Errorf("Prob() nil probs = %v, want 0.6", got)
	}
}

func TestErrorStatusesAndKeySafety(t *testing.T) {
	status := http.StatusTooManyRequests
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, `{"error":"nope"}`)
	}))
	defer srv.Close()
	c := New(testKey, srv.URL)

	_, err := c.Ask(context.Background(), "s", map[string]Question{"q": {Type: "noul", Instructions: "x"}})
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("429 err = %v, want ErrRateLimited", err)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Errorf("429 error leaks key: %q", err)
	}

	status = http.StatusInternalServerError
	_, err = c.Ask(context.Background(), "s", map[string]Question{"q": {Type: "noul", Instructions: "x"}})
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("500 err = %v", err)
	}
	if errors.Is(err, ErrRateLimited) {
		t.Errorf("500 must not be ErrRateLimited")
	}
	if strings.Contains(err.Error(), testKey) || strings.Contains(err.Error(), "Bearer") {
		t.Errorf("500 error leaks key: %q", err)
	}
}

func TestMissingAnswersIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"model":"jev-1"}`)
	}))
	defer srv.Close()
	_, err := New(testKey, srv.URL).Ask(context.Background(), "s", map[string]Question{"q": {Type: "noul"}})
	if err == nil {
		t.Fatal("expected error for missing answers")
	}
}

func TestTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(200 * time.Millisecond):
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	c := New(testKey, srv.URL)
	c.SetTimeout(50 * time.Millisecond)
	start := time.Now()
	_, err := c.Ask(context.Background(), "s", map[string]Question{"q": {Type: "noul"}})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if el := time.Since(start); el > time.Second {
		t.Errorf("Ask took %s", el)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Errorf("timeout error leaks key: %q", err)
	}
}

func TestDisabledWithoutKey(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
	}))
	defer srv.Close()

	c := New("", "")
	if c.Enabled() {
		t.Error("Enabled() = true with empty key")
	}
	if _, err := c.Ask(context.Background(), "s", nil); !errors.Is(err, ErrDisabled) {
		t.Errorf("err = %v, want ErrDisabled", err)
	}
	c2 := New("", srv.URL)
	if _, err := c2.Ask(context.Background(), "s", nil); !errors.Is(err, ErrDisabled) {
		t.Errorf("err = %v, want ErrDisabled", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Errorf("disabled client made %d HTTP calls", hits)
	}
	if New(testKey, "").url != DefaultURL {
		t.Errorf("empty url should default to DefaultURL")
	}
}
