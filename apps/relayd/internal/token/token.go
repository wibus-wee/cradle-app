package token

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	RoleHost       Role = "host"
	RoleController Role = "controller"

	PurposePairingStart Purpose = "pairing_start"
	PurposePairingClaim Purpose = "pairing_claim"
	PurposeRoomStart    Purpose = "room_start"
	PurposeWebSocket    Purpose = "ws"
)

var (
	ErrInvalidToken = errors.New("token: invalid token")
	ErrExpiredToken = errors.New("token: expired token")
)

type Role string

type Purpose string

type Claims struct {
	Issuer   string  `json:"iss"`
	Audience string  `json:"aud"`
	Subject  string  `json:"sub"`
	Role     Role    `json:"role,omitempty"`
	RoomID   string  `json:"roomId,omitempty"`
	Expiry   int64   `json:"exp"`
	IssuedAt int64   `json:"iat"`
	TokenID  string  `json:"jti"`
	Nonce    string  `json:"nonce"`
	Purpose  Purpose `json:"purpose,omitempty"`
}

type tokenHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
}

type ExpectedClaims struct {
	Audience string
	Role     Role
	RoomID   string
	Purpose  Purpose
}

type Validator interface {
	Validate(ctx context.Context, raw string, expected ExpectedClaims) (Claims, error)
}

type HMACValidatorConfig struct {
	Secret   []byte
	Issuer   string
	Audience string
	Now      func() time.Time
}

type HMACValidator struct {
	secret   []byte
	issuer   string
	audience string
	now      func() time.Time
}

func NewHMACValidator(cfg HMACValidatorConfig) (*HMACValidator, error) {
	if len(cfg.Secret) == 0 {
		return nil, errors.New("token: HMAC secret is required")
	}
	if cfg.Issuer == "" {
		return nil, errors.New("token: issuer is required")
	}
	if cfg.Audience == "" {
		return nil, errors.New("token: audience is required")
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &HMACValidator{
		secret:   bytes.Clone(cfg.Secret),
		issuer:   cfg.Issuer,
		audience: cfg.Audience,
		now:      now,
	}, nil
}

func (v *HMACValidator) Validate(_ context.Context, raw string, expected ExpectedClaims) (Claims, error) {
	claims, err := v.parse(raw)
	if err != nil {
		return Claims{}, err
	}
	if claims.Issuer != v.issuer {
		return Claims{}, ErrInvalidToken
	}
	audience := v.audience
	if expected.Audience != "" {
		audience = expected.Audience
	}
	if claims.Audience != audience {
		return Claims{}, ErrInvalidToken
	}
	if expected.Role != "" && claims.Role != expected.Role {
		return Claims{}, ErrInvalidToken
	}
	if expected.RoomID != "" && claims.RoomID != expected.RoomID {
		return Claims{}, ErrInvalidToken
	}
	if expected.Purpose != "" && claims.Purpose != expected.Purpose {
		return Claims{}, ErrInvalidToken
	}
	if claims.Expiry <= v.now().Unix() {
		return Claims{}, ErrExpiredToken
	}
	return claims, nil
}

func (v *HMACValidator) Sign(claims Claims) (string, error) {
	if claims.Issuer == "" {
		claims.Issuer = v.issuer
	}
	if claims.Audience == "" {
		claims.Audience = v.audience
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshaling claims: %w", err)
	}
	header := []byte(`{"alg":"HS256","typ":"JWT"}`)
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := encodedHeader + "." + encodedPayload
	signature := v.sign(signingInput)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (v *HMACValidator) parse(raw string) (Claims, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return Claims{}, ErrInvalidToken
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	expected := v.sign(signingInput)
	got, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	if subtle.ConstantTimeCompare(got, expected) != 1 {
		return Claims{}, ErrInvalidToken
	}
	headerPayload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var header tokenHeader
	if err := json.Unmarshal(headerPayload, &header); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if header.Algorithm != "HS256" || header.Type != "JWT" {
		return Claims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if claims.Subject == "" || claims.Expiry == 0 || claims.IssuedAt == 0 || claims.TokenID == "" {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

func (v *HMACValidator) sign(input string) []byte {
	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(input))
	return mac.Sum(nil)
}

func BearerToken(value string) (string, bool) {
	prefix := "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(value, prefix))
	if token == "" {
		return "", false
	}
	return token, true
}
