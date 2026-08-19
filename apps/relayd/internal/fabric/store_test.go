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
