package captionstream

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CaptionMessage represents a caption from the SSE stream
type CaptionMessage struct {
	Type      string    `json:"type"`
	Text      string    `json:"text"`
	Timestamp string    `json:"timestamp"`
	Status    string    `json:"status,omitempty"`
	Message   string    `json:"message,omitempty"`
}

// CaptionHandler is called when a new caption is received
type CaptionHandler func(text string, timestamp string)

// Client connects to Jgm-live-captions SSE stream
type Client struct {
	streamURL      string
	handler        CaptionHandler
	client         *http.Client
	mu             sync.Mutex
	connected      bool
	stopChan       chan struct{}
	reconnectDelay time.Duration
	maxRetries     int
}

// NewClient creates a new caption stream client
func NewClient(streamURL string, handler CaptionHandler) *Client {
	return &Client{
		streamURL:      streamURL,
		handler:        handler,
		client:         &http.Client{Timeout: 0}, // No timeout for SSE
		stopChan:       make(chan struct{}),
		reconnectDelay: 2 * time.Second,
		maxRetries:     -1, // Infinite retries
	}
}

// Start begins listening to the caption stream
func (c *Client) Start() error {
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		return fmt.Errorf("client already connected")
	}
	c.connected = true
	c.mu.Unlock()

	log.Printf("📡 Connecting to caption stream: %s", c.streamURL)

	go c.connect()
	return nil
}

// Stop disconnects from the caption stream
func (c *Client) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected {
		return
	}

	c.connected = false
	close(c.stopChan)
	log.Println("📡 Caption stream client stopped")
}

// IsConnected returns whether the client is connected
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// connect establishes the SSE connection with auto-reconnect
func (c *Client) connect() {
	retries := 0

	for {
		select {
		case <-c.stopChan:
			return
		default:
		}

		// Check if we should still be connected
		c.mu.Lock()
		if !c.connected {
			c.mu.Unlock()
			return
		}
		c.mu.Unlock()

		err := c.listenToStream()
		if err != nil {
			log.Printf("⚠️  Caption stream error: %v", err)
		}

		// Check if we should reconnect
		c.mu.Lock()
		shouldReconnect := c.connected
		c.mu.Unlock()

		if !shouldReconnect {
			return
		}

		// Exponential backoff for reconnection
		retries++
		delay := c.reconnectDelay * time.Duration(retries)
		if delay > 30*time.Second {
			delay = 30 * time.Second
		}

		log.Printf("🔄 Reconnecting to caption stream in %v... (attempt %d)", delay, retries)

		select {
		case <-time.After(delay):
			// Continue to reconnect
		case <-c.stopChan:
			return
		}
	}
}

// listenToStream connects to the SSE endpoint and processes events
func (c *Client) listenToStream() error {
	req, err := http.NewRequest("GET", c.streamURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Connection", "keep-alive")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	log.Println("✅ Connected to caption stream")

	reader := bufio.NewReader(resp.Body)

	for {
		select {
		case <-c.stopChan:
			return nil
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				return fmt.Errorf("stream closed by server")
			}
			return fmt.Errorf("error reading stream: %w", err)
		}

		line = strings.TrimSpace(line)

		// Skip empty lines and comments (heartbeats)
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}

		// Parse SSE data line
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			c.handleMessage(data)
		}
	}
}

// handleMessage processes a single SSE message
func (c *Client) handleMessage(data string) {
	var msg CaptionMessage
	if err := json.Unmarshal([]byte(data), &msg); err != nil {
		log.Printf("⚠️  Failed to parse caption message: %v", err)
		return
	}

	// Handle different message types
	switch msg.Type {
	case "status":
		// Service status update (offline, ready, live, paused, ended)
		log.Printf("📢 Caption service status: %s - %s", msg.Status, msg.Message)

	case "caption":
		// New caption received
		if msg.Text != "" && msg.Timestamp != "" {
			// Forward to handler for Bible reference parsing
			c.handler(msg.Text, msg.Timestamp)
		}

	case "clear":
		// Captions cleared (service ended or reset)
		log.Println("🧹 Captions cleared by caption service")

	case "delete":
		// Caption deleted (skip for now)

	default:
		// Unknown type or caption without explicit type field
		if msg.Text != "" && msg.Timestamp != "" {
			// Treat as caption
			c.handler(msg.Text, msg.Timestamp)
		}
	}
}
