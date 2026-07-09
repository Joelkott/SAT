package handlers

import (
	"bufio"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// BibleVerseEvent represents a Bible verse to display
type BibleVerseEvent struct {
	Book      string    `json:"book"`
	Chapter   int       `json:"chapter"`
	Verse     int       `json:"verse"`
	EndVerse  *int      `json:"endVerse,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

// SSE client manager for Bible verse events
var (
	bibleSSEClients = make(map[string]chan BibleVerseEvent)
	bibleSSEMutex   sync.RWMutex
)

// BroadcastBibleVerse sends a Bible verse to all connected SSE clients
func BroadcastBibleVerse(ref BibleReference) {
	event := BibleVerseEvent{
		Book:      ref.Book,
		Chapter:   ref.Chapter,
		Verse:     ref.Verse,
		EndVerse:  ref.EndVerse,
		Timestamp: time.Now(),
	}

	bibleSSEMutex.RLock()
	clientCount := len(bibleSSEClients)
	bibleSSEMutex.RUnlock()

	if clientCount == 0 {
		log.Printf("⚠️  No SSE clients connected to receive Bible verse: %s %d:%d", event.Book, event.Chapter, event.Verse)
		return
	}

	bibleSSEMutex.RLock()
	defer bibleSSEMutex.RUnlock()

	for clientID, ch := range bibleSSEClients {
		select {
		case ch <- event:
			log.Printf("📡 Sent Bible verse to client %s: %s %d:%d", clientID, event.Book, event.Chapter, event.Verse)
		default:
			log.Printf("⚠️  Client %s channel full, skipping event", clientID)
		}
	}
}

// BibleSSE handles Server-Sent Events for Bible verse updates
func (h *Handler) BibleSSE(c *fiber.Ctx) error {
	clientID := fmt.Sprintf("client_%d", time.Now().UnixNano())
	eventChan := make(chan BibleVerseEvent, 10)

	// Register client
	bibleSSEMutex.Lock()
	bibleSSEClients[clientID] = eventChan
	clientCount := len(bibleSSEClients)
	bibleSSEMutex.Unlock()

	log.Printf("📡 Bible SSE client connected: %s (total clients: %d)", clientID, clientCount)

	// Set headers
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	// Use status to set the response started
	c.Status(200)

	// Set up streaming
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		// Cleanup when stream ends
		defer func() {
			bibleSSEMutex.Lock()
			delete(bibleSSEClients, clientID)
			remaining := len(bibleSSEClients)
			bibleSSEMutex.Unlock()
			close(eventChan)
			log.Printf("📡 Bible SSE client disconnected: %s (remaining: %d)", clientID, remaining)
		}()

		log.Printf("✅ Stream writer started for %s", clientID)

		// Send initial connection message
		initialMsg := fmt.Sprintf("data: {\"type\":\"connected\",\"clientId\":\"%s\"}\n\n", clientID)
		w.WriteString(initialMsg)
		w.Flush()
		log.Printf("✅ Sent initial message to %s", clientID)

		// Set up a ticker for keep-alive pings
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		// Stream events in a loop
		for {
			select {
			case event, ok := <-eventChan:
				if !ok {
					log.Printf("📡 Event channel closed for %s", clientID)
					return
				}
				// Send Bible verse event
				data := fmt.Sprintf(`{"type":"bible_verse","book":"%s","chapter":%d,"verse":%d`,
					event.Book, event.Chapter, event.Verse)

				if event.EndVerse != nil {
					data += fmt.Sprintf(`,"endVerse":%d`, *event.EndVerse)
				}

				data += fmt.Sprintf(`,"timestamp":"%s"}`, event.Timestamp.Format(time.RFC3339))

				msg := fmt.Sprintf("data: %s\n\n", data)
				if _, err := w.WriteString(msg); err != nil {
					log.Printf("❌ Failed to write to %s: %v", clientID, err)
					return
				}
				if err := w.Flush(); err != nil {
					log.Printf("❌ Failed to flush to %s: %v", clientID, err)
					return
				}
				log.Printf("✅ Sent Bible verse event to %s: %s %d:%d", clientID, event.Book, event.Chapter, event.Verse)

			case <-ticker.C:
				// Send keep-alive ping
				if _, err := w.WriteString(": ping\n\n"); err != nil {
					log.Printf("❌ Failed to write ping to %s: %v", clientID, err)
					return
				}
				if err := w.Flush(); err != nil {
					log.Printf("❌ Failed to flush ping to %s: %v", clientID, err)
					return
				}
				log.Printf("🏓 Sent ping to %s", clientID)
			}
		}
	})

	return nil
}
