# FormAgent PRD Documentation

## Overview
FormAgent is an inbound execution system -- forms as the surface, AI agents as labor. Describe a form in plain text, get a smart form with an AI agent behind it. Features include NL form generation, 6 processing flows, 4 routing strategies, A/B experimentation, agent autonomy levels, and full analytics.

## Product Summary
- **One-liner:** Describe a form. Get a form and the AI that runs it.
- **Tech Stack:** Python 3.11+ / FastAPI, JSON file storage (`data/` directory), Claude API, Vanilla JS, WebSocket, SMTP
- **Storage:** 21 JSON files in `data/` -- one per entity type, no database
- **API:** ~91 endpoints (75 core + 16 auth)
- **Modules:** 5 (Module 0: Auth, Module 1: Build, Module 2: Capture+Process, Module 3: Experiments, Module 4: Observe)

> **Addendum:** The MVP uses JSON files instead of any database. See [ADR-015](adr/ADR-015-json-file-storage.md) for rationale. This supersedes the original SQLite decision ([ADR-002](adr/ADR-002-sqlite-database.md)).

## Documentation Structure

### Specification (`specification/`)
Requirements and constraints extracted from the PRD.
- [Functional Requirements](specification/requirements.md) - All functional requirements by module with IDs and acceptance criteria
- [Non-Functional Requirements](specification/non-functional.md) - Performance, security, scalability, reliability
- [Edge Cases](specification/edge-cases.md) - Boundary conditions and error scenarios
- [Constraints](specification/constraints.md) - Technical and business constraints
- [Glossary](specification/glossary.md) - Domain terminology definitions

### Domain-Driven Design (`ddd/`)
Domain modeling using DDD patterns.
- [Domain Model](ddd/domain-model.md) - Core domain model overview with context map
- [Bounded Contexts](ddd/bounded-contexts.md) - Context boundaries and relationships
- [Aggregates](ddd/aggregates.md) - Aggregate roots and consistency boundaries
- [Entities](ddd/entities.md) - Domain entities with identity
- [Value Objects](ddd/value-objects.md) - Immutable value objects
- [Domain Events](ddd/domain-events.md) - Event catalog
- [Repositories](ddd/repositories.md) - Repository interfaces
- [Services](ddd/services.md) - Domain and application services

### Architecture Decision Records (`adr/`)
Key architectural decisions with rationale and trade-offs.
- [ADR Index](adr/index.md) - Full index of all decisions
- ADR-001: Modular Monolith Architecture
- ~~ADR-002: SQLite Database~~ (Superseded by ADR-015)
- ADR-003: FastAPI Backend
- ADR-004: JWT Authentication
- ADR-005: Workspace Isolation (Multi-Tenancy)
- ADR-006: Vanilla JS Frontend
- ADR-007: Claude API Integration
- ADR-008: Daemon Thread Async Processing
- ADR-009: Processing Flow Architecture
- ADR-010: Agent Autonomy Model
- ADR-011: A/B Experimentation System
- ADR-012: Prefixed ID Generation
- ADR-013: Embed Architecture
- ADR-014: WebSocket Observability
- **ADR-015: JSON File Storage** (Addendum -- replaces SQLite for MVP)

### SPARC Implementation Docs (`sparc/`)
Implementation-ready documentation following SPARC methodology.
- [Specification](sparc/01-specification.md) - Detailed specs with acceptance criteria
- [Pseudocode](sparc/02-pseudocode.md) - High-level algorithms and flow logic
- [Architecture](sparc/03-architecture.md) - System architecture with diagrams
- [Refinement](sparc/04-refinement.md) - TDD anchors and test specifications
- [Completion](sparc/05-completion.md) - Integration checklist and deployment guide

## Quick Start for Developers

1. Start with the [Glossary](specification/glossary.md) to understand terminology
2. Read [Functional Requirements](specification/requirements.md) for the full scope
3. Review the [Domain Model](ddd/domain-model.md) for system structure
4. Check [ADR Index](adr/index.md) for key technical decisions -- especially [ADR-015](adr/ADR-015-json-file-storage.md) on storage
5. Follow [Completion Guide](sparc/05-completion.md) for build order

## Implementation Order (Critical)

Module 0 (Auth + Multi-Tenancy) MUST be built first. Every JSON record has `workspace_id`, every query filters by it, every endpoint validates it.

```
Module 0: Auth --> Module 1: Build --> Module 2: Capture --> Module 3: Experiments --> Module 4: Observe
```

## Storage (MVP)

No database. All data stored as JSON files in `data/`:

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

See [ADR-015](adr/ADR-015-json-file-storage.md) for the full `JsonStore` interface and atomic write strategy.

## Source Documents
- Product Definition: `../Inbound-Product-Definition.md`
- Auth Spec: `../inbound-Auth-MultiTenancy.md`
- Generator Workflow: `../prd-to-docs.md`

---
*Generated from FormAgent Product Definition v2.0 using prd-to-docs workflow*
