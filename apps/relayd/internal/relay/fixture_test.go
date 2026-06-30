package relay

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestEnvelopeFixtures(t *testing.T) {
	fixtures := filepath.Join("..", "..", "testdata")
	validNames := []string{
		"valid-host-envelope.json",
		"valid-controller-envelope.json",
	}
	for _, name := range validNames {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixtures, name))
			if err != nil {
				t.Fatalf("ReadFile() error = %v", err)
			}
			if _, err := ParseEnvelope(data, 4096); err != nil {
				t.Fatalf("ParseEnvelope() error = %v", err)
			}
		})
	}

	invalidNames := []string{
		"invalid-version-envelope.json",
		"missing-room-envelope.json",
	}
	for _, name := range invalidNames {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fixtures, name))
			if err != nil {
				t.Fatalf("ReadFile() error = %v", err)
			}
			_, err = ParseEnvelope(data, 4096)
			if !errors.Is(err, ErrInvalidEnvelope) {
				t.Fatalf("ParseEnvelope() error = %v, expected ErrInvalidEnvelope", err)
			}
		})
	}
}
