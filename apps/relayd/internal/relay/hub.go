package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/cradle/relayd/internal/metrics"
	"github.com/cradle/relayd/internal/token"
)

const (
	RoleHost       = token.RoleHost
	RoleController = token.RoleController
)

var (
	ErrRoomNotFound     = errors.New("relay: room not found")
	ErrRoomFull         = errors.New("relay: role already connected")
	ErrPeerNotConnected = errors.New("relay: peer not connected")
	ErrSlowConsumer     = errors.New("relay: slow consumer")
	ErrRoomLimitReached = errors.New("relay: room limit reached")
	ErrPubkeyMismatch   = errors.New("relay: pubkey mismatch")
)

type HubConfig struct {
	RoomTTL            time.Duration
	MaxRooms           int
	MaxFrameBytes      int64
	MaxQueuedEnvelopes int
	MaxQueuedBytes     int64
	HeartbeatInterval  time.Duration
	IdleTimeout        time.Duration
	Now                func() time.Time
	Metrics            *metrics.Counters
	Logger             *slog.Logger
}

type Hub struct {
	mu     sync.Mutex
	cfg    HubConfig
	now    func() time.Time
	rooms  map[string]*room
	logger *slog.Logger
}

type room struct {
	id               string
	expiresAt        time.Time
	host             *connState
	controller       *connState
	hostPubkey       string
	controllerPubkey string
	createdAt        time.Time
	closedAt         time.Time
}

type connState struct {
	role         token.Role
	roomID       string
	conn         *websocket.Conn
	scheduler    *peerScheduler
	done         chan struct{}
	closeOnce    sync.Once
	writeMu      sync.Mutex
	lastSeenUnix atomic.Int64
	cfg          HubConfig
	hub          *Hub
	logger       *slog.Logger
}

type queuedEnvelope struct {
	data []byte
	size int64
}

// peerScheduler reserves queue capacity for control traffic and serves bulk
// data round-robin by stream. relayd learns only the coarse priority and stream
// id from the outer envelope; the payload remains opaque.
type peerScheduler struct {
	mu              sync.Mutex
	control         []queuedEnvelope
	dataByStream    map[string][]queuedEnvelope
	streamOrder     []string
	nextStream      int
	queuedBytes     int64
	queuedCount     int
	queuedDataBytes int64
	queuedDataCount int
	maxBytes        int64
	maxCount        int
	maxDataBytes    int64
	maxDataCount    int
	signal          chan struct{}
}

func newPeerScheduler(maxCount int, maxBytes, maxFrameBytes int64) *peerScheduler {
	controlReserveCount := max(1, maxCount/8)
	controlReserveCount = min(controlReserveCount, maxCount)
	controlReserveBytes := max(maxBytes/8, maxFrameBytes)
	controlReserveBytes = min(controlReserveBytes, maxBytes)
	return &peerScheduler{
		dataByStream: map[string][]queuedEnvelope{},
		maxCount:     maxCount,
		maxBytes:     maxBytes,
		maxDataCount: maxCount - controlReserveCount,
		maxDataBytes: maxBytes - controlReserveBytes,
		signal:       make(chan struct{}, 1),
	}
}

func (s *peerScheduler) enqueue(item queuedEnvelope, priority, streamID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.queuedBytes+item.size > s.maxBytes || s.queuedCount >= s.maxCount {
		return ErrSlowConsumer
	}
	if priority == PriorityControl {
		s.control = append(s.control, item)
	} else {
		// Data must leave space for at least one maximum-sized control frame.
		// Without this separate budget, a bulk sender can fill the shared queue
		// and force an ACK, close, or peer notification to be rejected.
		if s.queuedDataBytes+item.size > s.maxDataBytes || s.queuedDataCount >= s.maxDataCount {
			return ErrSlowConsumer
		}
		if streamID == "" {
			streamID = "_unclassified"
		}
		if _, exists := s.dataByStream[streamID]; !exists {
			s.streamOrder = append(s.streamOrder, streamID)
		}
		s.dataByStream[streamID] = append(s.dataByStream[streamID], item)
		s.queuedDataBytes += item.size
		s.queuedDataCount++
	}
	s.queuedBytes += item.size
	s.queuedCount++
	select {
	case s.signal <- struct{}{}:
	default:
	}
	return nil
}

func (s *peerScheduler) next(ctx context.Context) (queuedEnvelope, error) {
	for {
		s.mu.Lock()
		if len(s.control) > 0 {
			item := s.control[0]
			s.control = s.control[1:]
			s.queuedBytes -= item.size
			s.queuedCount--
			s.mu.Unlock()
			return item, nil
		}
		for checked := 0; checked < len(s.streamOrder); checked++ {
			index := s.nextStream % len(s.streamOrder)
			streamID := s.streamOrder[index]
			items := s.dataByStream[streamID]
			if len(items) == 0 {
				continue
			}
			item := items[0]
			if len(items) == 1 {
				delete(s.dataByStream, streamID)
				s.streamOrder = append(s.streamOrder[:index], s.streamOrder[index+1:]...)
				if len(s.streamOrder) == 0 {
					s.nextStream = 0
				} else {
					s.nextStream = index % len(s.streamOrder)
				}
			} else {
				s.dataByStream[streamID] = items[1:]
				s.nextStream = (index + 1) % len(s.streamOrder)
			}
			s.queuedBytes -= item.size
			s.queuedCount--
			s.queuedDataBytes -= item.size
			s.queuedDataCount--
			s.mu.Unlock()
			return item, nil
		}
		s.mu.Unlock()
		select {
		case <-ctx.Done():
			return queuedEnvelope{}, ctx.Err()
		case <-s.signal:
		}
	}
}

func NewHub(cfg HubConfig) *Hub {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Hub{
		cfg:    cfg,
		now:    now,
		rooms:  map[string]*room{},
		logger: cfg.Logger,
	}
}

func (h *Hub) CreateRoom(_ context.Context, roomID string, expiresAt time.Time, hostPubkey string, controllerPubkey string) error {
	if roomID == "" {
		return errors.New("relay: room id is required")
	}
	if hostPubkey == "" {
		return errors.New("relay: host pubkey is required")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireLocked(h.now())
	if existing, ok := h.rooms[roomID]; ok {
		if existing.hostPubkey != "" && existing.hostPubkey != hostPubkey {
			return ErrPubkeyMismatch
		}
		existing.expiresAt = expiresAt
		existing.hostPubkey = hostPubkey
		if controllerPubkey != "" {
			existing.controllerPubkey = controllerPubkey
		}
		return nil
	}
	if len(h.rooms) >= h.cfg.MaxRooms {
		return ErrRoomLimitReached
	}
	h.rooms[roomID] = &room{
		id:               roomID,
		expiresAt:        expiresAt,
		hostPubkey:       hostPubkey,
		controllerPubkey: controllerPubkey,
		createdAt:        h.now(),
	}
	if h.cfg.Metrics != nil {
		h.cfg.Metrics.ActiveRooms.Add(1)
	}
	return nil
}

func (h *Hub) HandleConnection(ctx context.Context, role token.Role, assertion token.Assertion, ws *websocket.Conn) error {
	state, err := h.register(role, assertion, ws)
	if err != nil {
		ws.Close(websocket.StatusPolicyViolation, err.Error())
		return err
	}
	defer h.unregister(state)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	wg.Go(func() {
		state.writeLoop(ctx, cancel)
	})
	wg.Go(func() {
		state.heartbeatLoop(ctx, cancel)
	})
	err = state.readLoop(ctx, cancel)
	cancel()
	wg.Wait()
	return err
}

func (h *Hub) CloseRoom(_ context.Context, roomID string, reason string) error {
	h.mu.Lock()
	room, ok := h.rooms[roomID]
	if ok {
		delete(h.rooms, roomID)
		if h.cfg.Metrics != nil {
			h.cfg.Metrics.ActiveRooms.Add(-1)
		}
	}
	h.mu.Unlock()
	if !ok {
		return ErrRoomNotFound
	}
	if room.host != nil {
		room.host.close(websocket.StatusNormalClosure, reason)
	}
	if room.controller != nil {
		room.controller.close(websocket.StatusNormalClosure, reason)
	}
	return nil
}

func (h *Hub) register(role token.Role, assertion token.Assertion, ws *websocket.Conn) (*connState, error) {
	if assertion.RoomID == "" {
		return nil, errors.New("relay: assertion room id is required")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireLocked(h.now())
	room, ok := h.rooms[assertion.RoomID]
	if !ok {
		return nil, ErrRoomNotFound
	}
	if !h.now().Before(room.expiresAt) {
		delete(h.rooms, assertion.RoomID)
		if h.cfg.Metrics != nil {
			h.cfg.Metrics.ActiveRooms.Add(-1)
			h.cfg.Metrics.RoomExpirations.Add(1)
		}
		return nil, ErrRoomNotFound
	}
	if role == RoleHost && room.host != nil {
		return nil, ErrRoomFull
	}
	if role == RoleController && room.controller != nil {
		return nil, ErrRoomFull
	}
	if role == RoleHost && assertion.Pubkey != room.hostPubkey {
		return nil, ErrPubkeyMismatch
	}
	if role == RoleController {
		if room.controllerPubkey == "" || assertion.Pubkey != room.controllerPubkey {
			return nil, ErrPubkeyMismatch
		}
	}

	state := &connState{
		role:      role,
		roomID:    assertion.RoomID,
		conn:      ws,
		scheduler: newPeerScheduler(h.cfg.MaxQueuedEnvelopes, h.cfg.MaxQueuedBytes, h.cfg.MaxFrameBytes),
		done:      make(chan struct{}),
		cfg:       h.cfg,
		hub:       h,
		logger:    h.logger,
	}
	state.lastSeenUnix.Store(h.now().UnixNano())
	// Renew the room's TTL on every (re)connect so a reconnecting peer never
	// finds its room expired — long-lived tunnels survive host/controller restarts.
	room.expiresAt = h.now().Add(h.cfg.RoomTTL)
	if role == RoleHost {
		room.host = state
		if h.cfg.Metrics != nil {
			h.cfg.Metrics.ActiveHostSockets.Add(1)
		}
		return state, nil
	}
	room.controller = state
	if h.cfg.Metrics != nil {
		h.cfg.Metrics.ActiveControllerSockets.Add(1)
	}
	return state, nil
}

func (h *Hub) SetControllerPubkey(_ context.Context, roomID string, controllerPubkey string) error {
	if roomID == "" {
		return errors.New("relay: room id is required")
	}
	if controllerPubkey == "" {
		return errors.New("relay: controller pubkey is required")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireLocked(h.now())
	room, ok := h.rooms[roomID]
	if !ok {
		return ErrRoomNotFound
	}
	if room.controllerPubkey != "" && room.controllerPubkey != controllerPubkey {
		return ErrPubkeyMismatch
	}
	room.controllerPubkey = controllerPubkey
	return nil
}

func (h *Hub) unregister(state *connState) {
	state.close(websocket.StatusNormalClosure, "connection closed")
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[state.roomID]
	if !ok {
		return
	}
	if state.role == RoleHost && room.host == state {
		room.host = nil
		if h.cfg.Metrics != nil {
			h.cfg.Metrics.ActiveHostSockets.Add(-1)
		}
		h.notifyPeerLocked(room.controller, state.role, "closed")
	}
	if state.role == RoleController && room.controller == state {
		room.controller = nil
		if h.cfg.Metrics != nil {
			h.cfg.Metrics.ActiveControllerSockets.Add(-1)
		}
		h.notifyPeerLocked(room.host, state.role, "closed")
	}
}

func (h *Hub) forward(from *connState, env Envelope) error {
	if env.RoomID != from.roomID {
		return fmt.Errorf("%w: room mismatch", ErrInvalidEnvelope)
	}
	encoded, err := EncodeEnvelope(env, from.cfg.MaxFrameBytes)
	if err != nil {
		return err
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[from.roomID]
	if !ok {
		return ErrRoomNotFound
	}
	var peer *connState
	if from.role == RoleHost {
		peer = room.controller
	} else {
		peer = room.host
	}
	if peer == nil {
		return ErrPeerNotConnected
	}
	if err := peer.enqueue(encoded, env.Priority, env.StreamID); err != nil {
		if h.cfg.Metrics != nil && errors.Is(err, ErrSlowConsumer) {
			h.cfg.Metrics.SlowConsumerCloses.Add(1)
		}
		peer.close(websocket.StatusPolicyViolation, "slow consumer")
		return err
	}
	if h.cfg.Metrics != nil {
		h.cfg.Metrics.ForwardedEnvelopes.Add(1)
		h.cfg.Metrics.ForwardedBytes.Add(int64(len(encoded)))
	}
	return nil
}

func (h *Hub) notifyPeerLocked(peer *connState, role token.Role, reason string) {
	if peer == nil {
		return
	}
	env, err := RelayControlEnvelope(peer.roomID, KindPeerClosed, map[string]string{
		"role":   string(role),
		"reason": reason,
	})
	if err != nil {
		h.logger.Warn("creating peer close envelope failed", "error", err)
		return
	}
	encoded, err := EncodeEnvelope(env, h.cfg.MaxFrameBytes)
	if err != nil {
		h.logger.Warn("encoding peer close envelope failed", "error", err)
		return
	}
	if err := peer.enqueue(encoded, PriorityControl, ""); err != nil {
		peer.close(websocket.StatusPolicyViolation, "slow consumer")
	}
}

func (h *Hub) expireLocked(now time.Time) int {
	var removed int
	for roomID, room := range h.rooms {
		if now.Before(room.expiresAt) {
			continue
		}
		// Don't expire a room that still has an active peer — extend its TTL
		// instead. A long-lived relay tunnel can outlive the original RoomTTL;
		// tearing it down while peers are connected would force a full
		// re-pairing. Idle rooms (no peers) expire as normal.
		if room.host != nil || room.controller != nil {
			room.expiresAt = now.Add(h.cfg.RoomTTL)
			continue
		}
		delete(h.rooms, roomID)
		removed++
	}
	if removed > 0 && h.cfg.Metrics != nil {
		h.cfg.Metrics.ActiveRooms.Add(-int64(removed))
		h.cfg.Metrics.RoomExpirations.Add(int64(removed))
	}
	return removed
}

// renewRoom extends a room's expiry by RoomTTL from now. Called from the
// heartbeat loop of each connected peer so an active room's TTL is continuously
// refreshed while at least one peer is alive.
func (h *Hub) renewRoom(roomID string, now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[roomID]; ok {
		room.expiresAt = now.Add(h.cfg.RoomTTL)
	}
}

func (c *connState) readLoop(ctx context.Context, cancel context.CancelFunc) error {
	c.conn.SetReadLimit(c.cfg.MaxFrameBytes)
	for {
		messageType, data, err := c.conn.Read(ctx)
		if err != nil {
			cancel()
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			return fmt.Errorf("reading websocket: %w", err)
		}
		if messageType != websocket.MessageBinary {
			c.close(websocket.StatusUnsupportedData, "relay frames must be binary")
			cancel()
			return ErrInvalidEnvelope
		}
		c.lastSeenUnix.Store(time.Now().UnixNano())
		env, err := ParseEnvelope(data, c.cfg.MaxFrameBytes)
		if err != nil {
			if c.cfg.Metrics != nil {
				c.cfg.Metrics.ValidationFailures.Add(1)
			}
			c.close(websocket.StatusUnsupportedData, "invalid envelope")
			cancel()
			return err
		}
		if err := c.hub.forward(c, env); err != nil {
			status := websocket.StatusPolicyViolation
			if errors.Is(err, ErrPeerNotConnected) {
				status = websocket.StatusTryAgainLater
			}
			c.close(status, err.Error())
			cancel()
			return err
		}
	}
}

func (c *connState) writeLoop(ctx context.Context, cancel context.CancelFunc) {
	for {
		item, err := c.scheduler.next(ctx)
		if err != nil {
			return
		}
		writeCtx, stop := context.WithTimeout(ctx, 10*time.Second)
		err = c.write(writeCtx, item.data)
		stop()
		if err != nil {
			cancel()
			return
		}
	}
}

func (c *connState) heartbeatLoop(ctx context.Context, cancel context.CancelFunc) {
	ticker := time.NewTicker(c.cfg.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			lastSeen := time.Unix(0, c.lastSeenUnix.Load())
			if time.Since(lastSeen) > c.cfg.IdleTimeout {
				if c.cfg.Metrics != nil {
					c.cfg.Metrics.HeartbeatCloses.Add(1)
				}
				c.close(websocket.StatusPolicyViolation, "heartbeat timeout")
				cancel()
				return
			}
			pingCtx, stop := context.WithTimeout(ctx, c.cfg.HeartbeatInterval)
			err := c.ping(pingCtx)
			stop()
			if err != nil {
				if isNetClosed(err) {
					cancel()
					return
				}
				if c.cfg.Metrics != nil {
					c.cfg.Metrics.HeartbeatCloses.Add(1)
				}
				c.close(websocket.StatusPolicyViolation, "heartbeat timeout")
				cancel()
				return
			}
			c.lastSeenUnix.Store(time.Now().UnixNano())
			// Refresh the room's TTL while this peer is alive and responding to
			// pings, so an active relay tunnel is never expired out from under it.
			c.hub.renewRoom(c.roomID, c.hub.now())
		}
	}
}

func (c *connState) write(ctx context.Context, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Write(ctx, websocket.MessageBinary, data)
}

func (c *connState) ping(ctx context.Context) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Ping(ctx)
}

func (c *connState) enqueue(data []byte, priority, streamID string) error {
	size := int64(len(data))
	return c.scheduler.enqueue(queuedEnvelope{data: data, size: size}, priority, streamID)
}

func (c *connState) close(status websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		c.conn.Close(status, reason)
		close(c.done)
	})
}

func isNetClosed(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr)
}

func EncodePayload(payload map[string]string) json.RawMessage {
	raw, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return raw
}
