#!/bin/sh
# Don't use set -e - we want the backend to start even if Tailscale fails
set +e

echo "🚀 Starting backend server..."

# Initialize Tailscale ready flag
TAILSCALE_READY=false

# Start Tailscale daemon in background with userspace networking (for containers)
# Only if TAILSCALE_AUTH_KEY is provided (optional feature)
if [ ! -z "$TAILSCALE_AUTH_KEY" ]; then
    echo "Starting Tailscale daemon..."
    tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock 2>/dev/null &
    TAILSCALED_PID=$!

    # Wait for tailscaled to be ready (non-blocking - don't fail if it doesn't start)
    echo "Waiting for Tailscale daemon..."
    for i in $(seq 1 10); do
        if tailscale status >/dev/null 2>&1; then
            echo "✅ Tailscale daemon ready"
            TAILSCALE_READY=true
            break
        fi
        sleep 1
    done
    
    if [ "$TAILSCALE_READY" = "false" ]; then
        echo "⚠️  Tailscale daemon failed to start (non-critical, continuing without it)"
    fi
else
    echo "ℹ️  Tailscale not configured (TAILSCALE_AUTH_KEY not set)"
fi

# Authenticate with Tailscale if auth key provided and daemon is ready
if [ ! -z "$TAILSCALE_AUTH_KEY" ] && [ "$TAILSCALE_READY" = "true" ]; then
    echo "Authenticating with Tailscale..."
    tailscale up \
        --authkey="$TAILSCALE_AUTH_KEY" \
        --hostname=railway-teleprompter-backend \
        --accept-routes \
        --accept-dns=false 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Tailscale connected"
    else
        echo "⚠️  Tailscale authentication failed, continuing anyway..."
    fi
elif [ ! -z "$TAILSCALE_AUTH_KEY" ]; then
    echo "⚠️  Tailscale daemon not ready, ProPresenter integration won't work"
fi

# Check ProPresenter connectivity if enabled (non-blocking)
if [ "$PROPRESENTER_ENABLED" = "true" ] && [ ! -z "$PROPRESENTER_HOST" ]; then
    echo "Testing ProPresenter connection at $PROPRESENTER_HOST:$PROPRESENTER_PORT..."
    if nc -z -w3 "$PROPRESENTER_HOST" "$PROPRESENTER_PORT" 2>/dev/null; then
        echo "✅ ProPresenter is reachable"
    else
        echo "⚠️  Cannot reach ProPresenter at $PROPRESENTER_HOST:$PROPRESENTER_PORT"
        echo "   Make sure Tailscale is running on both machines"
        echo "   Backend will continue - ProPresenter sync will be attempted on-demand"
    fi
fi

echo "🎬 Starting backend server..."
exec ./server

