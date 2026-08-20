// Package metrics exposes relayd's operational counters on /metrics. The
// legacy room/pairing counters were removed with the room transport; new
// Fabric counters are added here as the FabricHub instruments them.
package metrics

import (
	"net/http"
)

type Counters struct{}

func New() *Counters {
	return &Counters{}
}

func (c *Counters) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
}
