# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server/main.go

# Final stage
FROM alpine:latest

WORKDIR /app

# ca-certificates for HTTPS, postgresql-client for backups, tzdata so the
# 2 AM backup scheduler uses local time (set TZ in docker-compose).
RUN apk --no-cache add ca-certificates postgresql-client tzdata

# Copy the binary from builder
COPY --from=builder /app/server .
# Note: migrations are mounted from host in docker-compose.yml, so no need to copy here

# Create backups directory
RUN mkdir -p /app/backups

# Expose port
EXPOSE 8080

# Run the application
CMD ["./server"]

