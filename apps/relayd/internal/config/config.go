package config

import (
	"errors"
	"fmt"
	"time"
)

type Config struct {
	ListenAddr            string
	PublicURL             string
	FabricDatabasePath    string
	PairingTTL            time.Duration
	RoomTTL               time.Duration
	HeartbeatInterval     time.Duration
	IdleTimeout           time.Duration
	ReadTimeout           time.Duration
	WriteTimeout          time.Duration
	AssertionMaxSkew      time.Duration
	PairingStartRateLimit int
	PairingClaimRateLimit int
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
	if c.FabricDatabasePath == "" {
		return errors.New("fabric database path is required")
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
	if c.AssertionMaxSkew <= 0 {
		return fmt.Errorf("assertion max skew must be positive")
	}
	if c.PairingStartRateLimit <= 0 {
		return fmt.Errorf("pairing start rate limit must be positive")
	}
	if c.PairingClaimRateLimit <= 0 {
		return fmt.Errorf("pairing claim rate limit must be positive")
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
