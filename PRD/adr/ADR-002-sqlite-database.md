# ADR-002: SQLite as Primary Database

## Status
Superseded by [ADR-015: JSON File Storage](./ADR-015-json-file-storage.md)

## Context
FormAgent requires persistent storage for 20 database tables spanning accounts, workspaces, forms, submissions, contacts, companies, deals, handler groups, campaigns, sequences, enrollments, experiments, drafts, spam logs, events, errors, sessions, API keys, and workspace memberships. The system is designed for rapid development and zero-infrastructure deployment (see [ADR-001](./ADR-001-modular-monolith.md)).

The database must support:
- JSON column storage (form fields, submission data, agent actions, touchpoints, experiment variants)
- Text primary keys (prefixed IDs; see [ADR-012](./ADR-012-prefixed-id-generation.md))
- Indexes on workspace_id for tenant isolation (see [ADR-005](./ADR-005-workspace-isolation.md))
- Composite unique constraints (e.g., `workspace_id + email` for contacts)
- Async access from Python (FastAPI is async-native; see [ADR-003](./ADR-003-fastapi-backend.md))

Background jobs (sequence processing every 60s, stale cleanup every 15 min, experiment stats refresh every 5 min) also access the database. These run as daemon threads within the same process (see [ADR-008](./ADR-008-daemon-thread-async.md)).

## Decision
We use **SQLite** as the sole database, accessed via **aiosqlite** (an async wrapper around Python's built-in `sqlite3` module).

The database is a single file (`formagent.db`) created at application startup. All 20 tables are initialized via `CREATE TABLE IF NOT EXISTS` statements in `backend/database.py`. Schema includes JSON columns (stored as TEXT, queried via SQLite's `json_extract()` where needed), TEXT primary keys, and composite indexes.

Key configuration:
- **WAL mode** (`PRAGMA journal_mode=WAL`) for improved read concurrency.
- **Foreign keys enabled** (`PRAGMA foreign_keys=ON`).
- **Busy timeout** set to handle brief write contention from background threads.
- All queries from authenticated endpoints include `WHERE workspace_id = ?` (enforced by middleware).

## Consequences

### Positive
- **Zero infrastructure:** No database server to install, configure, secure, back up, or monitor. The database is a file. Deployment is copying files.
- **Development speed:** No Docker Compose, no connection pooling, no ORM migration tool required. `CREATE TABLE IF NOT EXISTS` on startup handles schema creation.
- **Atomic consistency:** Single-writer semantics mean no complex locking strategies. Transactions are straightforward.
- **Portability:** The database file can be copied, emailed, or checked into version control (for test fixtures). Debugging production data requires only `sqlite3 formagent.db`.
- **JSON support:** SQLite natively stores JSON as TEXT and provides `json_extract()`, `json_each()` for queries. This supports the heavily JSON-structured data model (form fields, submission data, agent actions, experiment variants, touchpoints).
- **Performance for MVP scale:** SQLite handles thousands of reads per second and hundreds of writes per second, which exceeds expected MVP traffic.

### Negative
- **Single-writer bottleneck:** SQLite serializes write operations. Under heavy concurrent submission load, write contention becomes a bottleneck. WAL mode helps but does not eliminate the constraint.
- **No horizontal scaling:** The database file lives on one machine. There is no read replica, no sharding, no multi-region deployment option.
- **Limited concurrent access:** While aiosqlite provides async access from the event loop, the underlying SQLite library serializes writes. Background daemon threads and the main async loop contend for write access.
- **No native full-text search (without FTS extension):** Contact search, submission search, and event filtering rely on `LIKE` queries rather than proper full-text indexes.
- **Migration tooling:** No built-in migration framework. Schema changes require manual `ALTER TABLE` statements or a lightweight migration script.
- **Backup complexity at scale:** While trivial to copy the file, hot backups during writes require SQLite's backup API or WAL checkpointing.

## Alternatives Considered

1. **PostgreSQL** - Full-featured relational database with native JSON/JSONB support, concurrent writes, full-text search, and mature migration tooling (Alembic). Rejected because: (a) requires running a database server (Docker or managed service), adding infrastructure complexity; (b) connection pooling (asyncpg + connection pool) adds configuration; (c) for MVP/hackathon scope, the operational overhead is not justified; (d) PostgreSQL is the natural migration target if FormAgent outgrows SQLite.

2. **MySQL / MariaDB** - Similar to PostgreSQL in capability. Rejected for the same infrastructure reasons, plus less native JSON support compared to PostgreSQL.

3. **DuckDB** - Embedded analytical database with excellent JSON and aggregation support. Rejected because: (a) optimized for OLAP, not OLTP workloads; (b) write performance for transactional inserts (submissions, events) is not its strength; (c) less ecosystem support for async Python access.

4. **SQLite + Redis (hybrid)** - SQLite for persistence, Redis for caching and pub/sub (WebSocket event fan-out). Rejected because: (a) adds infrastructure (Redis server); (b) the modular monolith with in-process WebSocket broadcasting does not need external pub/sub; (c) introduces cache invalidation complexity.

5. **File-based storage (JSON files)** - Each entity as a JSON file on disk. Rejected because: (a) no indexing, no query capability; (b) no transactional writes; (c) scales poorly even for MVP.
