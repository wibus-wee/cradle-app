package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/pprof"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/directory"
	"github.com/cradle/relayd/internal/metrics"
	"github.com/cradle/relayd/internal/pairing"
	"github.com/cradle/relayd/internal/relay"
	"github.com/cradle/relayd/internal/token"
)

const maxJSONBodyBytes = 64 << 10
const assertionHeader = "X-Cradle-Relay-Assertion"
const signatureHeader = "X-Cradle-Relay-Signature"

type ServerConfig struct {
	Config    config.Config
	Validator token.Validator
	Pairings  *pairing.Store
	Hub       *relay.Hub
	Directory *directory.Server
	Metrics   *metrics.Counters
	Logger    *slog.Logger
}

type Server struct {
	cfg                 config.Config
	validator           token.Validator
	pairings            *pairing.Store
	hub                 *relay.Hub
	directory           *directory.Server
	metrics             *metrics.Counters
	logger              *slog.Logger
	mux                 *http.ServeMux
	pairingStartLimiter *rateLimiter
	pairingClaimLimiter *rateLimiter
}

type startRequest struct {
	Assertion token.SignedAssertion `json:"assertion"`
}

type startResponse struct {
	RoomID      string    `json:"roomId"`
	PairingCode string    `json:"pairingCode"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type claimRequest struct {
	Assertion token.SignedAssertion `json:"assertion"`
}

type claimResponse struct {
	RoomID    string    `json:"roomId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type hostSessionRequest struct {
	Assertion token.SignedAssertion `json:"assertion"`
}

type hostSessionResponse struct {
	RoomID    string    `json:"roomId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func NewServer(cfg ServerConfig) (*Server, error) {
	if cfg.Validator == nil {
		return nil, errors.New("httpapi: validator is required")
	}
	if cfg.Pairings == nil {
		return nil, errors.New("httpapi: pairings store is required")
	}
	if cfg.Hub == nil {
		return nil, errors.New("httpapi: hub is required")
	}
	if cfg.Metrics == nil {
		cfg.Metrics = metrics.New()
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	s := &Server{
		cfg:                 cfg.Config,
		validator:           cfg.Validator,
		pairings:            cfg.Pairings,
		hub:                 cfg.Hub,
		directory:           cfg.Directory,
		metrics:             cfg.Metrics,
		logger:              cfg.Logger,
		mux:                 http.NewServeMux(),
		pairingStartLimiter: newRateLimiter(cfg.Config.PairingStartRateLimit, time.Minute, time.Now),
		pairingClaimLimiter: newRateLimiter(cfg.Config.PairingClaimRateLimit, time.Minute, time.Now),
	}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /readyz", s.ready)
	s.mux.HandleFunc("POST /pairing/start", s.startPairing)
	s.mux.HandleFunc("POST /pairing/claim", s.claimPairing)
	s.mux.HandleFunc("POST /rooms/host-session", s.startHostSession)
	s.mux.HandleFunc("GET /ws/host", s.hostWebSocket)
	s.mux.HandleFunc("GET /ws/controller", s.controllerWebSocket)
	if s.directory != nil {
		s.directory.Register(s.mux)
	}
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

func (s *Server) startPairing(w http.ResponseWriter, r *http.Request) {
	if !s.allowPairingRequest(w, r, s.pairingStartLimiter) {
		return
	}
	var body startRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	assertion, ok := s.validateAssertion(w, r, body.Assertion, token.ExpectedAssertion{
		Role:    token.RoleHost,
		Purpose: token.PurposeCreateRoom,
	})
	if !ok {
		return
	}

	started, err := s.pairings.Start(r.Context(), pairing.StartInput{
		RoomID:     assertion.RoomID,
		HostPubkey: assertion.Pubkey,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not start pairing")
		return
	}
	if err := s.hub.CreateRoom(r.Context(), started.RoomID, started.ExpiresAt.Add(s.cfg.RoomTTL), assertion.Pubkey, ""); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not create room")
		return
	}
	s.metrics.PairingStarts.Add(1)
	writeJSON(w, http.StatusOK, startResponse{
		RoomID:      started.RoomID,
		PairingCode: started.PairingCode,
		ExpiresAt:   started.ExpiresAt,
	})
}

func (s *Server) claimPairing(w http.ResponseWriter, r *http.Request) {
	if !s.allowPairingRequest(w, r, s.pairingClaimLimiter) {
		return
	}
	var body claimRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	assertion, ok := s.validateAssertion(w, r, body.Assertion, token.ExpectedAssertion{
		Role:    token.RoleController,
		Purpose: token.PurposeClaim,
	})
	if !ok {
		return
	}
	if assertion.PairingCode == "" {
		writeError(w, http.StatusBadRequest, "pairing code is required")
		return
	}
	claimed, err := s.pairings.Claim(r.Context(), pairing.ClaimInput{
		Code:             assertion.PairingCode,
		RoomID:           assertion.RoomID,
		ControllerPubkey: assertion.Pubkey,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid pairing code")
		return
	}
	if err := s.hub.SetControllerPubkey(r.Context(), claimed.RoomID, assertion.Pubkey); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not claim room")
		return
	}
	s.metrics.PairingClaims.Add(1)
	writeJSON(w, http.StatusOK, claimResponse{
		RoomID:    claimed.RoomID,
		ExpiresAt: claimed.ExpiresAt,
	})
}

func (s *Server) startHostSession(w http.ResponseWriter, r *http.Request) {
	var body hostSessionRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	assertion, ok := s.validateAssertion(w, r, body.Assertion, token.ExpectedAssertion{
		Role:    token.RoleHost,
		Purpose: token.PurposeReconnect,
	})
	if !ok {
		return
	}
	expiresAt := time.Now().Add(s.cfg.AssertionMaxSkew)
	if err := s.hub.CreateRoom(r.Context(), assertion.RoomID, expiresAt.Add(s.cfg.RoomTTL), assertion.Pubkey, assertion.ControllerPubkey); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not create room")
		return
	}
	writeJSON(w, http.StatusOK, hostSessionResponse{
		RoomID:    assertion.RoomID,
		ExpiresAt: expiresAt,
	})
}

func (s *Server) hostWebSocket(w http.ResponseWriter, r *http.Request) {
	s.acceptWebSocket(w, r, token.RoleHost)
}

func (s *Server) controllerWebSocket(w http.ResponseWriter, r *http.Request) {
	s.acceptWebSocket(w, r, token.RoleController)
}

func (s *Server) acceptWebSocket(w http.ResponseWriter, r *http.Request, role token.Role) {
	signed, ok := token.SignedAssertionFromHeaders(r.Header.Get(assertionHeader), r.Header.Get(signatureHeader))
	if !ok {
		s.metrics.AuthFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "missing relay assertion")
		return
	}
	assertion, ok := s.validateAssertion(w, r, signed, token.ExpectedAssertion{
		Role:    role,
		Purpose: token.PurposeWebSocket,
	})
	if !ok {
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		s.logger.Warn("accepting websocket failed", "error", err)
		return
	}
	if err := s.hub.HandleConnection(r.Context(), role, assertion, ws); err != nil {
		s.logger.Info(
			"relay websocket closed",
			"role",
			role,
			"roomId",
			assertion.RoomID,
			"error",
			err,
		)
	}
}

func (s *Server) validateAssertion(w http.ResponseWriter, r *http.Request, signed token.SignedAssertion, expected token.ExpectedAssertion) (token.Assertion, bool) {
	assertion, err := s.validator.Validate(r.Context(), signed, expected)
	if err != nil {
		s.metrics.AuthFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "invalid relay assertion")
		return token.Assertion{}, false
	}
	return assertion, true
}

func (s *Server) allowPairingRequest(w http.ResponseWriter, r *http.Request, limiter *rateLimiter) bool {
	if limiter.allow(clientIP(r)) {
		return true
	}
	writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
	return false
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	defer r.Body.Close()
	reader := http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Warn("writing json response failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{
		"error": message,
	})
}

func ContextWithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, timeout)
}

func UnexpectedError(message string, err error) error {
	if err == nil {
		return errors.New(message)
	}
	return fmt.Errorf("%s: %w", message, err)
}

type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	byKey  map[string]rateBucket
}

type rateBucket struct {
	windowStart time.Time
	count       int
}

func newRateLimiter(limit int, window time.Duration, now func() time.Time) *rateLimiter {
	return &rateLimiter{
		limit:  limit,
		window: window,
		now:    now,
		byKey:  map[string]rateBucket{},
	}
}

func (l *rateLimiter) allow(key string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	for existingKey, bucket := range l.byKey {
		if now.Sub(bucket.windowStart) >= l.window {
			delete(l.byKey, existingKey)
		}
	}
	bucket := l.byKey[key]
	if bucket.windowStart.IsZero() || now.Sub(bucket.windowStart) >= l.window {
		l.byKey[key] = rateBucket{windowStart: now, count: 1}
		return true
	}
	if bucket.count >= l.limit {
		return false
	}
	bucket.count++
	l.byKey[key] = bucket
	return true
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
