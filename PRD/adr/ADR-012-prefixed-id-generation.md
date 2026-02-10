# ADR-012: Prefixed ID Generation

## Status
Accepted

## Context
FormAgent has 20 database tables (see [ADR-002](./ADR-002-sqlite-database.md)) with text primary keys stored in SQLite. IDs appear in:
- API responses (JSON payloads returned to dashboard and API consumers)
- URL paths (`/api/forms/{id}`, `/api/submissions/{id}`)
- Database foreign keys (submissions reference forms, contacts reference companies)
- Log entries and event streams (see [ADR-014](./ADR-014-websocket-observability.md))
- WebSocket event payloads
- Embed script hidden fields (`_experiment_id`, `_variant_id`)
- Debug output and error messages

When debugging a production issue, seeing an ID like `form_8a3f2b` immediately tells you the entity type. Seeing `8a3f2b91-4c7e-4d2a-b8f1-3e9a2c1d5f7e` does not.

## Decision
We generate all entity IDs using a **prefixed format**: `{entity_prefix}_{random_suffix}`.

### ID Prefix Table

| Entity | Prefix | Example |
|--------|--------|---------|
| Account | `acct_` | `acct_7kf2m9x` |
| Workspace | `ws_` | `ws_3np8q1r` |
| Workspace Membership | `wm_` | `wm_5ht6v2w` |
| API Key | `key_` | `key_9bj4c8y` |
| Session | `sess_` | `sess_1mw7d5z` |
| Form | `form_` | `form_8a3f2b` |
| Submission | `sub_` | `sub_k4m7n2` |
| Contact | `contact_` | `contact_p9q3r8` |
| Contact Note | `note_` | `note_2xc5v7` |
| Company | `company_` | `company_t6u1w4` |
| Deal | `deal_` | `deal_h3j9k6` |
| Handler Group | `group_` | `group_f2g5m8` |
| Campaign | `camp_` | `camp_b7d1n4` |
| Sequence | `seq_` | `seq_y8z3a6` |
| Sequence Step | `step_` | `step_e4f7h2` |
| Enrollment | `enroll_` | `enroll_s1t5u9` |
| Experiment | `exp_` | `exp_c6d8g3` |
| Draft | `draft_` | `draft_j2k4m7` |
| Spam Log | `spam_` | `spam_n5p8r1` |
| Event | `evt_` | `evt_w3x6z9` |
| Error | `err_` | `err_a1b4c7` |

### Implementation

ID generation is centralized in `backend/id_gen.py`:

```python
import secrets
import string

_ALPHABET = string.ascii_lowercase + string.digits
_SUFFIX_LENGTH = 8

def generate_id(prefix: str) -> str:
    suffix = ''.join(secrets.choice(_ALPHABET) for _ in range(_SUFFIX_LENGTH))
    return f"{prefix}_{suffix}"

# Convenience functions
def form_id() -> str: return generate_id("form")
def submission_id() -> str: return generate_id("sub")
def contact_id() -> str: return generate_id("contact")
# ... etc
```

The suffix uses `secrets.choice()` (cryptographically secure) over a 36-character alphabet (a-z, 0-9), producing 8-character suffixes. This yields 36^8 = ~2.8 trillion possible values per prefix, making collisions negligible at MVP scale.

### Database Storage

IDs are stored as `TEXT PRIMARY KEY` in SQLite:

```sql
CREATE TABLE forms (
    id TEXT PRIMARY KEY,
    ...
);
```

Foreign keys reference these text IDs:

```sql
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    contact_id TEXT,
    ...
);
```

## Consequences

### Positive
- **Human-readable:** Seeing `form_8a3f2b` in a log, error message, or URL immediately communicates the entity type without context. This dramatically speeds up debugging.
- **Self-documenting APIs:** API responses contain IDs that indicate their type. A client seeing `"contact_id": "contact_p9q3r8"` knows it refers to a contact without consulting documentation.
- **Cross-reference in logs:** Event streams and error logs reference multiple entity types. Prefixed IDs make it trivial to scan for "all events related to forms" or "all errors for this submission."
- **Copy-paste safety:** If someone pastes an ID into the wrong field, the prefix mismatch makes the error obvious. Putting `sub_k4m7n2` into a `form_id` field is visually wrong.
- **URL readability:** `/api/forms/form_8a3f2b` is more informative than `/api/forms/8a3f2b91-4c7e-4d2a-b8f1-3e9a2c1d5f7e`.
- **Collision resistance is sufficient:** At 36^8 possibilities per prefix (~2.8 trillion), and with each prefix being a separate namespace, collision probability is negligible for any reasonable deployment.

### Negative
- **Storage overhead vs integers:** Text IDs (`form_8a3f2b`, 13 bytes) consume more storage than auto-increment integers (4-8 bytes) and more than compact UUIDs (16 bytes binary). For 20 tables with foreign keys, this adds up. However, SQLite's dynamic typing and B-tree storage make this overhead modest.
- **Index performance:** B-tree indexes on variable-length text are slower than on fixed-size integers. For the query patterns in FormAgent (filtered by `workspace_id` first, then by ID), this is not a bottleneck.
- **No inherent ordering:** Unlike auto-increment IDs, prefixed random IDs do not indicate creation order. Sorting by ID does not sort by time. This is mitigated by `created_at` timestamps on every table.
- **Prefix consistency burden:** Every table must use the correct prefix. A developer using `generate_id("form")` for a contact is a silent bug. The convenience functions mitigate this but do not prevent it.
- **Not URL-safe by default:** The current alphabet (a-z, 0-9 plus underscore separator) is URL-safe. However, if the alphabet or separator changes, URL encoding issues could arise.

## Alternatives Considered

1. **UUIDs (v4)** - Standard 128-bit random identifiers (e.g., `8a3f2b91-4c7e-4d2a-b8f1-3e9a2c1d5f7e`). Rejected because: (a) not human-readable -- no indication of entity type; (b) 36 characters is long for URLs, logs, and UI display; (c) UUID v4 has no meaningful prefix for entity identification.

2. **Auto-increment integers** - Simple `INTEGER PRIMARY KEY AUTOINCREMENT` in SQLite. Rejected because: (a) sequential IDs leak information (total count, creation rate); (b) no entity type information; (c) IDs collide across tables (form 1, submission 1, contact 1 are all "1"); (d) merging or migrating data between databases causes ID conflicts.

3. **ULID (Universally Unique Lexicographically Sortable Identifier)** - 128-bit IDs with a timestamp prefix that sorts chronologically. Considered because sorting by ID would equal sorting by time. Rejected because: (a) still not human-readable for entity type; (b) the timestamp prefix adds complexity; (c) `created_at` timestamps serve the ordering need.

4. **Snowflake IDs (Twitter-style)** - 64-bit IDs with timestamp, machine ID, and sequence components. Rejected because: (a) designed for distributed systems with multiple ID generators; (b) FormAgent is a single-process monolith (see [ADR-001](./ADR-001-modular-monolith.md)); (c) no entity type information.

5. **Prefixed UUIDs** - `form_8a3f2b91-4c7e-4d2a-b8f1-3e9a2c1d5f7e` (prefix + full UUID). Rejected because: (a) excessively long (40+ characters); (b) the collision resistance of a full UUID is unnecessary at MVP scale; (c) shorter suffixes are more practical for logs and URLs.
