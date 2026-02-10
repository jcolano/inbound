# FormAgent — Product Definition v2.0 (Locked Scope)

**One-liner:** Describe a form. Get a form and the AI that runs it.

**Product definition:** FormAgent is an inbound execution system with forms as the surface and AI agents as labor. You describe what you need in plain text, the system generates a smart form with an AI agent behind it, assigns it to a handler with configurable trust levels, and gives you full visibility into every action — with A/B experimentation, self-optimization, and performance analytics built in.

**What it is NOT:** A form builder. A Zapier clone. An agent framework. It's the product that sits between your website and your team, turning every form submission into autonomous action.

---

## Scope Contract

### In Scope (MVP)

- User authentication / multi-tenant accounts (single-operator for now)
- Natural language form generation via Claude ("typed request")
- Visual form editor (edit what was generated)
- 6 processing flows (deterministic + agent-guided)
- 4 routing strategies (principal, round-robin, least-loaded, broadcast)
- Handler assignment with autonomy levels and guardrails
- One-click embed code generation
- Anti-spam pipeline (honeypot, rate limit, duplicate detection, CORS)
- Stateful contact memory with company matching
- Agent execution with allowed actions and autonomy levels
- Error recovery with retry, escalation, and logging
- Campaigns with nurture sequences
- A/B experiments with agent autopilot
- Form performance dashboard with funnel, attribution, speed-to-lead
- Field-level interaction tracking
- Multi-touch attribution (last-touch default, first-touch available)
- Agent observability dashboard with live timeline
- Optimization Assistant (suggestion + agent auto-apply with guardrails)

### Explicitly Out of Scope

- Billing / monetization layer
- Mobile-native form rendering
- Third-party CRM integrations (Salesforce, HubSpot)
- Email open/click tracking (requires delivery service)
- Ad spend import (manual only, no API pulls)

---

# Module 0: Auth + Multi-Tenancy

**This module is foundational. It runs before everything else.**

---

## Why Module 0

Multi-tenancy is not a feature — it's architecture. Every table has `workspace_id`. Every query filters by it. Every endpoint validates it. If this isn't built first, every line of code written afterward becomes technical debt.

---

## Core Concepts

```
Account (user)
    │
    ├── owns Workspace A
    │       ├── forms, submissions, contacts, deals...
    │       ├── handler groups, campaigns, sequences...
    │       └── experiments, analytics, events...
    │
    └── member of Workspace B (invited)
            └── same structure, fully isolated
```

**Account** = a person (email + password or OAuth)
**Workspace** = a tenant (all data is scoped here)
**Membership** = account's role within a workspace

One account can own multiple workspaces and be a member of others. All data is strictly isolated per workspace.

---

## Data Models

### Accounts

```json
{
  "id": "acct_xxx",
  "email": "juan@example.com",
  "name": "Juan",
  "password_hash": "bcrypt...",
  "status": "active",
  "created_at": "ISO timestamp",
  "last_login_at": "ISO timestamp"
}
```

### Workspaces

```json
{
  "id": "ws_xxx",
  "name": "My AI Consulting",
  "slug": "my-ai-consulting",
  "owner_account_id": "acct_xxx",
  "settings": {
    "default_timezone": "America/New_York",
    "default_from_email": "hello@myaiconsulting.com"
  },
  "status": "active",
  "created_at": "ISO timestamp"
}
```

### Workspace Memberships

```json
{
  "id": "wm_xxx",
  "workspace_id": "ws_xxx",
  "account_id": "acct_xxx",
  "role": "owner",
  "status": "active",
  "invited_by": null,
  "joined_at": "ISO timestamp"
}
```

**Roles:**

| Role | Permissions |
|------|------------|
| `owner` | Full access. Manage workspace settings, billing, members. Delete workspace. |
| `admin` | Full access to all data. Manage members. Cannot delete workspace. |
| `member` | Full access to forms, submissions, contacts, analytics. Cannot manage members or workspace settings. |
| `viewer` | Read-only access to dashboards and analytics. Cannot create or modify anything. |

### API Keys

```json
{
  "id": "key_xxx",
  "workspace_id": "ws_xxx",
  "account_id": "acct_xxx",
  "name": "Production API Key",
  "key_hash": "sha256...",
  "key_prefix": "fa_live_abc1",
  "permissions": ["forms:read", "forms:write", "submissions:read"],
  "last_used_at": "ISO timestamp",
  "expires_at": null,
  "status": "active",
  "created_at": "ISO timestamp"
}
```

API keys are displayed once on creation, then only the prefix is stored. The full key is hashed (SHA-256) for lookup.

Key format: `fa_live_{random_32_chars}` (live) or `fa_test_{random_32_chars}` (test)

---

## Database Tables

```sql
-- Accounts
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    last_login_at TEXT
);

-- Workspaces
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_account_id TEXT NOT NULL REFERENCES accounts(id),
    settings JSON DEFAULT '{}',
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Workspace Memberships
CREATE TABLE workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT DEFAULT 'active',
    invited_by TEXT,
    joined_at TEXT NOT NULL,
    UNIQUE(workspace_id, account_id)
);

-- API Keys
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    permissions JSON DEFAULT '[]',
    last_used_at TEXT,
    expires_at TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
);

-- Sessions (for dashboard JWT tracking / revocation)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    token_hash TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_memberships_account ON workspace_memberships(account_id);
CREATE INDEX idx_memberships_workspace ON workspace_memberships(workspace_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX idx_sessions_account ON sessions(account_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
```

**Total: 5 new tables (accounts, workspaces, workspace_memberships, api_keys, sessions)**

Combined with the 15 existing tables: **20 tables total.**

---

## Authentication Flows

### Flow 1: Signup

```
1. POST /api/auth/signup { email, password, name, workspace_name }
2. Validate email format, password strength (min 8 chars)
3. Check email not already registered
4. Hash password with bcrypt
5. Create account record
6. Create workspace record (owner = new account)
7. Create membership record (role = owner)
8. Generate JWT token (contains account_id, workspace_id, role)
9. Create session record
10. Return { token, account, workspace }
```

### Flow 2: Login

```
1. POST /api/auth/login { email, password }
2. Find account by email
3. Verify password against hash
4. Load workspaces for this account (via memberships)
5. If single workspace → auto-select
6. If multiple → return workspace list, user picks
7. Generate JWT token
8. Create session record
9. Update account.last_login_at
10. Return { token, account, workspace, workspaces[] }
```

### Flow 3: Switch Workspace

```
1. POST /api/auth/switch-workspace { workspace_id }
2. Verify account has active membership in target workspace
3. Generate new JWT with updated workspace_id
4. Create new session record
5. Return { token, workspace }
```

### Flow 4: API Key Authentication

```
1. Request includes header: Authorization: Bearer fa_live_xxxxx
2. Hash the key with SHA-256
3. Look up api_keys by key_hash
4. Verify status = active and not expired
5. Load workspace_id from the key record
6. Check permissions against the requested endpoint
7. Update last_used_at
8. Proceed with workspace_id injected into the request context
```

### Flow 5: Invite Member

```
1. POST /api/workspaces/{ws_id}/invite { email, role }
2. Verify inviter is owner or admin
3. Check if account exists for this email
   a. If yes → create membership (status: active)
   b. If no → create membership (status: pending), send invite email
4. When invited user signs up or logs in → auto-activate pending memberships
5. Return { membership }
```

---

## JWT Token Structure

```json
{
  "sub": "acct_xxx",
  "workspace_id": "ws_xxx",
  "role": "owner",
  "iat": 1707580800,
  "exp": 1707667200
}
```

- Signed with a server-side secret (HS256)
- Expires in 24 hours (configurable)
- Stored client-side in `localStorage` (dashboard) or passed as `Authorization: Bearer {token}`
- Session record allows server-side revocation

---

## Middleware: Workspace Isolation

This is the critical piece. A FastAPI dependency that runs on every authenticated endpoint.

```python
async def get_current_context(request: Request) -> AuthContext:
    """
    Extracts and validates auth context from every request.
    Returns: AuthContext(account_id, workspace_id, role)
    
    Two auth methods:
    1. JWT token (dashboard sessions)
    2. API key (programmatic access)
    """
    auth_header = request.headers.get("Authorization", "")
    
    if auth_header.startswith("Bearer fa_"):
        # API key auth
        return await _validate_api_key(auth_header[7:])
    elif auth_header.startswith("Bearer "):
        # JWT auth
        return await _validate_jwt(auth_header[7:])
    else:
        raise HTTPException(401, "Missing or invalid authorization")
```

**Every authenticated endpoint uses this:**

```python
@router.get("/api/forms")
async def list_forms(ctx: AuthContext = Depends(get_current_context)):
    forms = db.execute(
        "SELECT * FROM forms WHERE workspace_id = ?",
        [ctx.workspace_id]
    )
    return {"forms": forms}
```

**The rule is absolute:** No query ever touches data without a `WHERE workspace_id = ?` clause. No exceptions.

---

## Impact on Existing Tables

Every existing table in the spec already needs workspace_id. Here's the full list:

| Table | workspace_id column | Notes |
|-------|-------------------|-------|
| `forms` | ✅ Required | Added as non-nullable |
| `submissions` | ✅ Required | Denormalized from form |
| `contacts` | ✅ Required | Contacts are per-workspace |
| `contact_notes` | — | Inherits via contact_id FK |
| `companies` | ✅ Required | Companies are per-workspace |
| `deals` | ✅ Required | Deals are per-workspace |
| `handler_groups` | ✅ Required | Groups are per-workspace |
| `campaigns` | ✅ Required | Campaigns are per-workspace |
| `sequences` | ✅ Required | Sequences are per-workspace |
| `sequence_steps` | — | Inherits via sequence_id FK |
| `enrollments` | ✅ Required | For direct queries |
| `experiments` | ✅ Required | Experiments are per-workspace |
| `drafts` | ✅ Required | Drafts are per-workspace |
| `spam_log` | ✅ Required | Spam logs are per-workspace |
| `events` | ✅ Required | Events are per-workspace |
| `errors` | ✅ Required | Errors are per-workspace |

**Every indexed query should include workspace_id.** Update all indexes:

```sql
CREATE INDEX idx_forms_workspace ON forms(workspace_id);
CREATE INDEX idx_submissions_workspace ON submissions(workspace_id);
CREATE INDEX idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX idx_contacts_workspace_email ON contacts(workspace_id, email);
CREATE INDEX idx_deals_workspace ON deals(workspace_id);
CREATE INDEX idx_handler_groups_workspace ON handler_groups(workspace_id);
CREATE INDEX idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX idx_sequences_workspace ON sequences(workspace_id);
CREATE INDEX idx_enrollments_workspace ON enrollments(workspace_id);
CREATE INDEX idx_experiments_workspace ON experiments(workspace_id);
CREATE INDEX idx_events_workspace ON events(workspace_id);
-- ... etc for all tables with workspace_id
```

**Unique constraints must be workspace-scoped:**

```sql
-- Email uniqueness is per-workspace, not global
-- A contact jane@acme.com can exist in workspace A and workspace B independently
CREATE UNIQUE INDEX idx_contacts_unique_email ON contacts(workspace_id, email);

-- Form slugs are unique per workspace
CREATE UNIQUE INDEX idx_forms_unique_slug ON forms(workspace_id, slug);
```

---

## API Endpoints (Auth Module)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | No | Create account + workspace |
| POST | `/api/auth/login` | No | Login, get JWT |
| POST | `/api/auth/logout` | JWT | Invalidate session |
| POST | `/api/auth/switch-workspace` | JWT | Switch active workspace |
| GET | `/api/auth/me` | JWT | Get current account + workspace info |
| PUT | `/api/auth/me` | JWT | Update account (name, password) |
| GET | `/api/workspaces` | JWT | List workspaces for current account |
| POST | `/api/workspaces` | JWT | Create new workspace |
| PUT | `/api/workspaces/{id}` | JWT | Update workspace settings |
| GET | `/api/workspaces/{id}/members` | JWT | List workspace members |
| POST | `/api/workspaces/{id}/invite` | JWT | Invite member |
| PUT | `/api/workspaces/{id}/members/{mid}` | JWT | Update member role |
| DELETE | `/api/workspaces/{id}/members/{mid}` | JWT | Remove member |
| POST | `/api/api-keys` | JWT | Create API key |
| GET | `/api/api-keys` | JWT | List API keys (prefix only) |
| DELETE | `/api/api-keys/{id}` | JWT | Revoke API key |

**Total: 16 new endpoints**

Combined with ~75 existing: **~91 endpoints total.**

---

## Public Endpoints Exception

The form submission and schema endpoints remain unauthenticated — they're called from external websites:

| Endpoint | Auth | Isolation Method |
|----------|------|-----------------|
| `POST /api/submissions/{form_id}` | None | Form ID → workspace_id lookup |
| `GET /api/forms/{form_id}/schema` | None | Form ID → workspace_id lookup |

The form_id itself is the auth boundary. The form belongs to a workspace. The submission inherits the workspace_id from the form. No workspace_id is exposed to external visitors.

---

## Project Structure Addition

```
formagent/
├── backend/
│   ├── api/
│   │   ├── auth.py                    # Signup, login, logout, switch workspace
│   │   ├── workspaces.py              # Workspace CRUD, member management
│   │   ├── api_keys.py                # API key creation, listing, revocation
│   │   └── ... (existing route files)
│   │
│   ├── services/
│   │   ├── auth_service.py            # Password hashing, JWT generation/validation
│   │   ├── workspace_service.py       # Workspace creation, member invite logic
│   │   └── ... (existing services)
│   │
│   ├── middleware/
│   │   └── auth_context.py            # get_current_context() dependency
│   │
│   └── models/
│       ├── auth.py                    # Account, Workspace, Membership Pydantic models
│       └── ... (existing models)
```

---

## Implementation Order

This is critical. Auth and multi-tenancy must be built **first**, before any other module.

```
Step 1: Database tables (accounts, workspaces, memberships, api_keys, sessions)
Step 2: auth_service.py (password hashing, JWT gen/validate)
Step 3: auth_context.py middleware (get_current_context dependency)
Step 4: Auth endpoints (signup, login, logout)
Step 5: Apply workspace_id to ALL other tables
Step 6: Apply Depends(get_current_context) to ALL other endpoints
Step 7: Workspace management endpoints
Step 8: API key endpoints
Step 9: Then — and only then — build Module 1 (Forms)
```

Every endpoint written after Step 6 automatically inherits workspace isolation. No retrofitting needed.

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Password storage | bcrypt with salt (never plaintext, never md5/sha) |
| JWT secret | Server-side env var, rotatable |
| API key storage | SHA-256 hash only; full key shown once |
| Session hijacking | Token tied to session record; revocable server-side |
| Cross-workspace data leak | Middleware enforces workspace_id on every query |
| CORS on auth endpoints | Allow from dashboard origin only |
| Brute force login | Rate limit: 5 attempts per email per 15 minutes |
| Invite abuse | Only owner/admin can invite; pending invites expire in 7 days |


## System Architecture

```
External Website                          FormAgent Server
================                          ==================================

  Embedded Form                           POST /api/submissions/{form_id}
  (HTML/JS snippet) ── HTTP POST ──>     routes/submissions.py
                                                   |
                                                   v
                                          +------------------+
                                          | 1. Form lookup   |
                                          | 2. CORS check    |
                                          | 3. Parse body    |
                                          | 4. Field validate|
                                          | 5. Anti-spam     |
                                          | 6. Store         |
                                          | 7. A/B tagging   |
                                          +--------+---------+
                                                   |
                                                   v
                                            execute_flow()
                                          services/flow_engine.py
                                                   |
                                         +---------+---------+
                                         |                   |
                                    Common Steps        Flow-Specific
                                    ────────────        ────────────
                                    match_contact()     _flow_sales_lead()
                                    match_company()     _flow_support_triage()
                                    track_attribution() _flow_email_marketing()
                                                        _flow_booking_request()
                                                        _flow_direct_route()
                                                        _flow_notify_only()
                                                             |
                                                   +---------+---------+
                                                   |                   |
                                             Deterministic        Agent-Guided
                                             ─────────────        ────────────
                                             send_email()         route_to_handler()
                                             log_activity()            |
                                             create_task()        +----+----+
                                             enroll_sequence()    |         |
                                                                Human    Agent
                                                               (task)  (Claude API)

                  ▲
                  │ HTTP + WebSocket
                  ▼
┌──────────────────────────────────────────────────────────┐
│                  FORMAGENT DASHBOARD                      │
│               (Vanilla JS / Lightweight)                  │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Forms   │ │Analytics │ │ Experi-  │ │  Agent     │  │
│  │  Builder │ │ Dash     │ │  ments   │ │  Observe   │  │
│  │ + Config │ │ + Funnel │ │  + A/B   │ │  + Live    │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | Python 3.11+ / FastAPI | Async-native, fast to build |
| Database | SQLite (via aiosqlite) | Zero infra, single file, hackathon-appropriate |
| LLM | Claude API (Anthropic SDK) | Form generation, agent processing, optimization |
| Real-time | WebSocket (FastAPI native) | Live observability events |
| Frontend | Vanilla JS + CSS | No framework overhead |
| Email | SMTP (or mock for hackathon) | Agent action: send email |
| Embed | Generated HTML + JS snippet | Standalone, no dependencies on host site |
| Background | Threading (daemon threads) | Async agent processing, sequence steps |

---

## Module 1: BUILD — Form Creation + Assignment

### 1.1 Natural Language Form Builder (Typed Request)

The primary way to create forms. User describes what they need, Claude generates everything.

**Input:** Plain-text prompt.

```
"Build a demo request form for an AI consulting firm targeting enterprise clients"
```

**What Claude generates:**

- Form name, slug, type, and recommended flow
- Field definitions with types, labels, placeholders, validation
- Suggested handler configuration (autonomy level, allowed actions)
- Agent context (what the agent should know about this form's purpose)
- Response config (thank-you message, redirect URL)
- Security defaults

**LLM prompt structure:**

```
System: You are a form configuration generator for FormAgent.

Available field types: text, email, phone, number, select, multiselect,
textarea, checkbox, hidden, date, url

Form types: marketing, sales, support, general

Processing flows:
- email_marketing: Newsletter signups, downloads, registrations (deterministic)
- sales_lead: Demo requests, pricing inquiries (agent-guided)
- support_triage: Support requests, bug reports (agent-guided)
- booking_request: Meeting schedulers (deterministic)
- direct_route: General inquiries, feedback (deterministic, human decides)
- notify_only: Simple notifications, internal forms (minimal processing)

Return a complete form configuration as JSON matching this schema: { ... }

User: Generate a form configuration for: {prompt}

Return only JSON, no explanation.
```

**Response:** A draft form config (NOT saved). User reviews in the visual editor, adjusts, then saves.

**Iteration via conversation:**
- "Add a dropdown for budget range: <$10K, $10K-$50K, $50K-$100K, $100K+"
- "Make it bilingual English/Spanish"
- "Set the flow to sales_lead and autonomy to semi-autonomous"

### 1.2 Visual Form Editor

After generation (or from scratch), the user sees a visual editor.

**Supported field types:**

| Type | HTML Element | Validation |
|------|-------------|------------|
| `text` | `<input type="text">` | min/max length, regex |
| `email` | `<input type="email">` | Email format |
| `phone` | `<input type="tel">` | Phone format |
| `number` | `<input type="number">` | Min/max value |
| `select` | `<select>` | Value in options list |
| `multiselect` | `<select multiple>` | Values in options list |
| `textarea` | `<textarea>` | Max length |
| `checkbox` | `<input type="checkbox">` | Boolean |
| `hidden` | `<input type="hidden">` | — (honeypot) |
| `date` | `<input type="date">` | Date format |
| `url` | `<input type="url">` | URL format |

**Editor capabilities:**
- Drag to reorder fields
- Toggle required/optional
- Edit labels, placeholders, options
- Delete / add fields
- Preview form as it will appear embedded
- Configure auto-processing settings
- Configure security settings
- Configure response message / redirect URL

### 1.3 Form Data Model

```json
{
  "id": "form_xxx",
  "name": "Enterprise Demo Request",
  "slug": "enterprise-demo",
  "description": "Demo request form for enterprise AI consulting prospects",
  "status": "active",
  "type": "sales",
  "flow_id": "sales_lead",

  "entity": "handler_group",
  "entity_id": "group_xxx",

  "fields": [
    {
      "name": "first_name",
      "type": "text",
      "label": "First Name",
      "required": true,
      "placeholder": "Jane",
      "max_length": 100,
      "validation_regex": null,
      "options": null
    },
    {
      "name": "email",
      "type": "email",
      "label": "Work Email",
      "required": true,
      "placeholder": "jane@acme.com"
    },
    {
      "name": "company_name",
      "type": "text",
      "label": "Company",
      "required": true,
      "max_length": 200
    },
    {
      "name": "team_size",
      "type": "select",
      "label": "Team Size",
      "required": false,
      "options": ["1-10", "11-50", "51-200", "201-1000", "1000+"]
    },
    {
      "name": "budget_range",
      "type": "select",
      "label": "Budget Range",
      "required": false,
      "options": ["<$10K", "$10K-$50K", "$50K-$100K", "$100K+"]
    },
    {
      "name": "message",
      "type": "textarea",
      "label": "How can we help?",
      "required": false,
      "max_length": 5000
    }
  ],

  "field_mapping": {
    "first_name": "contact.first_name",
    "email": "contact.email",
    "company_name": "company.name",
    "team_size": "contact.custom_fields.company_size"
  },

  "auto": {
    "create_contact": true,
    "create_company": true,
    "confirmation_email_template_id": null,
    "log_activity": true,
    "notify_handler_ids": [],
    "post_to_feed": false
  },

  "agent": {
    "agent_id": null,
    "instructions": "New demo request. Qualify against ICP criteria. Check if contact or company already exists. Decide follow-up approach.",
    "autonomy_level": "semi_autonomous",
    "allowed_actions": ["qualify_lead", "send_email", "create_deal", "escalate"]
  },

  "security": {
    "allowed_origins": [],
    "honeypot_field": "_hp",
    "max_submissions_per_ip": 10,
    "max_submissions_per_email": 5,
    "duplicate_window_minutes": 5
  },

  "response": {
    "thank_you_message": "Thanks! Our team will reach out within 24 hours.",
    "redirect_url": null
  },

  "created_at": "ISO timestamp",
  "updated_at": null
}
```

### 1.4 Handler Assignment

#### Handler Types

| Type | Identifier | Description |
|------|-----------|-------------|
| `agent` | `agent_id` | AI agent processes submissions autonomously |
| `human` | `handler_id` | Routed to a specific human's inbox |
| `handler_group` | `group_id` | Routed via group with strategy |

#### Autonomy Levels (The Trust Slider)

| Level | Behavior | Agent Instructions |
|-------|----------|-------------------|
| **notify_only** | Agent reads, summarizes, alerts handler. No action taken. | "Do NOT take any actions. Analyze and prepare a summary." |
| **draft** | Agent drafts response/actions. Human approves before execution. | "Prepare planned actions and drafts. Do NOT execute. Await human review." |
| **semi_autonomous** | Agent acts immediately. Human can review within X minutes. | "Execute planned actions. Log everything. Human may review within {window}." |
| **fully_autonomous** | Agent handles end-to-end. Human sees activity log only. | "Execute all planned actions. Log everything for the activity stream." |

#### Allowed Actions (The Guardrails Checkboxes)

| Action | Description |
|--------|-------------|
| `qualify_lead` | Score and categorize the submission |
| `send_email` | Send a response email to the submitter |
| `create_deal` | Create a deal/opportunity record |
| `create_ticket` | Create a support ticket |
| `book_meeting` | Create a calendar booking |
| `enroll_sequence` | Enroll contact in a nurture sequence |
| `escalate` | Flag for human review |
| `respond_direct` | Return an immediate response message |

The agent cannot take actions that aren't enabled. Any attempt to use a disabled action is blocked, logged, and flagged.

### 1.5 Handler Groups (4 Routing Strategies)

Handler groups are reusable team definitions that distribute submissions.

**Data model:**

```json
{
  "id": "group_xxx",
  "name": "Sales Team",
  "description": "Handles all sales-related inbound submissions",
  "routing_strategy": "round_robin",

  "members": [
    {"handler_id": "agent_salesbot", "type": "agent", "role": "member", "active": true},
    {"handler_id": "human_rachel", "type": "human", "role": "principal", "active": true},
    {"handler_id": "agent_qualifier", "type": "agent", "role": "member", "active": true}
  ],

  "settings": {
    "fallback_handler_id": "human_rachel",
    "auto_assign_tasks": true,
    "notify_on_assignment": true
  },

  "last_assigned_index": 0,
  "assignment_count": {},

  "created_at": "ISO timestamp"
}
```

#### Strategy: `principal`

Always routes to the member with `role: "principal"`. If principal is inactive, falls back to `fallback_handler_id`.

**Use case:** "All demo requests go to SalesBot first."

#### Strategy: `round_robin`

Rotates through active members sequentially. Persists `last_assigned_index` across submissions.

```
Members: [A, B, C]
last_assigned_index: 1 (B was last)
Next: (1 + 1) % 3 = 2 → C
Update: last_assigned_index = 2
```

**Use case:** "Distribute support tickets evenly across 3 agents."

#### Strategy: `least_loaded`

Routes to the active member with the fewest assignments. Persists `assignment_count` per member.

```
assignment_count: {"A": 5, "B": 3, "C": 7}
Next: B (lowest count)
Update: assignment_count.B = 4
```

**Use case:** "Route to whoever has the lightest workload."

#### Strategy: `broadcast`

All active members receive a notification. First to claim handles it.

**Use case:** "Urgent inquiries — whoever's free, grab it."

#### Fallback Logic

If all members are inactive or the group is empty, falls back to `settings.fallback_handler_id`. If no fallback configured, submission enters `status: received` and appears in the unassigned queue.

### 1.6 Embed Code Generation

One click generates a snippet the user copies into any website.

**Generated output:**

```html
<!-- FormAgent Embed -->
<div id="fa-form-{form_id}"></div>
<script src="https://{host}/embed.js" data-form-id="{form_id}"></script>
```

**The embed script (`embed.js`):**

1. Fetches `GET /api/forms/{form_id}/schema` on page load
2. If active A/B experiment exists, receives variant-specific fields
3. Dynamically builds HTML form from field definitions
4. Adds hidden honeypot field for anti-spam
5. Adds hidden fields for experiment tracking (`_experiment_id`, `_variant_id`)
6. Captures UTM params from URL (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`)
7. Captures `referrer` and `page_url`
8. Tracks field interactions (focus, blur, fill events) for dropoff analytics
9. On submit: POSTs JSON to `POST /api/submissions/{form_id}`
10. Displays success message or validation errors
11. Supports optional redirect via `redirect_url`

**CORS:** The submission endpoint returns `Access-Control-Allow-Origin` matching the form's `security.allowed_origins`. If empty, returns `*`. Preflight `OPTIONS` handled automatically.

---

## Module 2: CAPTURE + PROCESS — Inbound Engine

### 2.1 Submission Flow

```
User fills form on external site
        │
        ▼
POST /api/submissions/{form_id}
        │
        ▼
┌─────────────────────┐
│   1. Form Lookup     │  By ID or slug
│   2. CORS Check      │  Validate origin
│   3. Parse Body      │  Separate _meta, _hp, _experiment fields
│   4. Field Validate  │  Type, required, length, regex, options
│   5. Anti-Spam       │  Honeypot → rate limit → duplicate
│   6. Store           │  Create submission record (status: received)
│   7. A/B Tag         │  Attach experiment_id + variant_id if present
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   8. Contact Match   │  Search by email → match or create
│   9. Company Match   │  Search by name → match or create, link to contact
│  10. Track Attrib.   │  Store touchpoint for attribution chain
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  11. Execute Flow    │  Based on form.flow_id
│      (6 flows)       │  See section 2.4
└────────┬────────────┘
         │
    ┌────┴─────┐
    │          │
 Sync       Async
 Steps      Steps
 (1-8)      (9-11: agent routing)
    │          │
    ▼          ▼
 HTTP 200   Background thread
 returned   processes agent work
```

**Key design:** Steps 1-8 execute synchronously within the HTTP request. The submitter gets an instant response. Steps 9+ (agent routing, agent runs) execute asynchronously via daemon thread.

### 2.2 Anti-Spam Pipeline

Runs synchronously before any processing. First failure rejects.

```
Submission Data
      |
      v
  [1] Honeypot Check ── bot filled hidden field? ── REJECT (return 200 silently)
      |
      v
  [2] IP Rate Limit ── > N from this IP in 1hr? ── REJECT (429)
      |
      v
  [3] Email Rate Limit ── > N from this email in 1hr? ── REJECT (429)
      |
      v
  [4] Duplicate Check ── same email + form within N min? ── REJECT (422)
      |
      v
  PASS → proceed to flow execution
```

All rejections logged to `spam_log` with reason. Honeypot rejections return HTTP 200 (not 422) to avoid tipping off bots.

Thresholds are configurable per-form via `security` config.

### 2.3 Stateful Contact Memory

Every submission is linked to a contact record. This is a core differentiator.

**Contact resolution logic:**

1. Search contacts by email
2. If match found → link submission, update with any new info (don't overwrite existing)
3. If no match → create new contact record
4. If `company_name` in submission → search companies by name, match or create, link to contact
5. Attach full history to the submission context before agent processing

**Contact data model:**

```json
{
  "id": "contact_xxx",
  "email": "jane@acme.com",
  "name": "Jane Smith",
  "phone": "+1-555-0100",
  "company_id": "company_xxx",
  "status": "lead",
  "source": "inbound_form",
  "tags": ["enterprise", "qualified", "q1-2026"],
  "custom_fields": {
    "company_size": "51-200",
    "budget_range": "$50K-$100K"
  },
  "first_seen": "ISO timestamp",
  "last_seen": "ISO timestamp",
  "submission_count": 3,
  "touchpoints": [
    {
      "submission_id": "sub_001",
      "form_id": "form_xxx",
      "utm_source": "google",
      "utm_medium": "cpc",
      "utm_campaign": "q1-launch",
      "page_url": "https://example.com/pricing",
      "at": "2026-01-15T10:00:00Z"
    },
    {
      "submission_id": "sub_002",
      "form_id": "form_yyy",
      "utm_source": "linkedin",
      "utm_medium": "social",
      "utm_campaign": "thought-leadership",
      "page_url": "https://example.com/whitepaper",
      "at": "2026-02-03T14:00:00Z"
    }
  ],
  "created_at": "ISO timestamp"
}
```

**What the agent sees when processing a submission:**

```
New submission from: jane@acme.com
Form: Enterprise Demo Request
Flow: sales_lead

--- Current Submission ---
Name: Jane Smith
Company: Acme Corp
Team Size: 51-200
Budget: $50K-$100K
Message: "We spoke last week about AI strategy consulting."

--- Contact History ---
Returning contact (2 previous submissions).
First seen: 2026-01-15 via Google Ads (pricing page).
Last submission: 2026-02-03 on "Whitepaper Download" form via LinkedIn.
Tags: enterprise, whitepaper-lead
Status: lead

--- Company ---
Acme Corp (matched existing record)
```

### 2.4 Processing Flows

Six built-in flows. The form's `flow_id` selects one.

| Flow | Mode | Creates | Routes To | Async? |
|------|------|---------|-----------|--------|
| `email_marketing` | Deterministic | Contact, Activity | Campaign + Nurture | No |
| `sales_lead` | Agent-guided | Contact, Activity, Deal | Group/Handler/Agent | Yes |
| `support_triage` | Agent-guided | Contact, Ticket | Group/Handler/Agent | Yes |
| `booking_request` | Deterministic | Contact, Activity | Calendar | No |
| `direct_route` | Deterministic | Contact, Task | Handler/Group | No |
| `notify_only` | Deterministic | — | — | No |

#### Flow: `email_marketing`

For: Newsletter signups, whitepaper downloads, webinar registrations.

| Step | Action | Details |
|------|--------|---------|
| 1 | `match_contact` | Search by email. Match or create. Apply campaign tags. |
| 2 | `match_company` | If company_name provided. Match or create. Link to contact. |
| 3 | `add_to_campaign` | Add contact to campaign. Apply contact_tags. |
| 4 | `send_welcome` | Send campaign welcome email. Include asset download link if configured. |
| 5 | `enroll_nurture` | If campaign has nurture_sequence_id, enroll contact. |
| 6 | `log_activity` | Log CRM activity on contact: "Web form: {form_name}" |
| 7 | `notify_handlers` | Notify handlers in `auto.notify_handler_ids` |
| 8 | `complete` | Update submission status → `processed` |

No agent involved. Every step is deterministic.

#### Flow: `sales_lead`

For: Demo requests, pricing inquiries, contact forms.

| Step | Action | Details |
|------|--------|---------|
| 1 | `match_contact` | Match or create contact |
| 2 | `match_company` | Match or create company. Link to contact. |
| 3 | `send_confirmation` | Send auto-reply if `confirmation_email_template_id` set |
| 4 | `log_activity` | Log CRM activity: "Inbound lead: {form_name}" |
| 5 | `notify_handlers` | Notify `auto.notify_handler_ids` |
| 6 | `route_to_handler` | Route to handler group (apply strategy) or specific handler |
| 7 | `agent_or_human` | If agent → call Claude API with full context. If human → create task + notify. |
| 8 | `complete` | Update status based on outcome |

Agent decides: Lead quality, deal creation, follow-up approach, whether to enroll in nurture or escalate to human.

#### Flow: `support_triage`

For: Support requests, bug reports, feature requests.

| Step | Action | Details |
|------|--------|---------|
| 1 | `match_contact` | Match or create contact |
| 2 | `match_company` | Match or create company |
| 3 | `create_ticket` | Create ticket from submission data |
| 4 | `send_confirmation` | Send confirmation with ticket reference |
| 5 | `notify_handlers` | Notify configured handlers |
| 6 | `route_to_handler` | Route via group strategy or direct |
| 7 | `agent_or_human` | Agent triages: searches KB, adds notes, resolves or escalates |
| 8 | `complete` | Update status |

#### Flow: `booking_request`

For: Meeting schedulers, demo bookings.

| Step | Action |
|------|--------|
| 1 | `match_contact` |
| 2 | `match_company` |
| 3 | `send_confirmation` with booking link |
| 4 | `log_activity` |
| 5 | `notify_handlers` |
| 6 | `complete` |

#### Flow: `direct_route`

For: General inquiries, feedback forms.

| Step | Action |
|------|--------|
| 1 | `match_contact` |
| 2 | Route to handler, create task |
| 3 | `send_confirmation` |
| 4 | `notify_handlers` |
| 5 | `complete` |

No agent. Human handles as they see fit.

#### Flow: `notify_only`

For: Simple notifications, internal forms.

| Step | Action |
|------|--------|
| 1 | `notify_handlers` |
| 2 | `complete` |

No contact matching, no CRM entities.

### 2.5 Agent Processing Pipeline

When a submission is routed to an agent handler:

```
Submission arrives with full context
        │
        ▼
┌─────────────────────────┐
│  1. Build Agent Prompt   │
│  - Form purpose/type     │
│  - Submission data       │
│  - Contact history       │
│  - Company info          │
│  - Allowed actions       │
│  - Autonomy instructions │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  2. Call Claude API      │
│  - System prompt with    │
│    context + constraints │
│  - Structured output     │
│    (JSON action plan)    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  3. Validate Actions     │
│  - Check each action     │
│    against allowed list  │
│  - Block unauthorized    │
│  - Log violations        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  4. Execute or Draft     │
│  - fully_autonomous:     │
│    execute immediately   │
│  - semi_autonomous:      │
│    execute, flag review  │
│  - draft: store draft,   │
│    await human approval  │
│  - notify_only: store    │
│    summary, alert handler│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  5. Log & Update         │
│  - Log all actions taken │
│  - Update contact notes  │
│  - Update contact tags   │
│  - Record outcome        │
│  - Emit WebSocket event  │
└──────────────────────────┘
```

**Agent system prompt structure:**

```
You are a FormAgent handler for: "{form_name}"
Form type: {form_type}
Purpose: {agent_instructions}

Your allowed actions: {allowed_actions_list}
Your autonomy level: {autonomy_level}

{autonomy_level_specific_instructions}

--- Contact Context ---
{contact_history_block}

--- Current Submission ---
{submission_data}

--- Instructions ---
1. Analyze this submission with full contact context
2. Decide which allowed actions to take and in what order
3. Return a structured JSON response:
   {
     "reasoning": "Why I chose these actions",
     "actions": [
       {"action": "qualify_lead", "details": {"score": "high", "reason": "..."}},
       {"action": "send_email", "details": {"subject": "...", "body": "..."}},
       {"action": "create_deal", "details": {"name": "...", "value": N}}
     ],
     "contact_updates": {
       "tags_add": ["qualified", "enterprise"],
       "notes": "High-intent enterprise lead..."
     }
   }
4. If you cannot handle this, use the "escalate" action
```

### 2.6 Error Recovery

Every step can fail. The system handles this explicitly.

| Error | Recovery | Fallback |
|-------|----------|----------|
| LLM API timeout | Retry with exponential backoff (3 attempts: 2s, 4s, 8s) | Queue for retry in 5 min |
| LLM unparseable response | Re-prompt with stricter format instructions | Escalate to human |
| External action fails (email) | Retry once | Log failure, mark `action_failed` |
| Agent uses disallowed action | Block action, log violation | Continue with valid actions |
| All retries exhausted | Mark as `needs_human_review` | Notify fallback handler |

Every recovery step emits a WebSocket event and is logged in the submission's `actions` array.

### 2.7 Submission Data Model

```json
{
  "id": "sub_xxx",
  "form_id": "form_xxx",
  "form_type": "sales",
  "flow_id": "sales_lead",

  "data": {
    "first_name": "Jane",
    "email": "jane@acme.com",
    "company_name": "Acme Corp",
    "team_size": "51-200",
    "message": "Interested in enterprise plan"
  },

  "meta": {
    "ip": "203.0.113.42",
    "user_agent": "Mozilla/5.0...",
    "page_url": "https://example.com/pricing",
    "referrer": "https://google.com/search?q=...",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "q1-launch",
    "utm_content": "pricing-banner",
    "utm_term": "ai consulting",
    "experiment_id": null,
    "variant_id": null
  },

  "field_interactions": {
    "first_name": {"focused": true, "filled": true, "time_ms": 2100},
    "email": {"focused": true, "filled": true, "time_ms": 3400},
    "company_name": {"focused": true, "filled": true, "time_ms": 1800},
    "team_size": {"focused": true, "filled": true, "time_ms": 900},
    "budget_range": {"focused": true, "filled": false, "time_ms": 500},
    "message": {"focused": false, "filled": false, "time_ms": 0}
  },

  "contact_id": "contact_xxx",
  "company_id": "company_xxx",
  "is_new_contact": true,

  "status": "processed",
  "status_detail": null,
  "outcome": "qualified",

  "routed_to_type": "handler_group",
  "routed_to_id": "group_xxx",
  "handled_by": "agent_salesbot",

  "actions": [
    {"step": "validate", "status": "ok", "at": "2026-02-10T14:00:00Z"},
    {"step": "anti_spam", "status": "passed", "at": "2026-02-10T14:00:00Z"},
    {"step": "match_contact", "status": "created", "entity_id": "contact_xxx", "at": "..."},
    {"step": "match_company", "status": "created", "entity_id": "company_xxx", "at": "..."},
    {"step": "send_confirmation", "status": "sent", "at": "..."},
    {"step": "route_to_group", "status": "routed", "handler": "agent_salesbot", "at": "..."},
    {"step": "agent_process", "status": "completed", "at": "..."},
    {"step": "qualify_lead", "status": "ok", "details": {"score": "high"}, "at": "..."},
    {"step": "send_email", "status": "sent", "at": "..."},
    {"step": "create_deal", "status": "ok", "entity_id": "deal_xxx", "at": "..."},
    {"step": "complete", "status": "ok", "at": "..."}
  ],

  "agent_notes": "High-intent enterprise lead. Created $100K deal. Sent personalized follow-up.",

  "created_entities": {
    "deal_id": "deal_xxx",
    "task_id": null,
    "ticket_id": null
  },

  "created_at": "2026-02-10T14:00:00Z",
  "processed_at": "2026-02-10T14:00:12Z",
  "processing_duration_ms": 12000
}
```

### 2.8 Campaigns

Campaigns are marketing containers that tie forms, sequences, and analytics together.

```json
{
  "id": "camp_xxx",
  "name": "Q1 AI Whitepaper Launch",
  "description": "Lead gen campaign for the AI strategy whitepaper",
  "status": "active",
  "type": "lead_gen",

  "inbound_form_ids": ["form_xxx", "form_yyy"],
  "welcome_email_template_id": "tmpl_xxx",
  "nurture_sequence_id": "seq_xxx",
  "asset_url": "https://example.com/assets/ai-whitepaper.pdf",
  "asset_name": "AI Strategy Whitepaper",

  "contact_tags": ["whitepaper-lead", "q1-2026"],
  "utm_campaign": "q1-ai-wp",

  "created_at": "ISO timestamp"
}
```

### 2.9 Nurture Sequences

Timed email drip sequences with enrollment tracking.

**Sequence definition:**

```json
{
  "id": "seq_xxx",
  "name": "Whitepaper Follow-up",
  "description": "3-touch nurture for whitepaper downloaders",
  "status": "active",
  "stop_conditions": ["contact_replied", "deal_created", "manual_stop", "contact_unsubscribed"],
  "created_at": "ISO timestamp"
}
```

**Sequence steps:**

```json
{
  "id": "step_xxx",
  "sequence_id": "seq_xxx",
  "order": 1,
  "delay_days": 3,
  "delay_hours": 0,
  "send_time": "09:00",
  "email_subject": "Quick follow-up on the AI Strategy whitepaper",
  "email_body": "Hi {{first_name}}, I noticed you downloaded our whitepaper...",
  "agent_personalize": false,
  "created_at": "ISO timestamp"
}
```

**Enrollment tracking:**

```json
{
  "id": "enroll_xxx",
  "sequence_id": "seq_xxx",
  "contact_id": "contact_xxx",
  "submission_id": "sub_xxx",
  "campaign_id": "camp_xxx",

  "current_step": 2,
  "status": "active",
  "stop_reason": null,

  "enrolled_at": "2026-02-10T10:00:00Z",
  "next_step_due_at": "2026-02-13T14:00:00Z",
  "completed_at": null,

  "history": [
    {"step": 1, "status": "sent", "sent_at": "2026-02-10T10:00:30Z"},
    {"step": 2, "status": "sent", "sent_at": "2026-02-13T14:00:15Z"}
  ]
}
```

**Background job:** Runs every 60 seconds. For each enrollment where `status=active` AND `next_step_due_at <= now()`:
1. Check stop conditions (contact replied, deal created, unsubscribed)
2. If stop condition met → stop enrollment, record reason
3. Send the current step's email (with variable substitution)
4. If last step → mark completed
5. Else → compute `next_step_due_at` from next step's delay

---

## Module 3: EXPERIMENTS — A/B Testing + Agent Autopilot

### 3.1 Experiment Data Model

```json
{
  "id": "exp_xxx",
  "name": "Shorter form test",
  "form_id": "form_xxx",
  "status": "active",
  "metric": "conversion_rate",
  "min_sample_size": 30,

  "variants": [
    {
      "id": "ctrl",
      "label": "Control",
      "weight": 50,
      "overrides": null
    },
    {
      "id": "var_a",
      "label": "Shorter form (no phone/company)",
      "weight": 50,
      "overrides": {
        "fields": [
          {"name": "first_name", "type": "text", "label": "Name", "required": true},
          {"name": "email", "type": "email", "label": "Email", "required": true},
          {"name": "message", "type": "textarea", "label": "How can we help?", "required": false}
        ]
      }
    }
  ],

  "winner_variant_id": null,

  "optimization_log": [
    {"at": "2026-02-10T10:00:00Z", "action": "created", "details": "Experiment created with 2 variants"},
    {"at": "2026-02-15T10:00:00Z", "action": "optimized", "details": "var_a promoted (18% vs 12% conversion). New challenger generated."}
  ],

  "created_at": "ISO timestamp"
}
```

**Key design:** Variant `overrides` is a partial form config — only the fields that differ from the base form. `null` means "use base form as-is" (control). This avoids duplicating entire form configs.

### 3.2 Traffic Splitting

When `GET /api/forms/{form_id}/schema` is called:

1. Check if an active experiment exists for this form
2. If yes, do weighted random variant selection
3. Apply variant overrides on top of base form config
4. Return modified schema with `experiment_id` and `variant_id` attached
5. Embed script passes these as hidden fields with the submission
6. Submission stores them in `meta.experiment_id` and `meta.variant_id`

### 3.3 Variant Stats Computation

For each variant in an experiment:

1. Filter submissions where `meta.experiment_id == exp_id` AND `meta.variant_id == var_id`
2. Per variant compute: submissions count, processed count, contacts created, deals created, revenue, conversion rate
3. Conversion rate = metric-dependent:
   - `conversion_rate`: processed / total
   - `contacts`: contacts created / total
   - `deals`: deals created / total
   - `revenue`: total revenue

### 3.4 Agent Autopilot (Optimize Endpoint)

`POST /api/experiments/{exp_id}/optimize`

1. Load experiment, validate `status=active`
2. Compute per-variant stats
3. Check if all variants have >= `min_sample_size` submissions
   - If not → return `{"action": "waiting", "message": "Need more data (var_a: 18/30, ctrl: 22/30)"}`
4. Determine winner based on experiment metric
5. If winner beats runner-up by >10%:
   - Apply winner's overrides to the base form
   - Log to `optimization_log`
6. Generate new challenger via Claude:

```
System: You are an A/B test optimizer for web forms.

Current form config: {form_fields}
Experiment metric: {metric}
Per-variant performance: {stats}

Based on what worked and what didn't, generate a new challenger variant.
Rules:
- Preserve all required fields from the base form
- Only modify optional fields, labels, placeholders, or add/remove non-required fields
- Return a partial form config (overrides only) as JSON

Return only JSON.
```

7. Add generated variant with 50% weight, set winner as new control with 50% weight
8. Update experiment record
9. Return `{"action": "optimized", "promoted": "var_a", "new_variant": "var_b", "stats": [...]}`

**Guardrails:**
- Winner must beat runner-up by >10% AND have >= min_sample_size before promoting
- One active experiment per form (create rejects if one already exists)
- Required fields cannot be removed by the optimizer
- Every optimization action logged with timestamp for audit trail

---

## Module 4: OBSERVE — Analytics + Agent Observability

### 4.1 Form Performance Dashboard

Business-facing metrics. Answers: "Are my forms working?"

#### KPI Cards (with period comparison)

| Metric | Description | Delta |
|--------|-------------|-------|
| Total Submissions | Count in period | vs previous period |
| Conversion Rate | processed/total | vs previous period |
| Contacts Created | New contacts from submissions | vs previous period |
| Revenue | Sum of deal values from submission-linked contacts | vs previous period |
| Deals Created | Count | — |
| Deals Won | Count where stage=won | — |
| Avg Response Time | Submission to first agent action | vs previous period |
| Spam Blocked | Count rejected by anti-spam | — |

**Period comparison:** User selects a date range (7d, 30d, 90d, custom). System computes the same-length period shifted back and calculates % deltas. E.g., "This week vs last week: submissions +12%, conversion rate -3%."

#### Funnel Visualization

Horizontal bar chart showing drop-off at each stage:

```
Submissions received:     340  ████████████████████████████████████  100%
Passed anti-spam:         312  ████████████████████████████████      92%
Contact created/matched:  308  ███████████████████████████████       91%
Successfully processed:   295  ██████████████████████████████        87%
Deal created:              42  █████                                 12%
Deal won:                  11  █                                      3%
```

Each drop-off is actionable:
- High spam rate → tighten anti-spam
- High processing failures → fix agent instructions
- Low submission-to-deal → improve qualification
- Low close rate → sales problem, not inbound

#### Channel Attribution

Table: UTM source → submissions, contacts, deals, revenue, conversion rate.

```
Source     | Submissions | Contacts | Deals | Revenue  | Conv%
-----------|-------------|----------|-------|----------|------
google     | 200         | 180      | 12    | $240K    | 6.0%
linkedin   | 40          | 38       | 8     | $320K    | 20.0%
direct     | 60          | 55       | 3     | $45K     | 5.0%
referral   | 15          | 14       | 4     | $120K    | 26.7%
```

This tells the user: "Google brings volume but LinkedIn brings value. Shift budget."

**Attribution model:** Last-touch by default (the UTM source on the submission that created the deal). First-touch available as toggle (the UTM source on the contact's earliest submission).

#### Multi-Touch Attribution

Each contact stores a `touchpoints` array (see contact data model in 2.3). This allows:

- **First-touch:** Which channel first brought this contact?
- **Last-touch:** Which channel converted them to a deal?
- **Full path:** All touchpoints in order, showing the journey

Display: For contacts with deals, show the touchpoint path:
```
Jane Smith → Deal: $100K
  Touch 1: Google Ads (pricing page) — Jan 15
  Touch 2: LinkedIn (whitepaper download) — Feb 3
  Touch 3: Direct (demo request) — Feb 10 ← deal created
```

#### Speed-to-Lead Distribution

Horizontal bar chart showing processing time distribution:

```
< 1 min:    ████████████████████  45%
1-5 min:    ██████████            22%
5-30 min:   ████████              18%
30m-1h:     ███                    7%
1-4h:       ██                     5%
4-24h:      █                      2%
> 24h:      ▏                      1%
```

Computed from `created_at` → `processed_at` timestamps on submissions.

#### Field-Level Interaction Analytics

The embed script tracks field interactions (focus, blur, fill) and sends them with the submission in `field_interactions`.

**Dashboard shows per field:**

| Field | Focused % | Filled % | Avg Time | Dropoff |
|-------|-----------|----------|----------|---------|
| first_name | 98% | 97% | 2.1s | 1% |
| email | 97% | 96% | 3.4s | 1% |
| company | 95% | 90% | 1.8s | 5% |
| team_size | 88% | 82% | 0.9s | 7% |
| budget | 78% | 45% | 0.5s | 42% |
| message | 42% | 30% | 0s | 29% |

This data powers the Optimization Assistant's suggestions: "budget_range has 42% dropoff — consider removing it or making it optional."

#### Form Comparison

Side-by-side table for multiple forms with the same purpose:

| Metric | Demo Request v1 | Demo Request v2 | Whitepaper Download |
|--------|----------------|----------------|-------------------|
| Submissions | 185 | 92 | 210 |
| Conversion % | 12% | 18% | 8% |
| Avg Speed | 8s | 6s | 2s |
| Contacts | 168 | 85 | 195 |

#### Sequence Health

Per nurture sequence:

| Sequence | Enrolled | Active | Completed | Stopped | Completion% |
|----------|----------|--------|-----------|---------|-------------|
| Whitepaper Follow-up | 195 | 42 | 120 | 33 | 61% |
| Demo Nurture | 85 | 28 | 40 | 17 | 47% |

#### Daily Volume

Simple bar chart (CSS bars, last 30 days) showing submission count per day with trend line.

### 4.2 Agent Observability Dashboard

Operational. Answers: "What is my agent doing right now?"

#### Live Status Board

Each agent handler shows:
- Current state: `idle` | `processing` | `waiting_approval` | `stuck` | `error`
- Last heartbeat timestamp
- Current submission being processed (if any)
- Visual flag if stuck (no heartbeat > configurable threshold)

#### Activity Stream (real-time via WebSocket)

Live feed of every event, filterable by form, agent, or submission.

| Event Type | Description |
|------------|-------------|
| `submission_received` | New submission arrived |
| `spam_blocked` | Rejected by anti-spam (with reason) |
| `contact_matched` | Linked to existing contact |
| `contact_created` | New contact record created |
| `handler_assigned` | Submission routed to handler |
| `agent_processing` | Agent is analyzing submission |
| `agent_action` | Agent took an action (with details) |
| `agent_draft` | Agent produced a draft (awaiting approval) |
| `agent_completed` | Agent finished processing |
| `agent_error` | Agent encountered an error |
| `agent_retry` | System retrying after error |
| `agent_escalated` | Escalated to human |
| `human_approved` | Human approved agent's draft |
| `human_rejected` | Human rejected agent's draft |
| `human_override` | Human took over from agent |
| `experiment_variant` | Submission tagged with A/B variant |
| `optimization_run` | Autopilot ran optimization cycle |

#### Processing Timeline (per submission)

Horizontal timeline for any individual submission:

```
received → spam_passed → contact_matched → handler_assigned →
agent_processing → action(qualify_lead) → action(send_email) →
action(create_deal) → completed [total: 12s]
```

With timestamps and duration between each step.

#### Agent Performance Metrics

| Metric | Description |
|--------|-------------|
| Avg handling time | Assignment to completion |
| Success rate | % completed without escalation or error |
| Escalation rate | % escalated to human |
| Error rate | % with errors |
| Recovery rate | % of errors self-recovered vs needed human |
| Actions per submission | Avg actions taken per submission |

### 4.3 Optimization Assistant

Analyzes form performance and produces suggestions. Two modes:

#### Mode 1: Suggestion Only (Default)

After configurable threshold (e.g., 50+ submissions), user can trigger analysis.

Claude receives:
- Field completion rates (from `field_interactions`)
- Outcome distribution
- Agent notes patterns
- Response times
- Common escalation reasons
- A/B experiment results (if any)

Returns plain-language suggestions:

```
┌─────────────────────────────────────────────────────┐
│  💡 Remove "Phone" field                             │
│  Only 23% fill it. Doesn't correlate with deals.    │
│  [Apply to Editor]  [Dismiss]                        │
├─────────────────────────────────────────────────────┤
│  💡 Add "Budget Range" dropdown                      │
│  60% of agent conversations ask about budget.        │
│  Pre-qualifying saves agent time.                    │
│  [Apply to Editor]  [Dismiss]                        │
├─────────────────────────────────────────────────────┤
│  💡 Create separate form for large groups            │
│  "Group Size: 10+" submissions convert 3x higher.    │
│  A targeted form could improve conversion further.   │
│  [Create Form]  [Dismiss]                            │
└─────────────────────────────────────────────────────┘
```

#### Mode 2: Agent Autopilot (Opt-in)

When enabled, the system periodically:
1. Analyzes performance
2. Creates A/B experiment with agent-generated challenger variant
3. Runs until min_sample_size reached
4. Promotes winner if improvement > 10%
5. Generates new challenger
6. Repeats

**Guardrails:**
- Winner must beat by >10% with sufficient sample
- Required fields never removed
- Every change logged in `optimization_log`
- Auto-rollback if performance drops >15% within 48h
- Human can pause/stop autopilot at any time

---

## Database Schema

```sql
-- Forms
CREATE TABLE forms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    status TEXT DEFAULT 'active',
    type TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    fields JSON NOT NULL,
    field_mapping JSON DEFAULT '{}',
    auto_config JSON DEFAULT '{}',
    agent_config JSON DEFAULT '{}',
    security_config JSON NOT NULL,
    response_config JSON DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Submissions
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id),
    form_type TEXT,
    flow_id TEXT,
    data JSON NOT NULL,
    meta JSON DEFAULT '{}',
    field_interactions JSON DEFAULT '{}',
    contact_id TEXT,
    company_id TEXT,
    is_new_contact BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'received',
    status_detail TEXT,
    outcome TEXT,
    routed_to_type TEXT,
    routed_to_id TEXT,
    handled_by TEXT,
    actions JSON DEFAULT '[]',
    agent_notes TEXT,
    created_entities JSON DEFAULT '{}',
    created_at TEXT NOT NULL,
    processed_at TEXT,
    processing_duration_ms INTEGER
);

-- Contacts
CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    company_id TEXT,
    status TEXT DEFAULT 'lead',
    source TEXT DEFAULT 'inbound_form',
    tags JSON DEFAULT '[]',
    custom_fields JSON DEFAULT '{}',
    touchpoints JSON DEFAULT '[]',
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    submission_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Contact Notes (append-only)
CREATE TABLE contact_notes (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    note TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Companies
CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT DEFAULT 'inbound_form',
    created_at TEXT NOT NULL
);

-- Deals
CREATE TABLE deals (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id),
    company_id TEXT REFERENCES companies(id),
    name TEXT NOT NULL,
    amount REAL DEFAULT 0,
    stage TEXT DEFAULT 'open',
    source TEXT DEFAULT 'inbound',
    source_submission_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Handler Groups
CREATE TABLE handler_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    routing_strategy TEXT NOT NULL,
    members JSON NOT NULL DEFAULT '[]',
    settings JSON DEFAULT '{}',
    last_assigned_index INTEGER DEFAULT 0,
    assignment_count JSON DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Campaigns
CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    type TEXT,
    inbound_form_ids JSON DEFAULT '[]',
    welcome_email_template_id TEXT,
    nurture_sequence_id TEXT,
    asset_url TEXT,
    asset_name TEXT,
    contact_tags JSON DEFAULT '[]',
    utm_campaign TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Nurture Sequences
CREATE TABLE sequences (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    stop_conditions JSON DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Sequence Steps
CREATE TABLE sequence_steps (
    id TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL REFERENCES sequences(id),
    "order" INTEGER NOT NULL,
    delay_days INTEGER DEFAULT 0,
    delay_hours INTEGER DEFAULT 0,
    send_time TEXT DEFAULT '09:00',
    email_subject TEXT NOT NULL,
    email_body TEXT NOT NULL,
    agent_personalize BOOLEAN DEFAULT FALSE,
    created_at TEXT NOT NULL
);

-- Sequence Enrollments
CREATE TABLE enrollments (
    id TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL REFERENCES sequences(id),
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    submission_id TEXT,
    campaign_id TEXT,
    current_step INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    stop_reason TEXT,
    enrolled_at TEXT NOT NULL,
    next_step_due_at TEXT,
    completed_at TEXT,
    history JSON DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- A/B Experiments
CREATE TABLE experiments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    form_id TEXT NOT NULL REFERENCES forms(id),
    status TEXT DEFAULT 'active',
    metric TEXT NOT NULL,
    min_sample_size INTEGER DEFAULT 30,
    variants JSON NOT NULL,
    winner_variant_id TEXT,
    optimization_log JSON DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Drafts (for draft/semi-autonomous modes)
CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    handler_id TEXT NOT NULL,
    planned_actions JSON NOT NULL,
    draft_content JSON NOT NULL,
    status TEXT DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL
);

-- Spam Log
CREATE TABLE spam_log (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL,
    ip_address TEXT,
    reason TEXT NOT NULL,
    submission_data JSON,
    created_at TEXT NOT NULL
);

-- Events (activity stream + observability)
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    submission_id TEXT,
    form_id TEXT,
    event_type TEXT NOT NULL,
    handler_id TEXT,
    details JSON,
    created_at TEXT NOT NULL
);

-- Error Log
CREATE TABLE errors (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    error_type TEXT NOT NULL,
    attempt INTEGER DEFAULT 1,
    recovery_action TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    escalated_to TEXT,
    details TEXT,
    created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_submissions_form ON submissions(form_id);
CREATE INDEX idx_submissions_contact ON submissions(contact_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_created ON submissions(created_at);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_events_submission ON events(submission_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_experiments_form ON experiments(form_id);
CREATE INDEX idx_enrollments_sequence ON enrollments(sequence_id);
CREATE INDEX idx_enrollments_status ON enrollments(status);
CREATE INDEX idx_enrollments_next ON enrollments(next_step_due_at);
CREATE INDEX idx_spam_form ON spam_log(form_id);
```

**Total: 15 tables**

---

## API Endpoints

### Public (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/submissions/{form_id}` | Submit a form |
| OPTIONS | `/api/submissions/{form_id}` | CORS preflight |
| GET | `/api/forms/{form_id}/schema` | Get form fields for rendering (+ A/B variant) |

### Form Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forms/generate` | NL typed request → Claude generates form |
| POST | `/api/forms` | Create form |
| GET | `/api/forms` | List forms |
| GET | `/api/forms/{id}` | Get form detail |
| PUT | `/api/forms/{id}` | Update form |
| DELETE | `/api/forms/{id}` | Archive form |
| GET | `/api/forms/{id}/embed` | Get embed code |

### Submissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/submissions` | List (filterable by form, status, date, contact) |
| GET | `/api/submissions/{id}` | Get detail + timeline |
| PUT | `/api/submissions/{id}` | Update (agent notes, status) |
| POST | `/api/submissions/{id}/reprocess` | Re-trigger flow |

### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/contacts` | List contacts |
| GET | `/api/contacts/{id}` | Get contact + full history |

### Deals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deals` | List deals |
| GET | `/api/deals/{id}` | Get deal detail |
| POST | `/api/deals` | Create deal (used by agents) |
| PUT | `/api/deals/{id}` | Update deal |

### Handler Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/handler-groups` | Create group |
| GET | `/api/handler-groups` | List groups |
| GET | `/api/handler-groups/{id}` | Get group |
| PUT | `/api/handler-groups/{id}` | Update group |
| DELETE | `/api/handler-groups/{id}` | Delete group |
| POST | `/api/handler-groups/{id}/members` | Add member |
| DELETE | `/api/handler-groups/{id}/members/{mid}` | Remove member |

### Campaigns

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns` | Create campaign |
| GET | `/api/campaigns` | List campaigns |
| GET | `/api/campaigns/{id}` | Get detail + analytics |
| PUT | `/api/campaigns/{id}` | Update campaign |
| DELETE | `/api/campaigns/{id}` | Archive campaign |
| GET | `/api/campaigns/{id}/contacts` | List enrolled contacts |
| POST | `/api/campaigns/{id}/contacts` | Add contact manually |

### Sequences

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sequences` | Create sequence |
| GET | `/api/sequences` | List sequences |
| GET | `/api/sequences/{id}` | Get detail + steps |
| PUT | `/api/sequences/{id}` | Update sequence |
| DELETE | `/api/sequences/{id}` | Delete sequence |
| POST | `/api/sequences/{id}/steps` | Add step |
| PUT | `/api/sequences/{id}/steps/{sid}` | Update step |
| DELETE | `/api/sequences/{id}/steps/{sid}` | Delete step |
| POST | `/api/sequences/{id}/enroll` | Enroll contact |
| GET | `/api/sequences/{id}/enrollments` | List enrollments |
| POST | `/api/enrollments/{id}/stop` | Stop enrollment |
| POST | `/api/enrollments/{id}/advance` | Skip to next step |
| POST | `/api/enrollments/{id}/pause` | Pause enrollment |
| POST | `/api/enrollments/{id}/resume` | Resume enrollment |

### Experiments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/experiments` | Create experiment |
| GET | `/api/experiments` | List experiments |
| GET | `/api/experiments/{id}` | Get detail + variant stats |
| PUT | `/api/experiments/{id}` | Update experiment |
| DELETE | `/api/experiments/{id}` | Complete/archive experiment |
| POST | `/api/experiments/{id}/optimize` | Run autopilot optimization |

### Drafts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/drafts` | List pending drafts |
| GET | `/api/drafts/{id}` | Get draft detail |
| POST | `/api/drafts/{id}/approve` | Approve and execute |
| POST | `/api/drafts/{id}/reject` | Reject with notes |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/overview` | System-wide KPIs |
| GET | `/api/analytics/forms/{id}` | Per-form performance |
| GET | `/api/analytics/funnel` | Funnel drop-off |
| GET | `/api/analytics/channels` | Channel attribution |
| GET | `/api/analytics/speed` | Speed-to-lead distribution |
| GET | `/api/analytics/fields/{form_id}` | Field-level interaction stats |
| GET | `/api/analytics/agents/{id}` | Agent performance |
| POST | `/api/analytics/forms/{id}/suggestions` | Trigger optimization analysis |
| GET | `/api/analytics/forms/{id}/suggestions` | Get current suggestions |

### Events + Observability

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events` | Query events (filterable) |
| WS | `/ws/events` | WebSocket stream of live events |

**Total: ~75 endpoints**

---

## Project Structure

```
formagent/
├── backend/
│   ├── main.py                        # FastAPI app, startup, scheduler
│   ├── config.py                      # Settings, env vars, API keys
│   ├── database.py                    # SQLite setup, table creation
│   ├── id_gen.py                      # ID generation (form_xxx, sub_xxx, etc.)
│   │
│   ├── api/
│   │   ├── forms.py                   # Form CRUD + NL generation
│   │   ├── submissions.py             # Public submit + submission management
│   │   ├── contacts.py                # Contact lookup + history
│   │   ├── deals.py                   # Deal CRUD
│   │   ├── handler_groups.py          # Group CRUD + member management
│   │   ├── campaigns.py               # Campaign CRUD + contacts
│   │   ├── sequences.py               # Sequence + step + enrollment management
│   │   ├── experiments.py             # Experiment CRUD + optimize
│   │   ├── drafts.py                  # Draft approval workflow
│   │   ├── analytics.py               # All analytics endpoints
│   │   ├── events.py                  # Event query + WebSocket
│   │   └── suggestions.py            # Optimization assistant
│   │
│   ├── services/
│   │   ├── flow_engine.py             # execute_flow() + all 6 flow implementations
│   │   ├── spam.py                    # Anti-spam pipeline (honeypot, rate, dup)
│   │   ├── contact_matcher.py         # Contact resolution + company matching
│   │   ├── router.py                  # Handler routing (4 strategies)
│   │   ├── agent_processor.py         # Agent prompt building + Claude API call
│   │   ├── action_executor.py         # Execute agent actions (email, deal, ticket, etc.)
│   │   ├── error_recovery.py          # Retry, backoff, escalation
│   │   ├── event_emitter.py           # Emit events to DB + WebSocket
│   │   ├── sequence_processor.py      # Background job: process due enrollment steps
│   │   ├── stale_cleanup.py           # Background job: fail stale submissions
│   │   └── attribution.py             # Touchpoint tracking, attribution computation
│   │
│   ├── llm/
│   │   ├── form_generator.py          # NL → form config prompt + parsing
│   │   ├── agent_prompts.py           # Agent system prompts per flow
│   │   ├── optimizer.py               # A/B optimization prompt + parsing
│   │   └── suggestion_engine.py       # Optimization assistant prompt + parsing
│   │
│   └── models/
│       ├── form.py                    # Pydantic models
│       ├── submission.py
│       ├── contact.py
│       ├── deal.py
│       ├── handler_group.py
│       ├── campaign.py
│       ├── sequence.py
│       ├── experiment.py
│       ├── draft.py
│       └── event.py
│
├── frontend/
│   ├── index.html                     # Dashboard shell
│   ├── css/
│   │   └── styles.css                 # All dashboard styling
│   ├── js/
│   │   ├── app.js                     # SPA router, tab switching
│   │   ├── form-builder.js            # Form creation + visual editor
│   │   ├── form-config.js             # Handler assignment + guardrails UI
│   │   ├── ai-builder.js              # NL form builder modal
│   │   ├── submissions.js             # Submission list + detail view
│   │   ├── contacts.js                # Contact list + detail
│   │   ├── groups.js                  # Handler group management
│   │   ├── campaigns.js               # Campaign management
│   │   ├── sequences.js               # Sequence management
│   │   ├── experiments.js             # Experiment tab + variant stats + autopilot
│   │   ├── drafts.js                  # Draft review queue
│   │   ├── dashboard-analytics.js     # Form performance dashboard
│   │   ├── dashboard-agents.js        # Agent observability dashboard
│   │   ├── timeline.js                # Per-submission processing timeline
│   │   ├── suggestions.js             # Optimization suggestions display
│   │   └── websocket.js               # WebSocket client for live events
│   └── embed/
│       └── embed.js                   # Embeddable form widget (with field tracking)
│
├── formagent.db                       # SQLite database (auto-created)
├── requirements.txt                   # Python dependencies
└── README.md
```

---

## Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Sequence step processor | Every 60s | Process due enrollment steps, send emails |
| Stale submission cleanup | Every 15 min | Fail submissions stuck in `processing` > 30 min |
| Experiment stats refresh | Every 5 min | Pre-compute variant stats for active experiments |

---

## Hackathon Demo Script (4 Minutes)

**0:00 — The Typed Request**
"I type: 'Build a lead capture form for an AI consulting firm targeting enterprise clients.' Claude generates a complete form: name, email, company, team size, budget range, message. It suggested sales_lead flow, semi-autonomous mode, and even wrote the agent instructions. All from one sentence."

**0:45 — Quick Config + Embed**
"I tweak the autonomy slider to fully autonomous. Enable qualify_lead, send_email, create_deal. One click — embed code ready. Paste it on my site — form is live."

**1:15 — First Submission**
"A visitor fills the form. Name: Jane Smith, Company: Acme Corp, Team Size: 51-200, Budget: $100K+. Watch the dashboard..."

**1:30 — Agent Works**
"Submission received... contact created... routed to agent via round-robin... agent processing... qualified as high-intent enterprise lead... sent personalized email... created $100K deal. All in 10 seconds. Full timeline visible."

**2:00 — Returning Contact**
"Same email, new submission. The agent recognizes Jane: 'Welcome back — we noted your interest from last week.' It updates the deal instead of creating a duplicate. That's stateful contact memory."

**2:20 — A/B Experiment**
"Now I create an experiment: control form vs a shorter 3-field variant. Traffic splits 50/50. After 30 submissions per variant, I hit 'Optimize.' The shorter form wins by 15%. The agent promotes it and generates a new challenger automatically."

**2:50 — Analytics**
"Here's the funnel: 340 submissions → 295 processed → 42 deals → 11 won. Channel attribution shows LinkedIn converts 3x better than Google despite fewer submissions. Speed-to-lead: 95% under 5 minutes. Field dropoff shows budget_range at 42% — the optimizer already suggested removing it."

**3:30 — The Vision**
"FormAgent: describe what you need. Get a form and the AI that runs it. The forms optimize themselves. The agents learn from every submission. This is what AI-native inbound looks like."

---

## Open Questions (Post-MVP)

1. **User auth / multi-tenant** — OAuth? API keys? Workspace isolation?
2. **Email deliverability** — DKIM/SPF via Resend/Postmark?
3. **Rate limits on Claude API** — Queue management for burst submissions?
4. **Embed customization** — CSS theming? White-labeling?
5. **Webhook integrations** — Push events to Slack, CRM, Zapier?
6. **Mobile form rendering** — Responsive embed? Native SDKs?
7. **Pricing model** — Per form? Per submission? Per agent-minute?
8. **Ad spend import** — Manual input? CSV upload? API integration?
