package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
	"github.com/yourusername/audience-stage-teleprompter/internal/backup"
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

	// Typesense is optional - can be disabled
	disableTypesense := os.Getenv("DISABLE_TYPESENSE") == "true"
	typesenseAPIKey := os.Getenv("TYPESENSE_API_KEY")
	typesenseHost := os.Getenv("TYPESENSE_HOST")
	
	var ts *typesense.Client
	if !disableTypesense {
		if typesenseAPIKey == "" {
			log.Fatal("TYPESENSE_API_KEY environment variable is required (or set DISABLE_TYPESENSE=true)")
		}
		if typesenseHost == "" {
			log.Fatal("TYPESENSE_HOST environment variable is required (or set DISABLE_TYPESENSE=true)")
		}
	}

	backupDir := os.Getenv("BACKUP_DIR")
	if backupDir == "" {
		backupDir = "./backups"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Check if we should skip Typesense indexing during import
	skipTypesense := os.Getenv("SKIP_TYPESENSE") == "true"
	if skipTypesense {
		log.Println("⚠️  SKIP_TYPESENSE enabled - songs will NOT be indexed in Typesense during creation")
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

	// Initialize Typesense (optional)
	if !disableTypesense {
		ts, err = typesense.New(typesenseAPIKey, typesenseHost)
		if err != nil {
			log.Fatalf("Failed to initialize Typesense: %v", err)
		}
		log.Println("Typesense client initialized")
	} else {
		log.Println("⚠️  Typesense is disabled - search will use PostgreSQL")
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

	// Initialize handlers
	h := handlers.New(db, ts, backupManager, ppClient, skipTypesense)

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:      "Audience Stage Teleprompter",
		ServerHeader: "AST",
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${latency} ${method} ${path}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	// Routes
	api := app.Group("/api")

	// Health check
	api.Get("/health", h.HealthCheck)

	// Songs CRUD
	api.Post("/songs", h.CreateSong)
	api.Get("/songs", h.GetAllSongs)
	api.Get("/songs/:id", h.GetSong)
	api.Put("/songs/:id", h.UpdateSong)
	api.Delete("/songs/:id", h.DeleteSong)

	// Search
	api.Get("/search", h.SearchSongs)

	// Queue management
	api.Get("/queue", h.GetQueue)
	api.Post("/queue", h.AddToQueue)
	api.Delete("/queue/:id", h.RemoveFromQueue)
	api.Delete("/queue/song/:song_id", h.RemoveFromQueueBySong)
	api.Put("/queue/reorder", h.ReorderQueue)
	api.Post("/queue/clear", h.ClearQueue)

	// Admin
	admin := api.Group("/admin")
	admin.Post("/reindex", h.ReindexAll)
	admin.Get("/backups", h.GetBackups)
	admin.Post("/backups", h.CreateBackup)

	// Settings
	api.Get("/settings", h.GetSettings)
	api.Put("/settings", h.UpdateSettings)

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

	// Start server
	log.Printf("Server starting on port %s", port)
	log.Printf("Backup directory: %s", backupDir)
	log.Printf("Database connected: %s", dbDSN)
	if !disableTypesense {
		log.Printf("Typesense host: %s", typesenseHost)
	}

	if err := app.Listen(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
