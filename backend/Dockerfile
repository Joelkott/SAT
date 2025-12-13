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

# Note: Migrations are not copied here - they will be run manually via Railway database connection
# This avoids build issues if migrations directory isn't in build context
RUN mkdir -p ./migrations

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server/main.go

# Final stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates for HTTPS requests and postgresql-client for backups
RUN apk --no-cache add ca-certificates postgresql-client

# Copy the binary from builder
COPY --from=builder /app/server .

# Create migrations directory (migrations run manually via Railway)
RUN mkdir -p ./migrations

# Create backups directory
RUN mkdir -p /app/backups

# Expose port
EXPOSE 8080

# Run the application
CMD ["./server"]

