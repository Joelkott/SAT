package remote

import (
	"net"
	"testing"
)

func TestClientIPFrom(t *testing.T) {
	cases := []struct {
		name string
		peer string
		xff  string
		want string
	}{
		{"loopback rightmost", "127.0.0.1", "1.2.3.4, 5.6.7.8", "5.6.7.8"},
		{"loopback no xff", "127.0.0.1", "", "127.0.0.1"},
		{"ipv6 loopback", "::1", "9.9.9.9", "9.9.9.9"},
		{"non-loopback ignores xff", "203.0.113.7", "1.2.3.4", "203.0.113.7"},
		{"loopback garbage xff", "127.0.0.1", "not-an-ip", "127.0.0.1"},
		{"loopback trailing comma", "127.0.0.1", "1.2.3.4, 5.6.7.8, ", "5.6.7.8"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := clientIPFrom(net.ParseIP(tc.peer), tc.xff)
			if got != tc.want {
				t.Fatalf("clientIPFrom(%s,%q)=%q want %q", tc.peer, tc.xff, got, tc.want)
			}
		})
	}
}
