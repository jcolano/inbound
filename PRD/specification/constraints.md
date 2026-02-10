# Technical and Business Constraints

> Derived from [Inbound-Product-Definition.md](../../Inbound-Product-Definition.md).
> Cross-references: [requirements.md](./requirements.md) | [non-functional.md](./non-functional.md) | [edge-cases.md](./edge-cases.md) | [glossary.md](./glossary.md)

---

## 1. Tech Stack Constraints

These technology choices are locked for the MVP. They are not negotiable within the current scope.

### TC-1: Backend -- Python 3.11+ / FastAPI

| Aspect | Constraint |
|--------|-----------|
| Language | Python 3.11 or later |
| Framework | FastAPI (async-native) |
| Rationale | Fast to build, async-native, strong typing with Pydantic |
| Implication | All backend code must be async-compatible; blocking I/O must use `run_in_executor` or equivalent |

**PRD reference:** Tech Stack table.

### TC-2: Database -- SQLite via aiosqlite

| Aspect | Constraint |
|--------|-----------|
| Engine | SQLite |
| Access layer | aiosqlite (async wrapper) |
| File | Single file: `formagent.db` (auto-created) |
| Rationale | Zero infrastructure, single file, hackathon-appropriate |

**Implications:**
- Single-writer model: only one write transaction at a time.
- No concurrent write scaling. Acceptable for MVP traffic levels.
- No stored procedures, no triggers (unless explicitly added).
- JSON columns used for flexible data (fields, meta, actions, etc.).
- Foreign key enforcement requires `PRAGMA foreign_keys = ON` at connection time.
- 20 tables total (5 auth + 15 data).

**PRD reference:** Tech Stack table; Database Schema.

### TC-3: LLM -- Claude API (Anthropic SDK)

| Aspect | Constraint |
|--------|-----------|
| Provider | Anthropic |
| SDK | Official Anthropic Python SDK |
| Uses | Form generation, agent processing, A/B optimization, suggestion engine |

**Implications:**
- All LLM calls are external API calls with associated latency and failure modes.
- Retry logic required (see [non-functional.md](./non-functional.md) -- NFR-R1).
- API key must be stored as an environment variable, never committed to code.
- Token costs are a runtime expense; no built-in cost tracking in MVP.
- Rate limits from Anthropic API apply; no queue management in MVP.

**PRD reference:** Tech Stack table; LLM prompt structure sections.

### TC-4: Real-Time -- WebSocket (FastAPI native)

| Aspect | Constraint |
|--------|-----------|
| Protocol | WebSocket |
| Library | FastAPI native WebSocket support |
| Endpoint | `/ws/events` |

**Implications:**
- Dashboard clients maintain persistent connections.
- Events are pushed as they occur; no polling.
- No message broker (Redis Pub/Sub, etc.) -- direct in-process event dispatch.
- If the server restarts, all WebSocket connections drop and must reconnect.

**PRD reference:** Tech Stack table; Section 4.2 Activity Stream.

### TC-5: Frontend -- Vanilla JS + CSS

| Aspect | Constraint |
|--------|-----------|
| Framework | None (Vanilla JavaScript) |
| Styling | Plain CSS |
| Rationale | No framework overhead |

**Implications:**
- No React, Vue, Angular, or any other framework.
- SPA routing handled manually (`app.js`).
- No build step, bundler, or transpiler.
- Embed script (`embed.js`) must also be framework-free and dependency-free.
- Frontend file count: ~16 JS files + 1 CSS file + 1 HTML shell.

**PRD reference:** Tech Stack table; Project Structure.

### TC-6: Email -- SMTP (or mock)

| Aspect | Constraint |
|--------|-----------|
| Protocol | SMTP |
| Hackathon mode | Mock/log-only acceptable |

**Implications:**
- Email sending is a best-effort action.
- No deliverability guarantees (no DKIM, SPF, DMARC in MVP).
- No email open/click tracking (explicitly out of scope).
- Sequence emails and agent-sent emails both use the same SMTP transport.

**PRD reference:** Tech Stack table; Scope Contract -- "Email open/click tracking (requires delivery service)."

### TC-7: Background Processing -- Daemon Threads

| Aspect | Constraint |
|--------|-----------|
| Mechanism | Python daemon threads |
| Uses | Async agent processing, sequence step execution, stale cleanup |

**Implications:**
- Threads are not durable. If the process dies, in-flight work is lost.
- No task queue (Celery, RQ, etc.) in MVP.
- Thread safety must be considered for shared resources (SQLite writes are serialized by aiosqlite).
- Three background jobs with fixed intervals: 60s, 5min, 15min.

**PRD reference:** Tech Stack table; Background Jobs section.

---

## 2. Architecture Constraints

### AC-1: Single-File Database

The entire data store is a single SQLite file. No separate databases for auth, analytics, or any other concern. All 20 tables coexist in one file.

**Implication:** Backup = copy one file. Migration = alter one schema. But write throughput is limited.

### AC-2: Module 0 Must Be Built First

Auth and multi-tenancy (Module 0) must be fully implemented before any work on Modules 1-4 begins. The implementation order is strictly sequential:

```
Step 1: Auth database tables
Step 2: Auth service (password hashing, JWT)
Step 3: Auth middleware (get_current_context)
Step 4: Auth endpoints (signup, login, logout)
Step 5: Add workspace_id to ALL data tables
Step 6: Apply auth middleware to ALL endpoints
Step 7: Workspace management endpoints
Step 8: API key endpoints
Step 9: Begin Module 1 (Forms)
```

**Rationale:** Every line of code written without workspace isolation becomes technical debt. The middleware pattern ensures all subsequent modules inherit isolation automatically.

**PRD reference:** Module 0 -- Implementation Order; "Multi-tenancy is not a feature -- it's architecture."

### AC-3: workspace_id on Every Query

This is both a constraint and a requirement. No database query that reads or modifies workspace-scoped data may omit the `workspace_id` filter. This is enforced by the middleware injecting `AuthContext` into every endpoint.

**Exception:** Global tables (`accounts`) and public lookups (form by ID for submission/schema endpoints).

### AC-4: Monolithic Deployment

The application is a single FastAPI process serving:
- REST API endpoints
- WebSocket connections
- Static frontend files
- Background job threads

No microservices, no separate worker processes, no message queues.

---

## 3. Business Constraints

### BC-1: No Billing or Monetization

There is no payment processing, subscription management, usage metering, or pricing tier logic. All features are available to all users without limits (aside from technical limits like rate limiting).

**PRD reference:** Scope Contract -- "Billing / monetization layer" is explicitly out of scope.

### BC-2: No Mobile-Native Form Rendering

The embed script renders HTML forms for web browsers. There are no native iOS or Android SDKs, no React Native components, and no mobile-optimized rendering beyond standard responsive CSS.

**PRD reference:** Scope Contract -- "Mobile-native form rendering" is explicitly out of scope.

### BC-3: No Third-Party CRM Integrations

The system does not integrate with Salesforce, HubSpot, Pipedrive, or any external CRM. Contact, company, and deal data lives exclusively within FormAgent's own database.

**PRD reference:** Scope Contract -- "Third-party CRM integrations (Salesforce, HubSpot)" is explicitly out of scope.

### BC-4: No Email Open/Click Tracking

The system can send emails but cannot track whether recipients open them or click links within them. This would require an email delivery service with tracking pixels and link wrapping (e.g., Resend, Postmark, SendGrid).

**PRD reference:** Scope Contract -- "Email open/click tracking (requires delivery service)" is explicitly out of scope.

### BC-5: Manual-Only Ad Spend Import

The system does not pull ad spend data from Google Ads, Facebook Ads, or any advertising platform via API. ROI calculations requiring ad spend must be based on manually entered data.

**PRD reference:** Scope Contract -- "Ad spend import (manual only, no API pulls)" is explicitly out of scope.

### BC-6: No Webhook or Integration Outbound

The system does not push events to external services (Slack, Zapier, custom webhooks). All processing is internal. External visibility is limited to the dashboard and emails.

**PRD reference:** Open Questions -- "Webhook integrations" listed as post-MVP consideration.

---

## 4. Data Constraints

### DC-1: JSON Column Usage

Multiple columns use SQLite's JSON type for flexible schemas:

| Table | JSON Columns |
|-------|-------------|
| forms | fields, field_mapping, auto_config, agent_config, security_config, response_config |
| submissions | data, meta, field_interactions, actions, created_entities |
| contacts | tags, custom_fields, touchpoints |
| handler_groups | members, settings, assignment_count |
| campaigns | inbound_form_ids, contact_tags |
| sequences | stop_conditions |
| enrollments | history |
| experiments | variants, optimization_log |
| drafts | planned_actions, draft_content |
| api_keys | permissions |
| workspaces | settings |

**Implication:** These columns cannot be efficiently indexed or queried by their internal structure using standard SQL. Filtering within JSON must happen in application code or use SQLite's `json_extract()` function (slower than indexed column lookups).

### DC-2: Text-Based IDs

All primary keys use text-based prefixed IDs (e.g., `form_xxx`, `sub_xxx`, `acct_xxx`). These are generated by the application, not auto-incremented by the database.

**Implication:** ID generation logic must guarantee uniqueness. Collisions would cause insert failures.

### DC-3: ISO Timestamp Strings

All timestamps are stored as ISO 8601 text strings, not SQLite's native datetime. Example: `"2026-02-10T14:00:00Z"`.

**Implication:** Date comparisons and sorting work correctly with string comparison (ISO 8601 is lexicographically sortable). But timezone handling is the application's responsibility.

---

## 5. Operational Constraints

### OC-1: No Monitoring Infrastructure

There is no APM (Application Performance Monitoring), log aggregation, or alerting system. Observability is limited to:
- The agent observability dashboard (in-app).
- The `events` table and `errors` table.
- Server console logs.

### OC-2: No Automated Testing Infrastructure

The PRD does not specify a testing framework or CI/CD pipeline. Testing strategy is left to the implementation phase.

### OC-3: No Database Migration System

Schema changes require manual SQL execution. There is no Alembic, Flyway, or equivalent migration tool specified. The database is created from the full schema on first run.

### OC-4: Single Process, Single Machine

The application runs as one process on one machine. There is no horizontal scaling, load balancing, or clustering. If the process crashes, everything stops until it is restarted.
