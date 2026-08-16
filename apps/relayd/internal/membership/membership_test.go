package membership

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"
)

func TestCertificateVerificationBindsOwnerFabricAndExpiry(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	validator := NewValidator(func() time.Time { return now }, time.Minute)
	ownerPublic, ownerPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	nodePublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := SignCertificate(ownerPrivate, Certificate{
		Version:          1,
		FabricID:         "fab_a",
		SubjectKind:      SubjectNode,
		SubjectID:        "node_a",
		IdentityPubkey:   base64.StdEncoding.EncodeToString(nodePublic),
		EncryptionPubkey: "x25519-public-key",
		Scopes:           []Scope{ScopeControl, ScopeView},
		IssuedAt:         now.Unix(),
		ExpiresAt:        now.Add(time.Hour).Unix(),
		Nonce:            "certificate-nonce",
		IssuerPubkey:     base64.StdEncoding.EncodeToString(ownerPublic),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validator.VerifyCertificate(certificate, base64.StdEncoding.EncodeToString(ownerPublic), "fab_a"); err != nil {
		t.Fatalf("VerifyCertificate() error = %v", err)
	}
	if err := validator.VerifyCertificate(certificate, base64.StdEncoding.EncodeToString(ownerPublic), "fab_b"); err != ErrWrongFabric {
		t.Fatalf("wrong fabric error = %v, want %v", err, ErrWrongFabric)
	}
	certificate.ExpiresAt = now.Add(-time.Second).Unix()
	if err := validator.VerifyCertificate(certificate, base64.StdEncoding.EncodeToString(ownerPublic), "fab_a"); err != ErrExpired {
		t.Fatalf("expired certificate error = %v, want %v", err, ErrExpired)
	}
}

func TestRequestProofRejectsReplayAndPathSubstitution(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	validator := NewValidator(func() time.Time { return now }, time.Minute)
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := SignRequestProof(privateKey, RequestProof{
		Method:   "GET",
		Path:     "/v1/fabrics/fab_a/nodes",
		IssuedAt: now.Unix(),
		Nonce:    "request-nonce",
	})
	if err != nil {
		t.Fatal(err)
	}
	pubkey := base64.StdEncoding.EncodeToString(publicKey)
	if err := validator.VerifyRequestProof(proof, pubkey, "GET", "/v1/fabrics/fab_a/nodes"); err != nil {
		t.Fatalf("VerifyRequestProof() error = %v", err)
	}
	if err := validator.VerifyRequestProof(proof, pubkey, "GET", "/v1/fabrics/fab_a/nodes"); err != ErrReplayedNonce {
		t.Fatalf("replay error = %v, want %v", err, ErrReplayedNonce)
	}
	second, err := SignRequestProof(privateKey, RequestProof{
		Method:   "GET",
		Path:     "/v1/fabrics/fab_a/nodes",
		IssuedAt: now.Unix(),
		Nonce:    "second-nonce",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validator.VerifyRequestProof(second, pubkey, "GET", "/v1/fabrics/fab_b/nodes"); err != ErrInvalidDocument {
		t.Fatalf("path substitution error = %v, want %v", err, ErrInvalidDocument)
	}
}

func TestJoinRequestIsBoundToNodeIdentity(t *testing.T) {
	now := time.Date(2026, 8, 16, 12, 0, 0, 0, time.UTC)
	validator := NewValidator(func() time.Time { return now }, time.Minute)
	identityPublic, identityPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	request, err := SignJoinRequest(identityPrivate, JoinRequest{
		RequestID:          "join_1",
		FabricID:           "fab_a",
		SubjectKind:        SubjectNode,
		SubjectID:          "node_a",
		EncryptionPubkey:   "x25519-public-key",
		DisplayName:        "Devbox",
		Platform:           "darwin",
		Version:            "1.0.0",
		Capabilities:       []string{"workspace", "terminal"},
		DeliverySecretHash: testDeliverySecretHash("delivery-secret"),
		IssuedAt:           now.Unix(),
		ExpiresAt:          now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if request.IdentityPubkey != base64.StdEncoding.EncodeToString(identityPublic) {
		t.Fatal("SignJoinRequest did not bind the signing key")
	}
	if err := validator.VerifyJoinRequest(request); err != nil {
		t.Fatalf("VerifyJoinRequest() error = %v", err)
	}
	request.DisplayName = "Attacker renamed this"
	if err := validator.VerifyJoinRequest(request); err != ErrInvalidDocument {
		t.Fatalf("tampered join request error = %v, want %v", err, ErrInvalidDocument)
	}
}

func testDeliverySecretHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
