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
}

type JoinRequestResult struct {
	Request     membership.JoinRequest  `json:"request"`
	Certificate *membership.Certificate `json:"certificate,omitempty"`
	ApprovedAt  *time.Time              `json:"approvedAt,omitempty"`
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

// ReadJoinRequest authenticates the joining Node with its delivery secret.
// Returning an approved certificate is intentionally idempotent: a response
// lost after commit must not strand an already-enrolled Node.
func (s *Store) ReadJoinRequest(ctx context.Context, requestID, deliverySecret string) (JoinRequestResult, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT request_json, secret_hash, certificate_json, approved_at, expires_at
		FROM join_requests WHERE request_id = ?
	`, requestID)
	var requestJSON, secretHash string
	var certificateJSON sql.NullString
	var approvedAt sql.NullInt64
	var expiresAt int64
	if err := row.Scan(&requestJSON, &secretHash, &certificateJSON, &approvedAt, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return JoinRequestResult{}, ErrJoinRequestNotFound
		}
		return JoinRequestResult{}, fmt.Errorf("reading join request: %w", err)
	}
	if hashSecret(deliverySecret) != secretHash {
		return JoinRequestResult{}, ErrAccessDenied
	}
	if !s.now().Before(time.Unix(expiresAt, 0)) && !certificateJSON.Valid {
		return JoinRequestResult{}, ErrJoinRequestExpired
	}
	var request membership.JoinRequest
	if err := json.Unmarshal([]byte(requestJSON), &request); err != nil {
		return JoinRequestResult{}, fmt.Errorf("decoding join request: %w", err)
	}
	result := JoinRequestResult{Request: request}
	if approvedAt.Valid {
		value := time.UnixMilli(approvedAt.Int64).UTC()
		result.ApprovedAt = &value
	}
	if !certificateJSON.Valid {
		return result, ErrJoinRequestPending
	}
	var certificate membership.Certificate
	if err := json.Unmarshal([]byte(certificateJSON.String), &certificate); err != nil {
		return JoinRequestResult{}, fmt.Errorf("decoding join certificate: %w", err)
	}
	result.Certificate = &certificate
	return result, nil
}

func (s *Store) ApproveJoinRequest(ctx context.Context, requestID string, certificate membership.Certificate) (NodeSummary, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return NodeSummary{}, err
	}
	defer tx.Rollback()
	row := tx.QueryRowContext(ctx, `
		SELECT fabric_id, subject_id, identity_pubkey, encryption_pubkey, display_name, platform, version, capabilities_json, expires_at, certificate_json
		FROM join_requests WHERE request_id = ?
	`, requestID)
	var fabricID, subjectID, identityPubkey, encryptionPubkey, displayName, platform, version, capabilitiesJSON string
	var expiresAt int64
	var existingCertificate sql.NullString
	if err := row.Scan(&fabricID, &subjectID, &identityPubkey, &encryptionPubkey, &displayName, &platform, &version, &capabilitiesJSON, &expiresAt, &existingCertificate); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return NodeSummary{}, ErrJoinRequestNotFound
		}
		return NodeSummary{}, fmt.Errorf("reading join request for approval: %w", err)
	}
	if !s.now().Before(time.Unix(expiresAt, 0)) && !existingCertificate.Valid {
		return NodeSummary{}, ErrJoinRequestExpired
	}
	if certificate.FabricID != fabricID || certificate.SubjectKind != membership.SubjectNode || certificate.SubjectID != subjectID || certificate.IdentityPubkey != identityPubkey || certificate.EncryptionPubkey != encryptionPubkey {
		return NodeSummary{}, ErrAccessDenied
	}
	if existingCertificate.Valid {
		if membership.CertificateFingerprint(certificate) != certificateFingerprintJSON(existingCertificate.String) {
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
	certificateJSON := mustJSON(certificate)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO principals (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		VALUES (?, ?, 'node', ?, ?, ?, ?)
		ON CONFLICT(fabric_id, subject_id) DO UPDATE SET
			identity_pubkey = excluded.identity_pubkey,
			encryption_pubkey = excluded.encryption_pubkey,
			certificate_json = excluded.certificate_json
	`, fabricID, subjectID, identityPubkey, encryptionPubkey, certificateJSON, now.UnixMilli())
	if err != nil {
		return NodeSummary{}, fmt.Errorf("persisting node principal: %w", err)
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
	_, err = tx.ExecContext(ctx, `UPDATE join_requests SET certificate_json = ?, approved_at = ? WHERE request_id = ?`, certificateJSON, now.UnixMilli(), requestID)
	if err != nil {
		return NodeSummary{}, fmt.Errorf("completing join request: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return NodeSummary{}, fmt.Errorf("committing join request approval: %w", err)
	}
	return NodeSummary{NodeID: subjectID, FabricID: fabricID, DisplayName: displayName, Platform: platform, Version: version, Capabilities: capabilities, Status: NodeOffline, LastSeenAt: now, Revision: revision}, nil
}

func (s *Store) RegisterController(ctx context.Context, certificate membership.Certificate, grants []Grant) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := s.now().UTC().UnixMilli()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO principals (fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at)
		VALUES (?, ?, 'controller', ?, ?, ?, ?)
		ON CONFLICT(fabric_id, subject_id) DO UPDATE SET
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
	return tx.Commit()
}

func (s *Store) ListAuthorizedNodes(ctx context.Context, fabricID, controllerID string) ([]NodeSummary, int64, error) {
	fabric, err := s.GetFabric(ctx, fabricID)
	if err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT n.node_id, n.fabric_id, n.display_name, n.platform, n.version, n.capabilities_json, n.status, n.last_seen_at, n.revision
		FROM nodes n
		JOIN node_grants g ON g.fabric_id = n.fabric_id AND g.node_id = n.node_id
		WHERE n.fabric_id = ? AND g.controller_id = ? AND g.revoked_at IS NULL
		  AND g.scope IN ('view', 'control', 'admin')
		ORDER BY n.display_name COLLATE NOCASE, n.node_id
	`, fabricID, controllerID)
	if err != nil {
		return nil, 0, fmt.Errorf("listing authorized nodes: %w", err)
	}
	defer rows.Close()
	nodes := []NodeSummary{}
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, 0, err
		}
		nodes = append(nodes, node)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return nodes, fabric.Revision, nil
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
			PRIMARY KEY(fabric_id, subject_id)
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
			approved_at INTEGER,
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
