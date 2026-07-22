package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
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
	hostKey := newAssertionKey(t)
	controllerKey := newAssertionKey(t)
	roomID := "room_pairing"

	start := postJSON[startResponse](t, server, "/pairing/start", startRequest{
		Assertion: hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeCreateRoom,
		}),
	})
	if start.RoomID != roomID {
		t.Fatalf("start.RoomID = %q, expected %q", start.RoomID, roomID)
	}
	if start.PairingCode == "" {
		t.Fatal("start.PairingCode is empty")
	}

	postJSON[claimResponse](t, server, "/pairing/claim", claimRequest{
		Assertion: controllerKey.sign(t, token.Assertion{
			Role:        token.RoleController,
			RoomID:      roomID,
			Purpose:     token.PurposeClaim,
			PairingCode: start.PairingCode,
		}),
	})
}

func TestHostSessionFlow(t *testing.T) {
	server := newTestServer(t)
	hostKey := newAssertionKey(t)
	controllerKey := newAssertionKey(t)
	roomID := "room_host_session"

	started := postJSON[hostSessionResponse](t, server, "/rooms/host-session", hostSessionRequest{
		Assertion: hostKey.sign(t, token.Assertion{
			Role:             token.RoleHost,
			RoomID:           roomID,
			Purpose:          token.PurposeReconnect,
			ControllerPubkey: controllerKey.pubkey,
		}),
	})
	if started.RoomID != roomID {
		t.Fatalf("started.RoomID = %q, expected %q", started.RoomID, roomID)
	}

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	defer host.Close(websocket.StatusNormalClosure, "test done")
}

func TestWebSocketRoutesEnvelopeBetweenHostAndController(t *testing.T) {
	server := newTestServer(t)
	hostKey := newAssertionKey(t)
	controllerKey := newAssertionKey(t)
	roomID := "room_ws"
	if err := server.hub.CreateRoom(t.Context(), roomID, time.Now().Add(time.Minute), hostKey.pubkey, controllerKey.pubkey); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}

	host, controller := dialHostController(t, server, roomID, hostKey, controllerKey)
	defer host.Close(websocket.StatusNormalClosure, "test done")
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
	if err := host.Write(t.Context(), websocket.MessageBinary, data); err != nil {
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
	hostKey := newAssertionKey(t)
	controllerKey := newAssertionKey(t)
	roomID := "room_heartbeat"
	if err := server.hub.CreateRoom(t.Context(), roomID, time.Now().Add(time.Minute), hostKey.pubkey, controllerKey.pubkey); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}
	host, controller := dialHostController(t, server, roomID, hostKey, controllerKey)
	defer host.Close(websocket.StatusNormalClosure, "test done")
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
	if err := host.Write(t.Context(), websocket.MessageBinary, data); err != nil {
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
	hostKey := newAssertionKey(t)
	roomID := "room_ws"
	if err := server.hub.CreateRoom(t.Context(), roomID, time.Now().Add(time.Minute), hostKey.pubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
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
	if err := host.Write(t.Context(), websocket.MessageBinary, data); err != nil {
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
	hostKey := newAssertionKey(t)
	roomID := "room_duplicate"
	if err := server.hub.CreateRoom(t.Context(), roomID, time.Now().Add(time.Minute), hostKey.pubkey, ""); err != nil {
		t.Fatalf("CreateRoom() error = %v", err)
	}

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	firstHost, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
	})
	if err != nil {
		t.Fatalf("first host Dial() error = %v", err)
	}
	defer firstHost.Close(websocket.StatusNormalClosure, "test done")

	secondHost, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
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
		ListenAddr:            "127.0.0.1:0",
		PublicURL:             "http://127.0.0.1:0",
		PairingTTL:            time.Minute,
		RoomTTL:               time.Minute,
		HeartbeatInterval:     heartbeatInterval,
		IdleTimeout:           idleTimeout,
		ReadTimeout:           time.Second,
		WriteTimeout:          time.Second,
		AssertionMaxSkew:      time.Minute,
		PairingStartRateLimit: 30,
		PairingClaimRateLimit: 120,
		MaxFrameBytes:         1024,
		MaxQueuedEnvelopes:    4,
		MaxQueuedBytes:        4096,
		MaxRooms:              16,
		MetricsEnabled:        true,
		PprofEnabled:          false,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	counterSet := metrics.New()
	server, err := NewServer(ServerConfig{
		Config:    cfg,
		Validator: token.NewAssertionValidator(token.AssertionValidatorConfig{Now: time.Now}),
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

func postJSON[T any](t *testing.T, server *Server, path string, body any) T {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s status = %d body = %s", path, rec.Code, rec.Body.String())
	}
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	return out
}

func dialHostController(t *testing.T, server *Server, roomID string, hostKey assertionKey, controllerKey assertionKey) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	host, _, err := websocket.Dial(t.Context(), wsURL+"/ws/host", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, hostKey.sign(t, token.Assertion{
			Role:    token.RoleHost,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
	})
	if err != nil {
		t.Fatalf("host Dial() error = %v", err)
	}
	controller, _, err := websocket.Dial(t.Context(), wsURL+"/ws/controller", &websocket.DialOptions{
		HTTPHeader: assertionHeaders(t, controllerKey.sign(t, token.Assertion{
			Role:    token.RoleController,
			RoomID:  roomID,
			Purpose: token.PurposeWebSocket,
		})),
	})
	if err != nil {
		host.Close(websocket.StatusNormalClosure, "test done")
		t.Fatalf("controller Dial() error = %v", err)
	}
	return host, controller
}

type assertionKey struct {
	private ed25519.PrivateKey
	pubkey  string
	counter int
}

func newAssertionKey(t *testing.T) assertionKey {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	return assertionKey{
		private: privateKey,
		pubkey:  base64.StdEncoding.EncodeToString(publicKey),
	}
}

func (k *assertionKey) sign(t *testing.T, assertion token.Assertion) token.SignedAssertion {
	t.Helper()
	k.counter++
	assertion.Pubkey = k.pubkey
	assertion.IssuedAt = time.Now().Unix()
	assertion.Nonce = fmt.Sprintf("nonce_%d", k.counter)
	payload, err := token.CanonicalJSON(assertion)
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	return token.SignedAssertion{
		Assertion: assertion,
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(k.private, payload)),
	}
}

func assertionHeaders(t *testing.T, signed token.SignedAssertion) http.Header {
	t.Helper()
	raw, err := json.Marshal(signed.Assertion)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	return http.Header{
		assertionHeader: []string{base64.StdEncoding.EncodeToString(raw)},
		signatureHeader: []string{signed.Signature},
	}
}
