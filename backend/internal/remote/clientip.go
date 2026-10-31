package remote

import (
	"net"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// ClientIP returns the caller's IP. Behind the TLS reverse proxy every peer is
// loopback, so only then is X-Forwarded-For consulted — and only its RIGHTMOST
// entry (the one the proxy appended); leftmost entries are client-controlled.
func ClientIP(c *fiber.Ctx) string {
	return clientIPFrom(c.Context().RemoteIP(), c.Get(fiber.HeaderXForwardedFor))
}

func clientIPFrom(peer net.IP, xff string) string {
	peerStr := ""
	if peer != nil {
		peerStr = peer.String()
	}
	if peer == nil || !peer.IsLoopback() || xff == "" {
		return peerStr
	}
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		p := strings.TrimSpace(parts[i])
		if p == "" {
			continue
		}
		if ip := net.ParseIP(p); ip != nil {
			return ip.String()
		}
		return peerStr
	}
	return peerStr
}
