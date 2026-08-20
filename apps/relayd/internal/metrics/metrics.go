// Package metrics owns relayd's bounded-cardinality Prometheus surface.
package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const namespace = "cradle_relayd"

type Metrics struct {
	handler http.Handler

	connections            *prometheus.GaugeVec
	connectionErrors       *prometheus.CounterVec
	links                  prometheus.Gauge
	linkEvents             *prometheus.CounterVec
	frames                 *prometheus.CounterVec
	frameBytes             *prometheus.CounterVec
	frameSize              *prometheus.HistogramVec
	queueEnvelopes         *prometheus.GaugeVec
	queueBytes             *prometheus.GaugeVec
	queueBackpressure      *prometheus.CounterVec
	queueBackpressureWait  *prometheus.HistogramVec
	websocketWrites        *prometheus.CounterVec
	websocketWriteDuration prometheus.Histogram
	directorySubscribers   prometheus.Gauge
	directoryEvents        *prometheus.CounterVec
	httpRequests           *prometheus.CounterVec
	httpRequestDuration    *prometheus.HistogramVec
}

func New(version string) *Metrics {
	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	m := &Metrics{
		connections: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: namespace, Name: "connections", Help: "Active Relay WebSocket connections by peer role.",
		}, []string{"role"}),
		connectionErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "connection_errors_total", Help: "Relay WebSocket sessions terminated by error class.",
		}, []string{"role", "reason"}),
		links: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: namespace, Name: "links", Help: "Active authorized Fabric links.",
		}),
		linkEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "link_events_total", Help: "Fabric link lifecycle events.",
		}, []string{"event"}),
		frames: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "frames_total", Help: "Opaque Fabric frames accepted for forwarding.",
		}, []string{"direction", "priority"}),
		frameBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "frame_bytes_total", Help: "Opaque Fabric frame bytes accepted for forwarding.",
		}, []string{"direction", "priority"}),
		frameSize: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: namespace, Name: "frame_size_bytes", Help: "Opaque Fabric frame size distribution.",
			Buckets: prometheus.ExponentialBuckets(256, 4, 7),
		}, []string{"direction", "priority"}),
		queueEnvelopes: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: namespace, Name: "queue_envelopes", Help: "Opaque envelopes currently queued across Relay peers.",
		}, []string{"priority"}),
		queueBytes: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: namespace, Name: "queue_bytes", Help: "Opaque envelope bytes currently queued across Relay peers.",
		}, []string{"priority"}),
		queueBackpressure: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "queue_backpressure_total", Help: "Queue capacity checks that required a producer to wait.",
		}, []string{"priority"}),
		queueBackpressureWait: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: namespace, Name: "queue_backpressure_wait_seconds", Help: "Time producers spend waiting for Relay queue capacity.",
			Buckets: prometheus.ExponentialBuckets(0.0005, 4, 8),
		}, []string{"priority"}),
		websocketWrites: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "websocket_writes_total", Help: "Relay WebSocket frame write outcomes.",
		}, []string{"outcome"}),
		websocketWriteDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Namespace: namespace, Name: "websocket_write_duration_seconds", Help: "Relay WebSocket frame write duration.",
			Buckets: prometheus.ExponentialBuckets(0.00025, 4, 8),
		}),
		directorySubscribers: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: namespace, Name: "directory_subscribers", Help: "Active Fabric directory SSE subscribers.",
		}),
		directoryEvents: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "directory_events_total", Help: "Fabric directory event delivery outcomes.",
		}, []string{"outcome"}),
		httpRequests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: namespace, Name: "http_requests_total", Help: "relayd HTTP requests by method and status code.",
		}, []string{"code", "method"}),
		httpRequestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: namespace, Name: "http_request_duration_seconds", Help: "relayd HTTP request duration by method.",
			Buckets: prometheus.DefBuckets,
		}, []string{"method"}),
	}

	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: namespace, Name: "build_info", Help: "relayd build information.",
	}, []string{"version"})
	buildInfo.WithLabelValues(version).Set(1)
	for _, role := range []string{"node", "controller"} {
		m.connections.WithLabelValues(role).Set(0)
	}
	for _, priority := range []string{"control", "data"} {
		m.queueEnvelopes.WithLabelValues(priority).Set(0)
		m.queueBytes.WithLabelValues(priority).Set(0)
	}
	m.links.Set(0)
	m.directorySubscribers.Set(0)

	registry.MustRegister(
		buildInfo,
		m.connections,
		m.connectionErrors,
		m.links,
		m.linkEvents,
		m.frames,
		m.frameBytes,
		m.frameSize,
		m.queueEnvelopes,
		m.queueBytes,
		m.queueBackpressure,
		m.queueBackpressureWait,
		m.websocketWrites,
		m.websocketWriteDuration,
		m.directorySubscribers,
		m.directoryEvents,
		m.httpRequests,
		m.httpRequestDuration,
	)
	m.handler = promhttp.HandlerFor(registry, promhttp.HandlerOpts{EnableOpenMetrics: true})
	return m
}

func (m *Metrics) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.handler.ServeHTTP(w, r)
}

func (m *Metrics) InstrumentHTTP(next http.Handler) http.Handler {
	return promhttp.InstrumentHandlerDuration(
		m.httpRequestDuration,
		promhttp.InstrumentHandlerCounter(m.httpRequests, next),
	)
}

func (m *Metrics) ConnectionOpened(role string) { m.connections.WithLabelValues(role).Inc() }
func (m *Metrics) ConnectionClosed(role string) { m.connections.WithLabelValues(role).Dec() }
func (m *Metrics) ConnectionError(role, reason string) {
	m.connectionErrors.WithLabelValues(role, reason).Inc()
}
func (m *Metrics) LinkOpened() {
	m.links.Inc()
	m.linkEvents.WithLabelValues("opened").Inc()
}
func (m *Metrics) LinkClosed(reason string) {
	m.links.Dec()
	m.linkEvents.WithLabelValues(reason).Inc()
}
func (m *Metrics) FrameForwarded(direction, priority string, size int) {
	m.frames.WithLabelValues(direction, priority).Inc()
	m.frameBytes.WithLabelValues(direction, priority).Add(float64(size))
	m.frameSize.WithLabelValues(direction, priority).Observe(float64(size))
}
func (m *Metrics) QueueEnqueued(priority string, size int64) {
	m.queueEnvelopes.WithLabelValues(priority).Inc()
	m.queueBytes.WithLabelValues(priority).Add(float64(size))
}
func (m *Metrics) QueueDequeued(priority string, size int64) {
	m.queueEnvelopes.WithLabelValues(priority).Dec()
	m.queueBytes.WithLabelValues(priority).Sub(float64(size))
}
func (m *Metrics) QueueBackpressure(priority string) {
	m.queueBackpressure.WithLabelValues(priority).Inc()
}
func (m *Metrics) ObserveQueueWait(priority string, elapsed time.Duration) {
	m.queueBackpressureWait.WithLabelValues(priority).Observe(elapsed.Seconds())
}
func (m *Metrics) ObserveWrite(elapsed time.Duration, err error) {
	outcome := "success"
	if err != nil {
		outcome = "error"
	}
	m.websocketWrites.WithLabelValues(outcome).Inc()
	m.websocketWriteDuration.Observe(elapsed.Seconds())
}
func (m *Metrics) DirectorySubscriberDelta(delta int) {
	m.directorySubscribers.Add(float64(delta))
}
func (m *Metrics) DirectoryEvent(outcome string) {
	m.directoryEvents.WithLabelValues(outcome).Inc()
}
