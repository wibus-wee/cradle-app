// Package fabric persists the small, non-content directory required to find
// authorized Cradle Nodes. It deliberately never sees relay payload bytes.
package fabric

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/cradle/relayd/internal/membership"
)

var (
	ErrFabricNotFound      = errors.New("fabric: not found")
	ErrJoinRequestNotFound = errors.New("fabric: join request not found")
	ErrJoinRequestExpired  = errors.New("fabric: join request expired")
	ErrJoinRequestPending  = errors.New("fabric: join request pending")
	ErrJoinRequestRejected = errors.New("fabric: join request rejected")
	ErrAccessDenied        = errors.New("fabric: access denied")
)

type NodeStatus string

const (
	NodeOffline NodeStatus = "offline"
	NodeOnline  NodeStatus = "online"
)

type StoreConfig struct {
	Path string
	Now  func() time.Time
}

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type Fabric struct {
	ID             string    `json:"fabricId"`
	OwnerPublicKey string    `json:"ownerPubkey"`
	Revision       int64     `json:"revision"`
	CreatedAt      time.Time `json:"createdAt"`
}

type NodeSummary struct {
	NodeID       string     `json:"nodeId"`
	FabricID     string     `json:"fabricId"`
	DisplayName  string     `json:"displayName"`
	Platform     string     `json:"platform"`
	Version      string     `json:"version"`
	Capabilities []string   `json:"capabilities"`
	Status       NodeStatus `json:"status"`
	LastSeenAt   time.Time  `json:"lastSeenAt"`
	Revision     int64      `json:"revision"`
	// Scopes carries the requesting Controller's active grant scopes over this
	// Node. It is populated only by ListAuthorizedNodes; other reads omit it.
	Scopes []string `json:"scopes,omitempty"`
}

type JoinRequestResult struct {
	Request               membership.JoinRequest  `json:"request"`
	NodeCertificate       *membership.Certificate `json:"nodeCertificate,omitempty"`
	ControllerCertificate *membership.Certificate `json:"controllerCertificate,omitempty"`
	ApprovedAt            *time.Time              `json:"approvedAt,omitempty"`
	RejectedAt            *time.Time              `json:"rejectedAt,omitempty"`
}

type Grant struct {
	ID           string           `json:"grantId"`
	FabricID     string           `json:"fabricId"`
	ControllerID string           `json:"controllerId"`
	NodeID       string           `json:"nodeId"`
	Scope        membership.Scope `json:"scope"`
	RevokedAt    *time.Time       `json:"revokedAt,omitempty"`
}

func OpenStore(cfg StoreConfig) (*Store, error) {
	if strings.TrimSpace(cfg.Path) == "" {
		return nil, errors.New("fabric: sqlite path is required")
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	db, err := sql.Open("sqlite", cfg.Path)
	if err != nil {
		return nil, fmt.Errorf("opening fabric sqlite database: %w", err)
	}
	store := &Store{db: db, now: now}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	if err := store.MarkAllOffline(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) CreateFabric(ctx context.Context, requestID, ownerPublicKey string) (Fabric, error) {
	if requestID == "" || ownerPublicKey == "" {
		return Fabric{}, errors.New("fabric: request id and owner public key are required")
	}
	if existing, err := s.fabricByRequestID(ctx, requestID, ownerPublicKey); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrFabricNotFound) {
		return Fabric{}, err
	}

	id, err := randomID("fab")
	if err != nil {
		return Fabric{}, err
	}
	now := s.now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO fabrics (fabric_id, owner_public_key, request_id, revision, created_at)
		VALUES (?, ?, ?, 0, ?)
	`, id, ownerPublicKey, requestID, now.UnixMilli())
	if err != nil {
		if existing, lookupErr := s.fabricByRequestID(ctx, requestID, ownerPublicKey); lookupErr == nil {
			return existing, nil
		}
		return Fabric{}, fmt.Errorf("creating fabric: %w", err)
	}
	return Fabric{ID: id, OwnerPublicKey: ownerPublicKey, CreatedAt: now}, nil
}

func (s *Store) GetFabric(ctx context.Context, fabricID string) (Fabric, error) {
	row := s.db.QueryRowContext(ctx, `SELECT fabric_id, owner_public_key, revision, created_at FROM fabrics WHERE fabric_id = ?`, fabricID)
	return scanFabric(row)
}

func (s *Store) GetFabricForNode(ctx context.Context, nodeID string) (Fabric, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT f.fabric_id, f.owner_public_key, f.revision, f.created_at
		FROM fabrics f JOIN nodes n ON n.fabric_id = f.fabric_id
		WHERE n.node_id = ?
	`, nodeID)
	return scanFabric(row)
}

func (s *Store) CreateJoinRequest(ctx context.Context, request membership.JoinRequest) (JoinRequestResult, error) {
	if _, err := s.GetFabric(ctx, request.FabricID); err != nil {
		return JoinRequestResult{}, err
	}
	capabilities, err := json.Marshal(request.Capabilities)
	if err != nil {
		return JoinRequestResult{}, fmt.Errorf("encoding node capabilities: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO join_requests (
			request_id, fabric_id, subject_id, identity_pubkey, encryption_pubkey,
			display_name, platform, version, capabilities_json, issued_at, expires_at,
			request_json, secret_hash, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, request.RequestID, request.FabricID, request.SubjectID, request.IdentityPubkey, request.EncryptionPubkey,
		request.DisplayName, request.Platform, request.Version, capabilities, request.IssuedAt, request.ExpiresAt,
		mustJSON(request), request.DeliverySecretHash, s.now().UTC().UnixMilli())
	if err != nil {
		// The joining Node owns the raw delivery secret. A retry with the same
		// signed request is therefore safely idempotent even if its first HTTP
		// response was lost.
		if existing, lookupErr := s.joinRequestByID(ctx, request.RequestID); lookupErr == nil && mustJSON(existing) == mustJSON(request) {
			return JoinRequestResult{Request: request}, nil
		}
		return JoinRequestResult{}, fmt.Errorf("creating join request: %w", err)
	}
	return JoinRequestResult{Request: request}, nil
}

// ReadJoinRequest authenticates the joining device with its delivery secret.
// Returning an approved certificate is intentionally idempotent: a response
// lost after commit must not strand an already-enrolled Node.
func (s *Store) ReadJoinRequest(ctx context.Context, requestID, deliverySecret string) (JoinRequestResult, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT request_json, secret_hash, certificate_json, controller_certificate_json, approved_at, rejected_at, expires_at
		FROM join_requests WHERE request_id = ?
	`, requestID)
	var requestJSON, secretHash string
	var nodeCertificateJSON, controllerCertificateJSON sql.NullString
	var approvedAt, rejectedAt sql.NullInt64
	var expiresAt int64
	if err := row.Scan(&requestJSON, &secretHash, &nodeCertificateJSON, &controllerCertificateJSON, &approvedAt, &rejectedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoinRequestResult{}, ErrJoinRequestNotFound
		}
		return JoinRequestResult{}, fmt.Errorf("reading join request: %w", err)
	}
	if hashSecret(deliverySecret) != secretHash {
		return JoinRequestResult{}, ErrAccessDenied
	}
	var request membership.JoinRequest
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return JoinRequestResult{}, fmt.Errorf("decoding join request: %w", err)
	}
	if !s.now().Before(time.Unix(expiresAt, 0)) && !nodeCertificateJSON.Valid && !rejectedAt.Valid {
		return JoinRequestResult{}, ErrJoinRequestExpired
	}
	result := JoinRequestResult{Request: request}
	if approvedAt.Valid {
		value := time.UnixMilli(approvedAt.Int64).UTC()
		result.ApprovedAt = &value
	}
	if rejectedAt.Valid {
		value := time.UnixMilli(rejectedAt.Int64).UTC()
		result.RejectedAt = &value
		return result, ErrJoinRequestRejected
	}
	if !nodeCertificateJSON.Valid || (request.SubjectKind == membership.SubjectNode && !controllerCertificateJSON.Valid) {
		return result, ErrJoinRequestPending
	}
	var primaryCertificate membership.Certificate
	if err := json.Unmarshal([]byte(nodeCertificateJSON.String), &primaryCertificate); err != nil {
		return JoinRequestResult{}, fmt.Errorf("decoding join certificate: %w", err)
	}
	if request.SubjectKind == membership.SubjectController {
		result.ControllerCertificate = &primaryCertificate
		return result, nil
	}
	result.NodeCertificate = &primaryCertificate
	var companionControllerCertificate membership.Certificate
	if err := json.Unmarshal([]byte(controllerCertificateJSON.String), &companionControllerCertificate); err != nil {
		return JoinRequestResult{}, fmt.Errorf("decoding companion Controller certificate: %w", err)
	}
	result.ControllerCertificate = &companionControllerCertificate
	return result, nil
}

func (s *Store) ListPendingJoinRequests(ctx context.Context, fabricID string) ([]membership.JoinRequest, error) {
	if _, err := s.GetFabric(ctx, fabricID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT request_json FROM join_requests
		WHERE fabric_id = ? AND certificate_json IS NULL AND rejected_at IS NULL AND expires_at > ?
		ORDER BY created_at, request_id
	`, fabricID, s.now().UTC().Unix())
	if err != nil {
		return nil, fmt.Errorf("listing pending join requests: %w", err)
	}
	defer rows.Close()
	requests := []membership.JoinRequest{}
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			return nil, err
		}
		var request membership.JoinRequest
		if err := json.Unmarshal([]byte(encoded), &request); err != nil {
			return nil, fmt.Errorf("decoding pending join request: %w", err)
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (s *Store) RejectJoinRequest(ctx context.Context, fabricID, requestID string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE join_requests SET rejected_at = ?
		WHERE fabric_id = ? AND request_id = ? AND certificate_json IS NULL AND rejected_at IS NULL
	`, s.now().UTC().UnixMilli(), fabricID, requestID)
	if err != nil {
		return fmt.Errorf("rejecting join request: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrJoinRequestNotFound
	}
	return nil
}

func (s *Store) ApproveJoinRequest(ctx context.Context, requestID string, nodeCertificate, controllerCertificate membership.Certificate) (NodeSummary, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeSummary{}, err
	}
	defer tx.Rollback()
	row := tx.QueryRowContext(ctx, `
		SELECT fabric_id, subject_id, identity_pubkey, encryption_pubkey, display_name, platform, version, capabilities_json, expires_at, request_json, certificate_json, controller_certificate_json, rejected_at
		FROM join_requests WHERE request_id = ?
	`, requestID)
	var fabricID, subjectID, identityPubkey, encryptionPubkey, displayName, platform, version, capabilitiesJSON, requestJSON string
	var expiresAt int64
	var existingNodeCertificate, existingControllerCertificate sql.NullString
	var rejectedAt sql.NullInt64
	if err := row.Scan(&fabricID, &subjectID, &identityPubkey, &encryptionPubkey, &displayName, &platform, &version, &capabilitiesJSON, &expiresAt, &requestJSON, &existingNodeCertificate, &existingControllerCertificate, &rejectedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NodeSummary{}, ErrJoinRequestNotFound
		}
		return NodeSummary{}, fmt.Errorf("reading join request for approval: %w", err)
	}
	if rejectedAt.Valid {
		return NodeSummary{}, ErrJoinRequestRejected
	}
	if !s.now().Before(time.Unix(expiresAt, 0)) && !existingNodeCertificate.Valid {
		return NodeSummary{}, ErrJoinRequestExpired
	}
	var joinRequest membership.JoinRequest
	if err := json.Unmarshal([]byte(requestJSON), &joinRequest); err != nil {
		return NodeSummary{}, fmt.Errorf("decoding join request for approval: %w", err)
	}
	if joinRequest.SubjectKind != membership.SubjectNode {
		return NodeSummary{}, ErrAccessDenied
	}
	if nodeCertificate.FabricID != fabricID || nodeCertificate.SubjectKind != membership.SubjectNode || nodeCertificate.SubjectID != subjectID || nodeCertificate.IdentityPubkey != identityPubkey || nodeCertificate.EncryptionPubkey != encryptionPubkey {
		return NodeSummary{}, ErrAccessDenied
	}
	if controllerCertificate.FabricID != fabricID || controllerCertificate.SubjectKind != membership.SubjectController || controllerCertificate.SubjectID != subjectID || controllerCertificate.IdentityPubkey != identityPubkey || controllerCertificate.EncryptionPubkey != encryptionPubkey {
		return NodeSummary{}, ErrAccessDenied
	}
	if existingNodeCertificate.Valid || existingControllerCertificate.Valid {
		if !existingNodeCertificate.Valid || !existingControllerCertificate.Valid || membership.CertificateFingerprint(nodeCertificate) != certificateFingerprintJSON(existingNodeCertificate.String) || membership.CertificateFingerprint(controllerCertificate) != certificateFingerprintJSON(existingControllerCertificate.String) {
			return NodeSummary{}, ErrAccessDenied
		}
		return s.nodeInTx(ctx, tx, fabricID, subjectID)
	}
	var capabilities []string
	if err := json.Unmarshal([]byte(capabilitiesJSON), &capabilities); err != nil {
		return NodeSummary{}, fmt.Errorf("decoding node capabilities: %w", err)
	}
	now := s.now().UTC()
	revision, err := nextRevision(ctx, tx, fabricID)
	if err != nil {
		return NodeSummary{}, err
	}
	nodeCertificateJSON := mustJSON(nodeCertificate)
	controllerCertificateJSON := mustJSON(controllerCertificate)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO principals (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		VALUES (?, ?, 'node', ?, ?, ?, ?)
		ON CONFLICT(fabric_id, subject_id, subject_kind) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`, fabricID, subjectID, identityPubkey, encryptionPubkey, nodeCertificateJSON, now.UnixMilli())
	if err != nil {
		return NodeSummary{}, fmt.Errorf("persisting node principal: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO principals (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		VALUES (?, ?, 'controller', ?, ?, ?, ?)
		ON CONFLICT(fabric_id, subject_id, subject_kind) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`, fabricID, subjectID, identityPubkey, encryptionPubkey, controllerCertificateJSON, now.UnixMilli())
	if err != nil {
		return NodeSummary{}, fmt.Errorf("persisting controller principal: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO nodes (node_id, fabric_id, identity_pubkey, encryption_pubkey, display_name, platform, version, capabilities_json, status, last_seen_at, revision, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?, ?, ?, ?)
		ON CONFLICT(node_id) DO UPDATE SET
			display_name = excluded.display_name,
			platform = excluded.platform,
			version = excluded.version,
			capabilities_json = excluded.capabilities_json,
			revision = excluded.revision,
			updated_at = excluded.updated_at
	`, subjectID, fabricID, identityPubkey, encryptionPubkey, displayName, platform, version, capabilitiesJSON, now.UnixMilli(), revision, now.UnixMilli(), now.UnixMilli())
	if err != nil {
		return NodeSummary{}, fmt.Errorf("persisting node: %w", err)
	}
	// An approved personal Fabric device is both a Node and a Controller. Add
	// the new Controller to every Node and every existing Controller to the new
	// Node so all approved devices can discover and control one another.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO node_grants (grant_id, fabric_id, controller_id, node_id, scope, created_at)
		SELECT 'grant_' || lower(hex(randomblob(18))), ?, ?, node_id, 'admin', ?
		FROM nodes WHERE fabric_id = ?
		ON CONFLICT(fabric_id, controller_id, node_id, scope) DO NOTHING
	`, fabricID, subjectID, now.UnixMilli(), fabricID)
	if err != nil {
		return NodeSummary{}, fmt.Errorf("granting new Controller access: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO node_grants (grant_id, fabric_id, controller_id, node_id, scope, created_at)
		SELECT 'grant_' || lower(hex(randomblob(18))), ?, subject_id, ?, 'admin', ?
		FROM (SELECT DISTINCT controller_id AS subject_id FROM node_grants WHERE fabric_id = ?)
		WHERE true
		ON CONFLICT(fabric_id, controller_id, node_id, scope) DO NOTHING
	`, fabricID, subjectID, now.UnixMilli(), fabricID)
	if err != nil {
		return NodeSummary{}, fmt.Errorf("granting existing Controllers access: %w", err)
	}
	_, err = tx.ExecContext(ctx, `UPDATE join_requests SET certificate_json = ?, controller_certificate_json = ?, approved_at = ? WHERE request_id = ?`, nodeCertificateJSON, controllerCertificateJSON, now.UnixMilli(), requestID)
	if err != nil {
		return NodeSummary{}, fmt.Errorf("completing join request: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return NodeSummary{}, fmt.Errorf("committing join request approval: %w", err)
	}
	return NodeSummary{NodeID: subjectID, FabricID: fabricID, DisplayName: displayName, Platform: platform, Version: version, Capabilities: capabilities, Status: NodeOffline, LastSeenAt: now, Revision: revision}, nil
}

// ApproveControllerJoinRequest atomically records a Controller certificate and
// its owner-selected grants. The joining Controller retrieves the certificate
// later with the delivery secret it generated locally.
func (s *Store) ApproveControllerJoinRequest(ctx context.Context, requestID string, certificate membership.Certificate, grants []Grant) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	row := tx.QueryRowContext(ctx, `
		SELECT request_json, expires_at, certificate_json, rejected_at
		FROM join_requests WHERE request_id = ?
	`, requestID)
	var requestJSON string
	var expiresAt int64
	var existingCertificate sql.NullString
	var rejectedAt sql.NullInt64
	if err := row.Scan(&requestJSON, &expiresAt, &existingCertificate, &rejectedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrJoinRequestNotFound
		}
		return fmt.Errorf("reading Controller join request for approval: %w", err)
	}
	if rejectedAt.Valid {
		return ErrJoinRequestRejected
	}
	if !s.now().Before(time.Unix(expiresAt, 0)) && !existingCertificate.Valid {
		return ErrJoinRequestExpired
	}
	var request membership.JoinRequest
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return fmt.Errorf("decoding Controller join request for approval: %w", err)
	}
	if request.SubjectKind != membership.SubjectController || certificate.FabricID != request.FabricID || certificate.SubjectKind != membership.SubjectController || certificate.SubjectID != request.SubjectID || certificate.IdentityPubkey != request.IdentityPubkey || certificate.EncryptionPubkey != request.EncryptionPubkey {
		return ErrAccessDenied
	}
	if err := validateControllerEnrollment(certificate, grants); err != nil {
		return err
	}
	if existingCertificate.Valid {
		if membership.CertificateFingerprint(certificate) != certificateFingerprintJSON(existingCertificate.String) {
			return ErrAccessDenied
		}
		return nil
	}
	if err := registerControllerInTx(ctx, tx, certificate, grants, s.now().UTC().UnixMilli()); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE join_requests SET certificate_json = ?, approved_at = ? WHERE request_id = ?`, mustJSON(certificate), s.now().UTC().UnixMilli(), requestID)
	if err != nil {
		return fmt.Errorf("completing Controller join request: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing Controller join request approval: %w", err)
	}
	return nil
}

func validateControllerEnrollment(certificate membership.Certificate, grants []Grant) error {
	if certificate.NodeID == "" || len(grants) == 0 {
		return ErrAccessDenied
	}
	certificateScopes := make(map[membership.Scope]struct{}, len(certificate.Scopes))
	for _, scope := range certificate.Scopes {
		if !isControllerEnrollmentScope(scope) {
			return ErrAccessDenied
		}
		certificateScopes[scope] = struct{}{}
	}
	for _, grant := range grants {
		if grant.ID == "" || grant.FabricID != certificate.FabricID || grant.ControllerID != certificate.SubjectID || grant.NodeID != certificate.NodeID || !isControllerEnrollmentScope(grant.Scope) {
			return ErrAccessDenied
		}
		if _, authorized := certificateScopes[grant.Scope]; !authorized {
			return ErrAccessDenied
		}
	}
	return nil
}

func isControllerEnrollmentScope(scope membership.Scope) bool {
	return scope == membership.ScopeView || scope == membership.ScopeControl || scope == membership.ScopeApprove
}

func (s *Store) RegisterController(ctx context.Context, certificate membership.Certificate, grants []Grant) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := registerControllerInTx(ctx, tx, certificate, grants, s.now().UTC().UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func registerControllerInTx(ctx context.Context, tx *sql.Tx, certificate membership.Certificate, grants []Grant, now int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO principals (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		VALUES (?, ?, 'controller', ?, ?, ?, ?)
		ON CONFLICT(fabric_id, subject_id, subject_kind) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`, certificate.FabricID, certificate.SubjectID, certificate.IdentityPubkey, certificate.EncryptionPubkey, mustJSON(certificate), now)
	if err != nil {
		return fmt.Errorf("persisting controller: %w", err)
	}
	for _, grant := range grants {
		if grant.ID == "" || grant.FabricID != certificate.FabricID || grant.ControllerID != certificate.SubjectID || grant.NodeID == "" || grant.Scope == "" {
			return ErrAccessDenied
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO node_grants (grant_id, fabric_id, controller_id, node_id, scope, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(fabric_id, controller_id, node_id, scope) DO NOTHING
		`, grant.ID, grant.FabricID, grant.ControllerID, grant.NodeID, grant.Scope, now)
		if err != nil {
			return fmt.Errorf("persisting node grant: %w", err)
		}
		if affected, err := result.RowsAffected(); err == nil && affected == 0 {
			// Keep a stable existing grant id; a second registration is idempotent.
			continue
		}
	}
	return nil
}

func (s *Store) GetJoinRequest(ctx context.Context, requestID string) (membership.JoinRequest, error) {
	return s.joinRequestByID(ctx, requestID)
}

func (s *Store) ListAuthorizedNodes(ctx context.Context, fabricID, controllerID string) ([]NodeSummary, int64, error) {
	fabric, err := s.GetFabric(ctx, fabricID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.node_id, n.fabric_id, n.display_name, n.platform, n.version, n.capabilities_json, n.status, n.last_seen_at, n.revision,
			GROUP_CONCAT(DISTINCT g.scope)
		FROM nodes n
		JOIN node_grants g ON g.fabric_id = n.fabric_id AND g.node_id = n.node_id
		WHERE n.fabric_id = ? AND g.controller_id = ? AND g.revoked_at IS NULL
		  AND g.scope IN ('view', 'control', 'approve', 'admin')
		GROUP BY n.node_id
		ORDER BY n.display_name COLLATE NOCASE, n.node_id
	`, fabricID, controllerID)
	if err != nil {
		return nil, 0, fmt.Errorf("listing authorized nodes: %w", err)
	}
	defer rows.Close()
	nodes := []NodeSummary{}
	for rows.Next() {
		node, scopes, err := scanNodeWithScopes(rows)
		if err != nil {
			return nil, 0, err
		}
		node.Scopes = scopes
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return nodes, fabric.Revision, nil
}

// ListFabricNodes returns the authoritative device directory for an admin
// Controller. Scopes still describe only that Controller's active grants, so
// discovery does not expand its authorization to open a link.
func (s *Store) ListFabricNodes(ctx context.Context, fabricID, controllerID string) ([]NodeSummary, int64, error) {
	fabricRecord, err := s.GetFabric(ctx, fabricID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.node_id, n.fabric_id, n.display_name, n.platform, n.version, n.capabilities_json, n.status, n.last_seen_at, n.revision,
			COALESCE(GROUP_CONCAT(DISTINCT g.scope), '')
		FROM nodes n
		LEFT JOIN node_grants g ON g.fabric_id = n.fabric_id AND g.node_id = n.node_id
			AND g.controller_id = ? AND g.revoked_at IS NULL
			AND g.scope IN ('view', 'control', 'approve', 'admin')
		WHERE n.fabric_id = ?
		GROUP BY n.node_id
		ORDER BY n.display_name COLLATE NOCASE, n.node_id
	`, controllerID, fabricID)
	if err != nil {
		return nil, 0, fmt.Errorf("listing Fabric nodes: %w", err)
	}
	defer rows.Close()
	nodes := []NodeSummary{}
	for rows.Next() {
		node, scopes, err := scanNodeWithScopes(rows)
		if err != nil {
			return nil, 0, err
		}
		node.Scopes = scopes
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return nodes, fabricRecord.Revision, nil
}

func (s *Store) ControllerExists(ctx context.Context, fabricID, controllerID, identityPubkey string) (bool, error) {
	var found int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM principals
		WHERE fabric_id = ? AND subject_id = ? AND subject_kind = 'controller' AND identity_pubkey = ?
		LIMIT 1
	`, fabricID, controllerID, identityPubkey).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking controller membership: %w", err)
	}
	return true, nil
}

func (s *Store) NodeExists(ctx context.Context, fabricID, nodeID, identityPubkey string) (bool, error) {
	var found int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM principals
		WHERE fabric_id = ? AND subject_id = ? AND subject_kind = 'node' AND identity_pubkey = ?
		LIMIT 1
	`, fabricID, nodeID, identityPubkey).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking node membership: %w", err)
	}
	return true, nil
}

func (s *Store) GetNode(ctx context.Context, fabricID, nodeID string) (NodeSummary, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT node_id, fabric_id, display_name, platform, version, capabilities_json, status, last_seen_at, revision
		FROM nodes WHERE fabric_id = ? AND node_id = ?
	`, fabricID, nodeID)
	return scanNode(row)
}

// GetNodeCertificate returns the owner-signed certificate recorded at
// enrollment. It is supplied to Controllers during link creation so they can
// verify the Node encryption key without trusting relayd as a key authority.
func (s *Store) GetNodeCertificate(ctx context.Context, fabricID, nodeID string) (membership.Certificate, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT certificate_json FROM principals
		WHERE fabric_id = ? AND subject_id = ? AND subject_kind = ?
	`, fabricID, nodeID, membership.SubjectNode)
	var raw string
	if err := row.Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return membership.Certificate{}, ErrFabricNotFound
		}
		return membership.Certificate{}, err
	}
	var certificate membership.Certificate
	if err := json.Unmarshal([]byte(raw), &certificate); err != nil {
		return membership.Certificate{}, fmt.Errorf("decoding node certificate: %w", err)
	}
	return certificate, nil
}

func (s *Store) SetNodePresence(ctx context.Context, fabricID, nodeID string, status NodeStatus) (NodeSummary, error) {
	if status != NodeOnline && status != NodeOffline {
		return NodeSummary{}, errors.New("fabric: invalid node status")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeSummary{}, err
	}
	defer tx.Rollback()
	revision, err := nextRevision(ctx, tx, fabricID)
	if err != nil {
		return NodeSummary{}, err
	}
	now := s.now().UTC()
	result, err := tx.ExecContext(ctx, `
		UPDATE nodes SET status = ?, last_seen_at = ?, revision = ?, updated_at = ? WHERE fabric_id = ? AND node_id = ?
	`, status, now.UnixMilli(), revision, now.UnixMilli(), fabricID, nodeID)
	if err != nil {
		return NodeSummary{}, fmt.Errorf("setting node presence: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return NodeSummary{}, err
	}
	if affected != 1 {
		return NodeSummary{}, ErrFabricNotFound
	}
	node, err := s.nodeInTx(ctx, tx, fabricID, nodeID)
	if err != nil {
		return NodeSummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return NodeSummary{}, err
	}
	return node, nil
}

func (s *Store) MarkAllOffline(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE nodes SET status = 'offline', updated_at = ? WHERE status != 'offline'`, s.now().UTC().UnixMilli())
	if err != nil {
		return fmt.Errorf("marking nodes offline: %w", err)
	}
	return nil
}

// RemoveNode permanently removes one enrolled device and every grant where it
// is either the target Node or the Controller. Its signed certificates can no
// longer authenticate because the corresponding principal and Node disappear
// in the same transaction.
func (s *Store) RemoveNode(ctx context.Context, fabricID, nodeID string) (NodeSummary, []string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeSummary{}, nil, err
	}
	defer tx.Rollback()
	node, err := s.nodeInTx(ctx, tx, fabricID, nodeID)
	if err != nil {
		return NodeSummary{}, nil, err
	}
	controllerRows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT controller_id FROM node_grants
		WHERE fabric_id = ? AND node_id = ? AND revoked_at IS NULL
	`, fabricID, nodeID)
	if err != nil {
		return NodeSummary{}, nil, fmt.Errorf("listing removed Node Controllers: %w", err)
	}
	controllerIDs := []string{}
	for controllerRows.Next() {
		var controllerID string
		if err := controllerRows.Scan(&controllerID); err != nil {
			controllerRows.Close()
			return NodeSummary{}, nil, err
		}
		controllerIDs = append(controllerIDs, controllerID)
	}
	if err := controllerRows.Close(); err != nil {
		return NodeSummary{}, nil, err
	}
	if err := controllerRows.Err(); err != nil {
		return NodeSummary{}, nil, err
	}
	revision, err := nextRevision(ctx, tx, fabricID)
	if err != nil {
		return NodeSummary{}, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM node_grants
		WHERE fabric_id = ? AND (node_id = ? OR controller_id = ?)
	`, fabricID, nodeID, nodeID); err != nil {
		return NodeSummary{}, nil, fmt.Errorf("removing Node grants: %w", err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM nodes WHERE fabric_id = ? AND node_id = ?`, fabricID, nodeID)
	if err != nil {
		return NodeSummary{}, nil, fmt.Errorf("removing Node: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return NodeSummary{}, nil, err
	}
	if affected != 1 {
		return NodeSummary{}, nil, ErrFabricNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM principals WHERE fabric_id = ? AND subject_id = ?`, fabricID, nodeID); err != nil {
		return NodeSummary{}, nil, fmt.Errorf("removing Node principal: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return NodeSummary{}, nil, err
	}
	node.Status = NodeOffline
	node.Revision = revision
	return node, controllerIDs, nil
}

// ListNodeGrants returns every grant recorded for a Node, including revoked
// rows, so an owner can audit and revoke access. Grants carry no secret data.
func (s *Store) ListNodeGrants(ctx context.Context, fabricID, nodeID string) ([]Grant, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT grant_id, fabric_id, controller_id, node_id, scope, revoked_at FROM node_grants
		WHERE fabric_id = ? AND node_id = ?
		ORDER BY created_at, grant_id
	`, fabricID, nodeID)
	if err != nil {
		return nil, fmt.Errorf("listing node grants: %w", err)
	}
	defer rows.Close()
	grants := []Grant{}
	for rows.Next() {
		var grant Grant
		var revokedAt sql.NullInt64
		if err := rows.Scan(&grant.ID, &grant.FabricID, &grant.ControllerID, &grant.NodeID, &grant.Scope, &revokedAt); err != nil {
			return nil, err
		}
		if revokedAt.Valid {
			at := time.UnixMilli(revokedAt.Int64).UTC()
			grant.RevokedAt = &at
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return grants, nil
}

func (s *Store) RevokeGrant(ctx context.Context, fabricID, nodeID, grantID string) (Grant, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT grant_id, fabric_id, controller_id, node_id, scope, revoked_at FROM node_grants
		WHERE fabric_id = ? AND node_id = ? AND grant_id = ? AND revoked_at IS NULL
	`, fabricID, nodeID, grantID)
	var grant Grant
	var revokedAt sql.NullInt64
	if err := row.Scan(&grant.ID, &grant.FabricID, &grant.ControllerID, &grant.NodeID, &grant.Scope, &revokedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Grant{}, ErrAccessDenied
		}
		return Grant{}, err
	}
	now := s.now().UTC().UnixMilli()
	result, err := s.db.ExecContext(ctx, `
		UPDATE node_grants SET revoked_at = ? WHERE fabric_id = ? AND node_id = ? AND grant_id = ? AND revoked_at IS NULL
	`, now, fabricID, nodeID, grantID)
	if err != nil {
		return Grant{}, fmt.Errorf("revoking grant: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Grant{}, err
	}
	if affected != 1 {
		return Grant{}, ErrAccessDenied
	}
	revoked := time.UnixMilli(now).UTC()
	grant.RevokedAt = &revoked
	return grant, nil
}

func (s *Store) HasActiveGrant(ctx context.Context, fabricID, controllerID, nodeID string, scopes ...membership.Scope) (bool, error) {
	if len(scopes) == 0 {
		return false, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(scopes)), ",")
	args := []any{fabricID, controllerID, nodeID}
	for _, scope := range scopes {
		args = append(args, scope)
	}
	query := `SELECT 1 FROM node_grants WHERE fabric_id = ? AND controller_id = ? AND node_id = ? AND revoked_at IS NULL AND scope IN (` + placeholders + `) LIMIT 1`
	var found int
	err := s.db.QueryRowContext(ctx, query, args...).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) nodeInTx(ctx context.Context, tx *sql.Tx, fabricID, nodeID string) (NodeSummary, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT node_id, fabric_id, display_name, platform, version, capabilities_json, status, last_seen_at, revision
		FROM nodes WHERE fabric_id = ? AND node_id = ?
	`, fabricID, nodeID)
	return scanNode(row)
}

func (s *Store) fabricByRequestID(ctx context.Context, requestID, ownerPublicKey string) (Fabric, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT fabric_id, owner_public_key, revision, created_at FROM fabrics WHERE request_id = ? AND owner_public_key = ?
	`, requestID, ownerPublicKey)
	return scanFabric(row)
}

func (s *Store) joinRequestByID(ctx context.Context, requestID string) (membership.JoinRequest, error) {
	row := s.db.QueryRowContext(ctx, `SELECT request_json FROM join_requests WHERE request_id = ?`, requestID)
	var requestJSON string
	if err := row.Scan(&requestJSON); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return membership.JoinRequest{}, ErrJoinRequestNotFound
		}
		return membership.JoinRequest{}, err
	}
	var request membership.JoinRequest
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return membership.JoinRequest{}, fmt.Errorf("decoding join request: %w", err)
	}
	return request, nil
}

func (s *Store) migrate(ctx context.Context) error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA journal_mode = WAL`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS fabrics (
			fabric_id TEXT PRIMARY KEY,
			owner_public_key TEXT NOT NULL,
			request_id TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			UNIQUE(owner_public_key, request_id)
		)`,
		`CREATE TABLE IF NOT EXISTS principals (
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			subject_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL CHECK(subject_kind IN ('node', 'controller')),
			identity_pubkey TEXT NOT NULL,
			encryption_pubkey TEXT NOT NULL,
			certificate_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(fabric_id, subject_id, subject_kind)
		)`,
		`CREATE TABLE IF NOT EXISTS nodes (
			node_id TEXT PRIMARY KEY,
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			identity_pubkey TEXT NOT NULL,
			encryption_pubkey TEXT NOT NULL,
			display_name TEXT NOT NULL,
			platform TEXT NOT NULL,
			version TEXT NOT NULL,
			capabilities_json TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
			last_seen_at INTEGER NOT NULL,
			revision INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS nodes_fabric_idx ON nodes(fabric_id)`,
		`CREATE TABLE IF NOT EXISTS node_grants (
			grant_id TEXT PRIMARY KEY,
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			controller_id TEXT NOT NULL,
			node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
			scope TEXT NOT NULL CHECK(scope IN ('view', 'control', 'approve', 'admin')),
			created_at INTEGER NOT NULL,
			revoked_at INTEGER,
			UNIQUE(fabric_id, controller_id, node_id, scope)
		)`,
		`CREATE INDEX IF NOT EXISTS node_grants_authorization_idx ON node_grants(fabric_id, controller_id, node_id, revoked_at)`,
		`CREATE TABLE IF NOT EXISTS join_requests (
			request_id TEXT PRIMARY KEY,
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			subject_id TEXT NOT NULL,
			identity_pubkey TEXT NOT NULL,
			encryption_pubkey TEXT NOT NULL,
			display_name TEXT NOT NULL,
			platform TEXT NOT NULL,
			version TEXT NOT NULL,
			capabilities_json TEXT NOT NULL,
			issued_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			request_json TEXT NOT NULL,
			secret_hash TEXT NOT NULL,
			certificate_json TEXT,
			controller_certificate_json TEXT,
			approved_at INTEGER,
			rejected_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS join_requests_fabric_idx ON join_requests(fabric_id, expires_at)`,
		`CREATE TABLE IF NOT EXISTS revocations (
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			subject_id TEXT NOT NULL,
			reason TEXT NOT NULL,
			revoked_at INTEGER NOT NULL,
			PRIMARY KEY(fabric_id, subject_id)
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrating fabric store: %w", err)
		}
	}
	if err := s.ensureColumn(ctx, "join_requests", "controller_certificate_json", "TEXT"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "join_requests", "rejected_at", "INTEGER"); err != nil {
		return err
	}
	if err := s.migratePrincipalsPrimaryKey(ctx); err != nil {
		return err
	}
	if err := s.repairPersonalDeviceGrants(ctx); err != nil {
		return err
	}
	return nil
}

// migratePrincipalsPrimaryKey separates the Node and Controller certificates
// for each personal device. The original schema keyed principals only by
// Fabric and subject id, causing the Controller certificate to overwrite the
// Node certificate when both identities shared a device id.
func (s *Store) migratePrincipalsPrimaryKey(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(principals)`)
	if err != nil {
		return fmt.Errorf("reading principals schema: %w", err)
	}
	hasSubjectKindPrimaryKey := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "subject_kind" && primaryKey > 0 {
			hasSubjectKindPrimaryKey = true
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if hasSubjectKindPrimaryKey {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE principals_replacement (
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			subject_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL CHECK(subject_kind IN ('node', 'controller')),
			identity_pubkey TEXT NOT NULL,
			encryption_pubkey TEXT NOT NULL,
			certificate_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(fabric_id, subject_id, subject_kind)
		)
	`); err != nil {
		return fmt.Errorf("creating replacement principals table: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO principals_replacement (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		SELECT fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at
		FROM principals
	`); err != nil {
		return fmt.Errorf("copying principals: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO principals_replacement (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		SELECT j.fabric_id, j.subject_id, 'node', j.identity_pubkey, j.encryption_pubkey, j.certificate_json, j.created_at
		FROM join_requests j
		JOIN nodes n ON n.fabric_id = j.fabric_id AND n.node_id = j.subject_id
		WHERE j.certificate_json IS NOT NULL AND j.approved_at IS NOT NULL
		ON CONFLICT(fabric_id, subject_id, subject_kind) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`); err != nil {
		return fmt.Errorf("restoring node principals: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO principals_replacement (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		SELECT j.fabric_id, j.subject_id, 'controller', j.identity_pubkey, j.encryption_pubkey, j.controller_certificate_json, j.created_at
		FROM join_requests j
		JOIN nodes n ON n.fabric_id = j.fabric_id AND n.node_id = j.subject_id
		WHERE j.controller_certificate_json IS NOT NULL AND j.approved_at IS NOT NULL
		ON CONFLICT(fabric_id, subject_id, subject_kind) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`); err != nil {
		return fmt.Errorf("restoring controller principals: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE principals`); err != nil {
		return fmt.Errorf("dropping old principals table: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE principals_replacement RENAME TO principals`); err != nil {
		return fmt.Errorf("renaming replacement principals table: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migrating principals table: %w", err)
	}
	return nil
}

// repairPersonalDeviceGrants upgrades Fabrics created before personal devices
// received full-mesh grants. Existing rows, including revoked grants, are
// authoritative and are never recreated or widened.
func (s *Store) repairPersonalDeviceGrants(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT p.fabric_id, p.subject_id, p.certificate_json
		FROM principals p
		JOIN nodes n ON n.fabric_id = p.fabric_id AND n.node_id = p.subject_id
		WHERE p.subject_kind = 'controller'
		UNION ALL
		SELECT j.fabric_id, j.subject_id, j.controller_certificate_json
		FROM join_requests j
		JOIN nodes n ON n.fabric_id = j.fabric_id AND n.node_id = j.subject_id
		WHERE j.controller_certificate_json IS NOT NULL AND j.approved_at IS NOT NULL
	`)
	if err != nil {
		return fmt.Errorf("listing personal Fabric Controllers: %w", err)
	}
	controllers := map[string]membership.Certificate{}
	for rows.Next() {
		var fabricID, controllerID, certificateJSON string
		if err := rows.Scan(&fabricID, &controllerID, &certificateJSON); err != nil {
			rows.Close()
			return err
		}
		var certificate membership.Certificate
		if err := json.Unmarshal([]byte(certificateJSON), &certificate); err != nil {
			rows.Close()
			return fmt.Errorf("decoding personal Fabric Controller certificate: %w", err)
		}
		if certificate.FabricID != fabricID || certificate.SubjectID != controllerID || certificate.SubjectKind != membership.SubjectController || !membership.HasAnyScope(certificate.Scopes, membership.ScopeAdmin) {
			continue
		}
		controllers[fabricID+"\x00"+controllerID] = certificate
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}

	nodeRows, err := tx.QueryContext(ctx, `SELECT fabric_id, node_id FROM nodes ORDER BY fabric_id, node_id`)
	if err != nil {
		return fmt.Errorf("listing Fabric Nodes for grant repair: %w", err)
	}
	nodesByFabric := map[string][]string{}
	for nodeRows.Next() {
		var fabricID, nodeID string
		if err := nodeRows.Scan(&fabricID, &nodeID); err != nil {
			nodeRows.Close()
			return err
		}
		nodesByFabric[fabricID] = append(nodesByFabric[fabricID], nodeID)
	}
	if err := nodeRows.Err(); err != nil {
		nodeRows.Close()
		return err
	}
	if err := nodeRows.Close(); err != nil {
		return err
	}

	touchedFabrics := map[string]struct{}{}
	createdAt := s.now().UTC().UnixMilli()
	for _, certificate := range controllers {
		for _, nodeID := range nodesByFabric[certificate.FabricID] {
			var existing int
			err := tx.QueryRowContext(ctx, `
				SELECT 1 FROM node_grants
				WHERE fabric_id = ? AND controller_id = ? AND node_id = ?
				LIMIT 1
			`, certificate.FabricID, certificate.SubjectID, nodeID).Scan(&existing)
			if err == nil {
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("checking personal device grant: %w", err)
			}
			grantID, err := randomID("grant_")
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO node_grants (grant_id, fabric_id, controller_id, node_id, scope, created_at)
				VALUES (?, ?, ?, ?, 'admin', ?)
			`, grantID, certificate.FabricID, certificate.SubjectID, nodeID, createdAt); err != nil {
				return fmt.Errorf("repairing personal device grant: %w", err)
			}
			touchedFabrics[certificate.FabricID] = struct{}{}
		}
	}
	for fabricID := range touchedFabrics {
		if _, err := nextRevision(ctx, tx, fabricID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(ctx context.Context, table, column, definition string) error {
	rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return fmt.Errorf("reading %s columns: %w", table, err)
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == column {
			return rows.Close()
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `ALTER TABLE `+table+` ADD COLUMN `+column+` `+definition); err != nil {
		return fmt.Errorf("adding %s.%s: %w", table, column, err)
	}
	return nil
}

func nextRevision(ctx context.Context, tx *sql.Tx, fabricID string) (int64, error) {
	result, err := tx.ExecContext(ctx, `UPDATE fabrics SET revision = revision + 1 WHERE fabric_id = ?`, fabricID)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if affected != 1 {
		return 0, ErrFabricNotFound
	}
	var revision int64
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM fabrics WHERE fabric_id = ?`, fabricID).Scan(&revision); err != nil {
		return 0, err
	}
	return revision, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanFabric(row rowScanner) (Fabric, error) {
	var fabric Fabric
	var createdAt int64
	if err := row.Scan(&fabric.ID, &fabric.OwnerPublicKey, &fabric.Revision, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Fabric{}, ErrFabricNotFound
		}
		return Fabric{}, err
	}
	fabric.CreatedAt = time.UnixMilli(createdAt).UTC()
	return fabric, nil
}

func scanNodeWithScopes(row rowScanner) (NodeSummary, []string, error) {
	var node NodeSummary
	var capabilitiesJSON string
	var status string
	var lastSeenAt int64
	var scopes string
	if err := row.Scan(&node.NodeID, &node.FabricID, &node.DisplayName, &node.Platform, &node.Version, &capabilitiesJSON, &status, &lastSeenAt, &node.Revision, &scopes); err != nil {
		return NodeSummary{}, nil, err
	}
	if err := json.Unmarshal([]byte(capabilitiesJSON), &node.Capabilities); err != nil {
		return NodeSummary{}, nil, fmt.Errorf("decoding node capabilities: %w", err)
	}
	node.Status = NodeStatus(status)
	node.LastSeenAt = time.UnixMilli(lastSeenAt).UTC()
	if scopes == "" {
		return node, []string{}, nil
	}
	return node, strings.Split(scopes, ","), nil
}

func scanNode(row rowScanner) (NodeSummary, error) {
	var node NodeSummary
	var capabilitiesJSON string
	var status string
	var lastSeenAt int64
	if err := row.Scan(&node.NodeID, &node.FabricID, &node.DisplayName, &node.Platform, &node.Version, &capabilitiesJSON, &status, &lastSeenAt, &node.Revision); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NodeSummary{}, ErrFabricNotFound
		}
		return NodeSummary{}, err
	}
	if err := json.Unmarshal([]byte(capabilitiesJSON), &node.Capabilities); err != nil {
		return NodeSummary{}, fmt.Errorf("decoding node capabilities: %w", err)
	}
	node.Status = NodeStatus(status)
	node.LastSeenAt = time.UnixMilli(lastSeenAt).UTC()
	return node, nil
}

func randomID(prefix string) (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generating random id: %w", err)
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func mustJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func certificateFingerprintJSON(encoded string) string {
	var certificate membership.Certificate
	if err := json.Unmarshal([]byte(encoded), &certificate); err != nil {
		return ""
	}
	return membership.CertificateFingerprint(certificate)
}
