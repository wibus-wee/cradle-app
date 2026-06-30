package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/httpapi"
	"github.com/cradle/relayd/internal/metrics"
	"github.com/cradle/relayd/internal/pairing"
	"github.com/cradle/relayd/internal/relay"
	"github.com/cradle/relayd/internal/token"
)

var relaydVersion = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("relayd exited", "error", err)
		os.Exit(1)
	}
}

func run() error {
	var cfg config.Config
	var showVersion bool
	flag.StringVar(&cfg.ListenAddr, "listen", envString("CRADLE_RELAYD_LISTEN", "127.0.0.1:8787"), "HTTP listen address")
	flag.StringVar(&cfg.PublicURL, "public-url", envString("CRADLE_RELAYD_PUBLIC_URL", "http://127.0.0.1:8787"), "public relay URL")
	flag.StringVar(&cfg.TokenIssuer, "token-issuer", envString("CRADLE_RELAYD_TOKEN_ISSUER", "cradle-server"), "expected token issuer")
	flag.StringVar(&cfg.TokenAudience, "token-audience", envString("CRADLE_RELAYD_TOKEN_AUDIENCE", "cradle-relay"), "expected token audience")
	flag.StringVar(&cfg.DevHMACSecret, "dev-hmac-secret", envString("CRADLE_RELAYD_DEV_HMAC_SECRET", envString("CRADLE_RELAY_HMAC_SECRET", "")), "HMAC token secret (required in production; defaults to a built-in dev secret for local use)")
	flag.DurationVar(&cfg.PairingTTL, "pairing-ttl", envDuration("CRADLE_RELAYD_PAIRING_TTL", 5*time.Minute), "pairing code TTL")
	flag.DurationVar(&cfg.RoomTTL, "room-ttl", envDuration("CRADLE_RELAYD_ROOM_TTL", 30*time.Minute), "room TTL")
	flag.DurationVar(&cfg.HeartbeatInterval, "heartbeat-interval", envDuration("CRADLE_RELAYD_HEARTBEAT_INTERVAL", 15*time.Second), "WebSocket heartbeat interval")
	flag.DurationVar(&cfg.IdleTimeout, "idle-timeout", envDuration("CRADLE_RELAYD_IDLE_TIMEOUT", 45*time.Second), "WebSocket idle timeout")
	flag.DurationVar(&cfg.ReadTimeout, "read-timeout", envDuration("CRADLE_RELAYD_READ_TIMEOUT", 10*time.Second), "HTTP read timeout")
	flag.DurationVar(&cfg.WriteTimeout, "write-timeout", envDuration("CRADLE_RELAYD_WRITE_TIMEOUT", 10*time.Second), "HTTP write timeout")
	flag.Int64Var(&cfg.MaxFrameBytes, "max-frame-bytes", envInt64("CRADLE_RELAYD_MAX_FRAME_BYTES", 1<<20), "maximum WebSocket frame bytes")
	flag.IntVar(&cfg.MaxQueuedEnvelopes, "max-queued-envelopes", envInt("CRADLE_RELAYD_MAX_QUEUED_ENVELOPES", 64), "maximum queued envelopes per connection")
	flag.Int64Var(&cfg.MaxQueuedBytes, "max-queued-bytes", envInt64("CRADLE_RELAYD_MAX_QUEUED_BYTES", 4<<20), "maximum queued bytes per connection")
	flag.IntVar(&cfg.MaxRooms, "max-rooms", envInt("CRADLE_RELAYD_MAX_ROOMS", 1024), "maximum live rooms")
	flag.BoolVar(&cfg.MetricsEnabled, "metrics", envBool("CRADLE_RELAYD_METRICS", true), "enable /metrics")
	flag.BoolVar(&cfg.PprofEnabled, "pprof", envBool("CRADLE_RELAYD_PPROF", false), "enable /debug/pprof")
	flag.BoolVar(&showVersion, "version", false, "print relayd version and exit")
	flag.Parse()

	if showVersion {
		fmt.Println(relaydVersion)
		return nil
	}

	var err error
	cfg.DevHMACSecret, cfg.DevHMACSecretResolved, err = resolveDevHMACSecret(cfg.DevHMACSecret, isProductionEnvironment())
	if err != nil {
		return err
	}

	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("validating config: %w", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))
	slog.SetDefault(logger)

	if cfg.DevHMACSecretResolved {
		logger.Warn("using built-in development HMAC secret; this is insecure and must not be used in production; set CRADLE_RELAYD_DEV_HMAC_SECRET (and CRADLE_RELAY_HMAC_SECRET on the server) to a strong secret")
	}

	validator, err := token.NewHMACValidator(token.HMACValidatorConfig{
		Secret:   []byte(cfg.DevHMACSecret),
		Issuer:   cfg.TokenIssuer,
		Audience: cfg.TokenAudience,
		Now:      time.Now,
	})
	if err != nil {
		return fmt.Errorf("creating token validator: %w", err)
	}

	counterSet := metrics.New()
	pairingStore := pairing.NewStore(pairing.StoreConfig{
		CodeTTL: cfg.PairingTTL,
		Now:     time.Now,
	})
	hub := relay.NewHub(relay.HubConfig{
		RoomTTL:            cfg.RoomTTL,
		MaxRooms:           cfg.MaxRooms,
		MaxFrameBytes:      cfg.MaxFrameBytes,
		MaxQueuedEnvelopes: cfg.MaxQueuedEnvelopes,
		MaxQueuedBytes:     cfg.MaxQueuedBytes,
		HeartbeatInterval:  cfg.HeartbeatInterval,
		IdleTimeout:        cfg.IdleTimeout,
		Now:                time.Now,
		Metrics:            counterSet,
		Logger:             logger,
	})
	api, err := httpapi.NewServer(httpapi.ServerConfig{
		Config:    cfg,
		Validator: validator,
		Pairings:  pairingStore,
		Hub:       hub,
		Metrics:   counterSet,
		Logger:    logger,
	})
	if err != nil {
		return fmt.Errorf("creating HTTP API: %w", err)
	}

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: cfg.ReadTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("starting relayd", "listen", cfg.ListenAddr, "publicUrl", cfg.PublicURL)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("serving HTTP: %w", err)
		}
		return nil
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutting down HTTP server: %w", err)
	}
	if err := <-errCh; err != nil {
		return fmt.Errorf("serving HTTP: %w", err)
	}
	return nil
}

func resolveDevHMACSecret(value string, production bool) (string, bool, error) {
	if value != "" {
		return value, false, nil
	}
	if production {
		return "", false, errors.New("HMAC token secret is required in production; set CRADLE_RELAYD_DEV_HMAC_SECRET or CRADLE_RELAY_HMAC_SECRET")
	}
	return config.DefaultDevHMACSecret, true, nil
}

func isProductionEnvironment() bool {
	return strings.EqualFold(os.Getenv("NODE_ENV"), "production") || strings.EqualFold(os.Getenv("CRADLE_ENV"), "production")
}

func envString(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return fallback
	}
	return parsed
}

func envInt64(name string, fallback int64) int64 {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	var parsed int64
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value := os.Getenv(name)
	switch value {
	case "":
		return fallback
	case "1", "true", "TRUE", "yes", "YES":
		return true
	case "0", "false", "FALSE", "no", "NO":
		return false
	default:
		return fallback
	}
}
