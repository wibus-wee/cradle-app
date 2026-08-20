package directory

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cradle/relayd/internal/fabric"
	"github.com/cradle/relayd/internal/membership"
)

func TestDirectoryEnrollmentAndAuthorizedDiscovery(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	clock := now
	store, err := fabric.OpenStore(fabric.StoreConfig{
		Path: t.TempDir() + "/fabric.sqlite",
		Now:  func() time.Time { return clock },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	validator := membership.NewValidator(func() time.Time { return clock }, time.Minute)
	directory, err := NewServer(Config{Store: store, Validator: validator})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	directory.Register(mux)
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	ownerPublic, ownerPrivate := directoryKey(t)
	create, err := membership.SignCreateFabric(ownerPrivate, membership.CreateFabricRequest{
		RequestID: "create-fabric-a",
		IssuedAt:  clock.Unix(),
		Nonce:     "create-nonce",
	})
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Fabric fabric.Fabric `json:"fabric"`
	}
	postDirectoryJSON(t, httpServer.URL+"/v1/fabrics", create, nil, http.StatusCreated, &created)
	if created.Fabric.OwnerPublicKey != encodeDirectoryKey(ownerPublic) {
		t.Fatal("created Fabric did not retain owner key")
	}

	nodePublic, nodePrivate := directoryKey(t)
	deliverySecret := "node-delivery-secret"
	join, err := membership.SignJoinRequest(nodePrivate, membership.JoinRequest{
		RequestID:          "join-node-a",
		FabricID:           created.Fabric.ID,
		SubjectKind:        membership.SubjectNode,
		SubjectID:          "node-a",
		EncryptionPubkey:   "node-x25519",
		DisplayName:        "MacBook Pro",
		Platform:           "darwin",
		Version:            "1.0.0",
		Capabilities:       []string{"workspace", "terminal"},
		DeliverySecretHash: directorySecretHash(deliverySecret),
		IssuedAt:           clock.Unix(),
		ExpiresAt:          clock.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	postDirectoryJSON(t, httpServer.URL+"/v1/join-requests", join, nil, http.StatusCreated, &map[string]any{})

	nodeCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         created.Fabric.ID,
		SubjectKind:      membership.SubjectNode,
		SubjectID:        "node-a",
		IdentityPubkey:   encodeDirectoryKey(nodePublic),
		EncryptionPubkey: "node-x25519",
		Scopes:           []membership.Scope{membership.ScopeControl},
		IssuedAt:         clock.Unix(),
		Nonce:            "node-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	joinedControllerCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         created.Fabric.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        "node-a",
		IdentityPubkey:   encodeDirectoryKey(nodePublic),
		EncryptionPubkey: "node-x25519",
		NodeID:           "node-a",
		Scopes:           []membership.Scope{membership.ScopeAdmin},
		IssuedAt:         clock.Unix(),
		Nonce:            "joined-controller-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	pendingPath := "/v1/fabrics/" + created.Fabric.ID + "/join-requests"
	pendingHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodGet, pendingPath, clock, "list-pending")
	var pending struct {
		Requests []membership.JoinRequest `json:"requests"`
	}
	getDirectoryJSON(t, httpServer.URL+pendingPath, pendingHeaders, http.StatusOK, &pending)
	if len(pending.Requests) != 1 || pending.Requests[0].RequestID != join.RequestID {
		t.Fatalf("pending join requests = %#v", pending.Requests)
	}
	ownerHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodPost, "/v1/join-requests/join-node-a/approve", clock, "approve-node")
	postDirectoryJSON(t, httpServer.URL+"/v1/join-requests/join-node-a/approve", approveJoinRequest{NodeCertificate: nodeCertificate, ControllerCertificate: joinedControllerCertificate}, ownerHeaders, http.StatusOK, &fabric.NodeSummary{})

	var approved struct {
		Status                string                 `json:"status"`
		NodeCertificate       membership.Certificate `json:"nodeCertificate"`
		ControllerCertificate membership.Certificate `json:"controllerCertificate"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/join-requests/join-node-a?secret="+deliverySecret, nil, http.StatusOK, &approved)
	if approved.Status != "approved" || approved.NodeCertificate.SubjectID != "node-a" || approved.ControllerCertificate.SubjectKind != membership.SubjectController {
		t.Fatalf("join request result = %#v", approved)
	}

	nodeBPublic, nodeBPrivate := directoryKey(t)
	nodeBJoin, err := membership.SignJoinRequest(nodeBPrivate, membership.JoinRequest{
		RequestID:          "join-node-b",
		FabricID:           created.Fabric.ID,
		SubjectKind:        membership.SubjectNode,
		SubjectID:          "node-b",
		EncryptionPubkey:   "node-b-x25519",
		DisplayName:        "Studio",
		Platform:           "darwin",
		Version:            "1.0.0",
		Capabilities:       []string{"workspace", "terminal"},
		DeliverySecretHash: directorySecretHash("node-b-delivery-secret"),
		IssuedAt:           clock.Unix(),
		ExpiresAt:          clock.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateJoinRequest(t.Context(), nodeBJoin); err != nil {
		t.Fatal(err)
	}
	nodeBCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         created.Fabric.ID,
		SubjectKind:      membership.SubjectNode,
		SubjectID:        "node-b",
		IdentityPubkey:   encodeDirectoryKey(nodeBPublic),
		EncryptionPubkey: "node-b-x25519",
		Scopes:           []membership.Scope{membership.ScopeControl},
		IssuedAt:         clock.Unix(),
		Nonce:            "node-b-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	nodeBControllerCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         created.Fabric.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        "node-b",
		IdentityPubkey:   encodeDirectoryKey(nodeBPublic),
		EncryptionPubkey: "node-b-x25519",
		Scopes:           []membership.Scope{membership.ScopeAdmin},
		IssuedAt:         clock.Unix(),
		Nonce:            "node-b-controller-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApproveJoinRequest(t.Context(), nodeBJoin.RequestID, nodeBCertificate, nodeBControllerCertificate); err != nil {
		t.Fatal(err)
	}

	legacyControllerHeaders := directoryProofHeaders(t, nodePrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "legacy-controller-list-nodes")
	legacyControllerHeaders.Set(certificateHeader, directoryHeaderJSON(t, joinedControllerCertificate))
	var legacyControllerDiscovery struct {
		Nodes []fabric.NodeSummary `json:"nodes"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", legacyControllerHeaders, http.StatusOK, &legacyControllerDiscovery)
	if len(legacyControllerDiscovery.Nodes) != 2 {
		t.Fatalf("legacy admin controller nodes = %#v", legacyControllerDiscovery.Nodes)
	}

	adminPublic, adminPrivate := directoryKey(t)
	adminWithoutGrants, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version: 1, FabricID: created.Fabric.ID, SubjectKind: membership.SubjectController,
		SubjectID: "admin-without-grants", IdentityPubkey: encodeDirectoryKey(adminPublic),
		EncryptionPubkey: "admin-without-grants-x25519", Scopes: []membership.Scope{membership.ScopeAdmin},
		IssuedAt: clock.Unix(), Nonce: "admin-without-grants-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	registerAdminPath := "/v1/fabrics/" + created.Fabric.ID + "/controllers"
	registerAdminHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodPost, registerAdminPath, clock, "register-admin-without-grants")
	postDirectoryJSON(t, httpServer.URL+registerAdminPath, registerControllerRequest{Certificate: adminWithoutGrants}, registerAdminHeaders, http.StatusNoContent, nil)
	adminDirectoryHeaders := directoryProofHeaders(t, adminPrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "admin-directory-without-grants")
	adminDirectoryHeaders.Set(certificateHeader, directoryHeaderJSON(t, adminWithoutGrants))
	var adminDirectory struct {
		Nodes []fabric.NodeSummary `json:"nodes"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", adminDirectoryHeaders, http.StatusOK, &adminDirectory)
	if len(adminDirectory.Nodes) != 2 || len(adminDirectory.Nodes[0].Scopes) != 0 || len(adminDirectory.Nodes[1].Scopes) != 0 {
		t.Fatalf("authoritative admin directory = %#v", adminDirectory.Nodes)
	}

	rejectedSecret := "rejected-delivery-secret"
	rejectedJoin, err := membership.SignJoinRequest(nodePrivate, membership.JoinRequest{
		RequestID:          "join-node-rejected",
		FabricID:           created.Fabric.ID,
		SubjectKind:        membership.SubjectNode,
		SubjectID:          "node-rejected",
		EncryptionPubkey:   "node-rejected-x25519",
		DisplayName:        "Rejected Mac",
		Platform:           "darwin",
		Version:            "1.0.0",
		Capabilities:       []string{"workspace"},
		DeliverySecretHash: directorySecretHash(rejectedSecret),
		IssuedAt:           clock.Unix(),
		ExpiresAt:          clock.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	postDirectoryJSON(t, httpServer.URL+"/v1/join-requests", rejectedJoin, nil, http.StatusCreated, &map[string]any{})
	rejectPath := "/v1/fabrics/" + created.Fabric.ID + "/join-requests/" + rejectedJoin.RequestID
	rejectHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodDelete, rejectPath, clock, "reject-node")
	deleteDirectory(t, httpServer.URL+rejectPath, rejectHeaders, http.StatusNoContent)
	var rejected struct {
		Status string `json:"status"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/join-requests/"+rejectedJoin.RequestID+"?secret="+rejectedSecret, nil, http.StatusOK, &rejected)
	if rejected.Status != "rejected" {
		t.Fatalf("rejected join request result = %#v", rejected)
	}

	controllerPublic, controllerPrivate := directoryKey(t)
	controllerCertificate, err := membership.SignCertificate(ownerPrivate, membership.Certificate{
		Version:          1,
		FabricID:         created.Fabric.ID,
		SubjectKind:      membership.SubjectController,
		SubjectID:        "controller-a",
		IdentityPubkey:   encodeDirectoryKey(controllerPublic),
		EncryptionPubkey: "controller-x25519",
		Scopes:           []membership.Scope{membership.ScopeView, membership.ScopeControl},
		IssuedAt:         clock.Unix(),
		Nonce:            "controller-certificate",
	})
	if err != nil {
		t.Fatal(err)
	}
	controllerBody := registerControllerRequest{
		Certificate: controllerCertificate,
		Grants: []fabric.Grant{{
			ID:           "grant-node-a-view",
			FabricID:     created.Fabric.ID,
			ControllerID: "controller-a",
			NodeID:       "node-a",
			Scope:        membership.ScopeView,
		}},
	}
	ownerHeaders = directoryProofHeaders(t, ownerPrivate, http.MethodPost, "/v1/fabrics/"+created.Fabric.ID+"/controllers", clock, "register-controller")
	postDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/controllers", controllerBody, ownerHeaders, http.StatusNoContent, nil)

	controllerHeaders := directoryProofHeaders(t, controllerPrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "list-nodes")
	controllerHeaders.Set(certificateHeader, directoryHeaderJSON(t, controllerCertificate))
	var discovered struct {
		Nodes []fabric.NodeSummary `json:"nodes"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", controllerHeaders, http.StatusOK, &discovered)
	if len(discovered.Nodes) != 1 || discovered.Nodes[0].NodeID != "node-a" {
		t.Fatalf("discovered nodes = %#v", discovered.Nodes)
	}
	if len(discovered.Nodes[0].Scopes) != 1 || discovered.Nodes[0].Scopes[0] != "view" {
		t.Fatalf("discovered node caller scopes = %#v", discovered.Nodes[0].Scopes)
	}

	grantListHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodGet, "/v1/nodes/node-a/grants", clock, "list-grants")
	var grantList struct {
		Grants []fabric.Grant `json:"grants"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/nodes/node-a/grants", grantListHeaders, http.StatusOK, &grantList)
	if len(grantList.Grants) != 3 || !hasActiveGrant(grantList.Grants, "grant-node-a-view", membership.ScopeView) {
		t.Fatalf("node grants = %#v", grantList.Grants)
	}
	// Grant management is owner-only: a Controller proof must not list grants.
	controllerGrantHeaders := directoryProofHeaders(t, controllerPrivate, http.MethodGet, "/v1/nodes/node-a/grants", clock, "list-grants-controller")
	controllerGrantHeaders.Set(certificateHeader, directoryHeaderJSON(t, controllerCertificate))
	getDirectoryJSON(t, httpServer.URL+"/v1/nodes/node-a/grants", controllerGrantHeaders, http.StatusUnauthorized, nil)

	revokeHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodDelete, "/v1/nodes/node-a/grants/grant-node-a-view", clock, "revoke-controller")
	deleteDirectory(t, httpServer.URL+"/v1/nodes/node-a/grants/grant-node-a-view", revokeHeaders, http.StatusNoContent)
	grantListHeaders = directoryProofHeaders(t, ownerPrivate, http.MethodGet, "/v1/nodes/node-a/grants", clock, "list-grants-after-revoke")
	getDirectoryJSON(t, httpServer.URL+"/v1/nodes/node-a/grants", grantListHeaders, http.StatusOK, &grantList)
	if len(grantList.Grants) != 3 || !hasRevokedGrant(grantList.Grants, "grant-node-a-view") {
		t.Fatalf("node grants after revocation = %#v", grantList.Grants)
	}
	controllerHeaders = directoryProofHeaders(t, controllerPrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "list-nodes-after-revoke")
	controllerHeaders.Set(certificateHeader, directoryHeaderJSON(t, controllerCertificate))
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", controllerHeaders, http.StatusOK, &discovered)
	if len(discovered.Nodes) != 0 {
		t.Fatalf("nodes after grant revocation = %#v", discovered.Nodes)
	}

	if _, err := directory.MarkNodePresence(t.Context(), created.Fabric.ID, "node-a", fabric.NodeOnline); err != nil {
		t.Fatal(err)
	}

	removePath := "/v1/nodes/node-b"
	removeHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodDelete, removePath, clock, "remove-node-b")
	deleteDirectory(t, httpServer.URL+removePath, removeHeaders, http.StatusNoContent)
	adminDirectoryHeaders = directoryProofHeaders(t, adminPrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "admin-directory-after-removal")
	adminDirectoryHeaders.Set(certificateHeader, directoryHeaderJSON(t, adminWithoutGrants))
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", adminDirectoryHeaders, http.StatusOK, &adminDirectory)
	if len(adminDirectory.Nodes) != 1 || adminDirectory.Nodes[0].NodeID != "node-a" {
		t.Fatalf("admin directory after removal = %#v", adminDirectory.Nodes)
	}
	nodeBHeaders := directoryProofHeaders(t, nodeBPrivate, http.MethodGet, "/v1/fabrics/"+created.Fabric.ID+"/nodes", clock, "removed-node-controller")
	nodeBHeaders.Set(certificateHeader, directoryHeaderJSON(t, nodeBControllerCertificate))
	getDirectoryJSON(t, httpServer.URL+"/v1/fabrics/"+created.Fabric.ID+"/nodes", nodeBHeaders, http.StatusNotFound, nil)
}

func TestControllerNodeRestriction(t *testing.T) {
	nodes := []fabric.NodeSummary{
		{NodeID: "node-a"},
		{NodeID: "node-b"},
	}

	legacyAdmin := membership.Certificate{
		NodeID: "node-a",
		Scopes: []membership.Scope{membership.ScopeAdmin},
	}
	adminNodes := restrictNodes(nodes, controllerNodeRestriction(legacyAdmin))
	if len(adminNodes) != 2 {
		t.Fatalf("legacy admin visible nodes = %#v", adminNodes)
	}

	boundController := membership.Certificate{
		NodeID: "node-a",
		Scopes: []membership.Scope{membership.ScopeView},
	}
	boundNodes := restrictNodes(nodes, controllerNodeRestriction(boundController))
	if len(boundNodes) != 1 || boundNodes[0].NodeID != "node-a" {
		t.Fatalf("node-bound controller visible nodes = %#v", boundNodes)
	}
}

func hasActiveGrant(grants []fabric.Grant, id string, scope membership.Scope) bool {
	for _, grant := range grants {
		if grant.ID == id && grant.Scope == scope && grant.RevokedAt == nil {
			return true
		}
	}
	return false
}

func hasRevokedGrant(grants []fabric.Grant, id string) bool {
	for _, grant := range grants {
		if grant.ID == id && grant.RevokedAt != nil {
			return true
		}
	}
	return false
}

func deleteDirectory(t *testing.T, url string, headers http.Header, wantStatus int) {
	t.Helper()
	request, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("DELETE %s status = %d, want %d", url, response.StatusCode, wantStatus)
	}
}

func postDirectoryJSON(t *testing.T, url string, value any, headers http.Header, wantStatus int, out any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("POST %s status = %d, want %d", url, response.StatusCode, wantStatus)
	}
	if out != nil && response.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(response.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

func getDirectoryJSON(t *testing.T, url string, headers http.Header, wantStatus int, out any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("GET %s status = %d, want %d", url, response.StatusCode, wantStatus)
	}
	if out != nil && response.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(response.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}

func directoryProofHeaders(t *testing.T, privateKey ed25519.PrivateKey, method, path string, now time.Time, nonce string) http.Header {
	t.Helper()
	proof, err := membership.SignRequestProof(privateKey, membership.RequestProof{
		Method: method, Path: path, IssuedAt: now.Unix(), Nonce: nonce,
	})
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{}
	headers.Set(proofHeader, directoryHeaderJSON(t, proof))
	return headers
}

func directoryHeaderJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawStdEncoding.EncodeToString(raw)
}

func directoryKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return publicKey, privateKey
}

func encodeDirectoryKey(key ed25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(key)
}

func directorySecretHash(secret string) string {
	// The production wire document receives this value from the Node. The store
	// checks it against the raw delivery secret only at the polling endpoint.
	sum := sha256.Sum256([]byte(secret))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
