package db

import (
	"crypto/rand"
	"fmt"
)

// NewUUID generates an RFC 4122 version-4 UUID. It exists so callers that
// need an ID before a row is inserted (e.g. bulk-loading with COPY, which
// can't use RETURNING) don't have to pull in a separate UUID library.
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Errorf("db: read random bytes for uuid: %w", err))
	}

	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant

	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
