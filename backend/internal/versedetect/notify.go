package versedetect

import "sync"

// notifier is a broadcast wake-up for long-polls without lost wake-ups:
// a waiter captures C() BEFORE reading state, so any Bump() after that read
// closes the captured channel and the waiter re-reads.
type notifier struct {
	mu sync.Mutex
	ch chan struct{}
}

func newNotifier() *notifier { return &notifier{ch: make(chan struct{})} }

// C returns the channel that the NEXT Bump closes. Capture it BEFORE reading state.
func (n *notifier) C() <-chan struct{} {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.ch
}

// Bump wakes every waiter currently holding C().
func (n *notifier) Bump() {
	n.mu.Lock()
	close(n.ch)
	n.ch = make(chan struct{})
	n.mu.Unlock()
}
