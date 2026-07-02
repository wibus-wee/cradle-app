package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/cradle/relayd/internal/config"
	"github.com/cradle/relayd/internal/metrics"
	"github.com/cradle/relayd/internal/pairing"
	"github.com/cradle/relayd/internal/relay"
	"github.com/cradle/relayd/internal/token"
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

func TestPairingFlow(t *testing.T) {
	server := newTestServer(t)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_pairing"
	startToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "start_1",
		Nonce:    "nonce_start",
		Purpose:  token.PurposePairingStart,
	})
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})

	startBody, err := json.Marshal(map[string]string{"hostToken": hostToken})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/pairing/start", bytes.NewReader(startBody))
	req.Header.Set("Authorization", "Bearer "+startToken)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d body = %s", rec.Code, rec.Body.String())
	}
	var start startResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &start); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if start.RoomID != roomID {
		t.Fatalf("start.RoomID = %q, expected %q", start.RoomID, roomID)
	}

	claimToken := signTestToken(t, signer, token.Claims{
		Subject:  "server_1",
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "claim_1",
		Nonce:    "nonce_claim",
		Purpose:  token.PurposePairingClaim,
	})
	controllerToken := signTestToken(t, signer, token.Claims{
		Subject:  "controller_1",
		Role:     token.RoleController,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "controller_1",
		Nonce:    "nonce_controller",
		Purpose:  token.PurposeWebSocket,
	})
	claimBody, err := json.Marshal(map[string]string{
		"pairingCode":     start.PairingCode,
		"controllerToken": controllerToken,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req = httptest.NewRequest(http.MethodPost, "/pairing/claim", bytes.NewReader(claimBody))
	req.Header.Set("Authorization", "Bearer "+claimToken)
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim status = %d body = %s", rec.Code, rec.Body.String())
	}
}

func TestHostSessionFlow(t *testing.T) {
	server := newTestServer(t)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_host_session"
	roomStartToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1_room_start",
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "room_start_1",
		Nonce:    "nonce_room_start",
		Purpose:  token.PurposeRoomStart,
	})
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})

	body, err := json.Marshal(map[string]string{"hostToken": hostToken})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/rooms/host-session", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+roomStartToken)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("host session status = %d body = %s", rec.Code, rec.Body.String())
	}
	var started hostSessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if started.RoomID != roomID {
		t.Fatalf("started.RoomID = %q, expected %q", started.RoomID, roomID)
	}

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	defer host.Close(websocket.StatusNormalClosure, "test done")
}

func TestWebSocketRoutesEnvelopeBetweenHostAndController(t *testing.T) {
	server := newTestServer(t)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_ws"
	if err := server.hub.CreateRoom(t.Context(), roomID, now.Add(time.Minute)); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})
	controllerToken := signTestToken(t, signer, token.Claims{
		Subject:  "controller_1",
		Role:     token.RoleController,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "controller_1",
		Nonce:    "nonce_controller",
		Purpose:  token.PurposeWebSocket,
	})

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")

	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	defer host.Close(websocket.StatusNormalClosure, "test done")
	controller, _, err := websocket.Dial(t.Context(), wsURL+"/ws/controller", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + controllerToken}},
	})
	if err != nil {
		t.Fatalf("controller Dial() error = %v", err)
	}
	defer controller.Close(websocket.StatusNormalClosure, "test done")

	payload := relay.EncodePayload(map[string]string{"method": "host/hello"})
	data, err := relay.EncodeEnvelope(relay.Envelope{
		Version: relay.ProtocolVersion,
		RoomID:  roomID,
		Seq:     1,
		Kind:    relay.KindRelayDataFrame,
		Payload: payload,
	}, 1024)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}
	if err := host.Write(t.Context(), websocket.MessageText, data); err != nil {
		t.Fatalf("host Write() error = %v", err)
	}

	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, got, err := controller.Read(readCtx)
	if err != nil {
		t.Fatalf("controller Read() error = %v", err)
	}
	env, err := relay.ParseEnvelope(got, 1024)
	if err != nil {
		t.Fatalf("ParseEnvelope() error = %v", err)
	}
	if env.RoomID != roomID {
		t.Fatalf("env.RoomID = %q, expected %q", env.RoomID, roomID)
	}
}

func TestWebSocketHeartbeatKeepsIdleConnectionOpen(t *testing.T) {
	server := newTestServerWithTiming(t, 100*time.Millisecond, 300*time.Millisecond)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_heartbeat"
	if err := server.hub.CreateRoom(t.Context(), roomID, now.Add(time.Minute)); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})
	controllerToken := signTestToken(t, signer, token.Claims{
		Subject:  "controller_1",
		Role:     token.RoleController,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "controller_1",
		Nonce:    "nonce_controller",
		Purpose:  token.PurposeWebSocket,
	})

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")

	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	defer host.Close(websocket.StatusNormalClosure, "test done")
	controller, _, err := websocket.Dial(t.Context(), wsURL+"/ws/controller", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + controllerToken}},
	})
	if err != nil {
		t.Fatalf("controller Dial() error = %v", err)
	}
	defer controller.Close(websocket.StatusNormalClosure, "test done")

	readerCtx, stopReaders := context.WithCancel(t.Context())
	defer stopReaders()
	go func() {
		for {
			if _, _, err := host.Read(readerCtx); err != nil {
				return
			}
		}
	}()
	controllerMessages := make(chan []byte, 1)
	controllerErrors := make(chan error, 1)
	go func() {
		for {
			_, data, err := controller.Read(readerCtx)
			if err != nil {
				controllerErrors <- err
				return
			}
			controllerMessages <- data
			return
		}
	}()

	time.Sleep(650 * time.Millisecond)

	payload := relay.EncodePayload(map[string]string{"method": "host/hello"})
	data, err := relay.EncodeEnvelope(relay.Envelope{
		Version: relay.ProtocolVersion,
		RoomID:  roomID,
		Seq:     1,
		Kind:    relay.KindRelayDataFrame,
		Payload: payload,
	}, 1024)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}
	if err := host.Write(t.Context(), websocket.MessageText, data); err != nil {
		t.Fatalf("host Write() error = %v", err)
	}

	select {
	case <-controllerMessages:
	case err := <-controllerErrors:
		t.Fatalf("controller Read() error = %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for forwarded message")
	}
}

func TestWebSocketRejectsRoomMismatch(t *testing.T) {
	server := newTestServer(t)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_ws"
	if err := server.hub.CreateRoom(t.Context(), roomID, now.Add(time.Minute)); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")

	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	defer host.Close(websocket.StatusNormalClosure, "test done")

	payload := relay.EncodePayload(map[string]string{"method": "host/hello"})
	data, err := relay.EncodeEnvelope(relay.Envelope{
		Version: relay.ProtocolVersion,
		RoomID:  "room_other",
		Seq:     1,
		Kind:    relay.KindRelayDataFrame,
		Payload: payload,
	}, 1024)
	if err != nil {
		t.Fatalf("EncodeEnvelope() error = %v", err)
	}
	if err := host.Write(t.Context(), websocket.MessageText, data); err != nil {
		t.Fatalf("host Write() error = %v", err)
	}
	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, _, err = host.Read(readCtx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("host Read() close status = %v error = %v, expected policy violation", websocket.CloseStatus(err), err)
	}
}

func TestWebSocketRejectsDuplicateRole(t *testing.T) {
	server := newTestServer(t)
	signer := newTestSigner(t)
	now := time.Now()
	roomID := "room_duplicate"
	if err := server.hub.CreateRoom(t.Context(), roomID, now.Add(time.Minute)); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	hostToken := signTestToken(t, signer, token.Claims{
		Subject:  "host_1",
		Role:     token.RoleHost,
		RoomID:   roomID,
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "host_1",
		Nonce:    "nonce_host",
		Purpose:  token.PurposeWebSocket,
	})

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	firstHost, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("first host Dial() error = %v", err)
	}
	defer firstHost.Close(websocket.StatusNormalClosure, "test done")

	secondHost, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + hostToken}},
	})
	if err != nil {
		t.Fatalf("second host Dial() error = %v", err)
	}
	defer secondHost.Close(websocket.StatusNormalClosure, "test done")

	readCtx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, _, err = secondHost.Read(readCtx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("second host close status = %v error = %v, expected policy violation", websocket.CloseStatus(err), err)
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	return newTestServerWithTiming(t, time.Second, 3*time.Second)
}

func newTestServerWithTiming(t *testing.T, heartbeatInterval time.Duration, idleTimeout time.Duration) *Server {
	t.Helper()
	cfg := config.Config{
		ListenAddr:         "127.0.0.1:0",
		PublicURL:          "http://127.0.0.1:0",
		TokenIssuer:        "cradle-server",
		TokenAudience:      "cradle-relay",
		DevHMACSecret:      "secret",
		PairingTTL:         time.Minute,
		RoomTTL:            time.Minute,
		HeartbeatInterval:  heartbeatInterval,
		IdleTimeout:        idleTimeout,
		ReadTimeout:        time.Second,
		WriteTimeout:       time.Second,
		MaxFrameBytes:      1024,
		MaxQueuedEnvelopes: 4,
		MaxQueuedBytes:     4096,
		MaxRooms:           16,
		MetricsEnabled:     true,
		PprofEnabled:       false,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	validator := newTestSigner(t)
	counterSet := metrics.New()
	server, err := NewServer(ServerConfig{
		Config:    cfg,
		Validator: validator,
		Pairings:  pairing.NewStore(pairing.StoreConfig{CodeTTL: time.Minute}),
		Hub: relay.NewHub(relay.HubConfig{
			RoomTTL:            cfg.RoomTTL,
			MaxRooms:           cfg.MaxRooms,
			MaxFrameBytes:      cfg.MaxFrameBytes,
			MaxQueuedEnvelopes: cfg.MaxQueuedEnvelopes,
			MaxQueuedBytes:     cfg.MaxQueuedBytes,
			HeartbeatInterval:  cfg.HeartbeatInterval,
			IdleTimeout:        cfg.IdleTimeout,
			Metrics:            counterSet,
		}),
		Metrics: counterSet,
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	return server
}

func newTestSigner(t *testing.T) *token.HMACValidator {
	t.Helper()
	validator, err := token.NewHMACValidator(token.HMACValidatorConfig{
		Secret:   []byte("secret"),
		Issuer:   "cradle-server",
		Audience: "cradle-relay",
		Now:      time.Now,
	})
	if err != nil {
		t.Fatalf("NewHMACValidator() error = %v", err)
	}
	return validator
}

func signTestToken(t *testing.T, signer *token.HMACValidator, claims token.Claims) string {
	t.Helper()
	raw, err := signer.Sign(claims)
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}
	return raw
}
