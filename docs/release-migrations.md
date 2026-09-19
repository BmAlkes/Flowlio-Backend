# Release migrations

Run commands from the backend root with CONNECTION_URL set for the intended database.

- npm run dbgenerate generates reviewed SQL in drizzle/releases. Commit its SQL, journal and snapshots together. Generation does not run during build.
- npm run build compiles the application without connecting to the database.
- npm run dbmigrate applies pending releases independently of the HTTP server; it needs only CONNECTION_URL and exits nonzero on failure.
- npm start also awaits the same runner before opening HTTP or starting jobs. Railway's existing build/start commands therefore remain valid. An optional pre-deploy dbmigrate uses the same history and does not apply migrations twice.

The deployment artifact must include drizzle/releases alongside dist. Do not use dbpush or the archived root drizzle history to apply production changes.

## Adoption and history

0000_baseline creates the current 61-table schema on an empty database. On an existing database it adds missing tables, columns, constraints and indexes, preserving existing rows, column definitions and extra objects. It recognizes legacy composite primary-key names. The known global invoice-number constraint is replaced by the organization-scoped constraint. Legacy lead/client classification runs only when the type column is absent.

0001_required_guards preserves invoice counters, time billing protection and the active timer guard introduced in T06–T08. Historical timer overlaps are preserved. The previous root SQL/history remains available for audit and older regression tests, but is no longer executed at startup.

flowlio_releases.migrations records each applied file and its SHA-256 hash. All pending releases and their history entries commit in one transaction, protected by a shared PostgreSQL advisory lock. The runner rejects changed/omitted applied files and verifies required triggers even when no migration is pending. SQL errors roll back the transaction and prevent the new server from listening.

Do not edit an applied migration or delete its history. Add a new migration for subsequent changes; custom SQL must also have a journal entry. This runner requires transactional SQL (no CREATE INDEX CONCURRENTLY). Keep changes compatible with the previous application during rolling deployment. A code rollback must preserve counters and guards.

Existing incompatible data or constraints require an explicit corrective migration; adoption does not erase data to force success. Before applying to another installation, validate against a restored backup of that installation. Local fixtures cover empty, legacy and current schemas, not every possible manually modified database.

## Tests

Build first, then run npm test. To include the release integration tests, set RELEASE_TEST_DATABASE_URL to a disposable PostgreSQL database named flowlio_migration_test at localhost:55439. These tests reset that dedicated database; other hosts, ports and database names are rejected. Temporary migration copies are created in the operating system temp directory and removed afterwards.
