package pairing

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/cradle/relayd/internal/token"
)

var (
	ErrNotFound       = errors.New("pairing: not found")
	ErrExpired        = errors.New("pairing: expired")
	ErrAlreadyClaimed = errors.New("pairing: already claimed")
	ErrRoomRequired   = errors.New("pairing: room id is required")
)

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type StoreConfig struct {
	CodeTTL time.Duration
	Now     func() time.Time
}

type Store struct {
	mu      sync.Mutex
	codeTTL time.Duration
	now     func() time.Time
	hashKey []byte
	byRoom  map[string]*record
}

type StartInput struct {
	Claims    token.Claims
	RoomID    string
	HostToken string
}

type ClaimInput struct {
	Code            string
	Claims          token.Claims
	ControllerToken string
}

type Record struct {
	RoomID          string
	PairingCode     string
	HostToken       string
	ControllerToken string
	Subject         string
	ExpiresAt       time.Time
	ClaimedAt       time.Time
}

type record struct {
	roomID          string
	codeHash        [32]byte
	codeSalt        []byte
	hostToken       string
	controllerToken string
	subject         string
	expiresAt       time.Time
	claimedAt       time.Time
}

func NewStore(cfg StoreConfig) *Store {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	codeTTL := cfg.CodeTTL
	if codeTTL <= 0 {
		codeTTL = 5 * time.Minute
	}
	hashKey, err := randomBytes(32)
	if err != nil {
		// crypto/rand failure is unrecoverable for a store whose security relies on it.
		panic(fmt.Sprintf("pairing: generating store hash key: %v", err))
	}
	return &Store{
		codeTTL: codeTTL,
		now:     now,
		hashKey: hashKey,
		byRoom:  map[string]*record{},
	}
}

func (s *Store) Start(_ context.Context, input StartInput) (Record, error) {
	roomID := strings.TrimSpace(input.RoomID)
	if roomID == "" {
		roomID = strings.TrimSpace(input.Claims.RoomID)
	}
	if roomID == "" {
		return Record{}, ErrRoomRequired
	}
	code, err := generateCode()
	if err != nil {
		return Record{}, fmt.Errorf("generating pairing code: %w", err)
	}
	salt, err := randomBytes(16)
	if err != nil {
		return Record{}, fmt.Errorf("generating pairing salt: %w", err)
	}
	rec := &record{
		roomID:    roomID,
		codeHash:  s.hashCode(salt, code),
		codeSalt:  salt,
		hostToken: input.HostToken,
		subject:   input.Claims.Subject,
		expiresAt: s.now().Add(s.codeTTL),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireLocked(s.now())
	s.byRoom[roomID] = rec

	return rec.toRecord(code), nil
}

func (s *Store) FindPending(_ context.Context, code string) (Record, error) {
	normalized := normalizeCode(code)
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireLocked(now)
	for _, rec := range s.byRoom {
		if rec.claimedAt.IsZero() && s.matches(rec, normalized) {
			if !now.Before(rec.expiresAt) {
				return Record{}, ErrExpired
			}
			return rec.toRecord(""), nil
		}
	}
	return Record{}, ErrNotFound
}

func (s *Store) Claim(_ context.Context, input ClaimInput) (Record, error) {
	normalized := normalizeCode(input.Code)
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.expireLocked(now)
	for _, rec := range s.byRoom {
		if !s.matches(rec, normalized) {
			continue
		}
		if !now.Before(rec.expiresAt) {
			return Record{}, ErrExpired
		}
		if !rec.claimedAt.IsZero() {
			return Record{}, ErrAlreadyClaimed
		}
		rec.claimedAt = now
		rec.controllerToken = input.ControllerToken
		return rec.toRecord(""), nil
	}
	return Record{}, ErrNotFound
}

func (s *Store) Expire(_ context.Context, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.expireLocked(now)
}

func (s *Store) expireLocked(now time.Time) int {
	var removed int
	for roomID, rec := range s.byRoom {
		if now.After(rec.expiresAt) || now.Equal(rec.expiresAt) {
			delete(s.byRoom, roomID)
			removed++
		}
	}
	return removed
}

func (s *Store) matches(rec *record, normalizedCode string) bool {
	hash := s.hashCode(rec.codeSalt, normalizedCode)
	return subtle.ConstantTimeCompare(hash[:], rec.codeHash[:]) == 1
}

func (r *record) toRecord(code string) Record {
	return Record{
		RoomID:          r.roomID,
		PairingCode:     code,
		HostToken:       r.hostToken,
		ControllerToken: r.controllerToken,
		Subject:         r.subject,
		ExpiresAt:       r.expiresAt,
		ClaimedAt:       r.claimedAt,
	}
}

func generateCode() (string, error) {
	raw, err := randomBytes(8)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.Grow(9)
	for i, value := range raw {
		if i == 4 {
			b.WriteByte('-')
		}
		b.WriteByte(codeAlphabet[int(value)&31])
	}
	return b.String(), nil
}

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("reading random bytes: %w", err)
	}
	return b, nil
}

func normalizeCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, "-", "")
	code = strings.ReplaceAll(code, " ", "")
	return code
}

func (s *Store) hashCode(salt []byte, code string) [32]byte {
	return hashCode(s.hashKey, salt, code)
}

func hashCode(key []byte, salt []byte, code string) [32]byte {
	h := sha256.New()
	h.Write(key)
	h.Write(salt)
	h.Write([]byte(normalizeCode(code)))
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}
