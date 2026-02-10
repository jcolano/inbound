# FormAgent -- SPARC Specification

> Cross-references: [Domain Model](../ddd/domain-model.md)

---

## 1. Module 0: Auth + Multi-Tenancy

### 1.1 Accounts

| Criterion | Requirement |
|-----------|-------------|
| ACC-01 | Signup creates an account, workspace, and owner membership atomically |
| ACC-02 | Email must be globally unique across all accounts |
| ACC-03 | Password hashed with bcrypt; minimum 8 characters |
| ACC-04 | Account statuses: `active`, `suspended` |
| ACC-05 | `last_login_at` updated on every successful login |

### 1.2 Workspaces

| Criterion | Requirement |
|-----------|-------------|
| WS-01 | Slug is globally unique, auto-generated from name (lowercase, hyphenated) |
| WS-02 | Every workspace has exactly one `owner` membership at creation |
| WS-03 | Settings JSON stores `default_timezone` and `default_from_email` |
| WS-04 | Workspace statuses: `active`, `suspended` |

### 1.3 Memberships + RBAC

| Role | Create/Edit Data | Manage Members | Workspace Settings | Delete Workspace |
|------|-----------------|----------------|-------------------|-----------------|
| `owner` | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | No |
| `member` | Yes | No | No | No |
| `viewer` | Read-only | No | No | No |

| Criterion | Requirement |
|-----------|-------------|
| RBAC-01 | Membership unique constraint: `(workspace_id, account_id)` |
| RBAC-02 | Pending invites auto-activate when the invited email signs up |
| RBAC-03 | Only `owner` or `admin` can invite members |
| RBAC-04 | Pending invites expire after 7 days |

### 1.4 JWT Tokens

| Criterion | Requirement |
|-----------|-------------|
| JWT-01 | Payload: `sub` (account_id), `workspace_id`, `role`, `iat`, `exp` |
| JWT-02 | Algorithm: HS256, signed with server-side secret |
| JWT-03 | Default expiry: 24 hours |
| JWT-04 | Session record created on every token issue for server-side revocation |

### 1.5 API Keys

| Criterion | Requirement |
|-----------|-------------|
| KEY-01 | Format: `fa_live_{32_random}` or `fa_test_{32_random}` |
| KEY-02 | Stored as SHA-256 hash; full key shown only once at creation |
| KEY-03 | Scoped permissions array (e.g. `forms:read`, `submissions:read`) |
| KEY-04 | Optional expiry; `last_used_at` updated on each use |
| KEY-05 | Revocation sets `status = revoked`; immediate effect |

### 1.6 Workspace Isolation Middleware

| Criterion | Requirement |
|-----------|-------------|
| ISO-01 | `get_current_context()` runs on every authenticated endpoint |
| ISO-02 | Detects auth method by prefix: `fa_` = API key, else JWT |
| ISO-03 | Returns `AuthContext(account_id, workspace_id, role)` |
| ISO-04 | Every DB query includes `WHERE workspace_id = ?` -- no exceptions |
| ISO-05 | Public endpoints (`/api/submissions/{form_id}`, `/api/forms/{form_id}/schema`) derive `workspace_id` from form lookup |

---

## 2. Module 1: BUILD

### 2.1 NL Form Generation

| Criterion | Requirement |
|-----------|-------------|
| NLG-01 | Input: plain text prompt; Output: complete form JSON config |
| NLG-02 | Claude returns: name, slug, type, flow_id, fields, agent config, security defaults |
| NLG-03 | Result is a draft -- not persisted until user saves |
| NLG-04 | Supports iterative refinement via follow-up prompts |

### 2.2 Form Data Validation Rules

| Field Type | Validation |
|------------|-----------|
| `text` | min/max length, optional regex |
| `email` | RFC 5322 format |
| `phone` | E.164 or common national formats |
| `number` | min/max value |
| `select` | Value must be in `options` array |
| `multiselect` | All values must be in `options` array |
| `textarea` | max length (default 5000) |
| `checkbox` | Boolean |
| `hidden` | No client validation (used for honeypot) |
| `date` | ISO 8601 date |
| `url` | Valid URL format |

### 2.3 Handler Assignment

| Criterion | Requirement |
|-----------|-------------|
| HND-01 | Entity types: `agent`, `human`, `handler_group` |
| HND-02 | Autonomy levels: `notify_only`, `draft`, `semi_autonomous`, `fully_autonomous` |
| HND-03 | Allowed actions validated against: `qualify_lead`, `send_email`, `create_deal`, `create_ticket`, `book_meeting`, `enroll_sequence`, `escalate`, `respond_direct` |
| HND-04 | Agent cannot execute actions not in `allowed_actions`; violations logged |

### 2.4 Handler Groups

| Criterion | Requirement |
|-----------|-------------|
| GRP-01 | Routing strategies: `principal`, `round_robin`, `least_loaded`, `broadcast` |
| GRP-02 | `principal` -- always routes to member with `role: principal`; fallback if inactive |
| GRP-03 | `round_robin` -- `last_assigned_index` persisted; skips inactive members |
| GRP-04 | `least_loaded` -- `assignment_count` per member persisted |
| GRP-05 | `broadcast` -- all active members notified; first to claim handles |
| GRP-06 | If all members inactive, fall back to `settings.fallback_handler_id` |
| GRP-07 | If no fallback, submission stays `status: received` in unassigned queue |

### 2.5 Embed Code

| Criterion | Requirement |
|-----------|-------------|
| EMB-01 | Output: HTML div + script tag with `data-form-id` |
| EMB-02 | `embed.js` fetches schema, builds form, handles submit |
| EMB-03 | Hidden honeypot field injected automatically |
| EMB-04 | UTM params and referrer captured from host page |
| EMB-05 | Field interactions (focus, blur, fill, time_ms) tracked per field |
| EMB-06 | CORS: `Access-Control-Allow-Origin` from `security.allowed_origins` or `*` |

---

## 3. Module 2: CAPTURE + PROCESS

### 3.1 Submission State Machine

```
received --> processing --> processed
                       \-> failed
                       \-> needs_human_review
received --> spam_rejected
```

| Status | Meaning |
|--------|---------|
| `received` | Stored, awaiting flow execution |
| `processing` | Flow engine actively working |
| `processed` | Flow completed successfully |
| `failed` | All retries exhausted |
| `needs_human_review` | Escalated; awaiting human |
| `spam_rejected` | Blocked by anti-spam |

### 3.2 11-Step Submission Pipeline (Acceptance Criteria)

| Step | Criterion ID | Acceptance |
|------|-------------|------------|
| 1. Form lookup | SUB-01 | 404 if form not found or inactive |
| 2. CORS check | SUB-02 | Reject if origin not in `allowed_origins` (unless empty = allow all) |
| 3. Parse body | SUB-03 | Separate `_meta`, `_hp`, `_experiment_*` from field data |
| 4. Field validate | SUB-04 | Return 422 with per-field errors for type/required/length violations |
| 5. Anti-spam | SUB-05 | Honeypot: 200 silent. IP rate: 429. Email rate: 429. Dup: 422 |
| 6. Store | SUB-06 | Insert submission with `status: received` |
| 7. A/B tag | SUB-07 | Copy `experiment_id` + `variant_id` from meta if present |
| 8. Contact match | SUB-08 | Match by email or create; never overwrite existing fields |
| 9. Company match | SUB-09 | Match by name or create; link to contact |
| 10. Attribution | SUB-10 | Append touchpoint to contact's `touchpoints` array |
| 11. Execute flow | SUB-11 | Dispatch to the correct flow based on `form.flow_id` |

### 3.3 Anti-Spam Pipeline

| Check | Threshold (defaults) | Rejection |
|-------|---------------------|-----------|
| Honeypot | `_hp` field non-empty | HTTP 200 (silent) |
| IP rate | `max_submissions_per_ip` per hour (default 10) | HTTP 429 |
| Email rate | `max_submissions_per_email` per hour (default 5) | HTTP 429 |
| Duplicate | Same email + form within `duplicate_window_minutes` (default 5) | HTTP 422 |

All rejections logged to `spam_log` with reason, IP, and timestamp.

### 3.4 Processing Flows

| Flow ID | Mode | Agent Involved | Creates |
|---------|------|---------------|---------|
| `email_marketing` | Deterministic | No | Contact, activity, campaign enrollment |
| `sales_lead` | Agent-guided | Yes | Contact, activity, deal |
| `support_triage` | Agent-guided | Yes | Contact, ticket |
| `booking_request` | Deterministic | No | Contact, activity |
| `direct_route` | Deterministic | No | Contact, task |
| `notify_only` | Deterministic | No | Nothing |

### 3.5 Enrollment State Machine

```
active --> completed  (all steps sent)
active --> stopped    (stop condition met)
active --> paused     (manual pause)
paused --> active     (manual resume)
```

| Enrollment Status | Meaning |
|-------------------|---------|
| `active` | Processing; `next_step_due_at` scheduled |
| `completed` | All steps sent |
| `stopped` | Stop condition triggered: `contact_replied`, `deal_created`, `manual_stop`, `contact_unsubscribed` |
| `paused` | Manually paused by user |

### 3.6 Draft State Machine

```
pending --> approved --> executed
pending --> rejected
```

| Draft Status | Meaning |
|-------------|---------|
| `pending` | Agent produced plan; awaiting human review |
| `approved` | Human approved; actions executed |
| `rejected` | Human rejected; no actions taken |

---

## 4. Module 3: EXPERIMENTS

### 4.1 Experiment State Machine

```
active --> completed  (winner declared or manual stop)
active --> paused     (manual)
paused --> active     (manual)
```

### 4.2 Acceptance Criteria

| Criterion | Requirement |
|-----------|-------------|
| EXP-01 | One active experiment per form; create rejects if one already exists |
| EXP-02 | Traffic split: weighted random based on variant `weight` values |
| EXP-03 | Variant `overrides` is a partial config; `null` = control (use base form) |
| EXP-04 | Stats computed: submissions, processed, contacts, deals, revenue, conversion rate |
| EXP-05 | Optimization requires all variants >= `min_sample_size` |
| EXP-06 | Winner must beat runner-up by >10% to be promoted |
| EXP-07 | Required fields cannot be removed by optimizer |
| EXP-08 | Every optimization action logged with timestamp in `optimization_log` |

---

## 5. Module 4: OBSERVE

### 5.1 KPI Dashboard

| Metric | Computation |
|--------|-------------|
| Total Submissions | `COUNT(submissions) WHERE created_at IN period` |
| Conversion Rate | `processed / total` |
| Contacts Created | `COUNT(submissions) WHERE is_new_contact = true` |
| Revenue | `SUM(deals.amount) WHERE source_submission_id IN period submissions` |
| Avg Response Time | `AVG(processing_duration_ms)` |
| Spam Blocked | `COUNT(spam_log) WHERE created_at IN period` |

Period comparison: same-length window shifted back; delta shown as percentage.

### 5.2 WebSocket Events

| Event Type | Payload |
|------------|---------|
| `submission_received` | `{submission_id, form_id}` |
| `spam_blocked` | `{form_id, reason}` |
| `contact_matched` / `contact_created` | `{contact_id, submission_id}` |
| `handler_assigned` | `{submission_id, handler_id, handler_type}` |
| `agent_processing` / `agent_action` / `agent_completed` | `{submission_id, action, details}` |
| `agent_error` / `agent_retry` / `agent_escalated` | `{submission_id, error, attempt}` |
| `agent_draft` | `{draft_id, submission_id}` |
| `human_approved` / `human_rejected` / `human_override` | `{draft_id, reviewer}` |
| `experiment_variant` | `{experiment_id, variant_id, submission_id}` |
| `optimization_run` | `{experiment_id, action, details}` |

### 5.3 API Contract Summaries

#### POST /api/auth/signup

```
Request:  { email: string, password: string, name: string, workspace_name: string }
Response: { token: string, account: Account, workspace: Workspace }
Errors:   409 email exists | 422 validation failed
```

#### POST /api/submissions/{form_id}

```
Request:  { [field_name]: value, _hp: string, _meta: {...}, _experiment_id: string?, _variant_id: string? }
Response: { submission_id: string, message: string, redirect_url: string? }
Errors:   404 form not found | 422 validation | 429 rate limit
```

#### POST /api/forms/generate

```
Request:  { prompt: string, conversation_id?: string }
Response: { form_config: FormConfig, conversation_id: string }
```

#### GET /api/analytics/overview

```
Request:  ?period=7d|30d|90d|custom&start=ISO&end=ISO
Response: { kpis: { submissions: {value, delta}, conversion_rate: {value, delta}, ... }, period: {...} }
```

#### POST /api/experiments/{id}/optimize

```
Response (waiting): { action: "waiting", message: string, variant_progress: [...] }
Response (optimized): { action: "optimized", promoted: string, new_variant: string, stats: [...] }
Response (no_winner): { action: "no_clear_winner", message: string, stats: [...] }
```
