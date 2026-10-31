// Package jev is a small typed client for the TypeSafe System One API
// (model "jev-latest"), used to resolve spoken/contextual Bible references.
//
// The API key is only ever placed in the Authorization header; it never
// appears in errors or log lines (the repo is public and logs may be shared).
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultURL = "https://api.typesafe.ai/v1/systemone"
const DefaultModel = "jev-latest"

const defaultTimeout = 3 * time.Second
const maxResponseBytes = 1 << 20

var ErrDisabled = errors.New("jev: no API key")
var ErrRateLimited = errors.New("jev: rate limited")

// Question is one question in a System One request.
type Question struct {
	Type         string            `json:"type"` // "noul" | "choice"
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria,omitempty"` // choice only: option -> description
}

// Request is the System One request body.
type Request struct {
	State     any                 `json:"state"`
	Model     string              `json:"model"`
	Questions map[string]Question `json:"questions"`
}

// Answer is one answer in a System One response.
type Answer struct {
	Type          string             `json:"type"`
	Choice        string             `json:"choice,omitempty"`
	Probabilities map[string]float64 `json:"probabilities,omitempty"`
	Confidence    float64            `json:"confidence,omitempty"`
	Noul          float64            `json:"noul,omitempty"`
}

// Prob is the probability of the chosen option (probabilities[choice], else Confidence).
func (a Answer) Prob() float64 {
	if p, ok := a.Probabilities[a.Choice]; ok {
		return p
	}
	return a.Confidence
}

// Usage reports token usage.
type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// Response is the System One response body.
type Response struct {
	Model   string            `json:"model"`
	Answers map[string]Answer `json:"answers"`
	Usage   Usage             `json:"usage"`
}

// Client calls the System One endpoint.
type Client struct {
	url, key, model string
	http            *http.Client
}

// New returns a client; key "" disables it. url "" -> DefaultURL. HTTP timeout 3s.
func New(key, url string) *Client {
	if url == "" {
		url = DefaultURL
	}
	return &Client{
		url:   url,
		key:   key,
		model: DefaultModel,
		http:  &http.Client{Timeout: defaultTimeout},
	}
}

// Enabled reports whether an API key is configured.
func (c *Client) Enabled() bool { return c != nil && c.key != "" }

// SetTimeout overrides the HTTP timeout (tests).
func (c *Client) SetTimeout(d time.Duration) { c.http.Timeout = d }

// Ask sends state + questions and returns the decoded answers.
func (c *Client) Ask(ctx context.Context, state any, qs map[string]Question) (*Response, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	body, err := json.Marshal(Request{State: state, Model: c.model, Questions: qs})
	if err != nil {
		return nil, fmt.Errorf("jev: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("jev: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Unwrap *url.Error so neither the URL nor anything request-derived leaks.
		var uerr *url.Error
		if errors.As(err, &uerr) {
			if uerr.Timeout() {
				return nil, fmt.Errorf("jev: request timed out: %w", uerr.Err)
			}
			return nil, fmt.Errorf("jev: request failed: %w", uerr.Err)
		}
		return nil, fmt.Errorf("jev: request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("jev: read response: %w", err)
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("%w (HTTP 429)", ErrRateLimited)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		snippet := raw
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, fmt.Errorf("jev: HTTP %d: %s", resp.StatusCode, c.scrub(string(snippet)))
	}

	var out Response
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("jev: decode response: %w", err)
	}
	if out.Answers == nil {
		return nil, errors.New("jev: response has no answers")
	}
	return &out, nil
}

// scrub removes the key should a server ever echo it back in an error body.
func (c *Client) scrub(s string) string {
	if c.key == "" {
		return s
	}
	return strings.ReplaceAll(s, c.key, "[redacted]")
}
