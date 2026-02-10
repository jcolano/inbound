# Non-Functional Requirements

> Derived from [Inbound-Product-Definition.md](../../Inbound-Product-Definition.md).
> Cross-references: [requirements.md](./requirements.md) | [edge-cases.md](./edge-cases.md) | [constraints.md](./constraints.md) | [glossary.md](./glossary.md)

---

## 1. Performance

### NFR-P1: Synchronous Submission Latency

Submission steps 1 through 8 (form lookup, CORS check, parse body, field validation, anti-spam, store, A/B tagging, and HTTP response) must complete within the HTTP request lifecycle. The submitter must receive an HTTP 200 response without waiting for agent processing.

**Metric:** Steps 1-8 complete in < 500ms under normal load (single SQLite writer, no contention).

**PRD reference:** Section 2.1 -- "Steps 1-8 execute synchronously within the HTTP request."

### NFR-P2: Asynchronous Agent Processing

Agent-guided flows (sales_lead, support_triage) spawn background threads for steps 9+ (contact matching, company matching, attribution tracking, routing, agent processing). These must not block the HTTP response.

**Metric:** Background thread launched before HTTP response is returned.

**PRD reference:** Section 2.1 -- "Steps 9+ execute asynchronously via daemon thread."

### NFR-P3: Speed-to-Lead Targets

The system tracks processing time from `created_at` to `processed_at`. The dashboard shows distribution across time buckets. Target: majority of submissions processed in under 5 minutes.

**Metric:** Dashboard renders speed-to-lead histogram with buckets: <1min, 1-5min, 5-30min, 30m-1h, 1-4h, 4-24h, >24h.

**PRD reference:** Section 4.1 -- Speed-to-Lead Distribution.

### NFR-P4: Background Job Cadence

| Job | Interval | Max Execution Time |
|-----|----------|--------------------|
| Sequence step processor | 60 seconds | Should complete before next tick |
| Stale submission cleanup | 15 minutes | < 30 seconds |
| Experiment stats refresh | 5 minutes | < 10 seconds |

**PRD reference:** Background Jobs section.

### NFR-P5: LLM Call Latency

Claude API calls for form generation, agent processing, and optimization must include timeout handling. Retries follow exponential backoff: 2s, 4s, 8s.

**Metric:** Maximum 3 retry attempts; total max wait per LLM call = 14 seconds before queuing or escalation.

**PRD reference:** Section 2.6 -- Error Recovery.

---

## 2. Security

### NFR-S1: Password Storage

All passwords must be hashed with bcrypt (with salt). Plaintext, MD5, and SHA-based password hashing are explicitly prohibited.

**Verification:** `password_hash` column values start with `$2b$` (bcrypt identifier).

**PRD reference:** Security Considerations table -- "bcrypt with salt (never plaintext, never md5/sha)."

### NFR-S2: JWT Signing

JWTs must be signed with HS256 using a server-side secret stored as an environment variable. The secret must be rotatable without downtime (support for multiple valid secrets during rotation).

**Token fields:** `sub` (account_id), `workspace_id`, `role`, `iat`, `exp`.
**Expiry:** 24 hours (configurable).

**PRD reference:** JWT Token Structure section.

### NFR-S3: API Key Storage

API keys must be hashed with SHA-256 before storage. The full key is displayed exactly once at creation time. Only the prefix (`fa_live_abc1` or `fa_test_abc1`) is stored for identification.

**Verification:** `key_hash` column contains a 64-character hex digest; `key_prefix` is the first 12 characters of the key.

**PRD reference:** Data Models: API Keys.

### NFR-S4: Workspace Data Isolation

Every authenticated database query must include `WHERE workspace_id = ?`. The `get_current_context()` middleware must run on every authenticated endpoint and inject `workspace_id` into the request context.

**Verification:** No endpoint returns data from a workspace the authenticated user does not belong to. Automated tests confirm cross-workspace queries return empty results.

**PRD reference:** Middleware: Workspace Isolation -- "The rule is absolute."

### NFR-S5: CORS Policy

- Auth endpoints: Allow from dashboard origin only.
- Public submission endpoint: Allow from form's `security.allowed_origins`. If empty, return `Access-Control-Allow-Origin: *`.
- Preflight `OPTIONS` requests handled automatically.

**PRD reference:** Section 1.6 -- CORS; Security Considerations.

### NFR-S6: Anti-Spam Pipeline

Four-layer defense, evaluated in order. First failure rejects the submission.

| Layer | Response Code | Behavior |
|-------|---------------|----------|
| Honeypot filled | 200 (silent) | Do not reveal rejection to bots |
| IP rate limit exceeded | 429 | Configurable per form |
| Email rate limit exceeded | 429 | Configurable per form |
| Duplicate submission | 422 | Same email + form within N minutes |

All rejections logged to `spam_log`.

**PRD reference:** Section 2.2 -- Anti-Spam Pipeline.

### NFR-S7: Rate Limiting -- Brute Force Login

Login attempts are rate-limited to 5 attempts per email per 15 minutes.

**PRD reference:** Security Considerations -- "Rate limit: 5 attempts per email per 15 minutes."

### NFR-S8: Invite Abuse Prevention

Only owner and admin roles can send invites. Pending invites expire after 7 days.

**PRD reference:** Security Considerations -- "Only owner/admin can invite; pending invites expire in 7 days."

### NFR-S9: Session Hijacking Mitigation

JWT tokens are tied to session records stored server-side. Sessions are revocable independently of token expiry. Session records store `ip_address` and `user_agent` for auditing.

**PRD reference:** Security Considerations -- "Token tied to session record; revocable server-side."

---

## 3. Scalability

### NFR-SC1: Single-File Database

The entire application uses a single SQLite database file (`formagent.db`), managed via aiosqlite for async access. This is a deliberate constraint for hackathon simplicity.

**Implication:** Write throughput limited to SQLite's single-writer model. Acceptable for MVP scale.

**PRD reference:** Tech Stack -- "Zero infra, single file, hackathon-appropriate."

### NFR-SC2: Daemon Threads for Async Work

Agent processing, sequence step execution, and stale cleanup run in Python daemon threads. These threads are not durable -- if the process restarts, in-flight work is lost.

**Mitigation:** Stale submission cleanup job detects and fails submissions stuck in `processing` for > 30 minutes.

**PRD reference:** Tech Stack -- "Threading (daemon threads)"; Background Jobs.

### NFR-SC3: Table Count

The schema comprises 20 tables total: 5 auth tables (accounts, workspaces, workspace_memberships, api_keys, sessions) + 15 data tables.

**PRD reference:** Module 0 -- "Total: 5 new tables"; Database Schema -- "Total: 15 tables."

### NFR-SC4: Endpoint Count

The API surface is approximately 91 endpoints: 16 auth endpoints + ~75 data/analytics endpoints.

**PRD reference:** Module 0 -- "~91 endpoints total."

### NFR-SC5: Index Coverage

Every table with `workspace_id` must have an index on `workspace_id`. Composite indexes required for frequently filtered combinations (e.g., `workspace_id + email`, `workspace_id + status`).

**PRD reference:** Impact on Existing Tables -- index definitions.

---

## 4. Reliability

### NFR-R1: Error Recovery -- LLM Timeout

LLM API timeouts trigger exponential backoff retries: 3 attempts at 2s, 4s, 8s intervals. If all fail, the submission is queued for retry in 5 minutes.

**PRD reference:** Section 2.6 -- Error Recovery table.

### NFR-R2: Error Recovery -- Unparseable LLM Response

If the LLM returns a response that cannot be parsed as JSON, the system re-prompts with stricter format instructions. If the second attempt also fails, the submission is escalated to a human handler.

**PRD reference:** Section 2.6 -- "Re-prompt with stricter format instructions."

### NFR-R3: Error Recovery -- External Action Failure

If an external action (e.g., sending email) fails, the system retries once. On second failure, the action is logged as `action_failed` and processing continues with remaining valid actions.

**PRD reference:** Section 2.6 -- "Retry once; Log failure, mark action_failed."

### NFR-R4: Error Recovery -- Disallowed Agent Actions

If the agent attempts an action not in the form's `allowed_actions` list, the action is blocked and logged as a violation. Processing continues with the remaining valid actions.

**PRD reference:** Section 2.6 -- "Block action, log violation; Continue with valid actions."

### NFR-R5: Error Recovery -- All Retries Exhausted

When all retry attempts are exhausted for any step, the submission is marked `needs_human_review` and the fallback handler is notified.

**PRD reference:** Section 2.6 -- "Mark as needs_human_review; Notify fallback handler."

### NFR-R6: Event Logging on Recovery

Every recovery step (retry, re-prompt, escalation) emits a WebSocket event and is logged in the submission's `actions` array.

**PRD reference:** Section 2.6 -- "Every recovery step emits a WebSocket event."

### NFR-R7: Stale Submission Detection

A background job running every 15 minutes detects submissions stuck in `processing` status for more than 30 minutes and marks them as failed.

**PRD reference:** Background Jobs -- "Stale submission cleanup."

### NFR-R8: Autopilot Auto-Rollback

If the optimization autopilot detects performance dropping >15% within 48 hours of a change, the system automatically rolls back the form to the previous configuration.

**PRD reference:** Section 4.3 Mode 2 -- "Auto-rollback if performance drops >15% within 48h."

---

## 5. Real-Time

### NFR-RT1: WebSocket Event Stream

The system provides a WebSocket endpoint (`/ws/events`) that streams live events to connected dashboard clients. Events cover 16 types (see [glossary.md](./glossary.md) -- Event).

**Behavior:** Events are emitted as they occur during submission processing and agent execution. Clients can filter by form, agent, or submission.

**PRD reference:** Section 4.2 -- Activity Stream.

### NFR-RT2: Event Persistence

All events emitted via WebSocket are also persisted to the `events` table for historical querying via the REST API (`GET /api/events`).

**PRD reference:** Events table schema; API Endpoints -- Events + Observability.

---

## 6. Data Integrity

### NFR-DI1: Workspace-Scoped Queries

Every query that reads or writes data must include `workspace_id` filtering. This is enforced at the middleware level, not left to individual endpoint implementations.

**PRD reference:** Middleware: Workspace Isolation.

### NFR-DI2: Workspace-Scoped Unique Constraints

Unique constraints are scoped to workspace. Examples:
- Contact email uniqueness: `UNIQUE(workspace_id, email)`
- Form slug uniqueness: `UNIQUE(workspace_id, slug)`

The same contact email can independently exist in different workspaces.

**PRD reference:** Impact on Existing Tables -- unique constraint examples.

### NFR-DI3: Workspace ID on All Tables

Every table except `accounts` (which is global) must have a `workspace_id` column. Tables that inherit workspace context via foreign key (e.g., `contact_notes` via `contact_id`, `sequence_steps` via `sequence_id`) do not need their own `workspace_id` column.

**PRD reference:** Impact on Existing Tables -- full table list.

### NFR-DI4: Append-Only Action Logs

The `actions` array on submissions and the `optimization_log` on experiments are append-only. Past entries are never modified or deleted.

**PRD reference:** Submission Data Model -- actions array; Experiment Data Model -- optimization_log.

### NFR-DI5: Enrollment History Integrity

Enrollment history records are append-only. Each step execution is logged with step number, status, and timestamp. History is never rewritten.

**PRD reference:** Section 2.9 -- Enrollment tracking history array.

### NFR-DI6: Account Email Global Uniqueness

Account emails (the `accounts` table) are globally unique across the entire system, not workspace-scoped. This is distinct from contact emails which are workspace-scoped.

**PRD reference:** Data Models: Accounts -- `email TEXT UNIQUE NOT NULL`.

### NFR-DI7: Foreign Key Enforcement

SQLite foreign keys must be enabled (`PRAGMA foreign_keys = ON`). All foreign key relationships defined in the schema must be enforced at the database level.

**Affected relationships:** forms -> workspaces, submissions -> forms, contacts -> companies, deals -> contacts, enrollments -> sequences, experiments -> forms, drafts -> submissions, and all auth table relationships.
