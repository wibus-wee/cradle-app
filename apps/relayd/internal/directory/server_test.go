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
	ownerHeaders := directoryProofHeaders(t, ownerPrivate, http.MethodPost, "/v1/join-requests/join-node-a/approve", clock, "approve-node")
	postDirectoryJSON(t, httpServer.URL+"/v1/join-requests/join-node-a/approve", approveJoinRequest{Certificate: nodeCertificate}, ownerHeaders, http.StatusOK, &fabric.NodeSummary{})

	var approved struct {
		Status      string                 `json:"status"`
		Certificate membership.Certificate `json:"certificate"`
	}
	getDirectoryJSON(t, httpServer.URL+"/v1/join-requests/join-node-a?secret="+deliverySecret, nil, http.StatusOK, &approved)
	if approved.Status != "approved" || approved.Certificate.SubjectID != "node-a" {
		t.Fatalf("join request result = %#v", approved)
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
	if len(grantList.Grants) != 1 || grantList.Grants[0].ID != "grant-node-a-view" || grantList.Grants[0].Scope != membership.ScopeView || grantList.Grants[0].RevokedAt != nil {
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
	if len(grantList.Grants) != 1 || grantList.Grants[0].RevokedAt == nil {
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
