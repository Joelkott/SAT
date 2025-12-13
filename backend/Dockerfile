# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files first
COPY go.mod ./
COPY go.sum* ./
# Download dependencies (go.sum is optional, will be generated if missing)
RUN go mod download

# Copy all source code
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY Makefile ./Makefile

# Copy migrations - create directory and copy SQL file directly
RUN mkdir -p ./migrations
COPY migrations/001_create_songs_table.sql ./migrations/

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server/main.go

# Final stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS requests and postgresql-client for backups
RUN apk --no-cache add ca-certificates postgresql-client

# Copy the binary from builder
COPY --from=builder /app/server .

# Copy migrations directory (will fail if it doesn't exist, but it should)
COPY --from=builder /app/migrations ./migrations

# Create backups directory
RUN mkdir -p /app/backups

# Expose port
EXPOSE 8080

# Run the application
CMD ["./server"]

