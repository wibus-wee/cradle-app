package relay

import (
	"context"
	"errors"
	"time"
)

type Metrics interface {
	ConnectionOpened(role string)
	ConnectionClosed(role string)
	ConnectionError(role, reason string)
	LinkOpened()
	LinkClosed(reason string)
	FrameForwarded(direction, priority string, size int)
	QueueEnqueued(priority string, size int64)
	QueueDequeued(priority string, size int64)
	QueueBackpressure(priority string)
	ObserveQueueWait(priority string, elapsed time.Duration)
	ObserveWrite(elapsed time.Duration, err error)
}

type noopMetrics struct{}

func (noopMetrics) ConnectionOpened(string)                {}
func (noopMetrics) ConnectionClosed(string)                {}
func (noopMetrics) ConnectionError(string, string)         {}
func (noopMetrics) LinkOpened()                            {}
func (noopMetrics) LinkClosed(string)                      {}
func (noopMetrics) FrameForwarded(string, string, int)     {}
func (noopMetrics) QueueEnqueued(string, int64)            {}
func (noopMetrics) QueueDequeued(string, int64)            {}
func (noopMetrics) QueueBackpressure(string)               {}
func (noopMetrics) ObserveQueueWait(string, time.Duration) {}
func (noopMetrics) ObserveWrite(time.Duration, error)      {}

func classifyConnectionError(err error) string {
	switch {
	case err == nil:
		return "closed"
	case errors.Is(err, ErrInvalidEnvelope):
		return "invalid_envelope"
	case errors.Is(err, ErrPeerNotConnected):
		return "peer_unavailable"
	case errors.Is(err, ErrLinkNotFound):
		return "link_not_found"
	case errors.Is(err, ErrLinkConnected), errors.Is(err, ErrNodeConnected):
		return "already_connected"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "context_closed"
	default:
		return "transport_error"
	}
}
