# ADR-001: Modular Monolith Architecture

## Status
Accepted

## Context
FormAgent is an inbound execution system combining forms, AI agents, processing flows, A/B experimentation, and real-time observability. The system includes ~91 API endpoints across authentication, form management, submissions, contacts, deals, campaigns, sequences, experiments, analytics, and events. It was conceived for rapid development (hackathon timeline) and needs to ship as a single deployable unit.

The architecture must support clear module boundaries (Auth, Build, Capture/Process, Experiments, Observe) while keeping operational complexity minimal. The chosen database is SQLite (see [ADR-002](./ADR-002-sqlite-database.md)), which is a single-file embedded database incompatible with multi-service architectures that require shared state across network boundaries.

## Decision
We adopt a **modular monolith** architecture: a single FastAPI application with clearly separated internal modules that communicate via direct function calls rather than network requests.

The module structure follows the PRD's functional decomposition:

```
formagent/
├── backend/
│   ├── main.py              # FastAPI app, startup, scheduler
│   ├── api/                  # Route handlers grouped by domain
│   │   ├── auth.py
│   │   ├── forms.py
│   │   ├── submissions.py
│   │   ├── contacts.py
│   │   ├── experiments.py
│   │   ├── analytics.py
│   │   └── ...
│   ├── services/             # Business logic, flow engine, agent processing
│   │   ├── flow_engine.py
│   │   ├── agent_processor.py
│   │   ├── contact_matcher.py
│   │   └── ...
│   ├── llm/                  # All Claude API integration
│   ├── middleware/            # Auth context, workspace isolation
│   └── models/               # Pydantic models per domain
```

Module boundaries are enforced by convention:
- **api/** contains only route definitions and request/response handling.
- **services/** contains all business logic; routes call services, never other routes.
- **llm/** encapsulates all LLM prompt construction and response parsing.
- **models/** defines Pydantic schemas per domain entity.
- **middleware/** provides cross-cutting concerns (auth, workspace isolation).

Inter-module communication is direct Python function calls. There are no message queues, service meshes, or network hops between modules. The flow engine (`services/flow_engine.py`) orchestrates cross-module operations (e.g., a submission triggers contact matching, company matching, attribution tracking, and agent processing in sequence).

## Consequences

### Positive
- **Development speed:** No service discovery, no API contracts between services, no distributed tracing needed. A single developer or small team can move fast.
- **SQLite compatibility:** A single process accessing a single database file avoids the concurrent-access problems that would arise with microservices sharing SQLite.
- **Simple deployment:** One process, one database file, one static frontend directory. No container orchestration, no service registry, no load balancer configuration.
- **Refactoring ease:** Module boundaries exist in code, not in deployment topology. Extracting a service later (if needed) is a matter of splitting code, not redesigning from scratch.
- **Debuggability:** Stack traces span the full request path. No need to correlate logs across services.
- **Transactional integrity:** All operations in a single submission flow (anti-spam, contact matching, company matching, flow execution) share a single database connection, enabling simple transaction management.

### Negative
- **Scaling ceiling:** The entire application scales as one unit. You cannot independently scale the agent processing pipeline or the analytics query engine.
- **Deployment coupling:** A change to the analytics module requires redeploying the entire application, including the submission pipeline.
- **Memory sharing:** A memory leak in one module affects all modules. There is no process isolation.
- **Team scaling:** With a larger team, merge conflicts and coordination overhead increase compared to independent service ownership.

## Alternatives Considered

1. **Microservices architecture** - Separate services for auth, forms, submissions, agent processing, analytics, and events. Rejected because: (a) SQLite cannot be shared across services without a network-capable database, which defeats the zero-infra goal; (b) the operational overhead of service discovery, inter-service auth, distributed transactions, and deployment orchestration is disproportionate for an MVP; (c) the team is small and the product is in discovery phase.

2. **Serverless functions (AWS Lambda / Cloudflare Workers)** - Each endpoint as an independent function. Rejected because: (a) WebSocket support is limited or complex in serverless; (b) daemon threads for background processing are incompatible with ephemeral execution; (c) SQLite file-based storage does not work well with stateless function instances; (d) cold start latency conflicts with real-time agent processing requirements.

3. **Modular monolith with plugin architecture** - Formal plugin interfaces with dependency injection containers. Rejected as over-engineering for the current stage. Simple Python module boundaries and FastAPI's dependency injection (`Depends()`) provide sufficient structure without a plugin framework.
