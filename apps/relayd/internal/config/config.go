package config

import (
	"errors"
	"fmt"
	"time"
)

// DefaultDevHMACSecret is the built-in HMAC secret used when no
// CRADLE_RELAYD_DEV_HMAC_SECRET / CRADLE_RELAY_HMAC_SECRET is configured.
//
// It is a publicly known, dev-only value: it lets `go run ./cmd/relayd` start
// with zero configuration and lets Cradle Server validate relay tokens out of
// the box for local development. It MUST NOT be used in production — set the
// HMAC secret env var on both sides for any non-local deployment. The value is
// duplicated verbatim in the Cradle Server relay token service so the two
// services agree on the dev default; keep them in sync.
const DefaultDevHMACSecret = "cradle-dev-relay-insecure-secret-do-not-use-in-production"

type Config struct {
	ListenAddr         string
	PublicURL          string
	TokenIssuer        string
	TokenAudience      string
	DevHMACSecret      string
	// DevHMACSecretResolved is true when DevHMACSecret came from the built-in
	// dev default rather than an explicit env/flag. Lets the entrypoint warn.
	DevHMACSecretResolved bool
	PairingTTL            time.Duration
	RoomTTL               time.Duration
	HeartbeatInterval     time.Duration
	IdleTimeout           time.Duration
	ReadTimeout           time.Duration
	WriteTimeout          time.Duration
	MaxFrameBytes         int64
	MaxQueuedEnvelopes    int
	MaxQueuedBytes        int64
	MaxRooms              int
	MetricsEnabled        bool
	PprofEnabled          bool
}

func (c Config) Validate() error {
	if c.ListenAddr == "" {
		return errors.New("listen address is required")
	}
	if c.PublicURL == "" {
		return errors.New("public url is required")
	}
	if c.TokenIssuer == "" {
		return errors.New("token issuer is required")
	}
	if c.TokenAudience == "" {
		return errors.New("token audience is required")
	}
	if c.DevHMACSecret == "" {
		return errors.New("development HMAC secret is required")
	}
	if c.PairingTTL <= 0 {
		return fmt.Errorf("pairing ttl must be positive")
	}
	if c.RoomTTL <= 0 {
		return fmt.Errorf("room ttl must be positive")
	}
	if c.HeartbeatInterval <= 0 {
		return fmt.Errorf("heartbeat interval must be positive")
	}
	if c.IdleTimeout <= c.HeartbeatInterval {
		return fmt.Errorf("idle timeout must be greater than heartbeat interval")
	}
	if c.ReadTimeout <= 0 {
		return fmt.Errorf("read timeout must be positive")
	}
	if c.WriteTimeout <= 0 {
		return fmt.Errorf("write timeout must be positive")
	}
	if c.MaxFrameBytes <= 0 {
		return fmt.Errorf("max frame bytes must be positive")
	}
	if c.MaxQueuedEnvelopes <= 0 {
		return fmt.Errorf("max queued envelopes must be positive")
	}
	if c.MaxQueuedBytes <= 0 {
		return fmt.Errorf("max queued bytes must be positive")
	}
	if c.MaxRooms <= 0 {
		return fmt.Errorf("max rooms must be positive")
	}
	return nil
}
