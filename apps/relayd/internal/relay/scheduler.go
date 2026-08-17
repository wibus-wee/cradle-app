package relay

import (
	"context"
	"errors"
	"net"
	"sync"
)

var (
	ErrPeerNotConnected = errors.New("relay: peer not connected")
	ErrSlowConsumer     = errors.New("relay: slow consumer")
)

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
	space           chan struct{}
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
		space:        make(chan struct{}, 1),
	}
}

func (s *peerScheduler) enqueueWait(ctx context.Context, done <-chan struct{}, item queuedEnvelope, priority, streamID string) error {
	for {
		s.mu.Lock()
		err := s.enqueueLocked(item, priority, streamID)
		s.mu.Unlock()
		if !errors.Is(err, ErrSlowConsumer) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-done:
			return net.ErrClosed
		case <-s.space:
		}
	}
}

func (s *peerScheduler) enqueueLocked(item queuedEnvelope, priority, streamID string) error {
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

func (s *peerScheduler) signalSpace() {
	select {
	case s.space <- struct{}{}:
	default:
	}
}

func (s *peerScheduler) next(ctx context.Context) (queuedEnvelope, error) {
	for {
		s.mu.Lock()
		if len(s.control) > 0 {
			item := s.control[0]
			s.control[0] = queuedEnvelope{}
			s.control = s.control[1:]
			s.queuedBytes -= item.size
			s.queuedCount--
			s.mu.Unlock()
			s.signalSpace()
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
			items[0] = queuedEnvelope{}
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
			s.signalSpace()
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
