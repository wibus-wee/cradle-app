// Package httpapi assembles relayd's HTTP surface: health probes, optional
// metrics/pprof, and the Fabric directory control plane. All room and pairing
// endpoints were removed with the legacy transport; the Fabric directory is
// the only control plane.
package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/pprof"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/directory"
	"github.com/cradle/relayd/internal/metrics"
)

type ServerConfig struct {
	Config    config.Config
	Directory *directory.Server
	Metrics   *metrics.Metrics
	Logger    *slog.Logger
}

type Server struct {
	cfg       config.Config
	directory *directory.Server
	metrics   *metrics.Metrics
	logger    *slog.Logger
	mux       *http.ServeMux
}

func NewServer(cfg ServerConfig) (*Server, error) {
	if cfg.Directory == nil {
		return nil, errors.New("httpapi: directory is required")
	}
	if cfg.Metrics == nil {
		cfg.Metrics = metrics.New("dev")
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	s := &Server{
		cfg:       cfg.Config,
		directory: cfg.Directory,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger,
		mux:       http.NewServeMux(),
	}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return s.metrics.InstrumentHTTP(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /readyz", s.ready)
	s.directory.Register(s.mux)
	if s.cfg.MetricsEnabled {
		s.mux.Handle("GET /metrics", s.metrics)
	}
	if s.cfg.PprofEnabled {
		s.mux.HandleFunc("GET /debug/pprof/", pprof.Index)
		s.mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
		s.mux.HandleFunc("GET /debug/pprof/profile", pprof.Profile)
		s.mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
		s.mux.HandleFunc("GET /debug/pprof/trace", pprof.Trace)
	}
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte("ok")); err != nil {
		s.logger.Warn("writing health response failed", "error", err)
	}
}

func (s *Server) ready(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte("ok")); err != nil {
		s.logger.Warn("writing readiness response failed", "error", err)
	}
}
