#!/bin/sh
set -e

echo "🚀 Starting Tailscale-enabled backend..."

# Start Tailscale daemon in background with userspace networking (for containers)
echo "Starting Tailscale daemon..."
tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &
TAILSCALED_PID=$!

# Wait for tailscaled to be ready
echo "Waiting for Tailscale daemon..."
for i in $(seq 1 30); do
    if tailscale status >/dev/null 2>&1; then
        echo "✅ Tailscale daemon ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Tailscale daemon failed to start"
        exit 1
    fi
    sleep 1
done

# Authenticate with Tailscale if auth key provided
if [ ! -z "$TAILSCALE_AUTH_KEY" ]; then
    echo "Authenticating with Tailscale..."
    tailscale up \
        --authkey="$TAILSCALE_AUTH_KEY" \
        --hostname=railway-teleprompter-backend \
        --accept-routes \
        --accept-dns=false
    
    if [ $? -eq 0 ]; then
        echo "✅ Tailscale connected"
        tailscale status
    else
        echo "⚠️  Tailscale authentication failed, continuing anyway..."
    fi
else
    echo "⚠️  No TAILSCALE_AUTH_KEY provided, ProPresenter integration won't work"
    echo "   Generate one at: https://login.tailscale.com/admin/settings/keys"
fi

# Check ProPresenter connectivity if enabled
if [ "$PROPRESENTER_ENABLED" = "true" ] && [ ! -z "$PROPRESENTER_HOST" ]; then
    echo "Testing ProPresenter connection at $PROPRESENTER_HOST:$PROPRESENTER_PORT..."
    if nc -z -w5 "$PROPRESENTER_HOST" "$PROPRESENTER_PORT" 2>/dev/null; then
        echo "✅ ProPresenter is reachable"
    else
        echo "⚠️  Cannot reach ProPresenter at $PROPRESENTER_HOST:$PROPRESENTER_PORT"
        echo "   Make sure Tailscale is running on both machines"
    fi
fi

echo "🎬 Starting backend server..."
exec ./server

