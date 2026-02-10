# Architecture Decision Records -- FormAgent

This directory contains the Architecture Decision Records (ADRs) for FormAgent, an inbound execution system that combines smart forms with AI agents.

**Product:** FormAgent v2.0 (Locked Scope)
**Date:** 2026-02-10
**Tech Stack:** Python 3.11+ / FastAPI, JSON file storage (`data/` directory), Claude API (Anthropic SDK), Vanilla JS, SMTP, WebSocket, daemon threads
**Scale:** 20 entity types (JSON files), ~91 API endpoints, multi-tenant with workspace isolation

---

## ADR Index

| ADR | Title | Status | Summary |
|-----|-------|--------|---------|
| [ADR-001](./ADR-001-modular-monolith.md) | Modular Monolith Architecture | Accepted | Single FastAPI app with clear module boundaries; no microservices. Optimized for hackathon speed, SQLite compatibility, and single-process deployment. |
| [ADR-002](./ADR-002-sqlite-database.md) | ~~SQLite as Primary Database~~ | Superseded | ~~Single-file database via aiosqlite.~~ Superseded by ADR-015. |
| [ADR-015](./ADR-015-json-file-storage.md) | JSON File Storage | Accepted | Each entity type stored as a JSON file in `data/` directory. Zero database dependencies. `JsonStore` class provides load/save/find/insert/update/delete. Atomic writes via temp file + rename. |
| [ADR-003](./ADR-003-fastapi-backend.md) | Python 3.11+ / FastAPI Backend | Accepted | Async-native framework with Pydantic validation, native WebSocket support, and dependency injection for auth context. |
| [ADR-004](./ADR-004-jwt-authentication.md) | JWT Authentication with Session Records | Accepted | HS256 JWT tokens (24h expiry) for dashboard sessions with server-side session table for revocation; API keys for programmatic access. |
| [ADR-005](./ADR-005-workspace-isolation.md) | Multi-Tenant Workspace Isolation | Accepted | Row-level tenancy via workspace_id column on every data table; middleware enforces isolation on every query; workspace-scoped unique constraints. |
| [ADR-006](./ADR-006-vanilla-js-frontend.md) | Vanilla JS Frontend | Accepted | No-framework SPA with zero build step; vanilla JavaScript and CSS for the dashboard and all UI components. |
| [ADR-007](./ADR-007-claude-api-integration.md) | Claude API for All LLM Features | Accepted | Anthropic SDK for form generation, agent processing, A/B optimization, and suggestions; structured JSON output pattern across all four use cases. |
| [ADR-008](./ADR-008-daemon-thread-async.md) | Daemon Threads for Async Processing | Accepted | Python daemon threads for background agent work and scheduled jobs; no Celery, no Redis, zero additional infrastructure. |
| [ADR-009](./ADR-009-processing-flow-architecture.md) | Processing Flow Architecture | Accepted | Six built-in flows (email_marketing, sales_lead, support_triage, booking_request, direct_route, notify_only) with shared common steps and flow-specific processing. |
| [ADR-010](./ADR-010-agent-autonomy-model.md) | Agent Autonomy Model | Accepted | Four autonomy levels (notify_only, draft, semi_autonomous, fully_autonomous) with allowed-action guardrails; all actions validated and logged. |
| [ADR-011](./ADR-011-ab-experimentation.md) | A/B Experimentation with Variant Overrides | Accepted | Partial config overrides on base form (not full duplication); one active experiment per form; autopilot with >10% improvement threshold and minimum sample size. |
| [ADR-012](./ADR-012-prefixed-id-generation.md) | Prefixed ID Generation | Accepted | Human-readable prefixed IDs (form_xxx, sub_xxx, contact_xxx) as TEXT primary keys; self-documenting and debuggable. |
| [ADR-013](./ADR-013-embed-architecture.md) | Embeddable Form via Script Tag | Accepted | embed.js fetches schema, renders form, tracks field interactions, and submits via CORS; public endpoints with form ID as implicit auth boundary. |
| [ADR-014](./ADR-014-websocket-observability.md) | WebSocket for Real-Time Observability | Accepted | Native FastAPI WebSocket for live event streaming; every processing step emits events consumed by the dashboard activity stream and timeline. |

---

## Decision Relationships

```
ADR-001 (Modular Monolith)
  ├── constrains --> ADR-002 (SQLite: single-file DB fits single-process model)
  ├── constrains --> ADR-008 (Daemon Threads: in-process, no external workers)
  └── enables   --> ADR-014 (WebSocket: in-process broadcast, no pub/sub needed)

ADR-002 (SQLite) -- SUPERSEDED by ADR-015

ADR-015 (JSON File Storage)
  ├── supersedes --> ADR-002 (SQLite)
  ├── requires   --> ADR-001 (single process for file-based access)
  ├── requires   --> ADR-008 (thread locks for concurrent write safety)
  └── shapes     --> ADR-012 (TEXT IDs as JSON object keys)

ADR-003 (FastAPI)
  ├── enables   --> ADR-004 (Depends() for auth middleware)
  ├── enables   --> ADR-005 (Depends(get_current_context) for isolation)
  └── enables   --> ADR-014 (native WebSocket routing)

ADR-004 (JWT Auth)
  └── feeds     --> ADR-005 (JWT carries workspace_id for isolation)

ADR-005 (Workspace Isolation)
  ├── requires  --> ADR-004 (auth context provides workspace_id)
  └── applies   --> ADR-013 (public endpoints: form_id -> workspace_id lookup)

ADR-007 (Claude API)
  ├── used by   --> ADR-009 (agent-guided flows call Claude)
  ├── used by   --> ADR-010 (agent prompt includes autonomy instructions)
  └── used by   --> ADR-011 (autopilot generates challengers via Claude)

ADR-009 (Processing Flows)
  ├── uses      --> ADR-008 (async agent work in daemon threads)
  ├── uses      --> ADR-010 (autonomy level determines execute vs. draft)
  └── emits     --> ADR-014 (every step emits WebSocket events)

ADR-011 (A/B Experiments)
  └── delivered --> ADR-013 (embed script serves variant schemas transparently)

ADR-013 (Embed Architecture)
  └── feeds     --> ADR-014 (submissions trigger events visible in dashboard)
```

---

## How to Read These ADRs

Each ADR follows a consistent structure:
- **Status:** Current state of the decision (Accepted, Superseded, Deprecated)
- **Context:** The problem or situation that motivated the decision
- **Decision:** What was decided and how it is implemented
- **Consequences:** Both positive outcomes and trade-offs
- **Alternatives Considered:** Other approaches evaluated and why they were rejected

ADRs cross-reference each other using relative paths. Follow the links to understand how decisions interact.
