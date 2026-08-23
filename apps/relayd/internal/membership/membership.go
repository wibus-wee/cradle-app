// Package membership defines the signed Fabric documents accepted by relayd.
// Relayd verifies these documents but never owns a Fabric owner private key.
package membership

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

type SubjectKind string

const (
	SubjectNode       SubjectKind = "node"
	SubjectController SubjectKind = "controller"
)

type Scope string

const (
	ScopeView    Scope = "view"
	ScopeControl Scope = "control"
	ScopeApprove Scope = "approve"
	ScopeAdmin   Scope = "admin"
)

var (
	ErrInvalidDocument = errors.New("membership: invalid document")
	ErrExpired         = errors.New("membership: expired document")
	ErrWrongFabric     = errors.New("membership: wrong fabric")
	ErrReplayedNonce   = errors.New("membership: replayed nonce")
)

// Certificate is signed by the Fabric owner. The relay stores it as evidence
// of an already-made ownership decision; it does not mint membership itself.
type Certificate struct {
	Version          int         `json:"version"`
	FabricID         string      `json:"fabricId"`
	SubjectKind      SubjectKind `json:"subjectKind"`
	SubjectID        string      `json:"subjectId"`
	IdentityPubkey   string      `json:"identityPubkey"`
	EncryptionPubkey string      `json:"encryptionPubkey"`
	NodeID           string      `json:"nodeId,omitempty"`
	Scopes           []Scope     `json:"scopes"`
	IssuedAt         int64       `json:"issuedAt"`
	ExpiresAt        int64       `json:"expiresAt,omitempty"`
	Nonce            string      `json:"nonce"`
	IssuerPubkey     string      `json:"issuerPubkey"`
	Signature        string      `json:"signature"`
}

type certificatePayload struct {
	Version          int         `json:"version"`
	FabricID         string      `json:"fabricId"`
	SubjectKind      SubjectKind `json:"subjectKind"`
	SubjectID        string      `json:"subjectId"`
	IdentityPubkey   string      `json:"identityPubkey"`
	EncryptionPubkey string      `json:"encryptionPubkey"`
	NodeID           string      `json:"nodeId,omitempty"`
	Scopes           []Scope     `json:"scopes"`
	IssuedAt         int64       `json:"issuedAt"`
	ExpiresAt        int64       `json:"expiresAt,omitempty"`
	Nonce            string      `json:"nonce"`
	IssuerPubkey     string      `json:"issuerPubkey"`
}

// RequestProof proves that the private key named by a certificate (or Fabric
// owner record) actually authorized this HTTP request. It binds method and
// path to stop a valid proof being replayed for another endpoint.
type RequestProof struct {
	Pubkey    string `json:"pubkey"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	IssuedAt  int64  `json:"issuedAt"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
}

type requestProofPayload struct {
	Pubkey   string `json:"pubkey"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	IssuedAt int64  `json:"issuedAt"`
	Nonce    string `json:"nonce"`
}

// CreateFabricRequest is self-signed by the owner key that will become the
// Fabric trust root. RequestID makes a network retry idempotent.
type CreateFabricRequest struct {
	OwnerPubkey string `json:"ownerPubkey"`
	RequestID   string `json:"requestId"`
	IssuedAt    int64  `json:"issuedAt"`
	Nonce       string `json:"nonce"`
	Signature   string `json:"signature"`
}

type createFabricPayload struct {
	OwnerPubkey string `json:"ownerPubkey"`
	RequestID   string `json:"requestId"`
	IssuedAt    int64  `json:"issuedAt"`
	Nonce       string `json:"nonce"`
}

// JoinRequest is signed by the joining device's identity key. The device
// generates its own delivery secret and puts only its SHA-256 hash here.
// Relayd never stores the raw secret.
type JoinRequest struct {
	RequestID          string      `json:"requestId"`
	FabricID           string      `json:"fabricId"`
	SubjectKind        SubjectKind `json:"subjectKind"`
	SubjectID          string      `json:"subjectId"`
	IdentityPubkey     string      `json:"identityPubkey"`
	EncryptionPubkey   string      `json:"encryptionPubkey"`
	DisplayName        string      `json:"displayName"`
	Platform           string      `json:"platform"`
	Version            string      `json:"version"`
	Capabilities       []string    `json:"capabilities"`
	DeliverySecretHash string      `json:"deliverySecretHash"`
	IssuedAt           int64       `json:"issuedAt"`
	ExpiresAt          int64       `json:"expiresAt"`
	Signature          string      `json:"signature"`
}

type joinRequestPayload struct {
	RequestID          string      `json:"requestId"`
	FabricID           string      `json:"fabricId"`
	SubjectKind        SubjectKind `json:"subjectKind"`
	SubjectID          string      `json:"subjectId"`
	IdentityPubkey     string      `json:"identityPubkey"`
	EncryptionPubkey   string      `json:"encryptionPubkey"`
	DisplayName        string      `json:"displayName"`
	Platform           string      `json:"platform"`
	Version            string      `json:"version"`
	Capabilities       []string    `json:"capabilities"`
	DeliverySecretHash string      `json:"deliverySecretHash"`
	IssuedAt           int64       `json:"issuedAt"`
	ExpiresAt          int64       `json:"expiresAt"`
}

type Validator struct {
	now      func() time.Time
	maxSkew  time.Duration
	nonceTTL time.Duration

	mu     sync.Mutex
	nonces map[string]time.Time
}

func NewValidator(now func() time.Time, maxSkew time.Duration) *Validator {
	if now == nil {
		now = time.Now
	}
	if maxSkew <= 0 {
		maxSkew = time.Minute
	}
	return &Validator{
		now:      now,
		maxSkew:  maxSkew,
		nonceTTL: maxSkew * 2,
		nonces:   map[string]time.Time{},
	}
}

func (v *Validator) VerifyCertificate(c Certificate, ownerPubkey, expectedFabric string) error {
	if c.Version != 1 || c.FabricID == "" || c.SubjectID == "" || c.Nonce == "" || c.IssuedAt == 0 || c.SubjectKind == "" || len(c.Scopes) == 0 {
		return ErrInvalidDocument
	}
	if expectedFabric != "" && c.FabricID != expectedFabric {
		return ErrWrongFabric
	}
	if c.IssuerPubkey != ownerPubkey {
		return ErrInvalidDocument
	}
	if err := validatePublicKey(c.IdentityPubkey); err != nil {
		return err
	}
	if strings.TrimSpace(c.EncryptionPubkey) == "" {
		return ErrInvalidDocument
	}
	if c.ExpiresAt != 0 && !v.now().Before(time.Unix(c.ExpiresAt, 0)) {
		return ErrExpired
	}
	payload, err := canonicalCertificate(c)
	if err != nil {
		return err
	}
	return verify(c.IssuerPubkey, c.Signature, payload)
}

func (v *Validator) VerifyRequestProof(proof RequestProof, expectedPubkey, method, path string) error {
	if proof.Pubkey == "" || proof.Method == "" || proof.Path == "" || proof.Nonce == "" || proof.IssuedAt == 0 {
		return ErrInvalidDocument
	}
	if expectedPubkey != "" && proof.Pubkey != expectedPubkey {
		return ErrInvalidDocument
	}
	if method != "" && proof.Method != method || path != "" && proof.Path != path {
		return ErrInvalidDocument
	}
	if err := v.validateFresh(proof.IssuedAt); err != nil {
		return err
	}
	payload, err := marshalSignedJSON(requestProofPayload{
		Pubkey: proof.Pubkey, Method: proof.Method, Path: proof.Path, IssuedAt: proof.IssuedAt, Nonce: proof.Nonce,
	})
	if err != nil {
		return ErrInvalidDocument
	}
	if err := verify(proof.Pubkey, proof.Signature, payload); err != nil {
		return err
	}
	return v.rememberNonce(proof.Pubkey + ":" + proof.Nonce)
}

func (v *Validator) VerifyCreateFabric(request CreateFabricRequest) error {
	if request.OwnerPubkey == "" || request.RequestID == "" || request.Nonce == "" || request.IssuedAt == 0 {
		return ErrInvalidDocument
	}
	if err := v.validateFresh(request.IssuedAt); err != nil {
		return err
	}
	payload, err := marshalSignedJSON(createFabricPayload{
		OwnerPubkey: request.OwnerPubkey, RequestID: request.RequestID, IssuedAt: request.IssuedAt, Nonce: request.Nonce,
	})
	if err != nil {
		return ErrInvalidDocument
	}
	if err := verify(request.OwnerPubkey, request.Signature, payload); err != nil {
		return err
	}
	return v.rememberNonce(request.OwnerPubkey + ":" + request.Nonce)
}

func (v *Validator) VerifyJoinRequest(request JoinRequest) error {
	if (request.SubjectKind != SubjectNode && request.SubjectKind != SubjectController) || request.RequestID == "" || request.FabricID == "" || request.SubjectID == "" || request.IdentityPubkey == "" || request.EncryptionPubkey == "" || !validDeliverySecretHash(request.DeliverySecretHash) || request.IssuedAt == 0 || request.ExpiresAt == 0 {
		return ErrInvalidDocument
	}
	if !v.now().Before(time.Unix(request.ExpiresAt, 0)) {
		return ErrExpired
	}
	if err := v.validateFresh(request.IssuedAt); err != nil {
		return err
	}
	payload, err := canonicalJoinRequest(request)
	if err != nil {
		return err
	}
	return verify(request.IdentityPubkey, request.Signature, payload)
}

func SignCertificate(privateKey ed25519.PrivateKey, certificate Certificate) (Certificate, error) {
	certificate.Signature = ""
	if certificate.IssuerPubkey == "" {
		certificate.IssuerPubkey = base64.StdEncoding.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	}
	payload, err := canonicalCertificate(certificate)
	if err != nil {
		return Certificate{}, err
	}
	certificate.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return certificate, nil
}

func SignRequestProof(privateKey ed25519.PrivateKey, proof RequestProof) (RequestProof, error) {
	proof.Signature = ""
	if proof.Pubkey == "" {
		proof.Pubkey = base64.StdEncoding.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	}
	payload, err := marshalSignedJSON(requestProofPayload{
		Pubkey: proof.Pubkey, Method: proof.Method, Path: proof.Path, IssuedAt: proof.IssuedAt, Nonce: proof.Nonce,
	})
	if err != nil {
		return RequestProof{}, err
	}
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return proof, nil
}

func SignCreateFabric(privateKey ed25519.PrivateKey, request CreateFabricRequest) (CreateFabricRequest, error) {
	request.Signature = ""
	if request.OwnerPubkey == "" {
		request.OwnerPubkey = base64.StdEncoding.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	}
	payload, err := marshalSignedJSON(createFabricPayload{
		OwnerPubkey: request.OwnerPubkey, RequestID: request.RequestID, IssuedAt: request.IssuedAt, Nonce: request.Nonce,
	})
	if err != nil {
		return CreateFabricRequest{}, err
	}
	request.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return request, nil
}

func SignJoinRequest(privateKey ed25519.PrivateKey, request JoinRequest) (JoinRequest, error) {
	request.Signature = ""
	if request.IdentityPubkey == "" {
		request.IdentityPubkey = base64.StdEncoding.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	}
	payload, err := canonicalJoinRequest(request)
	if err != nil {
		return JoinRequest{}, err
	}
	request.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return request, nil
}

func CertificateFingerprint(c Certificate) string {
	payload, err := canonicalCertificate(c)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(append(payload, []byte(c.Signature)...))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func HasAnyScope(scopes []Scope, expected ...Scope) bool {
	for _, scope := range scopes {
		for _, candidate := range expected {
			if scope == candidate {
				return true
			}
		}
	}
	return false
}

func canonicalCertificate(c Certificate) ([]byte, error) {
	scopes := append([]Scope(nil), c.Scopes...)
	sort.Slice(scopes, func(i, j int) bool { return scopes[i] < scopes[j] })
	return marshalSignedJSON(certificatePayload{
		Version: c.Version, FabricID: c.FabricID, SubjectKind: c.SubjectKind, SubjectID: c.SubjectID,
		IdentityPubkey: c.IdentityPubkey, EncryptionPubkey: c.EncryptionPubkey, NodeID: c.NodeID,
		Scopes: scopes, IssuedAt: c.IssuedAt, ExpiresAt: c.ExpiresAt, Nonce: c.Nonce, IssuerPubkey: c.IssuerPubkey,
	})
}

func canonicalJoinRequest(request JoinRequest) ([]byte, error) {
	capabilities := append([]string(nil), request.Capabilities...)
	sort.Strings(capabilities)
	return marshalSignedJSON(joinRequestPayload{
		RequestID: request.RequestID, FabricID: request.FabricID, SubjectKind: request.SubjectKind, SubjectID: request.SubjectID,
		IdentityPubkey: request.IdentityPubkey, EncryptionPubkey: request.EncryptionPubkey, DisplayName: request.DisplayName,
		Platform: request.Platform, Version: request.Version, Capabilities: capabilities, DeliverySecretHash: request.DeliverySecretHash, IssuedAt: request.IssuedAt, ExpiresAt: request.ExpiresAt,
	})
}

// marshalSignedJSON matches ECMAScript JSON.stringify string escaping while
// preserving the declaration order of the fixed signed-payload structs.
func marshalSignedJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	encoded := bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'})
	result := make([]byte, 0, len(encoded))
	for index := 0; index < len(encoded); {
		if encoded[index] == '\\' && index+1 < len(encoded) && encoded[index+1] == '\\' {
			result = append(result, encoded[index], encoded[index+1])
			index += 2
			continue
		}
		if index+6 <= len(encoded) && bytes.Equal(encoded[index:index+6], []byte(`\u2028`)) {
			result = append(result, []byte("\u2028")...)
			index += 6
			continue
		}
		if index+6 <= len(encoded) && bytes.Equal(encoded[index:index+6], []byte(`\u2029`)) {
			result = append(result, []byte("\u2029")...)
			index += 6
			continue
		}
		result = append(result, encoded[index])
		index++
	}
	return result, nil
}

func (v *Validator) validateFresh(issuedAt int64) error {
	issued := time.Unix(issuedAt, 0)
	now := v.now()
	if issued.Before(now.Add(-v.maxSkew)) || issued.After(now.Add(v.maxSkew)) {
		return ErrExpired
	}
	return nil
}

func (v *Validator) rememberNonce(key string) error {
	now := v.now()
	v.mu.Lock()
	defer v.mu.Unlock()
	for nonce, expiresAt := range v.nonces {
		if !now.Before(expiresAt) {
			delete(v.nonces, nonce)
		}
	}
	if _, exists := v.nonces[key]; exists {
		return ErrReplayedNonce
	}
	v.nonces[key] = now.Add(v.nonceTTL)
	return nil
}

func validatePublicKey(encoded string) error {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return ErrInvalidDocument
	}
	return nil
}

func validDeliverySecretHash(encoded string) bool {
	hash, err := base64.RawURLEncoding.DecodeString(encoded)
	return err == nil && len(hash) == sha256.Size
}

func verify(pubkey, signature string, payload []byte) error {
	if err := validatePublicKey(pubkey); err != nil {
		return err
	}
	key, _ := base64.StdEncoding.DecodeString(pubkey)
	rawSignature, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(rawSignature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(key), payload, rawSignature) {
		return ErrInvalidDocument
	}
	return nil
}
