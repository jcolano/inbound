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
