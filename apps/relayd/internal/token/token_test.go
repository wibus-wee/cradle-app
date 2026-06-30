package token

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestHMACValidator(t *testing.T) {
	now := time.Unix(1780000000, 0)
	validator, err := NewHMACValidator(HMACValidatorConfig{
		Secret:   []byte("secret"),
		Issuer:   "cradle-server",
		Audience: "cradle-relay",
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewHMACValidator() error = %v", err)
	}

	raw, err := validator.Sign(Claims{
		Subject:  "host_1",
		Role:     RoleHost,
		RoomID:   "room_1",
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "tok_1",
		Nonce:    "nonce_1",
		Purpose:  PurposeWebSocket,
	})
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}

	claims, err := validator.Validate(t.Context(), raw, ExpectedClaims{
		Role:    RoleHost,
		RoomID:  "room_1",
		Purpose: PurposeWebSocket,
	})
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if claims.Subject != "host_1" {
		t.Fatalf("claims.Subject = %q, expected host_1", claims.Subject)
	}
}

func TestHMACValidatorRejectsExpiredToken(t *testing.T) {
	now := time.Unix(1780000000, 0)
	validator, err := NewHMACValidator(HMACValidatorConfig{
		Secret:   []byte("secret"),
		Issuer:   "cradle-server",
		Audience: "cradle-relay",
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewHMACValidator() error = %v", err)
	}

	raw, err := validator.Sign(Claims{
		Subject:  "host_1",
		Role:     RoleHost,
		RoomID:   "room_1",
		Expiry:   now.Add(-time.Minute).Unix(),
		IssuedAt: now.Add(-2 * time.Minute).Unix(),
		TokenID:  "tok_1",
		Nonce:    "nonce_1",
		Purpose:  PurposeWebSocket,
	})
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}

	_, err = validator.Validate(context.Background(), raw, ExpectedClaims{
		Role:    RoleHost,
		RoomID:  "room_1",
		Purpose: PurposeWebSocket,
	})
	if !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("Validate() error = %v, expected ErrExpiredToken", err)
	}
}

func TestHMACValidatorRejectsUnexpectedHeader(t *testing.T) {
	now := time.Unix(1780000000, 0)
	validator, err := NewHMACValidator(HMACValidatorConfig{
		Secret:   []byte("secret"),
		Issuer:   "cradle-server",
		Audience: "cradle-relay",
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewHMACValidator() error = %v", err)
	}
	raw, err := validator.Sign(Claims{
		Subject:  "host_1",
		Role:     RoleHost,
		RoomID:   "room_1",
		Expiry:   now.Add(time.Minute).Unix(),
		IssuedAt: now.Unix(),
		TokenID:  "tok_1",
		Nonce:    "nonce_1",
		Purpose:  PurposeWebSocket,
	})
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}

	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		t.Fatalf("token parts = %d, expected 3", len(parts))
	}
	parts[0] = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	tampered := strings.Join(parts, ".")
	_, err = validator.Validate(t.Context(), tampered, ExpectedClaims{
		Role:    RoleHost,
		RoomID:  "room_1",
		Purpose: PurposeWebSocket,
	})
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Validate() error = %v, expected ErrInvalidToken", err)
	}
}
