package pairing

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/cradle/relayd/internal/token"
)

func TestStoreStartClaimOnce(t *testing.T) {
	now := time.Unix(1780000000, 0)
	store := NewStore(StoreConfig{
		CodeTTL: time.Minute,
		Now:     func() time.Time { return now },
	})

	started, err := store.Start(t.Context(), StartInput{
		Claims: token.Claims{
			Subject: "host_1",
			RoomID:  "room_1",
		},
		HostToken: "host_token",
	})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if started.PairingCode == "" {
		t.Fatal("Start() returned empty pairing code")
	}

	compactCode := strings.ReplaceAll(started.PairingCode, "-", "")
	claimed, err := store.Claim(context.Background(), ClaimInput{
		Code:            compactCode,
		Claims:          token.Claims{Subject: "controller_1"},
		ControllerToken: "controller_token",
	})
	if err != nil {
		t.Fatalf("Claim() error = %v", err)
	}
	if claimed.RoomID != "room_1" {
		t.Fatalf("claimed.RoomID = %q, expected room_1", claimed.RoomID)
	}

	_, err = store.Claim(context.Background(), ClaimInput{
		Code:            compactCode,
		Claims:          token.Claims{Subject: "controller_1"},
		ControllerToken: "controller_token",
	})
	if !errors.Is(err, ErrAlreadyClaimed) {
		t.Fatalf("second Claim() error = %v, expected ErrAlreadyClaimed", err)
	}
}

func TestStoreExpiresPairing(t *testing.T) {
	now := time.Unix(1780000000, 0)
	store := NewStore(StoreConfig{
		CodeTTL: time.Minute,
		Now:     func() time.Time { return now },
	})

	started, err := store.Start(t.Context(), StartInput{
		Claims: token.Claims{
			Subject: "host_1",
			RoomID:  "room_1",
		},
	})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	removed := store.Expire(t.Context(), now.Add(time.Minute))
	if removed != 1 {
		t.Fatalf("Expire() = %d, expected 1", removed)
	}

	_, err = store.Claim(t.Context(), ClaimInput{Code: started.PairingCode})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Claim() error = %v, expected ErrNotFound", err)
	}
}
