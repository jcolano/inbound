# ADR-003: Python 3.11+ / FastAPI for Backend

## Status
Accepted

## Context
FormAgent requires a backend framework capable of:
- Serving ~91 REST API endpoints across multiple domains (auth, forms, submissions, contacts, deals, campaigns, sequences, experiments, analytics, events)
- Native WebSocket support for real-time event streaming (see [ADR-014](./ADR-014-websocket-observability.md))
- Async I/O for non-blocking database access via aiosqlite (see [ADR-002](./ADR-002-sqlite-database.md)) and Claude API calls (see [ADR-007](./ADR-007-claude-api-integration.md))
- Request validation with typed models (form field definitions, submission data, experiment variants)
- Dependency injection for auth context middleware (see [ADR-005](./ADR-005-workspace-isolation.md))
- Serving static files for the frontend (see [ADR-006](./ADR-006-vanilla-js-frontend.md))
- Running background daemon threads for async processing (see [ADR-008](./ADR-008-daemon-thread-async.md))

The framework must support rapid development by a small team within a hackathon timeline.

## Decision
We use **Python 3.11+** with **FastAPI** as the backend framework.

FastAPI is configured as a single application instance in `backend/main.py` with routers organized by domain:

```python
from fastapi import FastAPI
from backend.api import auth, forms, submissions, contacts, deals, ...

app = FastAPI(title="FormAgent")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(forms.router, prefix="/api/forms")
app.include_router(submissions.router, prefix="/api/submissions")
# ... all routers
```

Key framework features used:
- **Pydantic models** for request/response validation (form schemas, submission payloads, experiment configs)
- **Depends()** for dependency injection of `AuthContext` on every authenticated endpoint
- **WebSocket routes** for the live event stream (`/ws/events`)
- **async def** route handlers with `await` for aiosqlite queries and Anthropic SDK calls
- **StaticFiles** mount for serving the vanilla JS frontend
- **Startup events** for database initialization and background thread spawning

Python 3.11+ is chosen for:
- `asyncio.TaskGroup` for structured concurrency
- Improved error messages and tracebacks
- 10-25% performance improvements over 3.10 (CPython optimizations)
- `tomllib` for configuration (stdlib)

## Consequences

### Positive
- **Async-native:** FastAPI is built on Starlette and uvicorn, providing first-class async support. Database queries (aiosqlite), LLM calls (Anthropic async client), and WebSocket handling all use `async/await` without blocking the event loop.
- **Pydantic validation:** Request bodies are validated against typed models before reaching handler logic. Invalid form field definitions, malformed submission data, or incorrect experiment configurations are rejected with structured error responses automatically.
- **Dependency injection:** The `Depends(get_current_context)` pattern provides clean workspace isolation. Every authenticated route receives an `AuthContext` with `account_id`, `workspace_id`, and `role` without boilerplate.
- **WebSocket support:** Native WebSocket routing via Starlette. No additional library needed for real-time event streaming.
- **Auto-generated OpenAPI docs:** Every endpoint is documented at `/docs` (Swagger UI) and `/redoc` automatically. Useful during development and for API key users.
- **Development speed:** Python's ecosystem (Anthropic SDK, aiosqlite, bcrypt, PyJWT) provides ready-made libraries for every integration. No wrapper libraries or custom adapters needed.
- **Single-file deployment:** Combined with SQLite and static file serving, the entire application runs with `uvicorn backend.main:app`.

### Negative
- **Python performance ceiling:** Python is slower than compiled languages for CPU-bound operations. Analytics aggregations over large datasets may become slow.
- **GIL limitations:** The Global Interpreter Lock means CPU-bound work in daemon threads (see [ADR-008](./ADR-008-daemon-thread-async.md)) can contend with the async event loop. This is mitigated by the I/O-bound nature of most operations (database queries, API calls).
- **Type safety is advisory:** Pydantic validates at runtime, not compile time. Type errors in service-to-service calls within the monolith are caught only during execution.
- **Deployment requires Python runtime:** Unlike Go or Rust (single binary), deployment requires a Python interpreter, virtualenv, and pip-installed dependencies.
- **Memory usage:** Python processes consume more memory than equivalent Go or Node.js processes, especially with large in-memory structures (WebSocket connection pools, cached form schemas).

## Alternatives Considered

1. **Node.js / Express (or Fastify)** - JavaScript runtime with a mature ecosystem. Rejected because: (a) lacks Pydantic-equivalent validation (Zod/Joi exist but are less integrated); (b) the Anthropic Python SDK is more mature and better documented than the Node.js SDK at the time of decision; (c) WebSocket support requires additional libraries (ws, Socket.io); (d) the team has stronger Python expertise.

2. **Go (net/http or Gin/Echo)** - Compiled language with excellent concurrency via goroutines. Rejected because: (a) development speed is slower for a hackathon timeline (no REPL, stricter type system, verbose error handling); (b) SQLite integration via cgo adds build complexity; (c) no equivalent to FastAPI's auto-generated docs and Pydantic validation; (d) the Anthropic Go SDK is less mature.

3. **Django + Django REST Framework** - Python's batteries-included framework. Rejected because: (a) synchronous by default (async support is incomplete in DRF); (b) ORM is opinionated and adds overhead for SQLite's simple query patterns; (c) WebSocket support requires Django Channels (adds Redis dependency); (d) heavier than needed for an API-only backend.

4. **Flask** - Lightweight Python framework. Rejected because: (a) no native async support (requires Quart fork); (b) no built-in validation (requires Marshmallow or similar); (c) no native WebSocket support; (d) FastAPI provides all of Flask's simplicity plus async, validation, and OpenAPI docs.
