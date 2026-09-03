package fabric

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/cradle/relayd/internal/membership"
)

func TestStorePersistsFabricAndFiltersNodesByGrant(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	store := newTestStore(t, &clock)
	ownerPublic, ownerPrivate := newKey(t)
	fabricA, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	fabricB, err := store.CreateFabric(t.Context(), "create-b", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	nodeA := enrollNode(t, store, ownerPrivate, fabricA, "node-a", "Mac devbox", clock)
	_ = enrollNode(t, store, ownerPrivate, fabricB, "node-b", "Linux build", clock)
	controllerPublic, controllerPrivate := newKey(t)
	controllerCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         fabricA.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        "controller-a",
		IdentityPubkey:   encodeKey(controllerPublic),
		EncryptionPubkey: "controller-x25519",
		Scopes:           []membership.Scope{membership.ScopeView, membership.ScopeControl},
		IssuedAt:         clock.Unix(),
		Nonce:            "controller-cert",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterController(t.Context(), controllerCertificate, []Grant{{
		ID:           "grant-node-a-view",
		FabricID:     fabricA.ID,
		ControllerID: "controller-a",
		NodeID:       nodeA.NodeID,
		Scope:        membership.ScopeView,
	}}); err != nil {
		t.Fatal(err)
	}
	nodes, revision, err := store.ListAuthorizedNodes(t.Context(), fabricA.ID, "controller-a")
	if err != nil {
		t.Fatal(err)
	}
	if revision == 0 || len(nodes) != 1 || nodes[0].NodeID != nodeA.NodeID {
		t.Fatalf("authorized nodes = %#v at revision %d, want only node-a", nodes, revision)
	}
	if _, _, err := store.ListAuthorizedNodes(t.Context(), fabricB.ID, "controller-a"); err != nil {
		t.Fatal(err)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricB.ID, "controller-a", "node-b", membership.ScopeControl); err != nil || granted {
		t.Fatalf("cross-fabric grant = %v, error = %v", granted, err)
	}
	_ = controllerPrivate
}

func TestStoreRestartRetainsNodeAndResetsTransientPresence(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	path := t.TempDir() + "/fabric.sqlite"
	store, err := OpenStore(StoreConfig{Path: path, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	node := enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "Devbox", clock)
	clock = clock.Add(time.Minute)
	if _, err := store.SetNodePresence(t.Context(), fabricRecord.ID, node.NodeID, NodeOnline); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenStore(StoreConfig{Path: path, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	restored, err := store.GetNode(t.Context(), fabricRecord.ID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != NodeOffline {
		t.Fatalf("status after restart = %q, want %q", restored.Status, NodeOffline)
	}
}

func TestStoreMigratesLegacyPrincipalSchemaWithoutLosingNodeCertificate(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	path := t.TempDir() + "/fabric.sqlite"
	store, err := OpenStore(StoreConfig{Path: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	node := enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "Studio", now)

	if _, err := store.db.ExecContext(t.Context(), `
		CREATE TABLE principals_legacy (
			fabric_id TEXT NOT NULL REFERENCES fabrics(fabric_id) ON DELETE CASCADE,
			subject_id TEXT NOT NULL,
			subject_kind TEXT NOT NULL CHECK(subject_kind IN ('node', 'controller')),
			identity_pubkey TEXT NOT NULL,
			encryption_pubkey TEXT NOT NULL,
			certificate_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(fabric_id, subject_id)
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		INSERT INTO principals_legacy
		SELECT fabric_id, subject_id, subject_kind, identity_pubkey, encryption_pubkey, certificate_json, created_at
		FROM principals WHERE subject_kind = 'controller'
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `DROP TABLE principals`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `ALTER TABLE principals_legacy RENAME TO principals`); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenStore(StoreConfig{Path: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	certificate, err := store.GetNodeCertificate(t.Context(), fabricRecord.ID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if certificate.SubjectKind != membership.SubjectNode || certificate.SubjectID != node.NodeID {
		t.Fatalf("restored Node certificate = %#v", certificate)
	}
	if exists, err := store.ControllerExists(t.Context(), fabricRecord.ID, node.NodeID, certificate.IdentityPubkey); err != nil || !exists {
		t.Fatalf("restored Controller principal = %v, error = %v", exists, err)
	}
}

func TestStoreRestartRepairsMissingPersonalDeviceGrantsWithoutRestoringRevokedAccess(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	path := t.TempDir() + "/fabric.sqlite"
	store, err := OpenStore(StoreConfig{Path: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "Studio", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-b", "MacBook", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-c", "Laptop", now)

	var legacyControllerCertificate string
	if err := store.db.QueryRowContext(t.Context(), `
		SELECT controller_certificate_json FROM join_requests WHERE fabric_id = ? AND subject_id = ?
	`, fabricRecord.ID, "node-a").Scan(&legacyControllerCertificate); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		DELETE FROM principals
		WHERE fabric_id = ? AND subject_id = ? AND subject_kind = 'node'
	`, fabricRecord.ID, "node-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		UPDATE principals SET certificate_json = ?
		WHERE fabric_id = ? AND subject_id = ? AND subject_kind = 'controller'
	`, legacyControllerCertificate, fabricRecord.ID, "node-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		UPDATE join_requests SET controller_certificate_json = NULL
		WHERE fabric_id = ? AND subject_id = ?
	`, fabricRecord.ID, "node-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		DELETE FROM node_grants WHERE fabric_id = ? AND controller_id = ? AND node_id = ?
	`, fabricRecord.ID, "node-a", "node-b"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		DELETE FROM node_grants WHERE fabric_id = ? AND controller_id = ? AND node_id = ?
	`, fabricRecord.ID, "node-b", "node-c"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(t.Context(), `
		UPDATE node_grants SET revoked_at = ?
		WHERE fabric_id = ? AND controller_id = ? AND node_id = ?
	`, now.UnixMilli(), fabricRecord.ID, "node-b", "node-a"); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetFabric(t.Context(), fabricRecord.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = OpenStore(StoreConfig{Path: path, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, "node-a", "node-b", membership.ScopeAdmin); err != nil || !granted {
		t.Fatalf("repaired legacy owner grant = %v, error = %v", granted, err)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, "node-b", "node-c", membership.ScopeAdmin); err != nil || !granted {
		t.Fatalf("repaired joined device grant = %v, error = %v", granted, err)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, "node-b", "node-a", membership.ScopeAdmin); err != nil || granted {
		t.Fatalf("revoked personal device grant = %v, error = %v", granted, err)
	}
	after, err := store.GetFabric(t.Context(), fabricRecord.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != before.Revision+1 {
		t.Fatalf("repaired Fabric revision = %d, want %d", after.Revision, before.Revision+1)
	}
}

func TestStoreListsAllFabricNodesForAdminWithoutExpandingGrants(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	store := newTestStore(t, &now)
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "MacBook", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-b", "Studio", now)
	adminPublic, _ := newKey(t)
	adminCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version: 1, FabricID: fabricRecord.ID, SubjectKind: membership.SubjectController,
		SubjectID: "admin-without-grants", IdentityPubkey: encodeKey(adminPublic),
		EncryptionPubkey: "admin-x25519", Scopes: []membership.Scope{membership.ScopeAdmin},
		IssuedAt: now.Unix(), Nonce: "admin-without-grants",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RegisterController(t.Context(), adminCertificate, nil); err != nil {
		t.Fatal(err)
	}

	nodes, _, err := store.ListFabricNodes(t.Context(), fabricRecord.ID, adminCertificate.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || len(nodes[0].Scopes) != 0 || len(nodes[1].Scopes) != 0 {
		t.Fatalf("admin directory without grants = %#v", nodes)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, adminCertificate.SubjectID, "node-a", membership.ScopeAdmin); err != nil || granted {
		t.Fatalf("admin discovery expanded grant = %v, error = %v", granted, err)
	}
}

func TestStoreRevokesControllerIdentityAndAllGrants(t *testing.T) {
	now := time.Date(2026, 8, 31, 2, 0, 0, 0, time.UTC)
	store := newTestStore(t, &now)
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-revoke", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "Studio", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-b", "Laptop", now)
	controllerPublic, _ := newKey(t)
	certificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version: 1, FabricID: fabricRecord.ID, SubjectKind: membership.SubjectController,
		SubjectID: "mobile-controller", IdentityPubkey: encodeKey(controllerPublic),
		EncryptionPubkey: "mobile-x25519", Scopes: []membership.Scope{membership.ScopeControl},
		IssuedAt: now.Unix(), Nonce: "mobile-controller-cert",
	})
	if err != nil {
		t.Fatal(err)
	}
	grants := []Grant{
		{ID: "mobile-node-a", FabricID: fabricRecord.ID, ControllerID: certificate.SubjectID, NodeID: "node-a", Scope: membership.ScopeControl},
		{ID: "mobile-node-b", FabricID: fabricRecord.ID, ControllerID: certificate.SubjectID, NodeID: "node-b", Scope: membership.ScopeControl},
	}
	if err := store.RegisterController(t.Context(), certificate, grants); err != nil {
		t.Fatal(err)
	}
	before, err := store.GetFabric(t.Context(), fabricRecord.ID)
	if err != nil {
		t.Fatal(err)
	}
	nodeIDs, revision, err := store.RevokeController(t.Context(), fabricRecord.ID, certificate.SubjectID, "owner_revoked")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeIDs) != 2 || nodeIDs[0] != "node-a" || nodeIDs[1] != "node-b" || revision != before.Revision+1 {
		t.Fatalf("revocation nodes = %#v, revision = %d", nodeIDs, revision)
	}
	if exists, err := store.ControllerExists(t.Context(), fabricRecord.ID, certificate.SubjectID, certificate.IdentityPubkey); err != nil || exists {
		t.Fatalf("revoked Controller exists = %v, error = %v", exists, err)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, certificate.SubjectID, "node-a", membership.ScopeControl); err != nil || granted {
		t.Fatalf("revoked Controller grant = %v, error = %v", granted, err)
	}
	if err := store.RegisterController(t.Context(), certificate, grants); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("re-register revoked Controller error = %v", err)
	}
	againNodes, againRevision, err := store.RevokeController(t.Context(), fabricRecord.ID, certificate.SubjectID, "owner_revoked")
	if err != nil || len(againNodes) != 0 || againRevision != revision {
		t.Fatalf("idempotent revocation nodes = %#v, revision = %d, error = %v", againNodes, againRevision, err)
	}
	if _, _, err := store.RevokeController(t.Context(), fabricRecord.ID, "node-a", "owner_revoked"); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("revoke admin Controller error = %v", err)
	}
}

func TestStoreRemoveNodeDeletesIdentityAndBothSidesOfGrants(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	store := newTestStore(t, &now)
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-a", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "MacBook", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-b", "Studio", now)

	removed, controllerIDs, err := store.RemoveNode(t.Context(), fabricRecord.ID, "node-b")
	if err != nil {
		t.Fatal(err)
	}
	if removed.NodeID != "node-b" || removed.Revision <= 0 || len(controllerIDs) != 2 {
		t.Fatalf("removed Node = %#v, controllers = %#v", removed, controllerIDs)
	}
	if _, err := store.GetNode(t.Context(), fabricRecord.ID, "node-b"); !errors.Is(err, ErrFabricNotFound) {
		t.Fatalf("removed Node lookup error = %v", err)
	}
	if _, err := store.GetNodeCertificate(t.Context(), fabricRecord.ID, "node-b"); !errors.Is(err, ErrFabricNotFound) {
		t.Fatalf("removed Node certificate lookup error = %v", err)
	}
	if granted, err := store.HasActiveGrant(t.Context(), fabricRecord.ID, "node-b", "node-a", membership.ScopeAdmin); err != nil || granted {
		t.Fatalf("removed Controller grant = %v, error = %v", granted, err)
	}
	nodes, _, err := store.ListFabricNodes(t.Context(), fabricRecord.ID, "node-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].NodeID != "node-a" {
		t.Fatalf("directory after removal = %#v", nodes)
	}
}

func enrollNode(t *testing.T, store *Store, owner ed25519.PrivateKey, fabricRecord Fabric, nodeID, displayName string, now time.Time) NodeSummary {
	t.Helper()
	identityPublic, identityPrivate := newKey(t)
	request, err := membership.SignJoinRequest(identityPrivate, membership.JoinRequest{
		RequestID:          "join-" + nodeID,
		FabricID:           fabricRecord.ID,
		SubjectKind:        membership.SubjectNode,
		SubjectID:          nodeID,
		EncryptionPubkey:   "node-x25519-" + nodeID,
		DisplayName:        displayName,
		Platform:           "darwin",
		Version:            "1.0.0",
		Capabilities:       []string{"workspace", "terminal"},
		DeliverySecretHash: hashSecret("delivery-" + nodeID),
		IssuedAt:           now.Unix(),
		ExpiresAt:          now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateJoinRequest(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	certificate, err := membership.SignCertificate(owner, membership.Certificate{
		Version:          1,
		FabricID:         fabricRecord.ID,
		SubjectKind:      membership.SubjectNode,
		SubjectID:        nodeID,
		IdentityPubkey:   encodeKey(identityPublic),
		EncryptionPubkey: request.EncryptionPubkey,
		Scopes:           []membership.Scope{membership.ScopeControl},
		IssuedAt:         now.Unix(),
		Nonce:            "node-cert-" + nodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	controllerCertificate, err := membership.SignCertificate(owner, membership.Certificate{
		Version:          1,
		FabricID:         fabricRecord.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        nodeID,
		IdentityPubkey:   encodeKey(identityPublic),
		EncryptionPubkey: request.EncryptionPubkey,
		NodeID:           nodeID,
		Scopes:           []membership.Scope{membership.ScopeAdmin},
		IssuedAt:         now.Unix(),
		Nonce:            "controller-cert-" + nodeID,
	})
	if err != nil {
		t.Fatal(err)
	}
	node, err := store.ApproveJoinRequest(t.Context(), request.RequestID, certificate, controllerCertificate)
	if err != nil {
		t.Fatal(err)
	}
	return node
}

func TestApproveControllerJoinRequestPersistsCertificateAndScopedGrants(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	store := newTestStore(t, &now)
	ownerPublic, ownerPrivate := newKey(t)
	fabricRecord, err := store.CreateFabric(t.Context(), "create-controller-fabric", encodeKey(ownerPublic))
	if err != nil {
		t.Fatal(err)
	}
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-a", "Studio", now)
	_ = enrollNode(t, store, ownerPrivate, fabricRecord, "node-b", "Devbox", now)

	controllerPublic, controllerPrivate := newKey(t)
	deliverySecret := "ios-controller-delivery-secret"
	joinRequest, err := membership.SignJoinRequest(controllerPrivate, membership.JoinRequest{
		RequestID:          "join-controller-ios",
		FabricID:           fabricRecord.ID,
		SubjectKind:        membership.SubjectController,
		SubjectID:          "controller-ios",
		EncryptionPubkey:   "controller-ios-x25519",
		DisplayName:        "iPhone",
		Platform:           "ios",
		Version:            "1.0.0",
		Capabilities:       []string{"chat", "work"},
		DeliverySecretHash: hashSecret(deliverySecret),
		IssuedAt:           now.Unix(),
		ExpiresAt:          now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateJoinRequest(t.Context(), joinRequest); err != nil {
		t.Fatal(err)
	}
	certificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         fabricRecord.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        joinRequest.SubjectID,
		IdentityPubkey:   encodeKey(controllerPublic),
		EncryptionPubkey: joinRequest.EncryptionPubkey,
		Scopes:           []membership.Scope{membership.ScopeView, membership.ScopeControl},
		IssuedAt:         now.Unix(),
		Nonce:            "controller-ios-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	grants := []Grant{
		{ID: "grant-ios-view", FabricID: fabricRecord.ID, ControllerID: joinRequest.SubjectID, NodeID: "node-a", Scope: membership.ScopeView},
		{ID: "grant-ios-control", FabricID: fabricRecord.ID, ControllerID: joinRequest.SubjectID, NodeID: "node-a", Scope: membership.ScopeControl},
		{ID: "grant-ios-node-b-view", FabricID: fabricRecord.ID, ControllerID: joinRequest.SubjectID, NodeID: "node-b", Scope: membership.ScopeView},
		{ID: "grant-ios-node-b-control", FabricID: fabricRecord.ID, ControllerID: joinRequest.SubjectID, NodeID: "node-b", Scope: membership.ScopeControl},
	}
	boundCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         fabricRecord.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        joinRequest.SubjectID,
		IdentityPubkey:   encodeKey(controllerPublic),
		EncryptionPubkey: joinRequest.EncryptionPubkey,
		NodeID:           "node-a",
		Scopes:           []membership.Scope{membership.ScopeView},
		IssuedAt:         now.Unix(),
		Nonce:            "controller-ios-bound-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ApproveControllerJoinRequest(t.Context(), joinRequest.RequestID, boundCertificate, grants[:1]); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("node-bound Controller approval error = %v, want access denied", err)
	}
	adminCertificate := certificate
	adminCertificate.Scopes = []membership.Scope{membership.ScopeAdmin}
	adminCertificate.Nonce = "controller-ios-admin-certificate"
	adminCertificate, err = membership.SignCertificate(ownerPrivate, adminCertificate)
	if err != nil {
		t.Fatal(err)
	}
	adminGrant := []Grant{{ID: "grant-ios-admin", FabricID: fabricRecord.ID, ControllerID: joinRequest.SubjectID, NodeID: "node-a", Scope: membership.ScopeAdmin}}
	if err := store.ApproveControllerJoinRequest(t.Context(), joinRequest.RequestID, adminCertificate, adminGrant); !errors.Is(err, ErrAccessDenied) {
		t.Fatalf("admin Controller enrollment error = %v, want access denied", err)
	}
	if err := store.ApproveControllerJoinRequest(t.Context(), joinRequest.RequestID, certificate, grants); err != nil {
		t.Fatal(err)
	}
	result, err := store.ReadJoinRequest(t.Context(), joinRequest.RequestID, deliverySecret)
	if err != nil {
		t.Fatal(err)
	}
	if result.NodeCertificate != nil || result.ControllerCertificate == nil || result.ControllerCertificate.SubjectID != joinRequest.SubjectID {
		t.Fatalf("Controller enrollment result = %#v", result)
	}
	nodes, _, err := store.ListAuthorizedNodes(t.Context(), fabricRecord.ID, joinRequest.SubjectID)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || nodes[0].NodeID != "node-b" && nodes[1].NodeID != "node-b" {
		t.Fatalf("Controller authorized Nodes = %#v", nodes)
	}
	if err := store.ApproveControllerJoinRequest(t.Context(), joinRequest.RequestID, certificate, grants); err != nil {
		t.Fatalf("idempotent Controller approval error = %v", err)
	}
}

func newTestStore(t *testing.T, clock *time.Time) *Store {
	t.Helper()
	store, err := OpenStore(StoreConfig{
		Path: t.TempDir() + "/fabric.sqlite",
		Now:  func() time.Time { return *clock },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func newKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey, privateKey
}

func encodeKey(key ed25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(key)
}
