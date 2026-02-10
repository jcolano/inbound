# ADR-009: Processing Flow Architecture (6 Built-in Flows)

## Status
Accepted

## Context
FormAgent processes form submissions through a configurable pipeline. Different form purposes require different processing behavior:

- A newsletter signup should create a contact, add them to a campaign, send a welcome email, and enroll in a nurture sequence. No AI agent needed.
- A sales demo request should create a contact, match a company, route to an AI agent for qualification, and potentially create a deal and send a personalized email.
- A support ticket should triage the issue, create a ticket record, and route to the appropriate handler.
- A meeting booking should confirm the booking and notify handlers.

The system must support both **deterministic** flows (fixed steps, no AI) and **agent-guided** flows (AI decides actions based on context). Each form has a `flow_id` that selects its processing behavior.

The processing must also split into **synchronous** steps (within the HTTP request, returning a response to the submitter) and **asynchronous** steps (agent processing in background threads; see [ADR-008](./ADR-008-daemon-thread-async.md)).

## Decision
We implement a **flow engine** (`services/flow_engine.py`) with 6 built-in flows. Each flow is a sequence of named steps. All flows share common initial steps, then diverge into flow-specific behavior.

### The 6 Flows

| Flow ID | Mode | Use Case |
|---------|------|----------|
| `email_marketing` | Deterministic | Newsletter signups, whitepaper downloads, webinar registrations |
| `sales_lead` | Agent-guided | Demo requests, pricing inquiries, contact forms |
| `support_triage` | Agent-guided | Support requests, bug reports, feature requests |
| `booking_request` | Deterministic | Meeting schedulers, demo bookings |
| `direct_route` | Deterministic | General inquiries, feedback (human decides) |
| `notify_only` | Deterministic | Simple notifications, internal forms |

### Common Steps (All Flows)

Every submission passes through these steps before flow-specific processing:

1. **Form lookup** - Validate form exists and is active
2. **CORS check** - Validate request origin against `security.allowed_origins`
3. **Parse body** - Separate `_meta`, `_hp`, `_experiment` fields from submission data
4. **Field validation** - Type checking, required fields, length limits, regex, option values
5. **Anti-spam pipeline** - Honeypot, IP rate limit, email rate limit, duplicate detection
6. **Store submission** - Create record with `status: received`
7. **A/B tag** - Attach `experiment_id` and `variant_id` if present

These run synchronously. The HTTP response is returned after step 7.

### Flow-Specific Steps

After common steps, each flow executes its own sequence:

**`email_marketing`:** match_contact -> match_company -> add_to_campaign -> send_welcome -> enroll_nurture -> log_activity -> notify_handlers -> complete

**`sales_lead`:** match_contact -> match_company -> send_confirmation -> log_activity -> notify_handlers -> route_to_handler -> agent_or_human -> complete

**`support_triage`:** match_contact -> match_company -> create_ticket -> send_confirmation -> notify_handlers -> route_to_handler -> agent_or_human -> complete

**`booking_request`:** match_contact -> match_company -> send_confirmation -> log_activity -> notify_handlers -> complete

**`direct_route`:** match_contact -> route_to_handler (create task) -> send_confirmation -> notify_handlers -> complete

**`notify_only`:** notify_handlers -> complete

### Engine Pattern

```python
async def execute_flow(submission_id: str, form: Form, data: dict, meta: dict):
    flow_fn = {
        "email_marketing": _flow_email_marketing,
        "sales_lead": _flow_sales_lead,
        "support_triage": _flow_support_triage,
        "booking_request": _flow_booking_request,
        "direct_route": _flow_direct_route,
        "notify_only": _flow_notify_only,
    }[form.flow_id]

    # Common steps (contact match, company match, attribution)
    contact = await match_contact(data, form.workspace_id)
    company = await match_company(data, form.workspace_id) if has_company_data(data) else None
    await track_attribution(contact, meta)

    # Flow-specific steps
    await flow_fn(submission_id, form, data, contact, company)
```

### Sync/Async Split

For agent-guided flows (`sales_lead`, `support_triage`), the `agent_or_human` step spawns a daemon thread for agent processing. All steps before it run synchronously. The submission status transitions:

```
received -> processing -> processed (or needs_human_review, or error)
```

For deterministic flows, all steps run synchronously within the request or immediately after response via lightweight background work.

### Step Logging

Every step execution is appended to the submission's `actions` JSON array:

```json
{"step": "match_contact", "status": "created", "entity_id": "contact_xxx", "at": "..."}
```

This provides a complete audit trail and powers the processing timeline visualization (see [ADR-014](./ADR-014-websocket-observability.md)).

## Consequences

### Positive
- **Predictable behavior:** Each flow is a documented sequence of steps. Users selecting `email_marketing` know exactly what will happen. No hidden logic.
- **Shared infrastructure:** Common steps (contact matching, company matching, attribution tracking) are implemented once and reused across all flows. Bug fixes and improvements apply everywhere.
- **Clear sync/async boundary:** The split between HTTP-synchronous steps and background-async steps is explicit per flow. Developers know which steps block the response and which do not.
- **Auditable execution:** Every step is logged with status and timestamp. The processing timeline for any submission is fully reconstructable.
- **Extensibility pattern:** Adding a 7th flow is a matter of defining a new function and registering it in the dispatch dictionary. No framework changes needed.

### Negative
- **Fixed flow set:** Users cannot create custom flows or reorder steps. The 6 flows cover common use cases but may not fit every scenario. Custom step ordering would require a flow builder UI and a more complex engine.
- **Flow selection is per-form, not per-submission:** A form has one `flow_id`. Dynamic flow selection based on submission content (e.g., "if budget > $100K, use sales_lead; otherwise, use notify_only") is not supported.
- **Step coupling:** Some flows share steps (e.g., `match_contact` appears in 5 of 6 flows), but the step implementations may need flow-specific behavior (e.g., different contact tags for marketing vs. sales). This is handled via flow-specific arguments, which adds conditional logic inside shared steps.
- **No conditional branching:** Flows are linear sequences. There is no "if/else" or "branch" primitive. Agent-guided flows achieve conditional behavior via the LLM's action plan, but deterministic flows are strictly sequential.

## Alternatives Considered

1. **User-configurable flow builder** - A visual DAG editor where users define custom step sequences with conditions and branches. Rejected because: (a) dramatically increases UI complexity; (b) requires a flow execution engine with branching, conditions, and error handling; (c) the 6 built-in flows cover the PRD's scope; (d) can be added later as an advanced feature.

2. **Single generic flow with conditional steps** - One flow that conditionally executes steps based on form configuration flags. Rejected because: (a) leads to complex conditional logic in a single function; (b) harder to reason about than separate named flows; (c) the distinct flow names communicate intent clearly to users.

3. **Event-driven architecture (pub/sub)** - Each step publishes an event, and subsequent steps subscribe. Rejected because: (a) adds indirection that makes the execution order harder to trace; (b) requires an event bus (even in-process); (c) the sequential nature of submission processing does not benefit from decoupled event handling; (d) debugging publish/subscribe chains is harder than tracing function calls.

4. **Workflow engine (Temporal, Prefect)** - External workflow orchestration. Rejected because: (a) adds significant infrastructure; (b) overkill for 6 linear flows; (c) learning curve for the team; (d) conflicts with the zero-infra philosophy (see [ADR-001](./ADR-001-modular-monolith.md)).
