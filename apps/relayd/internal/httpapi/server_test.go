package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/directory"
	"github.com/cradle/relayd/internal/fabric"
	"github.com/cradle/relayd/internal/membership"
	"github.com/cradle/relayd/internal/relay"
)

func TestHealth(t *testing.T) {
	server := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, expected 200", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("body = %q, expected ok", rec.Body.String())
	}
}

func TestMetricsExposeRuntimeAndRelayCollectors(t *testing.T) {
	server := newTestServer(t)
	health := httptest.NewRecorder()
	server.Handler().ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, expected 200", rec.Code)
	}
	for _, metricName := range []string{
		"go_goroutines",
		"process_resident_memory_bytes",
		"cradle_relayd_build_info",
		"cradle_relayd_http_requests_total",
		"cradle_relayd_queue_bytes",
	} {
		if !strings.Contains(rec.Body.String(), metricName) {
			t.Errorf("metrics response does not contain %q", metricName)
		}
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	cfg := config.Config{
		ListenAddr:         "127.0.0.1:0",
		PublicURL:          "http://127.0.0.1:0",
		FabricDatabasePath: t.TempDir() + "/fabric.sqlite",
		ReadTimeout:        time.Second,
		WriteTimeout:       time.Second,
		AssertionMaxSkew:   time.Minute,
		MaxFrameBytes:      1024,
		MaxQueuedEnvelopes: 4,
		MaxQueuedBytes:     4096,
		MetricsEnabled:     true,
		PprofEnabled:       false,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	store, err := fabric.OpenStore(fabric.StoreConfig{Path: cfg.FabricDatabasePath})
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	t.Cleanup(func() { store.Close() })
	fabricDirectory, err := directory.NewServer(directory.Config{
		Store:     store,
		Validator: membership.NewValidator(time.Now, cfg.AssertionMaxSkew),
		Links: relay.NewFabricHub(relay.FabricHubConfig{
			MaxFrameBytes:      cfg.MaxFrameBytes,
			MaxQueuedEnvelopes: cfg.MaxQueuedEnvelopes,
			MaxQueuedBytes:     cfg.MaxQueuedBytes,
		}),
	})
	if err != nil {
		t.Fatalf("directory.NewServer() error = %v", err)
	}
	server, err := NewServer(ServerConfig{
		Config:    cfg,
		Directory: fabricDirectory,
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	return server
}
