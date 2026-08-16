package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestFabricHubMultiplexesIndependentControllerLinks(t *testing.T) {
	hub := NewFabricHub(HubConfig{
		MaxFrameBytes: 1024, MaxQueuedEnvelopes: 8, MaxQueuedBytes: 4096,
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/node", func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_ = hub.HandleNode(r.Context(), "fab-a", "node-a", ws)
	})
	mux.HandleFunc("/controller/{linkId}", func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_ = hub.HandleController(r.Context(), r.PathValue("linkId"), "controller-a", ws)
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	node, _, err := websocket.Dial(t.Context(), wsURL+"/node", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close(websocket.StatusNormalClosure, "done")
	for deadline := time.Now().Add(time.Second); ; time.Sleep(10 * time.Millisecond) {
		err = hub.OpenLink("fab-a", "node-a", "link-one", "controller-a")
		if !errors.Is(err, ErrNodeNotConnected) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("node did not become available")
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := hub.OpenLink("fab-a", "node-a", "link-two", "controller-a"); err != nil {
		t.Fatal(err)
	}
	controllerOne := dialFabricController(t, wsURL, "link-one")
	defer controllerOne.Close(websocket.StatusNormalClosure, "done")
	controllerTwo := dialFabricController(t, wsURL, "link-two")
	defer controllerTwo.Close(websocket.StatusNormalClosure, "done")

	frameOne := fabricFrame(t, "link-one", "stream-a", []byte("one"))
	if err := controllerOne.Write(t.Context(), websocket.MessageBinary, frameOne); err != nil {
		t.Fatal(err)
	}
	got := readFabricFrame(t, node)
	if string(got.Payload) != "one" || got.LinkID != "link-one" {
		t.Fatalf("node frame = %#v", got)
	}
	frameTwo := fabricFrame(t, "link-two", "stream-b", []byte("two"))
	if err := controllerTwo.Write(t.Context(), websocket.MessageBinary, frameTwo); err != nil {
		t.Fatal(err)
	}
	got = readFabricFrame(t, node)
	if string(got.Payload) != "two" || got.LinkID != "link-two" {
		t.Fatalf("node frame = %#v", got)
	}

	if err := hub.RevokeLink("link-one"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := controllerOne.Read(context.Background()); websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("revoked controller close = %v", err)
	}
	closed := readFabricFrame(t, node)
	if closed.LinkID != "link-one" || closed.Kind != FabricKindPeerClosed {
		t.Fatalf("node did not receive isolated link close: %#v", closed)
	}
	if err := controllerTwo.Write(t.Context(), websocket.MessageBinary, fabricFrame(t, "link-two", "stream-b", []byte("still-live"))); err != nil {
		t.Fatal(err)
	}
	got = readFabricFrame(t, node)
	if string(got.Payload) != "still-live" {
		t.Fatalf("second controller was affected by revocation: %#v", got)
	}
}

func dialFabricController(t *testing.T, baseURL, linkID string) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.Dial(t.Context(), baseURL+"/controller/"+linkID, nil)
	if err != nil {
		t.Fatal(err)
	}
	return ws
}

func fabricFrame(t *testing.T, linkID, streamID string, payload []byte) []byte {
	t.Helper()
	frame, err := EncodeFabricEnvelope(FabricEnvelope{
		Version: FabricProtocolVersion, FabricID: "fab-a", NodeID: "node-a", LinkID: linkID,
		StreamID: streamID, Seq: 1, Kind: FabricKindData, Priority: PriorityData, Payload: payload,
	}, 1024)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func readFabricFrame(t *testing.T, ws *websocket.Conn) FabricEnvelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, data, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := ParseFabricEnvelopeView(data, 1024)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}
