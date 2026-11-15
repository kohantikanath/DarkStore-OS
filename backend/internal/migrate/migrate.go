// Package migrate applies the embedded SQL migrations at server startup.
// Running migrations as part of the server's own boot sequence — rather than
// as a separate deploy step — means there's no window where new code can
// start handling requests against an old schema, and it works the same way
// whether preDeployCommand is available on a given hosting plan or not.
package migrate

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
	"github.com/pressly/goose/v3"

	"github.com/kohantikanath/darkstore-os/backend/migrations"
)

// Up applies every pending migration embedded in the migrations package.
// goose's library API needs a database/sql *sql.DB (not the pgxpool.Pool the
// rest of the app uses), so this opens its own short-lived connection and
// closes it before returning — it's not meant to be called more than once
// per process.
func Up(databaseURL string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("migrate: open: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("migrate: set dialect: %w", err)
	}

	// goose logs each migration it applies (e.g. "OK 00001_init_schema.sql")
	// via the standard log package, so this shows up in Render's logs same
	// as everything else the server prints.
	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("migrate: up: %w", err)
	}

	return nil
}
