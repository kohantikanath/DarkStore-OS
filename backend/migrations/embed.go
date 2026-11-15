// Package migrations embeds the SQL migration files into the server binary,
// so the deployed server can apply them at startup without needing the goose
// CLI or the source tree present at runtime — just this compiled binary.
//
// go:embed can only reach files in or below its own source file's directory,
// which is why this file lives in migrations/ itself rather than in
// internal/migrate (the package that actually runs them). The goose CLI
// (used for local dev) ignores this .go file and only looks at the *.sql
// files, so both ways of running migrations keep working off one folder.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
