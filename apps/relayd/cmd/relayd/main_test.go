package main

import (
	"strings"
	"testing"

	"github.com/cradle/relayd/internal/config"
)

func TestResolveDevHMACSecretUsesBuiltInDefault(t *testing.T) {
	secret, resolved, err := resolveDevHMACSecret("", false)
	if err != nil {
		t.Fatalf("resolveDevHMACSecret returned error: %v", err)
	}
	if secret != config.DefaultDevHMACSecret {
		t.Fatalf("secret = %q, expected built-in dev default", secret)
	}
	if !resolved {
		t.Fatal("resolved = false, expected true for built-in dev default")
	}
}

func TestResolveDevHMACSecretPreservesExplicitSecret(t *testing.T) {
	secret, resolved, err := resolveDevHMACSecret("explicit-secret", true)
	if err != nil {
		t.Fatalf("resolveDevHMACSecret returned error: %v", err)
	}
	if secret != "explicit-secret" {
		t.Fatalf("secret = %q, expected explicit secret", secret)
	}
	if resolved {
		t.Fatal("resolved = true, expected false for explicit secret")
	}
}

func TestResolveDevHMACSecretRejectsBuiltInDefaultInProduction(t *testing.T) {
	_, _, err := resolveDevHMACSecret("", true)
	if err == nil {
		t.Fatal("err = nil, expected production secret error")
	}
	if !strings.Contains(err.Error(), "required in production") {
		t.Fatalf("err = %v, expected production secret error", err)
	}
}
