# FormAgent -- SPARC Architecture

> Cross-references: [Specification](./01-specification.md) | [Pseudocode](./02-pseudocode.md) | [Domain Model](../ddd/domain-model.md)

---

## 1. High-Level System Diagram

```mermaid
graph LR
    subgraph External
        Website[External Website]
        Visitor[Site Visitor]
    end

    subgraph FormAgent["FormAgent (Single Process)"]
        API[FastAPI Server]
        Services[Service Layer]
        LLM[Claude API Client]
        DB[(SQLite DB)]
        BG[Background Threads]
        WS[WebSocket Hub]
    end

    subgraph Dashboard["Dashboard (Vanilla JS)"]
        Builder[Form Builder]
        Analytics[Analytics]
        Observe[Agent Observe]
        Experiments[Experiments]
    end

    Visitor -->|fills form| Website
    Website -->|POST /api/submissions| API
    API --> Services
    Services --> LLM
    Services --> DB
    Services --> BG
    Services --> WS
    Dashboard <-->|HTTP + WS| API
    LLM -->|Claude API| Claude[Anthropic API]
```

---

## 2. Component / Layer Architecture

```mermaid
graph TB
    subgraph "API Layer (FastAPI Routers)"
        auth_api[auth.py]
        workspaces_api[workspaces.py]
        api_keys_api[api_keys.py]
        forms_api[forms.py]
        submissions_api[submissions.py]
        contacts_api[contacts.py]
        deals_api[deals.py]
        groups_api[handler_groups.py]
        campaigns_api[campaigns.py]
        sequences_api[sequences.py]
        experiments_api[experiments.py]
        drafts_api[drafts.py]
        analytics_api[analytics.py]
        events_api[events.py]
    end

    subgraph "Middleware"
        auth_ctx[auth_context.py<br/>get_current_context]
    end

    subgraph "Service Layer"
        auth_svc[auth_service.py]
        workspace_svc[workspace_service.py]
        flow_eng[flow_engine.py]
        spam_svc[spam.py]
        contact_match[contact_matcher.py]
        router_svc[router.py]
        agent_proc[agent_processor.py]
        action_exec[action_executor.py]
        err_recovery[error_recovery.py]
        event_emit[event_emitter.py]
        seq_proc[sequence_processor.py]
        attrib_svc[attribution.py]
        stale_svc[stale_cleanup.py]
    end

    subgraph "LLM Layer"
        form_gen[form_generator.py]
        agent_prompts[agent_prompts.py]
        optimizer[optimizer.py]
        suggest_eng[suggestion_engine.py]
    end

    subgraph "Models Layer (Pydantic)"
        models[auth.py, form.py, submission.py,<br/>contact.py, deal.py, handler_group.py,<br/>campaign.py, sequence.py, experiment.py,<br/>draft.py, event.py]
    end

    subgraph "Database"
        database[database.py + SQLite file]
    end

    auth_ctx --> auth_svc
    forms_api --> auth_ctx
    submissions_api --> flow_eng
    flow_eng --> spam_svc
    flow_eng --> contact_match
    flow_eng --> router_svc
    flow_eng --> agent_proc
    agent_proc --> action_exec
    agent_proc --> err_recovery
    flow_eng --> event_emit
    experiments_api --> optimizer
    analytics_api --> suggest_eng
    forms_api --> form_gen
```

---

## 3. Auth Flow Diagram

```mermaid
sequenceDiagram
    participant Client as Dashboard / API Client
    participant API as FastAPI
    participant Auth as auth_service
    participant DB as SQLite
    participant JWT as JWT Library

    Note over Client, JWT: Signup Flow
    Client->>API: POST /api/auth/signup {email, password, name, workspace_name}
    API->>Auth: validate + hash password
    Auth->>DB: INSERT account
    Auth->>DB: INSERT workspace
    Auth->>DB: INSERT membership (role=owner)
    Auth->>JWT: generate token (sub, workspace_id, role)
    Auth->>DB: INSERT session
    API-->>Client: {token, account, workspace}

    Note over Client, JWT: Authenticated Request
    Client->>API: GET /api/forms (Authorization: Bearer <token>)
    API->>Auth: get_current_context()
    Auth->>JWT: decode + verify token
    Auth->>DB: verify session exists + not expired
    Auth-->>API: AuthContext(account_id, workspace_id, role)
    API->>DB: SELECT * FROM forms WHERE workspace_id = ctx.workspace_id
    API-->>Client: {forms: [...]}

    Note over Client, JWT: API Key Auth
    Client->>API: GET /api/forms (Authorization: Bearer fa_live_xxx)
    API->>Auth: get_current_context()
    Auth->>DB: SELECT FROM api_keys WHERE key_hash = SHA256(key)
    Auth-->>API: AuthContext(account_id, workspace_id, permissions)
    API->>DB: SELECT * FROM forms WHERE workspace_id = ctx.workspace_id
    API-->>Client: {forms: [...]}
```

---

## 4. Submission Processing Sequence Diagram

```mermaid
sequenceDiagram
    participant Embed as Embed JS
    participant API as Submission Endpoint
    participant Spam as spam.py
    participant DB as SQLite
    participant BG as Background Thread
    participant Flow as flow_engine.py
    participant CM as contact_matcher.py
    participant Router as router.py
    participant Agent as agent_processor.py
    participant Claude as Claude API
    participant WS as WebSocket

    Embed->>API: POST /api/submissions/{form_id}
    API->>DB: Lookup form (Step 1)
    API->>API: CORS check (Step 2)
    API->>API: Parse body (Step 3)
    API->>API: Validate fields (Step 4)
    API->>Spam: Anti-spam check (Step 5)
    Spam-->>API: PASS
    API->>DB: INSERT submission status=received (Step 6)
    API->>DB: Tag experiment/variant (Step 7)
    API-->>Embed: 200 {submission_id, message}

    Note over BG, WS: Async Processing
    API->>BG: Spawn thread
    BG->>CM: Match/create contact (Step 8)
    CM->>DB: Search + upsert contact
    BG->>CM: Match/create company (Step 9)
    CM->>DB: Search + upsert company
    BG->>DB: Append touchpoint (Step 10)
    BG->>Flow: execute_flow (Step 11)
    Flow->>Router: route_to_handler
    Router-->>Flow: {type: agent, id: agent_salesbot}
    Flow->>Agent: process_with_agent
    Agent->>Claude: Call with full context
    Claude-->>Agent: JSON action plan
    Agent->>Agent: Validate actions
    Agent->>DB: Execute actions (email, deal, etc.)
    Agent->>WS: Emit events
    Agent->>DB: Update submission status=processed
```

---

## 5. Agent Execution Sequence

```mermaid
sequenceDiagram
    participant Flow as flow_engine
    participant AP as agent_processor
    participant Claude as Claude API
    participant AE as action_executor
    participant DB as SQLite
    participant WS as WebSocket
    participant ER as error_recovery

    Flow->>AP: process_with_agent(submission, contact, form)
    AP->>AP: Build system prompt (context + constraints)
    AP->>WS: emit "agent_processing"
    AP->>Claude: Call API (system prompt)

    alt Success
        Claude-->>AP: JSON action plan
        AP->>AP: Parse JSON
        loop Each action in plan
            AP->>AP: Check action in allowed_actions
            alt Allowed
                AP->>AE: execute_action(action)
                AE->>DB: Create deal / send email / etc.
                AP->>WS: emit "agent_action"
            else Blocked
                AP->>DB: Log violation
                AP->>WS: emit "agent_action_blocked"
            end
        end
        AP->>DB: Update contact (tags, notes)
        AP->>WS: emit "agent_completed"

    else Timeout / Error
        Claude-->>AP: Error
        AP->>ER: handle_llm_error(attempt=1)
        ER->>ER: Wait 2s (exponential backoff)
        ER->>Claude: Retry
        alt Retry succeeds
            Claude-->>ER: JSON action plan
            ER-->>AP: Continue processing
        else All retries fail
            ER->>DB: Mark needs_human_review
            ER->>WS: emit "agent_escalated"
        end
    end
```

---

## 6. Data Flow Diagram

```mermaid
graph TD
    subgraph "BUILD (Module 1)"
        Prompt[NL Prompt] -->|Claude| FormConfig[Form Config JSON]
        FormConfig --> Editor[Visual Editor]
        Editor --> SaveForm[Save to DB]
        SaveForm --> EmbedCode[Generate Embed Code]
    end

    subgraph "CAPTURE (Module 2)"
        EmbedCode -->|deployed to| ExternalSite[External Website]
        ExternalSite -->|POST| Submission[Submission]
        Submission --> AntiSpam{Anti-Spam}
        AntiSpam -->|pass| Store[Store in DB]
        AntiSpam -->|fail| SpamLog[Spam Log]
        Store --> ContactMatch[Contact Match/Create]
        ContactMatch --> FlowExec[Execute Flow]
    end

    subgraph "PROCESS (Module 2)"
        FlowExec -->|deterministic| AutoActions[Auto Actions<br/>email, enroll, log]
        FlowExec -->|agent-guided| AgentPipeline[Agent Pipeline]
        AgentPipeline -->|Claude API| ActionPlan[Action Plan]
        ActionPlan --> Execute[Execute Actions]
        Execute --> Events[Event Stream]
    end

    subgraph "EXPERIMENTS (Module 3)"
        SaveForm -.->|active experiment| VariantSplit[Traffic Split]
        VariantSplit --> Submission
        Events --> Stats[Variant Stats]
        Stats -->|autopilot| Optimize[Claude Optimizer]
        Optimize -->|new variant| VariantSplit
    end

    subgraph "OBSERVE (Module 4)"
        Events --> Dashboard[KPI Dashboard]
        Events --> Funnel[Funnel Analytics]
        Events --> AgentDash[Agent Observability]
        Store --> Attribution[Channel Attribution]
        ContactMatch --> Attribution
    end
```

---

## 7. Background Jobs Architecture

```mermaid
graph TB
    subgraph "Main Process (FastAPI)"
        App[FastAPI App]
        Startup[on_startup hook]
    end

    subgraph "Daemon Threads"
        T1[Sequence Processor<br/>every 60s]
        T2[Stale Cleanup<br/>every 15min]
        T3[Experiment Stats Refresh<br/>every 5min]
    end

    subgraph "Per-Request Background"
        T4[Submission Processing<br/>spawned per submission]
    end

    Startup -->|thread.start daemon=True| T1
    Startup -->|thread.start daemon=True| T2
    Startup -->|thread.start daemon=True| T3
    App -->|threading.Thread per submission| T4

    T1 -->|query + send email| DB[(SQLite)]
    T2 -->|fail stale submissions| DB
    T3 -->|compute variant stats| DB
    T4 -->|contact match, flow exec, agent| DB
```

| Job | Interval | Description |
|-----|----------|-------------|
| Sequence Processor | 60s | Query enrollments where `next_step_due_at <= NOW`, send emails, advance steps |
| Stale Cleanup | 15 min | Mark submissions stuck in `processing` > 30min as `failed` |
| Experiment Stats | 5 min | Pre-compute variant stats for active experiments |

---

## 8. WebSocket Event Flow

```mermaid
sequenceDiagram
    participant Dashboard as Dashboard Client
    participant WS as WebSocket Hub
    participant Emitter as event_emitter.py
    participant Service as Any Service

    Dashboard->>WS: Connect /ws/events
    WS-->>Dashboard: Connection ACK

    Service->>Emitter: emit("agent_action", {submission_id, action, details})
    Emitter->>WS: Broadcast to connected clients
    Emitter->>DB: INSERT events record
    WS-->>Dashboard: {event_type, payload, timestamp}
```

The WebSocket hub maintains a set of connected clients. Events are broadcast to all connected dashboard sessions within the same workspace. The `event_emitter` is the single point of emission -- every service writes events through it, ensuring both persistence (to `events` table) and real-time delivery (to WebSocket).

---

## 9. Database Relationship Diagram

```mermaid
erDiagram
    accounts ||--o{ workspace_memberships : "has memberships"
    accounts ||--o{ api_keys : "owns keys"
    accounts ||--o{ sessions : "has sessions"
    workspaces ||--o{ workspace_memberships : "has members"
    workspaces ||--o{ api_keys : "scoped keys"
    workspaces ||--o{ sessions : "scoped sessions"
    workspaces ||--o{ forms : "contains"
    workspaces ||--o{ contacts : "contains"
    workspaces ||--o{ companies : "contains"
    workspaces ||--o{ deals : "contains"
    workspaces ||--o{ handler_groups : "contains"
    workspaces ||--o{ campaigns : "contains"
    workspaces ||--o{ sequences : "contains"
    workspaces ||--o{ experiments : "contains"
    workspaces ||--o{ events : "contains"

    forms ||--o{ submissions : "receives"
    forms ||--o{ experiments : "tested by"
    forms }o--|| handler_groups : "routed via"

    submissions }o--|| contacts : "linked to"
    submissions }o--|| companies : "linked to"
    submissions ||--o{ drafts : "produces"
    submissions ||--o{ events : "emits"
    submissions ||--o{ errors : "logs errors"

    contacts ||--o{ contact_notes : "has notes"
    contacts }o--|| companies : "belongs to"
    contacts ||--o{ deals : "has deals"
    contacts ||--o{ enrollments : "enrolled in"

    campaigns ||--o{ sequences : "has sequence"
    sequences ||--o{ sequence_steps : "has steps"
    sequences ||--o{ enrollments : "has enrollments"

    experiments ||--o{ submissions : "tags via meta"
```

### Table Summary (20 Tables)

| # | Table | workspace_id | Key Relationships |
|---|-------|-------------|-------------------|
| 1 | `accounts` | N/A (global) | Owner of workspaces |
| 2 | `workspaces` | IS the tenant | Contains all scoped data |
| 3 | `workspace_memberships` | FK | Links accounts to workspaces |
| 4 | `api_keys` | FK | Scoped to workspace |
| 5 | `sessions` | FK | JWT session tracking |
| 6 | `forms` | FK | Central entity; receives submissions |
| 7 | `submissions` | FK (denormalized) | Links to form, contact, company |
| 8 | `contacts` | FK | Unique per (workspace, email) |
| 9 | `contact_notes` | via FK | Append-only notes on contacts |
| 10 | `companies` | FK | Linked to contacts |
| 11 | `deals` | FK | Linked to contacts, companies |
| 12 | `handler_groups` | FK | Routing config with members JSON |
| 13 | `campaigns` | FK | Marketing containers |
| 14 | `sequences` | FK | Email drip definitions |
| 15 | `sequence_steps` | via FK | Ordered steps in a sequence |
| 16 | `enrollments` | FK | Contact progress through sequence |
| 17 | `experiments` | FK | A/B tests on forms |
| 18 | `drafts` | FK | Agent draft actions awaiting approval |
| 19 | `spam_log` | FK | Rejected submission log |
| 20 | `events` | FK | Activity stream + observability |

Note: `errors` table (21st if counted separately) stores error recovery logs.

---

## 10. Deployment View

```mermaid
graph TB
    subgraph "Single Server / Process"
        subgraph "Python Process"
            FastAPI[FastAPI + Uvicorn]
            Threads[Daemon Threads x3]
        end
        SQLite[(formagent.db)]
        Static[/frontend/ static files]
    end

    subgraph "External"
        Claude[Anthropic Claude API]
        SMTP[SMTP Server]
    end

    Browser[Dashboard Browser] -->|HTTP/WS| FastAPI
    EmbedSite[External Website] -->|HTTP POST| FastAPI
    FastAPI --> SQLite
    FastAPI --> Static
    FastAPI --> Claude
    FastAPI --> SMTP
    Threads --> SQLite
    Threads --> SMTP
```

**Deployment characteristics:**
- Single Python process (Uvicorn with FastAPI)
- SQLite database: single file (`formagent.db`), no separate DB server
- Static frontend served by FastAPI (or separate static file server)
- Background work handled by daemon threads (not Celery, not Redis)
- External dependencies: Anthropic Claude API, SMTP server (or mock)
- Environment variables: `CLAUDE_API_KEY`, `JWT_SECRET`, `SMTP_*` settings
