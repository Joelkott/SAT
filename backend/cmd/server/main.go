package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
	"github.com/yourusername/audience-stage-teleprompter/internal/auth"
	"github.com/yourusername/audience-stage-teleprompter/internal/backup"
	"github.com/yourusername/audience-stage-teleprompter/internal/bible"
	"github.com/yourusername/audience-stage-teleprompter/internal/captionstream"
	"github.com/yourusername/audience-stage-teleprompter/internal/database"
	"github.com/yourusername/audience-stage-teleprompter/internal/handlers"
	"github.com/yourusername/audience-stage-teleprompter/internal/propresenter"
	"github.com/yourusername/audience-stage-teleprompter/internal/typesense"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Get configuration from environment
	dbDSN := os.Getenv("DATABASE_URL")
	if dbDSN == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	// Typesense is optional — explicitly disabled or unconfigured falls back to DB search.
	skipTypesense := os.Getenv("SKIP_TYPESENSE") == "true" || os.Getenv("DISABLE_TYPESENSE") == "true"
	typesenseAPIKey := os.Getenv("TYPESENSE_API_KEY")
	typesenseHost := os.Getenv("TYPESENSE_HOST")
	if !skipTypesense && (typesenseAPIKey == "" || typesenseHost == "") {
		log.Println("⚠️  Typesense not configured (missing TYPESENSE_API_KEY or TYPESENSE_HOST) - search will use database fallback")
		skipTypesense = true
	}

	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "./backups"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// ProPresenter configuration (optional)
	ppHost := os.Getenv("PROPRESENTER_HOST")
	ppPort := os.Getenv("PROPRESENTER_PORT")
	ppEnabled := os.Getenv("PROPRESENTER_ENABLED") == "true"
	ppPlaylist := os.Getenv("PROPRESENTER_PLAYLIST") // Optional, defaults to "Live Queue"

	if ppPort == "" {
		ppPort = "4031" // ProPresenter REST API default port
	}

	// Initialize database
	db, err := database.New(dbDSN)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize Typesense (optional — graceful degradation if unreachable)
	var ts *typesense.Client
	if !skipTypesense {
		ts, err = typesense.New(typesenseAPIKey, typesenseHost)
		if err != nil {
			log.Printf("⚠️  Failed to initialize Typesense: %v — falling back to database search", err)
			skipTypesense = true
		}
	} else {
		log.Println("⚠️  Typesense disabled - search will use PostgreSQL")
	}

	// Initialize backup manager (backup every 100 edits)
	backupManager := backup.NewManager(dbDSN, backupDir, 100)
	backupManager.Start()

	// Initialize ProPresenter client from database settings
	var ppClient *propresenter.Client
	settings, err := db.GetSettings()
	if err != nil {
		log.Printf("⚠️  Warning: Could not load settings from database: %v", err)
		// Fallback to environment variables
		if ppEnabled && ppHost != "" {
			ppConfig := &propresenter.Config{
				Host:       ppHost,
				Port:       ppPort,
				Enabled:    true,
				PlaylistID: ppPlaylist,
			}
			ppClient = propresenter.New(ppConfig)
			log.Printf("✅ ProPresenter integration enabled (from env): %s:%s", ppHost, ppPort)
		} else {
			ppClient = propresenter.New(nil)
			log.Println("ℹ️  ProPresenter integration disabled")
		}
	} else {
		// Use database settings
		if settings.ProPresenterHost != "" && settings.ProPresenterPort > 0 {
			ppConfig := &propresenter.Config{
				Host:       settings.ProPresenterHost,
				Port:       fmt.Sprintf("%d", settings.ProPresenterPort),
				Enabled:    true,
				PlaylistID: settings.ProPresenterPlaylist,
			}
			ppClient = propresenter.New(ppConfig)
			if ppClient.IsConnected() {
				log.Printf("✅ ProPresenter integration enabled and connected: %s:%d", settings.ProPresenterHost, settings.ProPresenterPort)
			} else {
				log.Printf("⚠️  ProPresenter integration enabled but not connected: %s:%d", settings.ProPresenterHost, settings.ProPresenterPort)
			}
			// Start periodic health checks (every 30 seconds)
			ppClient.StartPeriodicHealthCheck(30 * time.Second)
		} else {
			// Fallback to environment variables if database settings are empty
			if ppEnabled && ppHost != "" {
				ppConfig := &propresenter.Config{
					Host:       ppHost,
					Port:       ppPort,
					Enabled:    true,
					PlaylistID: ppPlaylist,
				}
				ppClient = propresenter.New(ppConfig)
				log.Printf("✅ ProPresenter integration enabled (from env): %s:%s", ppHost, ppPort)
				ppClient.StartPeriodicHealthCheck(30 * time.Second)
			} else {
				ppClient = propresenter.New(nil)
				log.Println("ℹ️  ProPresenter integration disabled")
			}
		}
	}

	// Bible API configuration (optional)
	bibleAPIKey := os.Getenv("API_BIBLE_KEY")
	bibleBaseURL := os.Getenv("API_BIBLE_BASE_URL")

	// api.bible client (optional) + bundled local Bibles (always available).
	bibleClient := bible.New(&bible.Config{
		APIKey:  bibleAPIKey,
		BaseURL: bibleBaseURL,
	})
	bibleLocal := bible.NewLocalProvider()
	bibleHandler := bible.NewHandler(bibleClient, bibleLocal)
	if bibleClient.IsConfigured() {
		log.Println("Bible integration enabled (api.bible + local KJV/MOV)")
	} else {
		log.Println("Bible integration enabled (local KJV/MOV only — no API_BIBLE_KEY)")
	}

	// Initialize handlers
	h := handlers.New(db, ts, backupManager, ppClient, skipTypesense)

	// Initialize caption stream client (optional - only if JGM_CAPTIONS_URL is set)
	jgmCaptionsURL := os.Getenv("JGM_CAPTIONS_URL")
	if jgmCaptionsURL != "" {
		// Create caption handler that forwards to Bible parsing
		captionHandler := func(text string, timestamp string) {
			// Forward caption to the ReceiveCaption handler for Bible reference parsing
			log.Printf("📖 Received caption from stream: %s", text)
			h.ProcessCaptionText(text, timestamp)
		}

		// Create and start caption stream client
		streamClient := captionstream.NewClient(jgmCaptionsURL+"/audience/stream", captionHandler)
		if err := streamClient.Start(); err != nil {
			log.Printf("⚠️  Failed to start caption stream client: %v", err)
		} else {
			log.Printf("✅ Caption stream client started: %s", jgmCaptionsURL)
		}
	} else {
		log.Println("ℹ️  JGM_CAPTIONS_URL not set - caption stream disabled")
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:      "Audience Stage Teleprompter",
		ServerHeader: "AST",
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
		BodyLimit:    2 * 1024 * 1024, // 2MB — largest payload is song lyrics
	})

	// Middleware
	app.Use(recover.New())
	// The full song list is ~5MB of JSON (lyrics compress ~5x) — serve it gzipped.
	app.Use(compress.New(compress.Config{Level: compress.LevelBestSpeed}))
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${latency} ${method} ${path}\n",
	}))
	// CORS Configuration
	// Allow both Vercel frontend and local development
	allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		// Default: allow all for development
		allowedOrigins = "*"
	}

	app.Use(cors.New(cors.Config{
		AllowOrigins: allowedOrigins,
		AllowHeaders: "Origin, Content-Type, Accept, X-API-Key, Authorization",
		AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
	}))

	// Auth: everything behind login except health/login and key-authed routes.
	authSvc := auth.New(db.DB)
	authSvc.Bootstrap()
	app.Use(authSvc.Middleware())

	// Routes
	api := app.Group("/api")

	// Health check
	api.Get("/health", h.HealthCheck)

	// Auth
	api.Post("/auth/login", authSvc.Login)
	api.Get("/auth/me", authSvc.Me)
	api.Put("/auth/users/:username/password", auth.RequireAdmin, authSvc.SetPassword)

	// Songs CRUD
	api.Post("/songs", h.CreateSong)
	api.Get("/songs", h.GetAllSongs)
	api.Get("/songs/:id", h.GetSong)
	api.Put("/songs/:id", h.UpdateSong)
	api.Delete("/songs/:id", auth.RequireAdmin, h.DeleteSong)

	// Search
	api.Get("/search", h.SearchSongs)

	// Live output state (scripture on the LED wall via /output/bible)
	liveGroup := api.Group("/live")
	liveGroup.Get("/scripture", h.GetLiveScripture)
	liveGroup.Post("/scripture", h.SetLiveScripture)
	liveGroup.Delete("/scripture", h.ClearLiveScripture)
	liveGroup.Get("/suggestion", h.GetLiveSuggestion)
	liveGroup.Post("/suggestion", h.SetLiveSuggestion)
	liveGroup.Get("/output-config", h.GetOutputConfig)
	liveGroup.Put("/output-config", h.SetOutputConfig)

	// Queue management
	api.Get("/queue", h.GetQueue)
	api.Post("/queue", h.AddToQueue)
	api.Delete("/queue/:id", h.RemoveFromQueue)
	api.Delete("/queue/song/:song_id", h.RemoveFromQueueBySong)
	api.Put("/queue/reorder", h.ReorderQueue)
	api.Post("/queue/clear", h.ClearQueue)

	// Admin
	admin := api.Group("/admin", auth.RequireAdmin)
	admin.Post("/reindex", h.ReindexAll)
	admin.Get("/edit-logs", h.GetEditLogs)
	admin.Get("/backups", h.GetBackups)
	admin.Post("/backups", h.CreateBackup)

	// Settings
	api.Get("/settings", h.GetSettings)
	api.Put("/settings", auth.RequireAdmin, h.UpdateSettings)

	// ProPresenter integration
	pp := api.Group("/propresenter")
	pp.Get("/status", h.ProPresenterStatus)
	pp.Get("/library", h.ProPresenterLibrary)
	pp.Get("/playlists", h.ProPresenterPlaylists)
	pp.Post("/queue", h.ProPresenterSendToQueue)
	pp.Post("/trigger", h.ProPresenterTrigger)
	pp.Post("/next", h.ProPresenterNextSlide)
	pp.Post("/previous", h.ProPresenterPreviousSlide)
	pp.Post("/clear", h.ProPresenterClear)

	// Bible API routes (api.bible proxy + bundled local KJV/MOV)
	bibleGroup := api.Group("/bible")
	bibleGroup.Get("/bibles", bibleHandler.GetBibles)
	bibleGroup.Get("/bibles/:bibleId/books", bibleHandler.GetBooks)
	bibleGroup.Get("/bibles/:bibleId/books/:bookId/chapters", bibleHandler.GetChapters)
	bibleGroup.Get("/bibles/:bibleId/chapters/:chapterId", bibleHandler.GetChapter)
	bibleGroup.Get("/bibles/:bibleId/verses/:verseId", bibleHandler.GetVerse)
	bibleGroup.Get("/bibles/:bibleId/passages/:passageId", bibleHandler.GetPassage)

	// Captions integration (from Jgm-live-captions)
	api.Post("/caption", h.ReceiveCaption)
	api.Get("/bible/sse", h.BibleSSE) // Server-Sent Events for Bible verses

	// Bible references from remote parser (for VPS deployment)
	api.Post("/bible-references", h.ReceiveParsedReferences)

	// Start server
	log.Printf("Server starting on port %s", port)
	log.Printf("Backup directory: %s", backupDir)
	log.Printf("Database connected")
	if !skipTypesense {
		log.Printf("Typesense host: %s", typesenseHost)
	}

	if err := app.Listen(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
