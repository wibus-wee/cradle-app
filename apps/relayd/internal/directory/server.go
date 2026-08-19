// Package directory exposes the Fabric control plane. Its payloads are only
// identity, authorization, and Node-summary metadata; relay payloads remain
// owned by the transport package and are never decoded here.
package directory

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/cradle/relayd/internal/fabric"
	"github.com/cradle/relayd/internal/membership"
	"github.com/cradle/relayd/internal/relay"
)

const (
	certificateHeader = "X-Cradle-Fabric-Certificate"
	proofHeader       = "X-Cradle-Fabric-Proof"
	maxJSONBodyBytes  = 64 << 10
)

type Server struct {
	store     *fabric.Store
	validator *membership.Validator
	broker    *broker
	links     *relay.FabricHub
}

type Config struct {
	Store     *fabric.Store
	Validator *membership.Validator
	Links     *relay.FabricHub
}

type createFabricResponse struct {
	Fabric fabric.Fabric `json:"fabric"`
}

type createJoinRequestResponse struct {
	RequestID string    `json:"requestId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type approveJoinRequest struct {
	NodeCertificate       membership.Certificate `json:"nodeCertificate"`
	ControllerCertificate membership.Certificate `json:"controllerCertificate"`
}

type registerControllerRequest struct {
	Certificate membership.Certificate `json:"certificate"`
	Grants      []fabric.Grant         `json:"grants"`
}

type event struct {
	Type     string              `json:"type"`
	Revision int64               `json:"revision"`
	Node     *fabric.NodeSummary `json:"node,omitempty"`
}

func NewServer(cfg Config) (*Server, error) {
	if cfg.Store == nil {
		return nil, errors.New("directory: fabric store is required")
	}
	if cfg.Validator == nil {
		return nil, errors.New("directory: membership validator is required")
	}
	return &Server{store: cfg.Store, validator: cfg.Validator, broker: newBroker(), links: cfg.Links}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/fabrics", s.createFabric)
	mux.HandleFunc("POST /v1/join-requests", s.createJoinRequest)
	mux.HandleFunc("GET /v1/join-requests/{requestId}", s.readJoinRequest)
	mux.HandleFunc("POST /v1/join-requests/{requestId}/approve", s.approveJoinRequest)
	mux.HandleFunc("GET /v1/fabrics/{fabricId}/join-requests", s.listJoinRequests)
	mux.HandleFunc("DELETE /v1/fabrics/{fabricId}/join-requests/{requestId}", s.rejectJoinRequest)
	mux.HandleFunc("POST /v1/fabrics/{fabricId}/controllers", s.registerController)
	mux.HandleFunc("GET /v1/fabrics/{fabricId}/nodes", s.listNodes)
	mux.HandleFunc("GET /v1/fabrics/{fabricId}/events", s.events)
	mux.HandleFunc("POST /v1/nodes/{nodeId}/links", s.openLink)
	mux.HandleFunc("GET /v1/nodes/{nodeId}/grants", s.listNodeGrants)
	mux.HandleFunc("DELETE /v1/nodes/{nodeId}/grants/{grantId}", s.revokeGrant)
	mux.HandleFunc("GET /v1/ws/nodes", s.nodeWebSocket)
	mux.HandleFunc("GET /v1/ws/controllers/{linkId}", s.controllerWebSocket)
}

func (s *Server) createFabric(w http.ResponseWriter, r *http.Request) {
	var request membership.CreateFabricRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := s.validator.VerifyCreateFabric(request); err != nil {
		writeMembershipError(w, err)
		return
	}
	created, err := s.store.CreateFabric(r.Context(), request.RequestID, request.OwnerPubkey)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, createFabricResponse{Fabric: created})
}

func (s *Server) createJoinRequest(w http.ResponseWriter, r *http.Request) {
	var request membership.JoinRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := s.validator.VerifyJoinRequest(request); err != nil {
		writeMembershipError(w, err)
		return
	}
	created, err := s.store.CreateJoinRequest(r.Context(), request)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, createJoinRequestResponse{
		RequestID: created.Request.RequestID,
		ExpiresAt: time.Unix(created.Request.ExpiresAt, 0).UTC(),
	})
}

func (s *Server) readJoinRequest(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("requestId")
	result, err := s.store.ReadJoinRequest(r.Context(), requestID, r.URL.Query().Get("secret"))
	if errors.Is(err, fabric.ErrJoinRequestPending) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending", "request": result.Request})
		return
	}
	if errors.Is(err, fabric.ErrJoinRequestRejected) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "rejected", "request": result.Request, "rejectedAt": result.RejectedAt})
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":                "approved",
		"request":               result.Request,
		"nodeCertificate":       result.NodeCertificate,
		"controllerCertificate": result.ControllerCertificate,
		"approvedAt":            result.ApprovedAt,
	})
}

func (s *Server) listJoinRequests(w http.ResponseWriter, r *http.Request) {
	fabricID := r.PathValue("fabricId")
	record, err := s.store.GetFabric(r.Context(), fabricID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, record); err != nil {
		writeMembershipError(w, err)
		return
	}
	requests, err := s.store.ListPendingJoinRequests(r.Context(), fabricID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": requests})
}

func (s *Server) rejectJoinRequest(w http.ResponseWriter, r *http.Request) {
	fabricID := r.PathValue("fabricId")
	record, err := s.store.GetFabric(r.Context(), fabricID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, record); err != nil {
		writeMembershipError(w, err)
		return
	}
	if err := s.store.RejectJoinRequest(r.Context(), fabricID, r.PathValue("requestId")); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) approveJoinRequest(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("requestId")
	var request approveJoinRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	fabricRecord, err := s.store.GetFabric(r.Context(), request.NodeCertificate.FabricID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, fabricRecord); err != nil {
		writeMembershipError(w, err)
		return
	}
	if err := s.validator.VerifyCertificate(request.NodeCertificate, fabricRecord.OwnerPublicKey, fabricRecord.ID); err != nil {
		writeMembershipError(w, err)
		return
	}
	if err := s.validator.VerifyCertificate(request.ControllerCertificate, fabricRecord.OwnerPublicKey, fabricRecord.ID); err != nil {
		writeMembershipError(w, err)
		return
	}
	if request.ControllerCertificate.SubjectKind != membership.SubjectController || !membership.HasAnyScope(request.ControllerCertificate.Scopes, membership.ScopeAdmin) {
		writeError(w, http.StatusBadRequest, "admin Controller certificate is required")
		return
	}
	node, err := s.store.ApproveJoinRequest(r.Context(), requestID, request.NodeCertificate, request.ControllerCertificate)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.broker.publish(node.FabricID, event{Type: "node.upsert", Revision: node.Revision, Node: &node})
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) registerController(w http.ResponseWriter, r *http.Request) {
	fabricID := r.PathValue("fabricId")
	record, err := s.store.GetFabric(r.Context(), fabricID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, record); err != nil {
		writeMembershipError(w, err)
		return
	}
	var request registerControllerRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if request.Certificate.SubjectKind != membership.SubjectController {
		writeError(w, http.StatusBadRequest, "controller certificate is required")
		return
	}
	if err := s.validator.VerifyCertificate(request.Certificate, record.OwnerPublicKey, record.ID); err != nil {
		writeMembershipError(w, err)
		return
	}
	nodeRestriction := controllerNodeRestriction(request.Certificate)
	for _, grant := range request.Grants {
		if (nodeRestriction != "" && grant.NodeID != nodeRestriction) || !membership.HasAnyScope(request.Certificate.Scopes, grant.Scope, membership.ScopeAdmin) {
			writeError(w, http.StatusForbidden, "controller certificate does not authorize this grant")
			return
		}
	}
	if err := s.store.RegisterController(r.Context(), request.Certificate, request.Grants); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listNodes(w http.ResponseWriter, r *http.Request) {
	fabricID := r.PathValue("fabricId")
	controller, err := s.requireController(r, fabricID)
	if err != nil {
		writeMembershipError(w, err)
		return
	}
	nodes, revision, err := s.store.ListAuthorizedNodes(r.Context(), fabricID, controller.SubjectID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revision": revision, "nodes": restrictNodes(nodes, controllerNodeRestriction(controller))})
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fabricID := r.PathValue("fabricId")
	controller, err := s.requireController(r, fabricID)
	if err != nil {
		writeMembershipError(w, err)
		return
	}
	nodes, revision, err := s.store.ListAuthorizedNodes(r.Context(), fabricID, controller.SubjectID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming is unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	nodeRestriction := controllerNodeRestriction(controller)
	if !writeSSE(w, "snapshot", map[string]any{"revision": revision, "nodes": restrictNodes(nodes, nodeRestriction)}) {
		return
	}
	flusher.Flush()
	updates, cancel := s.broker.subscribe(fabricID)
	defer cancel()
	for {
		select {
		case <-r.Context().Done():
			return
		case update := <-updates:
			if update.Node != nil {
				if nodeRestriction != "" && update.Node.NodeID != nodeRestriction {
					continue
				}
				allowed, err := s.store.HasActiveGrant(r.Context(), fabricID, controller.SubjectID, update.Node.NodeID, membership.ScopeView, membership.ScopeControl, membership.ScopeApprove, membership.ScopeAdmin)
				if err != nil || !allowed {
					continue
				}
			}
			if !writeSSE(w, update.Type, update) {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) listNodeGrants(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("nodeId")
	record, err := s.store.GetFabricForNode(r.Context(), nodeID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, record); err != nil {
		writeMembershipError(w, err)
		return
	}
	grants, err := s.store.ListNodeGrants(r.Context(), record.ID, nodeID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"grants": grants})
}

func (s *Server) revokeGrant(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("nodeId")
	grantID := r.PathValue("grantId")
	record, err := s.store.GetFabricForNode(r.Context(), nodeID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.requireOwner(r, record); err != nil {
		writeMembershipError(w, err)
		return
	}
	grant, err := s.store.RevokeGrant(r.Context(), record.ID, nodeID, grantID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if s.links != nil {
		s.links.RevokeControllerNode(record.ID, nodeID, grant.ControllerID)
	}
	node, err := s.store.GetNode(r.Context(), record.ID, nodeID)
	if err == nil {
		s.broker.publish(record.ID, event{Type: "node.grant_revoked", Revision: node.Revision, Node: &node})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) openLink(w http.ResponseWriter, r *http.Request) {
	if s.links == nil {
		writeError(w, http.StatusServiceUnavailable, "fabric transport is unavailable")
		return
	}
	nodeID := r.PathValue("nodeId")
	record, err := s.store.GetFabricForNode(r.Context(), nodeID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	controller, err := s.requireController(r, record.ID)
	if err != nil {
		writeMembershipError(w, err)
		return
	}
	if !membership.HasAnyScope(controller.Scopes, membership.ScopeControl, membership.ScopeAdmin) {
		writeError(w, http.StatusForbidden, "control grant is required")
		return
	}
	granted, err := s.store.HasActiveGrant(r.Context(), record.ID, controller.SubjectID, nodeID, membership.ScopeControl, membership.ScopeAdmin)
	if err != nil || !granted {
		writeError(w, http.StatusForbidden, "control grant is required")
		return
	}
	linkID, err := randomLinkID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create link")
		return
	}
	certificate, err := json.Marshal(controller)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not encode controller certificate")
		return
	}
	if err := s.links.OpenLink(record.ID, nodeID, linkID, controller.SubjectID, certificate); err != nil {
		if errors.Is(err, relay.ErrNodeNotConnected) {
			writeError(w, http.StatusServiceUnavailable, "fabric node offline")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not open link")
		return
	}
	nodeCertificate, err := s.store.GetNodeCertificate(r.Context(), record.ID, nodeID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"linkId": linkID, "expiresAt": time.Now().Add(15 * time.Minute).UTC(), "nodeCertificate": nodeCertificate})
}

func (s *Server) nodeWebSocket(w http.ResponseWriter, r *http.Request) {
	if s.links == nil {
		writeError(w, http.StatusServiceUnavailable, "fabric transport is unavailable")
		return
	}
	certificate, err := certificateFromHeader(r)
	if err != nil || certificate.SubjectKind != membership.SubjectNode {
		writeMembershipError(w, membership.ErrInvalidDocument)
		return
	}
	record, err := s.store.GetFabric(r.Context(), certificate.FabricID)
	if err != nil || s.validator.VerifyCertificate(certificate, record.OwnerPublicKey, record.ID) != nil {
		writeMembershipError(w, membership.ErrInvalidDocument)
		return
	}
	proof, err := proofFromHeader(r)
	if err != nil || s.validator.VerifyRequestProof(proof, certificate.IdentityPubkey, r.Method, r.URL.Path) != nil {
		writeMembershipError(w, membership.ErrInvalidDocument)
		return
	}
	exists, err := s.store.NodeExists(r.Context(), record.ID, certificate.SubjectID, certificate.IdentityPubkey)
	if err != nil || !exists {
		writeMembershipError(w, fabric.ErrAccessDenied)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	if _, err := s.MarkNodePresence(r.Context(), record.ID, certificate.SubjectID, fabric.NodeOnline); err != nil {
		_ = ws.Close(websocket.StatusPolicyViolation, "node unavailable")
		return
	}
	defer func() {
		_, _ = s.MarkNodePresence(context.Background(), record.ID, certificate.SubjectID, fabric.NodeOffline)
	}()
	_ = s.links.HandleNode(r.Context(), record.ID, certificate.SubjectID, ws)
}

func (s *Server) controllerWebSocket(w http.ResponseWriter, r *http.Request) {
	if s.links == nil {
		writeError(w, http.StatusServiceUnavailable, "fabric transport is unavailable")
		return
	}
	linkID := r.PathValue("linkId")
	link, err := s.links.LinkInfo(linkID)
	if err != nil {
		writeError(w, http.StatusNotFound, "fabric link not found")
		return
	}
	controller, err := s.requireController(r, link.FabricID)
	if err != nil || controller.SubjectID != link.ControllerID {
		writeMembershipError(w, membership.ErrInvalidDocument)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
	if err != nil {
		return
	}
	_ = s.links.HandleController(r.Context(), linkID, controller.SubjectID, ws)
}

// Admin controllers are scoped by durable grants. Earlier device certificates
// carried a node ID, which must not hide other nodes subsequently granted to them.
func controllerNodeRestriction(certificate membership.Certificate) string {
	if membership.HasAnyScope(certificate.Scopes, membership.ScopeAdmin) {
		return ""
	}
	return certificate.NodeID
}

func restrictNodes(nodes []fabric.NodeSummary, nodeID string) []fabric.NodeSummary {
	if nodeID == "" {
		return nodes
	}
	for _, node := range nodes {
		if node.NodeID == nodeID {
			return []fabric.NodeSummary{node}
		}
	}
	return []fabric.NodeSummary{}
}

// MarkNodePresence is called by the Node socket owner in Milestone 2. It is
// already independent of the room relay and therefore safe to exercise in
// Milestone 1 store/integration tests.
func (s *Server) MarkNodePresence(ctx context.Context, fabricID, nodeID string, status fabric.NodeStatus) (fabric.NodeSummary, error) {
	node, err := s.store.SetNodePresence(ctx, fabricID, nodeID, status)
	if err != nil {
		return fabric.NodeSummary{}, err
	}
	s.broker.publish(fabricID, event{Type: "node.presence", Revision: node.Revision, Node: &node})
	return node, nil
}

func (s *Server) requireOwner(r *http.Request, record fabric.Fabric) error {
	proof, err := proofFromHeader(r)
	if err != nil {
		return err
	}
	return s.validator.VerifyRequestProof(proof, record.OwnerPublicKey, r.Method, r.URL.Path)
}

func (s *Server) requireController(r *http.Request, fabricID string) (membership.Certificate, error) {
	record, err := s.store.GetFabric(r.Context(), fabricID)
	if err != nil {
		return membership.Certificate{}, err
	}
	certificate, err := certificateFromHeader(r)
	if err != nil {
		return membership.Certificate{}, err
	}
	if certificate.SubjectKind != membership.SubjectController || certificate.FabricID != fabricID || !membership.HasAnyScope(certificate.Scopes, membership.ScopeView, membership.ScopeControl, membership.ScopeAdmin) {
		return membership.Certificate{}, membership.ErrInvalidDocument
	}
	if err := s.validator.VerifyCertificate(certificate, record.OwnerPublicKey, fabricID); err != nil {
		return membership.Certificate{}, err
	}
	proof, err := proofFromHeader(r)
	if err != nil {
		return membership.Certificate{}, err
	}
	if err := s.validator.VerifyRequestProof(proof, certificate.IdentityPubkey, r.Method, r.URL.Path); err != nil {
		return membership.Certificate{}, err
	}
	exists, err := s.store.ControllerExists(r.Context(), fabricID, certificate.SubjectID, certificate.IdentityPubkey)
	if err != nil {
		return membership.Certificate{}, err
	}
	if !exists {
		return membership.Certificate{}, fabric.ErrAccessDenied
	}
	return certificate, nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeMembershipError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fabric.ErrFabricNotFound), errors.Is(err, fabric.ErrAccessDenied), errors.Is(err, membership.ErrWrongFabric):
		writeError(w, http.StatusNotFound, "fabric node not found")
	case errors.Is(err, membership.ErrExpired), errors.Is(err, membership.ErrReplayedNonce), errors.Is(err, membership.ErrInvalidDocument):
		writeError(w, http.StatusUnauthorized, "invalid fabric membership")
	default:
		writeError(w, http.StatusUnauthorized, "invalid fabric membership")
	}
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fabric.ErrFabricNotFound), errors.Is(err, fabric.ErrJoinRequestNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, fabric.ErrJoinRequestPending):
		writeError(w, http.StatusConflict, "join request is pending")
	case errors.Is(err, fabric.ErrJoinRequestRejected):
		writeError(w, http.StatusConflict, "join request was rejected")
	case errors.Is(err, fabric.ErrJoinRequestExpired):
		writeError(w, http.StatusGone, "join request expired")
	case errors.Is(err, fabric.ErrAccessDenied):
		writeError(w, http.StatusForbidden, "access denied")
	default:
		writeError(w, http.StatusInternalServerError, "fabric directory failure")
	}
}

func certificateFromHeader(r *http.Request) (membership.Certificate, error) {
	var certificate membership.Certificate
	if err := decodeHeaderJSON(r.Header.Get(certificateHeader), &certificate); err != nil {
		return membership.Certificate{}, err
	}
	return certificate, nil
}

func proofFromHeader(r *http.Request) (membership.RequestProof, error) {
	var proof membership.RequestProof
	if err := decodeHeaderJSON(r.Header.Get(proofHeader), &proof); err != nil {
		return membership.RequestProof{}, err
	}
	return proof, nil
}

func decodeHeaderJSON(value string, out any) error {
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return membership.ErrInvalidDocument
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return membership.ErrInvalidDocument
	}
	return nil
}

func randomLinkID() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "lnk_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func writeSSE(w http.ResponseWriter, eventName string, value any) bool {
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventName, raw)
	return err == nil
}

type broker struct {
	mu          sync.Mutex
	subscribers map[string]map[chan event]struct{}
}

func newBroker() *broker {
	return &broker{subscribers: map[string]map[chan event]struct{}{}}
}

func (b *broker) subscribe(fabricID string) (<-chan event, func()) {
	updates := make(chan event, 16)
	b.mu.Lock()
	if b.subscribers[fabricID] == nil {
		b.subscribers[fabricID] = map[chan event]struct{}{}
	}
	b.subscribers[fabricID][updates] = struct{}{}
	b.mu.Unlock()
	return updates, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.subscribers[fabricID], updates)
		if len(b.subscribers[fabricID]) == 0 {
			delete(b.subscribers, fabricID)
		}
	}
}

func (b *broker) publish(fabricID string, update event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for subscriber := range b.subscribers[fabricID] {
		select {
		case subscriber <- update:
		default:
			// Subscribers always receive a snapshot on reconnection. Dropping an
			// overfull live update is preferable to unbounded relay control-plane
			// memory and cannot expose another Node's state.
		}
	}
}
