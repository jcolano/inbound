# FormAgent -- SPARC Completion (Integration + Deployment)

> Cross-references: [Specification](./01-specification.md) | [Architecture](./03-architecture.md) | [Refinement](./04-refinement.md) | [Domain Model](../ddd/domain-model.md)

---

## 1. Implementation Order

Modules must be built in strict order. Each module depends on the prior.

```
Module 0: Auth + Multi-Tenancy     (foundation -- every table and endpoint depends on this)
    |
    v
Module 1: BUILD                     (form creation, handler config, embed)
    |
    v
Module 2: CAPTURE + PROCESS         (submission pipeline, contacts, flows, agents, sequences)
    |
    v
Module 3: EXPERIMENTS                (A/B testing, traffic split, autopilot)
    |
    v
Module 4: OBSERVE                    (analytics, dashboards, optimization assistant)
```

---

## 2. Step-by-Step Build Sequence

### Phase 0: Auth + Multi-Tenancy (Steps 1-8)

| Step | Task | Deliverable | Verification |
|------|------|------------|-------------|
| 0.1 | Create database tables | `accounts`, `workspaces`, `workspace_memberships`, `api_keys`, `sessions` | Tables exist with correct schema |
| 0.2 | Implement `auth_service.py` | Password hashing (bcrypt), JWT generate/validate | Unit tests AUTH-U01 through AUTH-U08 pass |
| 0.3 | Implement `auth_context.py` middleware | `get_current_context()` dependency | Unit tests AUTH-U09 through AUTH-U12 pass |
| 0.4 | Build auth endpoints | Signup, login, logout, me, switch-workspace | API tests API-01 through API-11 pass |
| 0.5 | Add `workspace_id` to ALL other tables | Alter 15 existing tables, add column + indexes | All workspace-scoped indexes created |
| 0.6 | Apply `Depends(get_current_context)` | Every authenticated endpoint uses AuthContext | Edge tests EDGE-01 through EDGE-04 pass |
| 0.7 | Build workspace management endpoints | Create, update, list, members, invite | API endpoint functional |
| 0.8 | Build API key endpoints | Create, list (prefix only), revoke | SEC-08 passes |

### Phase 1: BUILD (Steps 9-14)

| Step | Task | Deliverable | Verification |
|------|------|------------|-------------|
| 1.1 | Create `forms` table | Schema with workspace_id, JSON fields | Table exists |
| 1.2 | Implement form CRUD endpoints | POST, GET, PUT, DELETE /api/forms | API tests API-12 through API-17 pass |
| 1.3 | Implement NL form generator | `form_generator.py` + POST /api/forms/generate | Returns valid form config JSON from prompt |
| 1.4 | Implement handler groups | CRUD + member management + 4 routing strategies | RTR-U01 through RTR-U09 pass |
| 1.5 | Implement embed code generation | GET /api/forms/{id}/embed | Returns valid HTML snippet |
| 1.6 | Build `embed.js` | Field rendering, interaction tracking, submit | Form renders on external page and submits |

### Phase 2: CAPTURE + PROCESS (Steps 15-25)

| Step | Task | Deliverable | Verification |
|------|------|------------|-------------|
| 2.1 | Create remaining tables | `submissions`, `contacts`, `contact_notes`, `companies`, `deals`, `handler_groups`, `campaigns`, `sequences`, `sequence_steps`, `enrollments`, `drafts`, `spam_log`, `events`, `errors` | All 20 tables exist |
| 2.2 | Implement anti-spam pipeline | `spam.py` with 4 checks | SPAM-U01 through SPAM-U09 pass |
| 2.3 | Implement contact matcher | `contact_matcher.py` with merge logic | CM-U01 through CM-U10 pass |
| 2.4 | Implement submission endpoint | POST /api/submissions/{form_id} (public, steps 1-7) | API-18 through API-23 pass |
| 2.5 | Implement flow engine | `flow_engine.py` with all 6 flows | FLOW-U01 through FLOW-U06 pass |
| 2.6 | Implement handler routing | `router.py` with 4 strategies | RTR tests pass |
| 2.7 | Implement agent processor | `agent_processor.py` + `action_executor.py` | AGT-U01 through AGT-U08 pass |
| 2.8 | Implement error recovery | `error_recovery.py` with exponential backoff | EDGE-11, EDGE-12 pass |
| 2.9 | Implement event emitter | `event_emitter.py` with DB persistence + WebSocket | Events appear in DB and WS |
| 2.10 | Implement draft workflow | Draft CRUD + approve/reject endpoints | Draft flow functional |
| 2.11 | Implement campaigns + sequences | CRUD + enrollment + background processor | INT-05 through INT-07 pass |

### Phase 3: EXPERIMENTS (Steps 26-29)

| Step | Task | Deliverable | Verification |
|------|------|------------|-------------|
| 3.1 | Implement experiment CRUD | Create, list, get, update, archive | One-per-form constraint enforced |
| 3.2 | Implement traffic splitting | Modified GET /api/forms/{form_id}/schema | INT-08, INT-09 pass |
| 3.3 | Implement variant stats | Compute per-variant metrics | Stats match expected values |
| 3.4 | Implement autopilot optimize | POST /api/experiments/{id}/optimize | INT-10, INT-11 pass |

### Phase 4: OBSERVE (Steps 30-35)

| Step | Task | Deliverable | Verification |
|------|------|------------|-------------|
| 4.1 | Implement KPI dashboard endpoint | GET /api/analytics/overview | API-24 passes |
| 4.2 | Implement funnel endpoint | GET /api/analytics/funnel | API-25 passes |
| 4.3 | Implement channel attribution | GET /api/analytics/channels | API-26 passes |
| 4.4 | Implement speed-to-lead | GET /api/analytics/speed | Returns distribution buckets |
| 4.5 | Implement field analytics | GET /api/analytics/fields/{form_id} | Returns per-field stats |
| 4.6 | Implement agent observability | GET /api/analytics/agents/{id} + live stream | Agent metrics returned |
| 4.7 | Implement optimization assistant | POST + GET /api/analytics/forms/{id}/suggestions | Returns actionable suggestions |
| 4.8 | Build dashboard frontend | Vanilla JS SPA with all tabs | Visual verification |

---

## 3. Environment Setup

### 3.1 Prerequisites

```
- Python 3.11+
- pip (or uv for faster installs)
- Anthropic API key (for Claude)
- SMTP credentials (or mock for development)
```

### 3.2 Install Dependencies

```
# requirements.txt
fastapi>=0.104.0
uvicorn>=0.24.0
aiosqlite>=0.19.0
anthropic>=0.18.0
pydantic>=2.5.0
python-jose[cryptography]>=3.3.0    # JWT
bcrypt>=4.1.0
python-multipart>=0.0.6
aiosmtplib>=3.0.0                   # async SMTP
websockets>=12.0
httpx>=0.25.0                       # testing
pytest>=7.4.0
pytest-asyncio>=0.23.0
```

### 3.3 Environment Variables

```
# .env (never committed)
CLAUDE_API_KEY=sk-ant-api03-xxxx
JWT_SECRET=<random-64-char-string>
JWT_EXPIRY_HOURS=24

# SMTP (optional, mock if not set)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=xxxx
SMTP_FROM=FormAgent <noreply@example.com>

# Server
HOST=0.0.0.0
PORT=8000
DATABASE_PATH=./formagent.db
CORS_ORIGINS=http://localhost:3000
```

---

## 4. Database Initialization

On first startup, `database.py` runs all CREATE TABLE and CREATE INDEX statements.

### Initialization Order

1. `accounts` (no foreign keys)
2. `workspaces` (FK to accounts)
3. `workspace_memberships` (FK to accounts + workspaces)
4. `api_keys` (FK to accounts + workspaces)
5. `sessions` (FK to accounts + workspaces)
6. `forms` (FK to workspaces)
7. `companies` (FK to workspaces)
8. `contacts` (FK to workspaces + companies)
9. `contact_notes` (FK to contacts)
10. `deals` (FK to contacts + companies)
11. `handler_groups` (FK to workspaces)
12. `submissions` (FK to forms + contacts + companies)
13. `campaigns` (FK to workspaces)
14. `sequences` (FK to workspaces)
15. `sequence_steps` (FK to sequences)
16. `enrollments` (FK to sequences + contacts)
17. `experiments` (FK to forms)
18. `drafts` (FK to submissions)
19. `spam_log` (no strict FK)
20. `events` (no strict FK)
21. `errors` (FK to submissions)
22. All indexes (after tables created)

### Key Indexes

```
-- Auth indexes
idx_memberships_account, idx_memberships_workspace
idx_api_keys_hash, idx_api_keys_workspace
idx_sessions_account, idx_sessions_token

-- Workspace-scoped indexes (on all tenant tables)
idx_forms_workspace, idx_submissions_workspace, idx_contacts_workspace
idx_contacts_workspace_email (unique), idx_forms_unique_slug (unique)
idx_deals_workspace, idx_handler_groups_workspace
idx_campaigns_workspace, idx_sequences_workspace
idx_enrollments_workspace, idx_experiments_workspace, idx_events_workspace

-- Query-performance indexes
idx_submissions_form, idx_submissions_contact, idx_submissions_status
idx_submissions_created, idx_contacts_email, idx_deals_contact
idx_events_submission, idx_events_type, idx_experiments_form
idx_enrollments_sequence, idx_enrollments_status, idx_enrollments_next
idx_spam_form
```

---

## 5. Configuration Checklist

| Item | Location | Required | Notes |
|------|----------|----------|-------|
| Claude API key | `CLAUDE_API_KEY` env var | Yes | Required for NL generation, agent processing, optimization |
| JWT secret | `JWT_SECRET` env var | Yes | At least 32 characters, random |
| SMTP credentials | `SMTP_*` env vars | No | If unset, emails logged to console (mock mode) |
| Database path | `DATABASE_PATH` env var | No | Defaults to `./formagent.db` |
| CORS origins | `CORS_ORIGINS` env var | No | Comma-separated; defaults to `*` for development |
| Server host/port | `HOST`, `PORT` env vars | No | Defaults to `0.0.0.0:8000` |

---

## 6. Smoke Test Checklist Per Module

### Module 0: Auth

- [ ] POST /api/auth/signup returns token and workspace
- [ ] POST /api/auth/login returns token
- [ ] GET /api/auth/me returns account info
- [ ] Request without auth returns 401
- [ ] Request with other workspace's data returns 404

### Module 1: BUILD

- [ ] POST /api/forms/generate returns form config from NL prompt
- [ ] POST /api/forms creates and persists form
- [ ] GET /api/forms lists only current workspace forms
- [ ] GET /api/forms/{id}/embed returns HTML snippet
- [ ] GET /api/forms/{id}/schema returns field definitions (public endpoint)

### Module 2: CAPTURE + PROCESS

- [ ] POST /api/submissions/{form_id} stores submission and returns 200
- [ ] Submission with honeypot returns 200 silently (logged to spam_log)
- [ ] Submission creates or matches contact
- [ ] Submission with sales_lead flow triggers agent processing
- [ ] Agent actions appear in events table
- [ ] Draft created for `draft` autonomy level
- [ ] Sequence enrollment processes on schedule

### Module 3: EXPERIMENTS

- [ ] POST /api/experiments creates experiment on form
- [ ] GET /api/forms/{id}/schema returns variant-modified fields
- [ ] Submissions tagged with experiment_id and variant_id
- [ ] POST /api/experiments/{id}/optimize returns stats

### Module 4: OBSERVE

- [ ] GET /api/analytics/overview returns KPIs
- [ ] GET /api/analytics/funnel returns stage counts
- [ ] GET /api/analytics/channels returns per-source breakdown
- [ ] WebSocket /ws/events delivers live events
- [ ] POST /api/analytics/forms/{id}/suggestions returns optimization suggestions

---

## 7. Demo Data Seeding Script Outline

The seed script creates a realistic demo environment.

```
FUNCTION seed_demo_data():
    // 1. Create demo account + workspace
    account = signup("demo@formagent.io", "DemoPass123", "Demo User", "AI Consulting")

    // 2. Create handler group
    group = create_handler_group("Sales Team", strategy="round_robin", members=[
        { handler_id: "agent_salesbot", type: "agent", role: "principal" },
        { handler_id: "human_rachel", type: "human", role: "member" }
    ])

    // 3. Create forms
    demo_form = create_form("Enterprise Demo Request", type="sales",
        flow_id="sales_lead", entity="handler_group", entity_id=group.id,
        fields=[name, email, company, team_size, budget, message])

    whitepaper_form = create_form("Whitepaper Download", type="marketing",
        flow_id="email_marketing",
        fields=[name, email, company])

    // 4. Create campaign + sequence
    sequence = create_sequence("Whitepaper Follow-up", steps=[
        { order: 1, delay_days: 0, subject: "Your whitepaper is ready", body: "..." },
        { order: 2, delay_days: 3, subject: "Quick follow-up", body: "..." },
        { order: 3, delay_days: 7, subject: "One more thing", body: "..." }
    ])
    campaign = create_campaign("Q1 AI Whitepaper", form_ids=[whitepaper_form.id],
        nurture_sequence_id=sequence.id, contact_tags=["whitepaper-lead"])

    // 5. Create 50 sample submissions across both forms
    FOR i IN 1..35:
        submit(demo_form.id, random_lead_data(i), random_utm_data())
    FOR i IN 1..15:
        submit(whitepaper_form.id, random_marketing_data(i), random_utm_data())

    // 6. Create experiment
    experiment = create_experiment("Shorter Form Test", form_id=demo_form.id,
        metric="conversion_rate", variants=[
            { id: "ctrl", label: "Control", weight: 50, overrides: null },
            { id: "var_a", label: "Short Form", weight: 50,
              overrides: { fields: [name, email, message] } }
        ])

    // 7. Create some deals
    FOR 5 random processed submissions:
        create_deal(contact_id, name="Demo deal", amount=random(10000, 200000))

    PRINT "Demo data seeded. Login: demo@formagent.io / DemoPass123"
```

---

## 8. Production Readiness Checklist

| Category | Item | Status |
|----------|------|--------|
| **Security** | JWT secret is random and not hardcoded | Required |
| **Security** | Claude API key stored in env var, not in code | Required |
| **Security** | CORS origins configured (not wildcard in production) | Required |
| **Security** | Password hashing uses bcrypt (not md5/sha) | Required |
| **Security** | API keys hashed with SHA-256, full key never stored | Required |
| **Security** | Login rate limiting enabled (5 per email per 15 min) | Required |
| **Database** | SQLite WAL mode enabled for concurrent reads | Recommended |
| **Database** | All indexes created (see Section 4) | Required |
| **Database** | Database file backed up regularly | Recommended |
| **Monitoring** | Error logs captured (errors table) | Required |
| **Monitoring** | Stale submission cleanup job running | Required |
| **Config** | SMTP configured for real email delivery | Required for production |
| **Config** | Background threads started on app startup | Required |
| **Performance** | Connection pool configured for aiosqlite | Recommended |
| **Deployment** | Single process: `uvicorn main:app --host 0.0.0.0 --port 8000` | Required |

---

## 9. Known Limitations (MVP)

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| **SQLite concurrency** | Write locks under heavy load; single-writer | WAL mode helps reads; sufficient for MVP traffic |
| **No email open/click tracking** | Cannot measure email engagement | Requires dedicated email delivery service (post-MVP) |
| **No CRM integration** | Data stays in FormAgent only | Manual export or future webhook/API integration |
| **No billing layer** | No usage limits or monetization | All features available to all workspaces |
| **No mobile-native forms** | Embed relies on responsive HTML | Works on mobile browsers but not native apps |
| **No ad spend import** | Attribution shows conversions but not ROI | Manual ad spend entry possible (post-MVP) |
| **Daemon threads** | No job persistence across restarts | Jobs re-evaluate state on startup; enrollments resume |
| **No horizontal scaling** | Single process, single SQLite file | Sufficient for single-team or hackathon use |
| **Agent retry is in-process** | Retries lost if process crashes during backoff | Submissions stuck in `processing` caught by stale cleanup |
| **No OAuth** | Email + password only | OAuth providers can be added post-MVP |

---

## 10. Startup Command

```
# Development
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Production
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Note: `--workers 1` is intentional. SQLite does not support multiple writer processes. Background daemon threads run within the single process.
