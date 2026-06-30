package metrics

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

type Counters struct {
	ActiveRooms             atomic.Int64
	ActiveHostSockets       atomic.Int64
	ActiveControllerSockets atomic.Int64
	PairingStarts           atomic.Int64
	PairingClaims           atomic.Int64
	AuthFailures            atomic.Int64
	ForwardedEnvelopes      atomic.Int64
	ForwardedBytes          atomic.Int64
	ValidationFailures      atomic.Int64
	SlowConsumerCloses      atomic.Int64
	HeartbeatCloses         atomic.Int64
	RoomExpirations         atomic.Int64
}

func New() *Counters {
	return &Counters{}
}

func (c *Counters) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	writeMetric(w, "cradle_relay_active_rooms", c.ActiveRooms.Load())
	writeMetric(w, "cradle_relay_active_host_sockets", c.ActiveHostSockets.Load())
	writeMetric(w, "cradle_relay_active_controller_sockets", c.ActiveControllerSockets.Load())
	writeMetric(w, "cradle_relay_pairing_starts_total", c.PairingStarts.Load())
	writeMetric(w, "cradle_relay_pairing_claims_total", c.PairingClaims.Load())
	writeMetric(w, "cradle_relay_auth_failures_total", c.AuthFailures.Load())
	writeMetric(w, "cradle_relay_forwarded_envelopes_total", c.ForwardedEnvelopes.Load())
	writeMetric(w, "cradle_relay_forwarded_bytes_total", c.ForwardedBytes.Load())
	writeMetric(w, "cradle_relay_validation_failures_total", c.ValidationFailures.Load())
	writeMetric(w, "cradle_relay_slow_consumer_closes_total", c.SlowConsumerCloses.Load())
	writeMetric(w, "cradle_relay_heartbeat_closes_total", c.HeartbeatCloses.Load())
	writeMetric(w, "cradle_relay_room_expirations_total", c.RoomExpirations.Load())
}

func writeMetric(w http.ResponseWriter, name string, value int64) {
	fmt.Fprintf(w, "# TYPE %s gauge\n%s %d\n", name, name, value)
}
