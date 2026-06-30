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
	id         string
	expiresAt  time.Time
	host       *connState
	controller *connState
	createdAt  time.Time
	closedAt   time.Time
}

type connState struct {
	role         token.Role
	roomID       string
	conn         *websocket.Conn
	outbound     chan queuedEnvelope
	done         chan struct{}
	closeOnce    sync.Once
	writeMu      sync.Mutex
	pendingBytes atomic.Int64
	lastSeenUnix atomic.Int64
	cfg          HubConfig
	hub          *Hub
	logger       *slog.Logger
}

type queuedEnvelope struct {
	data []byte
	size int64
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

func (h *Hub) CreateRoom(_ context.Context, roomID string, expiresAt time.Time) error {
	if roomID == "" {
		return errors.New("relay: room id is required")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireLocked(h.now())
	if _, ok := h.rooms[roomID]; ok {
		h.rooms[roomID].expiresAt = expiresAt
		return nil
	}
	if len(h.rooms) >= h.cfg.MaxRooms {
		return ErrRoomLimitReached
	}
	h.rooms[roomID] = &room{
		id:        roomID,
		expiresAt: expiresAt,
		createdAt: h.now(),
	}
	if h.cfg.Metrics != nil {
		h.cfg.Metrics.ActiveRooms.Add(1)
	}
	return nil
}

func (h *Hub) HandleConnection(ctx context.Context, role token.Role, claims token.Claims, ws *websocket.Conn) error {
	state, err := h.register(role, claims, ws)
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

func (h *Hub) register(role token.Role, claims token.Claims, ws *websocket.Conn) (*connState, error) {
	if claims.RoomID == "" {
		return nil, errors.New("relay: token room id is required")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireLocked(h.now())
	room, ok := h.rooms[claims.RoomID]
	if !ok {
		return nil, ErrRoomNotFound
	}
	if !h.now().Before(room.expiresAt) {
		delete(h.rooms, claims.RoomID)
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

	state := &connState{
		role:     role,
		roomID:   claims.RoomID,
		conn:     ws,
		outbound: make(chan queuedEnvelope, h.cfg.MaxQueuedEnvelopes),
		done:     make(chan struct{}),
		cfg:      h.cfg,
		hub:      h,
		logger:   h.logger,
	}
	state.lastSeenUnix.Store(h.now().UnixNano())
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
	if err := peer.enqueue(encoded); err != nil {
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
	if err := peer.enqueue(encoded); err != nil {
		peer.close(websocket.StatusPolicyViolation, "slow consumer")
	}
}

func (h *Hub) expireLocked(now time.Time) int {
	var removed int
	for roomID, room := range h.rooms {
		if now.Before(room.expiresAt) {
			continue
		}
		delete(h.rooms, roomID)
		removed++
		if room.host != nil {
			room.host.close(websocket.StatusNormalClosure, "room expired")
		}
		if room.controller != nil {
			room.controller.close(websocket.StatusNormalClosure, "room expired")
		}
	}
	if removed > 0 && h.cfg.Metrics != nil {
		h.cfg.Metrics.ActiveRooms.Add(-int64(removed))
		h.cfg.Metrics.RoomExpirations.Add(int64(removed))
	}
	return removed
}

func (c *connState) readLoop(ctx context.Context, cancel context.CancelFunc) error {
	c.conn.SetReadLimit(c.cfg.MaxFrameBytes)
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			cancel()
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
				return nil
			}
			return fmt.Errorf("reading websocket: %w", err)
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
		select {
		case <-ctx.Done():
			return
		case item := <-c.outbound:
			c.pendingBytes.Add(-item.size)
			writeCtx, stop := context.WithTimeout(ctx, 10*time.Second)
			err := c.write(writeCtx, item.data)
			stop()
			if err != nil {
				cancel()
				return
			}
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
		}
	}
}

func (c *connState) write(ctx context.Context, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Write(ctx, websocket.MessageText, data)
}

func (c *connState) ping(ctx context.Context) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Ping(ctx)
}

func (c *connState) enqueue(data []byte) error {
	size := int64(len(data))
	nextBytes := c.pendingBytes.Add(size)
	if nextBytes > c.cfg.MaxQueuedBytes {
		c.pendingBytes.Add(-size)
		return ErrSlowConsumer
	}
	select {
	case c.outbound <- queuedEnvelope{data: data, size: size}:
		return nil
	default:
		c.pendingBytes.Add(-size)
		return ErrSlowConsumer
	}
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
