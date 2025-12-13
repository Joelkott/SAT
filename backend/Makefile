.PHONY: help install run build migrate-up migrate-down clean

help:
	@echo "Available commands:"
	@echo "  make install     - Install Go dependencies"
	@echo "  make run         - Run the server"
	@echo "  make build       - Build the server binary"
	@echo "  make migrate-up  - Run database migrations"
	@echo "  make clean       - Clean build artifacts"

install:
	go mod download
	go mod tidy

run:
	go run cmd/server/main.go

build:
	go build -o bin/server cmd/server/main.go

migrate-up:
	psql $(DATABASE_URL) < migrations/001_create_songs_table.sql

clean:
	rm -rf bin/
	rm -rf backups/
