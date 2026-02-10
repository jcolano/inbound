# ADR-015: JSON File Storage Instead of Database

## Status
Accepted

## Context
[ADR-002](./ADR-002-sqlite-database.md) chose SQLite as the primary database. Before implementation begins, we are revising this decision for the MVP. The goal is to eliminate all database dependencies — including SQLite — and use the simplest possible persistence mechanism: JSON files on disk.

The system has 20 entity types. Each needs to be stored, queried by ID, listed, filtered by `workspace_id`, and occasionally queried by secondary keys (e.g., contacts by email, forms by slug). For MVP, the data volumes are small (hundreds to low thousands of records per entity type).

## Decision
We use **JSON files as tables**. Each entity type is stored as a single JSON file inside a `data/` directory at the project root.

### Storage Layout

```
data/
├── accounts.json
├── workspaces.json
├── workspace_memberships.json
├── api_keys.json
├── sessions.json
├── forms.json
├── submissions.json
├── contacts.json
├── contact_notes.json
├── companies.json
├── deals.json
├── handler_groups.json
├── campaigns.json
├── sequences.json
├── sequence_steps.json
├── enrollments.json
├── experiments.json
├── drafts.json
├── spam_log.json
├── events.json
└── errors.json
```

### File Format

Each JSON file contains an array of objects. Each object is one record:

```json
[
  {
    "id": "form_abc12345",
    "workspace_id": "ws_xyz98765",
    "name": "Enterprise Demo Request",
    "slug": "enterprise-demo",
    "...": "..."
  },
  {
    "id": "form_def67890",
    "workspace_id": "ws_xyz98765",
    "...": "..."
  }
]
```

### Data Access Layer

A thin `JsonStore` class wraps all file I/O:

- **`load(entity)`** -- Reads and parses `data/{entity}.json`. Returns `[]` if file does not exist.
- **`save(entity, records)`** -- Writes the full array to `data/{entity}.json` atomically (write to temp file, then rename).
- **`get(entity, id)`** -- Load + filter by `id`.
- **`find(entity, filters)`** -- Load + filter by arbitrary key-value pairs (e.g., `{"workspace_id": "ws_xxx", "email": "jane@acme.com"}`).
- **`insert(entity, record)`** -- Load, append, save.
- **`update(entity, id, changes)`** -- Load, find by id, merge changes, save.
- **`delete(entity, id)`** -- Load, remove by id, save.

All operations read the full file, operate in memory, and write the full file back. This is acceptable at MVP scale.

### Workspace Isolation

The same rule from [ADR-005](./ADR-005-workspace-isolation.md) applies: every query includes a `workspace_id` filter. The `JsonStore.find()` method always receives `workspace_id` from the auth context middleware. No data leaks between workspaces.

### Atomic Writes

To prevent data corruption on crash:
1. Write to `data/{entity}.json.tmp`
2. `os.replace("data/{entity}.json.tmp", "data/{entity}.json")` (atomic on all major OSes)

### Initialization

On startup, the application ensures `data/` exists. Missing JSON files are created as empty arrays `[]` on first access.

## Consequences

### Positive
- **Zero dependencies:** No database library, no driver, no aiosqlite, no connection management. Just `json.load()` and `json.dump()`.
- **Human-readable storage:** Every record is visible in a text editor. Debugging is trivial — open the file, search for the ID.
- **Instant setup:** Clone the repo, run the app. No database initialization, no schema creation, no migrations.
- **Easy seeding:** Seed data is just copying JSON files into `data/`.
- **Version-controllable:** Test fixtures can be committed as JSON files.
- **Hackathon speed:** No time spent on database abstractions. Persistence layer implemented in under 100 lines.

### Negative
- **No indexing:** Every query scans the full array. O(n) for all lookups. Acceptable for MVP volumes (< 10K records per entity), but will not scale.
- **No concurrent writes:** Read-modify-write cycle is not thread-safe without locking. Requires a file lock or single-writer pattern for background threads.
- **No transactions:** Multi-entity operations (e.g., create contact + create submission + update form) are not atomic across files.
- **No query language:** Filtering is manual Python code. Complex queries (joins, aggregations for analytics) require loading multiple files and processing in memory.
- **Memory usage:** Entire table loaded into memory on every operation. Large event logs or submission histories will consume memory.
- **No foreign key enforcement:** Referential integrity is application-level only.
- **Must be replaced:** This approach has a hard ceiling. Migration to SQLite or PostgreSQL is inevitable for production use.

### Mitigations
- **Thread safety:** Use `threading.Lock()` per entity file to serialize writes from background threads.
- **Analytics queries:** Pre-compute and cache common aggregations (KPIs, funnel stats) rather than scanning on every request.
- **Migration path:** The `JsonStore` interface is simple enough that swapping to SQLite/PostgreSQL later requires only reimplementing the data access layer. No application logic changes needed.

## Alternatives Considered

1. **SQLite (original ADR-002)** -- Provides indexing, transactions, and SQL queries. Rejected for MVP because even SQLite adds a dependency (aiosqlite), schema management, and abstraction overhead. The JSON approach is faster to implement and easier to debug. SQLite remains the recommended upgrade path.

2. **TinyDB** -- A Python document database backed by JSON files. Provides query syntax and indexing. Rejected because: (a) adds a dependency; (b) the custom `JsonStore` is simpler and gives full control; (c) TinyDB's query API is not significantly better than manual filtering for our use case.

3. **SQLite with raw SQL (no aiosqlite)** -- Synchronous SQLite access without the async wrapper. Still requires schema setup and SQL query construction. Rejected in favor of the even simpler JSON approach for MVP.

## Supersedes
This ADR supersedes [ADR-002: SQLite as Primary Database](./ADR-002-sqlite-database.md).
