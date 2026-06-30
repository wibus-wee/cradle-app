package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"time"

	"github.com/coder/websocket"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/metrics"
	"github.com/cradle/relayd/internal/pairing"
	"github.com/cradle/relayd/internal/relay"
	"github.com/cradle/relayd/internal/token"
)

const maxJSONBodyBytes = 64 << 10

type ServerConfig struct {
	Config    config.Config
	Validator token.Validator
	Pairings  *pairing.Store
	Hub       *relay.Hub
	Metrics   *metrics.Counters
	Logger    *slog.Logger
}

type Server struct {
	cfg       config.Config
	validator token.Validator
	pairings  *pairing.Store
	hub       *relay.Hub
	metrics   *metrics.Counters
	logger    *slog.Logger
	mux       *http.ServeMux
}

type startRequest struct {
	HostToken string `json:"hostToken,omitempty"`
	RoomID    string `json:"roomId,omitempty"`
}

type startResponse struct {
	RoomID      string    `json:"roomId"`
	PairingCode string    `json:"pairingCode"`
	HostToken   string    `json:"hostToken,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type claimRequest struct {
	PairingCode     string `json:"pairingCode"`
	ControllerToken string `json:"controllerToken,omitempty"`
}

type claimResponse struct {
	RoomID          string    `json:"roomId"`
	ControllerToken string    `json:"controllerToken,omitempty"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

type hostSessionRequest struct {
	HostToken string `json:"hostToken"`
}

type hostSessionResponse struct {
	RoomID    string    `json:"roomId"`
	HostToken string    `json:"hostToken"`
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
		cfg:       cfg.Config,
		validator: cfg.Validator,
		pairings:  cfg.Pairings,
		hub:       cfg.Hub,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger,
		mux:       http.NewServeMux(),
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
	claims, ok := s.authenticate(w, r, token.ExpectedClaims{Purpose: token.PurposePairingStart})
	if !ok {
		return
	}
	var body startRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	roomID := body.RoomID
	if roomID == "" {
		roomID = claims.RoomID
	}
	if body.HostToken != "" {
		if _, err := s.validator.Validate(r.Context(), body.HostToken, token.ExpectedClaims{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		}); err != nil {
			s.metrics.AuthFailures.Add(1)
			writeError(w, http.StatusUnauthorized, "invalid host token")
			return
		}
	}

	started, err := s.pairings.Start(r.Context(), pairing.StartInput{
		Claims:    claims,
		RoomID:    roomID,
		HostToken: body.HostToken,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not start pairing")
		return
	}
	if err := s.hub.CreateRoom(r.Context(), started.RoomID, started.ExpiresAt.Add(s.cfg.RoomTTL)); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not create room")
		return
	}
	s.metrics.PairingStarts.Add(1)
	writeJSON(w, http.StatusOK, startResponse{
		RoomID:      started.RoomID,
		PairingCode: started.PairingCode,
		HostToken:   started.HostToken,
		ExpiresAt:   started.ExpiresAt,
	})
}

func (s *Server) claimPairing(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authenticate(w, r, token.ExpectedClaims{Purpose: token.PurposePairingClaim})
	if !ok {
		return
	}
	var body claimRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	pending, err := s.pairings.FindPending(r.Context(), body.PairingCode)
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid pairing code")
		return
	}
	if body.ControllerToken != "" {
		if _, err := s.validator.Validate(r.Context(), body.ControllerToken, token.ExpectedClaims{
			Role:    token.RoleController,
			RoomID:  pending.RoomID,
			Purpose: token.PurposeWebSocket,
		}); err != nil {
			s.metrics.AuthFailures.Add(1)
			writeError(w, http.StatusUnauthorized, "invalid controller token")
			return
		}
	}
	if body.ControllerToken == "" {
		writeJSON(w, http.StatusOK, claimResponse{
			RoomID:    pending.RoomID,
			ExpiresAt: pending.ExpiresAt,
		})
		return
	}
	claimed, err := s.pairings.Claim(r.Context(), pairing.ClaimInput{
		Code:            body.PairingCode,
		ControllerToken: body.ControllerToken,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid pairing code")
		return
	}
	s.metrics.PairingClaims.Add(1)
	writeJSON(w, http.StatusOK, claimResponse{
		RoomID:          claimed.RoomID,
		ControllerToken: claimed.ControllerToken,
		ExpiresAt:       claimed.ExpiresAt,
	})
}

func (s *Server) startHostSession(w http.ResponseWriter, r *http.Request) {
	claims, ok := s.authenticate(w, r, token.ExpectedClaims{Purpose: token.PurposeRoomStart})
	if !ok {
		return
	}
	if claims.RoomID == "" {
		writeError(w, http.StatusBadRequest, "room id is required")
		return
	}
	var body hostSessionRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.HostToken == "" {
		writeError(w, http.StatusBadRequest, "host token is required")
		return
	}
	if _, err := s.validator.Validate(r.Context(), body.HostToken, token.ExpectedClaims{
		Role:    token.RoleHost,
		RoomID:  claims.RoomID,
		Purpose: token.PurposeWebSocket,
	}); err != nil {
		s.metrics.AuthFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "invalid host token")
		return
	}
	expiresAt := time.Unix(claims.Expiry, 0)
	if err := s.hub.CreateRoom(r.Context(), claims.RoomID, expiresAt.Add(s.cfg.RoomTTL)); err != nil {
		writeError(w, http.StatusServiceUnavailable, "could not create room")
		return
	}
	writeJSON(w, http.StatusOK, hostSessionResponse{
		RoomID:    claims.RoomID,
		HostToken: body.HostToken,
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
	claims, ok := s.authenticate(w, r, token.ExpectedClaims{
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
	if err := s.hub.HandleConnection(r.Context(), role, claims, ws); err != nil {
		s.logger.Info(
			"relay websocket closed",
			"role",
			role,
			"roomId",
			claims.RoomID,
			"error",
			err,
		)
	}
}

func (s *Server) authenticate(w http.ResponseWriter, r *http.Request, expected token.ExpectedClaims) (token.Claims, bool) {
	raw, ok := token.BearerToken(r.Header.Get("Authorization"))
	if !ok {
		s.metrics.AuthFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "missing bearer token")
		return token.Claims{}, false
	}
	claims, err := s.validator.Validate(r.Context(), raw, expected)
	if err != nil {
		s.metrics.AuthFailures.Add(1)
		writeError(w, http.StatusUnauthorized, "invalid bearer token")
		return token.Claims{}, false
	}
	return claims, true
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
