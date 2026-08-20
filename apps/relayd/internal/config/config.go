package config

import (
	"errors"
	"fmt"
	"time"
)

type Config struct {
	ListenAddr         string
	PublicURL          string
	FabricDatabasePath string
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	AssertionMaxSkew   time.Duration
	MaxFrameBytes      int64
	MaxQueuedEnvelopes int
	MaxQueuedBytes     int64
	MetricsEnabled     bool
	PprofEnabled       bool
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
	if c.ReadTimeout <= 0 {
		return fmt.Errorf("read timeout must be positive")
	}
	if c.WriteTimeout <= 0 {
		return fmt.Errorf("write timeout must be positive")
	}
	if c.AssertionMaxSkew <= 0 {
		return fmt.Errorf("assertion max skew must be positive")
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
	return nil
}
