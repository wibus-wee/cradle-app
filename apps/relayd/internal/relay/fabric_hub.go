package relay

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/coder/websocket"
)

var (
	ErrNodeNotConnected = errors.New("relay: node not connected")
	ErrLinkNotFound     = errors.New("relay: link not found")
	ErrLinkConnected    = errors.New("relay: link already connected")
	ErrNodeConnected    = errors.New("relay: node already connected")
)

// FabricHubConfig bounds the opaque envelope queues of one FabricHub.
type FabricHubConfig struct {
	MaxFrameBytes      int64
	MaxQueuedEnvelopes int
	MaxQueuedBytes     int64
}

// FabricHub replaces one permanent room with a durable Node socket and many
// short-lived Controller links. It receives authorization decisions from the
// directory; it never evaluates certificates itself.
type FabricHub struct {
	mu    sync.RWMutex
	cfg   FabricHubConfig
	nodes map[string]*fabricNode
	links map[string]*fabricLink
}

type fabricNode struct {
	fabricID string
	nodeID   string
	conn     *fabricConn
}

type fabricLink struct {
	fabricID     string
	nodeID       string
	linkID       string
	controllerID string
	controller   *fabricConn
	expires      *time.Timer
}

type FabricLinkInfo struct {
	FabricID     string
	NodeID       string
	LinkID       string
	ControllerID string
}

type fabricConn struct {
	ws        *websocket.Conn
	scheduler *peerScheduler
	done      chan struct{}
	closeOnce sync.Once
	writeMu   sync.Mutex
}

func NewFabricHub(cfg FabricHubConfig) *FabricHub {
	return &FabricHub{cfg: cfg, nodes: map[string]*fabricNode{}, links: map[string]*fabricLink{}}
}

// OpenLink creates one short-lived Controller link. controllerCertificate is
// opaque to relayd after directory authorization, but is delivered to the
// Node in a control envelope so the Node can independently verify the owner
// signature before it accepts the Controller's encrypted hello.
func (h *FabricHub) OpenLink(fabricID, nodeID, linkID, controllerID string, certificates ...[]byte) error {
	if fabricID == "" || nodeID == "" || linkID == "" || controllerID == "" {
		return ErrInvalidEnvelope
	}
	h.mu.Lock()
	if _, exists := h.links[linkID]; exists {
		h.mu.Unlock()
		return ErrLinkConnected
	}
	node := h.nodes[nodeKey(fabricID, nodeID)]
	if node == nil {
		h.mu.Unlock()
		return ErrNodeNotConnected
	}
	link := &fabricLink{fabricID: fabricID, nodeID: nodeID, linkID: linkID, controllerID: controllerID}
	link.expires = time.AfterFunc(15*time.Minute, func() { _ = h.RevokeLink(linkID) })
	h.links[linkID] = link
	h.mu.Unlock()
	if len(certificates) > 0 && len(certificates[0]) > 0 {
		h.enqueueControl(node.conn, link, FabricKindLinkOpen, certificates[0])
	}
	return nil
}

func (h *FabricHub) HandleNode(ctx context.Context, fabricID, nodeID string, ws *websocket.Conn) error {
	conn := h.newConn(ws)
	h.mu.Lock()
	key := nodeKey(fabricID, nodeID)
	if h.nodes[key] != nil {
		h.mu.Unlock()
		conn.close(websocket.StatusPolicyViolation, ErrNodeConnected.Error())
		return ErrNodeConnected
	}
	h.nodes[key] = &fabricNode{fabricID: fabricID, nodeID: nodeID, conn: conn}
	h.mu.Unlock()
	defer h.dropNode(fabricID, nodeID, conn)
	return h.serve(ctx, conn, func(data []byte, env FabricEnvelope) error {
		if env.FabricID != fabricID || env.NodeID != nodeID {
			return ErrInvalidEnvelope
		}
		return h.forwardFromNode(ctx, conn, data, env)
	})
}

func (h *FabricHub) HandleController(ctx context.Context, linkID, controllerID string, ws *websocket.Conn) error {
	conn := h.newConn(ws)
	h.mu.Lock()
	link := h.links[linkID]
	if link == nil {
		h.mu.Unlock()
		conn.close(websocket.StatusPolicyViolation, ErrLinkNotFound.Error())
		return ErrLinkNotFound
	}
	if link.controllerID != controllerID {
		h.mu.Unlock()
		conn.close(websocket.StatusPolicyViolation, ErrInvalidEnvelope.Error())
		return ErrInvalidEnvelope
	}
	if link.controller != nil {
		h.mu.Unlock()
		conn.close(websocket.StatusPolicyViolation, ErrLinkConnected.Error())
		return ErrLinkConnected
	}
	link.controller = conn
	h.mu.Unlock()
	defer h.dropController(linkID, conn)
	return h.serve(ctx, conn, func(data []byte, env FabricEnvelope) error {
		if env.LinkID != linkID || env.FabricID != link.fabricID || env.NodeID != link.nodeID {
			return ErrInvalidEnvelope
		}
		return h.forwardFromController(ctx, conn, data, env)
	})
}

func (h *FabricHub) RevokeLink(linkID string) error {
	h.mu.Lock()
	link := h.links[linkID]
	if link == nil {
		h.mu.Unlock()
		return ErrLinkNotFound
	}
	delete(h.links, linkID)
	node := h.nodes[nodeKey(link.fabricID, link.nodeID)]
	h.mu.Unlock()
	if link.expires != nil {
		link.expires.Stop()
	}
	if link.controller != nil {
		link.controller.close(websocket.StatusPolicyViolation, "fabric_grant_revoked")
	}
	if node != nil {
		h.enqueueControl(node.conn, link, FabricKindPeerClosed, []byte("fabric_grant_revoked"))
	}
	return nil
}

func (h *FabricHub) LinkInfo(linkID string) (FabricLinkInfo, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	link := h.links[linkID]
	if link == nil {
		return FabricLinkInfo{}, ErrLinkNotFound
	}
	return FabricLinkInfo{FabricID: link.fabricID, NodeID: link.nodeID, LinkID: link.linkID, ControllerID: link.controllerID}, nil
}

func (h *FabricHub) RevokeControllerNode(fabricID, nodeID, controllerID string) {
	h.mu.RLock()
	linkIDs := []string{}
	for linkID, link := range h.links {
		if link.fabricID == fabricID && link.nodeID == nodeID && link.controllerID == controllerID {
			linkIDs = append(linkIDs, linkID)
		}
	}
	h.mu.RUnlock()
	for _, linkID := range linkIDs {
		_ = h.RevokeLink(linkID)
	}
}

// RemoveNode terminates the device's persistent socket and every live link in
// which it participates as either the target Node or the Controller.
func (h *FabricHub) RemoveNode(fabricID, nodeID string) {
	h.mu.Lock()
	removedNode := h.nodes[nodeKey(fabricID, nodeID)]
	delete(h.nodes, nodeKey(fabricID, nodeID))
	links := []*fabricLink{}
	peerNodes := map[*fabricLink]*fabricNode{}
	for linkID, link := range h.links {
		if link.fabricID != fabricID || (link.nodeID != nodeID && link.controllerID != nodeID) {
			continue
		}
		links = append(links, link)
		if link.nodeID != nodeID {
			peerNodes[link] = h.nodes[nodeKey(fabricID, link.nodeID)]
		}
		delete(h.links, linkID)
	}
	h.mu.Unlock()

	for _, link := range links {
		if link.expires != nil {
			link.expires.Stop()
		}
		if link.controller != nil {
			link.controller.close(websocket.StatusPolicyViolation, "fabric_node_removed")
		}
		if peer := peerNodes[link]; peer != nil {
			h.enqueueControl(peer.conn, link, FabricKindPeerClosed, []byte("fabric_node_removed"))
		}
	}
	if removedNode != nil {
		removedNode.conn.close(websocket.StatusPolicyViolation, "fabric_node_removed")
	}
}

func (h *FabricHub) newConn(ws *websocket.Conn) *fabricConn {
	return &fabricConn{
		ws:        ws,
		scheduler: newPeerScheduler(h.cfg.MaxQueuedEnvelopes, h.cfg.MaxQueuedBytes, h.cfg.MaxFrameBytes),
		done:      make(chan struct{}),
	}
}

func (h *FabricHub) serve(ctx context.Context, conn *fabricConn, forward func([]byte, FabricEnvelope) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go h.writeLoop(ctx, conn)
	conn.ws.SetReadLimit(h.cfg.MaxFrameBytes)
	for {
		messageType, data, err := conn.ws.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			return err
		}
		if messageType != websocket.MessageBinary {
			return ErrInvalidEnvelope
		}
		env, err := ParseFabricEnvelopeView(data, h.cfg.MaxFrameBytes)
		if err != nil {
			return err
		}
		if err := forward(data, env); err != nil {
			return err
		}
	}
}

func (h *FabricHub) writeLoop(ctx context.Context, conn *fabricConn) {
	for {
		item, err := conn.scheduler.next(ctx)
		if err != nil {
			return
		}
		writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err = conn.write(writeCtx, item.data)
		cancel()
		if err != nil {
			conn.close(websocket.StatusPolicyViolation, err.Error())
			return
		}
	}
}

func (h *FabricHub) forwardFromNode(ctx context.Context, from *fabricConn, data []byte, env FabricEnvelope) error {
	h.mu.RLock()
	link := h.links[env.LinkID]
	if link == nil || link.controller == nil {
		h.mu.RUnlock()
		return ErrPeerNotConnected
	}
	peer := link.controller
	h.mu.RUnlock()
	return peer.enqueue(ctx, data, env.Priority, env.StreamID)
}

func (h *FabricHub) forwardFromController(ctx context.Context, from *fabricConn, data []byte, env FabricEnvelope) error {
	h.mu.RLock()
	link := h.links[env.LinkID]
	node := h.nodes[nodeKey(env.FabricID, env.NodeID)]
	if link == nil || link.controller != from || node == nil {
		h.mu.RUnlock()
		return ErrPeerNotConnected
	}
	peer := node.conn
	h.mu.RUnlock()
	return peer.enqueue(ctx, data, env.Priority, env.StreamID)
}

func (h *FabricHub) dropNode(fabricID, nodeID string, conn *fabricConn) {
	conn.close(websocket.StatusNormalClosure, "node disconnected")
	h.mu.Lock()
	if node := h.nodes[nodeKey(fabricID, nodeID)]; node != nil && node.conn == conn {
		delete(h.nodes, nodeKey(fabricID, nodeID))
	}
	controllers := []*fabricConn{}
	links := []*fabricLink{}
	for linkID, link := range h.links {
		if link.fabricID != fabricID || link.nodeID != nodeID {
			continue
		}
		if link.controller != nil {
			controllers = append(controllers, link.controller)
		}
		links = append(links, link)
		delete(h.links, linkID)
	}
	h.mu.Unlock()
	for _, link := range links {
		if link.expires != nil {
			link.expires.Stop()
		}
	}
	for _, controller := range controllers {
		controller.close(websocket.StatusTryAgainLater, "fabric_node_offline")
	}
}

func (h *FabricHub) dropController(linkID string, conn *fabricConn) {
	conn.close(websocket.StatusNormalClosure, "controller disconnected")
	h.mu.Lock()
	link := h.links[linkID]
	if link != nil && link.controller == conn {
		link.controller = nil
	}
	h.mu.Unlock()
}

func (h *FabricHub) enqueueControl(conn *fabricConn, link *fabricLink, kind string, payload []byte) {
	encoded, err := EncodeFabricEnvelope(FabricEnvelope{Version: FabricProtocolVersion, FabricID: link.fabricID, NodeID: link.nodeID, LinkID: link.linkID, Kind: kind, Priority: PriorityControl, Payload: payload}, h.cfg.MaxFrameBytes)
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = conn.enqueue(ctx, encoded, PriorityControl, "")
	}
}

func (conn *fabricConn) enqueue(ctx context.Context, data []byte, priority, streamID string) error {
	return conn.scheduler.enqueueWait(ctx, conn.done, queuedEnvelope{data: data, size: int64(len(data))}, priority, streamID)
}

func (conn *fabricConn) write(ctx context.Context, data []byte) error {
	conn.writeMu.Lock()
	defer conn.writeMu.Unlock()
	return conn.ws.Write(ctx, websocket.MessageBinary, data)
}

func (conn *fabricConn) close(status websocket.StatusCode, reason string) {
	conn.closeOnce.Do(func() {
		_ = conn.ws.Close(status, reason)
		close(conn.done)
	})
}

func nodeKey(fabricID, nodeID string) string { return fabricID + "\x00" + nodeID }
