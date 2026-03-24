package bible

import (
	"sync"
	"time"
)

const (
	// MetadataTTL is the cache duration for bible metadata (translations, books, chapters)
	MetadataTTL = 24 * time.Hour
	// ContentTTL is the cache duration for verse/passage content
	ContentTTL = 1 * time.Hour
)

// cacheEntry holds a cached value with its expiration time
type cacheEntry struct {
	data      interface{}
	expiresAt time.Time
}

// Cache provides an in-memory TTL cache using sync.Map
type Cache struct {
	store sync.Map
}

// NewCache creates a new Cache instance
func NewCache() *Cache {
	return &Cache{}
}

// Get retrieves a value from the cache. Returns nil, false if expired or missing.
func (c *Cache) Get(key string) (interface{}, bool) {
	val, ok := c.store.Load(key)
	if !ok {
		return nil, false
	}

	entry := val.(*cacheEntry)
	if time.Now().After(entry.expiresAt) {
		// Lazy cleanup: delete expired entry on access
		c.store.Delete(key)
		return nil, false
	}

	return entry.data, true
}

// Set stores a value in the cache with the given TTL duration
func (c *Cache) Set(key string, data interface{}, ttl time.Duration) {
	c.store.Store(key, &cacheEntry{
		data:      data,
		expiresAt: time.Now().Add(ttl),
	})
}

// Delete removes a value from the cache
func (c *Cache) Delete(key string) {
	c.store.Delete(key)
}
