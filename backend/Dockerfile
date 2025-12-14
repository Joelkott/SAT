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

# Install dependencies including Tailscale for ProPresenter connectivity
# Install Tailscale directly via apk (works better in containers than the install script)
RUN apk --no-cache add \
    ca-certificates \
    postgresql-client \
    curl \
    iptables \
    ip6tables \
    tailscale

# Copy the binary from builder
COPY --from=builder /app/server .

# Copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create directories
RUN mkdir -p ./migrations
RUN mkdir -p /app/backups
RUN mkdir -p /var/lib/tailscale
RUN mkdir -p /var/run/tailscale

# Expose port
EXPOSE 8080

# Run start script (starts Tailscale then server)
CMD ["/app/start.sh"]

