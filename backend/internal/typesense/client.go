package typesense

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/typesense/typesense-go/typesense"
	"github.com/typesense/typesense-go/typesense/api"
	"github.com/typesense/typesense-go/typesense/api/pointer"
	"github.com/yourusername/audience-stage-teleprompter/internal/models"
)

type Client struct {
	client *typesense.Client
}

const collectionName = "songs"

func New(apiKey, host string) (*Client, error) {
	client := typesense.NewClient(
		typesense.WithServer(host),
		typesense.WithAPIKey(apiKey),
		typesense.WithConnectionTimeout(5*time.Second),
	)

	tc := &Client{client: client}

	// Initialize schema
	if err := tc.initSchema(); err != nil {
		return nil, fmt.Errorf("error initializing schema: %w", err)
	}

	log.Println("Typesense client initialized")
	return tc, nil
}

func (c *Client) initSchema() error {
	ctx := context.Background()

	// Check if collection exists
	_, err := c.client.Collection(collectionName).Retrieve(ctx)
	if err == nil {
		log.Println("Collection already exists")
		return nil
	}

	// Create collection
	schema := &api.CollectionSchema{
		Name: collectionName,
		Fields: []api.Field{
			{
				Name: "id",
				Type: "string",
			},
			{
				Name: "title",
				Type: "string",
			},
			{
				Name:     "artist",
				Type:     "string",
				Optional: pointer.True(),
			},
			{
				Name: "lyrics",
				Type: "string",
			},
			{
				Name:  "language",
				Type:  "string",
				Facet: pointer.True(),
			},
			{
				Name: "content",
				Type: "string",
			},
			{
				Name: "updated_at",
				Type: "int64",
			},
		},
		DefaultSortingField: pointer.String("updated_at"),
	}

	_, err = c.client.Collections().Create(ctx, schema)
	if err != nil {
		return fmt.Errorf("error creating collection: %w", err)
	}

	log.Println("Typesense collection created successfully")
	return nil
}

func (c *Client) IndexSong(song *models.Song) error {
	ctx := context.Background()

	doc := map[string]interface{}{
		"id":         song.ID,
		"title":      song.Title,
		"lyrics":     song.Lyrics,
		"language":   song.Language,
		"content":    song.Content,
		"updated_at": song.UpdatedAt.Unix(),
	}

	if song.Artist != nil {
		doc["artist"] = *song.Artist
	}

	_, err := c.client.Collection(collectionName).Documents().Upsert(ctx, doc)
	if err != nil {
		return fmt.Errorf("error indexing song: %w", err)
	}

	return nil
}

func (c *Client) DeleteSong(id string) error {
	ctx := context.Background()
	_, err := c.client.Collection(collectionName).Document(id).Delete(ctx)
	if err != nil {
		return fmt.Errorf("error deleting song from index: %w", err)
	}
	return nil
}

type SearchResult struct {
	Songs      []models.Song `json:"songs"`
	TotalFound int           `json:"total_found"`
	SearchTime int           `json:"search_time_ms"`
}

func (c *Client) Search(query string, languages []string) (*SearchResult, error) {
	ctx := context.Background()

	searchParams := &api.SearchCollectionParams{
		Q:       query,
		QueryBy: "title,artist,lyrics",
		Prefix:  pointer.String("true"),
		PerPage: pointer.Int(50),
		// Keep default text match ordering, but allow for score ties to be stable
		HighlightStartTag: pointer.String(""),
		HighlightEndTag:   pointer.String(""),
	}

	// Add language filter if specified
	if len(languages) > 0 {
		filterValues := make([]string, 0, len(languages)*4)
		seen := make(map[string]struct{})

		addVal := func(val string) {
			v := strings.TrimSpace(val)
			if v == "" {
				return
			}
			if _, ok := seen[v]; ok {
				return
			}
			seen[v] = struct{}{}
			filterValues = append(filterValues, fmt.Sprintf("\"%s\"", v))
		}

		for _, lang := range languages {
			if lang == "" {
				continue
			}
			lo := strings.ToLower(strings.TrimSpace(lang))
			title := strings.Title(lo)
			addVal(lang)
			addVal(lo)
			addVal(title)
		}

		if len(filterValues) > 0 {
			filter := fmt.Sprintf("language:=[%s]", strings.Join(filterValues, ","))
			searchParams.FilterBy = pointer.String(filter)
		}
	}

	result, err := c.client.Collection(collectionName).Documents().Search(ctx, searchParams)
	if err != nil {
		return nil, fmt.Errorf("error searching: %w", err)
	}

	songs := make([]models.Song, 0)
	if result.Hits != nil {
		for _, hit := range *result.Hits {
			doc := *hit.Document
			song := models.Song{
				ID:       doc["id"].(string),
				Title:    doc["title"].(string),
				Lyrics:   doc["lyrics"].(string),
				Language: doc["language"].(string),
				Content:  doc["content"].(string),
			}

			if artist, ok := doc["artist"].(string); ok {
				song.Artist = &artist
			}

			if updatedAt, ok := doc["updated_at"].(float64); ok {
				song.UpdatedAt = time.Unix(int64(updatedAt), 0)
			}

			songs = append(songs, song)
		}
	}

	searchTimeMs := 0
	if result.SearchTimeMs != nil {
		searchTimeMs = *result.SearchTimeMs
	}

	totalFound := 0
	if result.Found != nil {
		totalFound = *result.Found
	}

	return &SearchResult{
		Songs:      songs,
		TotalFound: totalFound,
		SearchTime: searchTimeMs,
	}, nil
}

func (c *Client) ReindexAll(songs []models.Song) error {
	ctx := context.Background()
	log.Println("Starting full reindex...")

	// Delete existing collection
	_, err := c.client.Collection(collectionName).Delete(ctx)
	if err != nil {
		log.Printf("Warning: could not delete existing collection: %v", err)
	}

	// Recreate schema
	if err := c.initSchema(); err != nil {
		return fmt.Errorf("error recreating schema: %w", err)
	}

	// Index all songs
	for i, song := range songs {
		if err := c.IndexSong(&song); err != nil {
			return fmt.Errorf("error indexing song %s: %w", song.ID, err)
		}
		if (i+1)%100 == 0 {
			log.Printf("Indexed %d/%d songs", i+1, len(songs))
		}
	}

	log.Printf("Reindex complete: %d songs indexed", len(songs))
	return nil
}
