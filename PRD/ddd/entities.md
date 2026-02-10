# Entities

> Entities have identity that persists across state changes. Each uses a prefixed ID scheme for global uniqueness and human readability.

See also: [Aggregates](./aggregates.md) | [Value Objects](./value-objects.md) | [Repositories](./repositories.md)

---

## ID Scheme

All entity IDs follow the pattern `{prefix}_{random}` where `random` is a unique string (e.g., UUID or nanoid). The prefix makes IDs self-describing when encountered in logs, URLs, or debug output.

| Entity | Prefix | Example |
|--------|--------|---------|
| Account | `acct_` | `acct_a1b2c3d4` |
| Workspace | `ws_` | `ws_x7y8z9` |
| WorkspaceMembership | `wm_` | `wm_m1n2o3` |
| ApiKey | `key_` | `key_k4l5m6` |
| Session | `sess_` | `sess_s1t2u3` |
| Form | `form_` | `form_f1g2h3` |
| Submission | `sub_` | `sub_j4k5l6` |
| Contact | `contact_` | `contact_c7d8e9` |
| ContactNote | `note_` | `note_n1o2p3` |
| Company | `company_` | `company_q4r5s6` |
| Deal | `deal_` | `deal_d1e2f3` |
| HandlerGroup | `group_` | `group_g7h8i9` |
| Campaign | `camp_` | `camp_a1b2c3` |
| Sequence | `seq_` | `seq_s4t5u6` |
| SequenceStep | `step_` | `step_v7w8x9` |
| Enrollment | `enroll_` | `enroll_e1f2g3` |
| Experiment | `exp_` | `exp_h4i5j6` |
| Draft | `draft_` | `draft_k7l8m9` |
| Event | `evt_` | `evt_n1o2p3` |
| Error | `err_` | `err_q4r5s6` |
| SpamLogEntry | `spam_` | `spam_t7u8v9` |

---

## Identity & Access Entities

### Account

The person who uses FormAgent. Owns workspaces and holds memberships.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `acct_xxx` | Primary identity |
| `email` | string | Globally unique |
| `name` | string | Display name |
| `password_hash` | string | bcrypt hash (never exposed) |
| `status` | enum | `active`, `inactive` |
| `created_at` | ISO timestamp | Registration time |
| `last_login_at` | ISO timestamp | Last successful login |

### Workspace

The tenant boundary. All domain data is scoped to a workspace.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `ws_xxx` | Primary identity |
| `name` | string | Display name |
| `slug` | string | URL-safe, globally unique |
| `owner_account_id` | `acct_xxx` | The account that created this workspace |
| `settings` | JSON | `{ default_timezone, default_from_email }` |
| `status` | enum | `active`, `suspended` |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

### WorkspaceMembership

Links an account to a workspace with a role.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `wm_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Parent workspace |
| `account_id` | `acct_xxx` | The member |
| `role` | enum | `owner`, `admin`, `member`, `viewer` |
| `status` | enum | `active`, `pending` (invited but not yet joined) |
| `invited_by` | `acct_xxx` | Who sent the invitation |
| `joined_at` | ISO timestamp | |

### Session

Tracks active JWT sessions for server-side revocation.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `sess_xxx` | Primary identity |
| `account_id` | `acct_xxx` | Session owner |
| `workspace_id` | `ws_xxx` | Active workspace |
| `token_hash` | string | SHA-256 of the JWT (for lookup) |
| `ip_address` | string | Client IP at creation |
| `user_agent` | string | Client user-agent |
| `expires_at` | ISO timestamp | JWT expiry |
| `created_at` | ISO timestamp | |

### ApiKey

Programmatic access credential for a workspace.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `key_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Scoped workspace |
| `account_id` | `acct_xxx` | Key creator |
| `name` | string | Human label (e.g., "Production API Key") |
| `key_hash` | string | SHA-256 of the full key |
| `key_prefix` | string | First 12 chars for display (e.g., `fa_live_abc1`) |
| `permissions` | JSON array | `["forms:read", "forms:write", "submissions:read"]` |
| `last_used_at` | ISO timestamp | |
| `expires_at` | ISO timestamp | Nullable (no expiry) |
| `status` | enum | `active`, `revoked` |
| `created_at` | ISO timestamp | |

---

## Form Management Entities

### Form

The central configuration object: fields, flow, handler, agent config, security.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `form_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | Display name |
| `slug` | string | URL-safe, unique per workspace |
| `description` | string | Purpose description |
| `status` | enum | `active`, `paused`, `archived` |
| `type` | enum | `marketing`, `sales`, `support`, `general` |
| `flow_id` | FlowId enum | Processing flow to execute |
| `entity` | enum | `agent`, `human`, `handler_group` |
| `entity_id` | string | ID of the assigned handler entity |
| `fields` | FormField[] | JSON array of field definitions |
| `field_mapping` | JSON | Maps field names to CRM paths |
| `auto_config` | AutoConfig | Deterministic processing settings |
| `agent_config` | AgentConfig | Agent instructions and guardrails |
| `security_config` | SecurityConfig | Anti-spam and CORS settings |
| `response_config` | ResponseConfig | Post-submission behavior |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

---

## Inbound Processing Entities

### Submission

A single form submission with its full processing history.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `sub_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Denormalized from form |
| `form_id` | `form_xxx` | Source form |
| `form_type` | string | Denormalized form type |
| `flow_id` | string | Denormalized flow |
| `data` | JSON | Raw field values |
| `meta` | SubmissionMeta | IP, user-agent, UTMs, referrer |
| `field_interactions` | JSON map | Per-field interaction tracking |
| `contact_id` | `contact_xxx` | Resolved contact (nullable until matched) |
| `company_id` | `company_xxx` | Resolved company (nullable) |
| `is_new_contact` | boolean | Whether a new contact was created |
| `status` | enum | See state machine in [aggregates](./aggregates.md) |
| `status_detail` | string | Human-readable status detail |
| `outcome` | string | Result (e.g., "qualified", "escalated") |
| `routed_to_type` | enum | `handler_group`, `agent`, `human` |
| `routed_to_id` | string | ID of routed-to entity |
| `handled_by` | string | ID of the member who actually processed |
| `actions` | AgentAction[] | Ordered list of processing steps |
| `agent_notes` | string | Agent's summary notes |
| `created_entities` | JSON | `{ deal_id, task_id, ticket_id }` |
| `created_at` | ISO timestamp | |
| `processed_at` | ISO timestamp | |
| `processing_duration_ms` | integer | Computed on completion |

### SpamLogEntry

Records rejected submissions for audit.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `spam_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `form_id` | `form_xxx` | Target form |
| `ip_address` | string | Submitter IP |
| `reason` | string | `honeypot`, `ip_rate_limit`, `email_rate_limit`, `duplicate` |
| `submission_data` | JSON | The rejected payload |
| `created_at` | ISO timestamp | |

---

## Contact & CRM Entities

### Contact

A person who has submitted one or more forms. The system's memory.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `contact_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `email` | string | Unique per workspace |
| `name` | string | |
| `phone` | string | |
| `company_id` | `company_xxx` | Linked company |
| `status` | enum | `lead`, `qualified`, `customer`, `unsubscribed` |
| `source` | string | `inbound_form` (default) |
| `tags` | JSON array | Freeform tags |
| `custom_fields` | JSON map | Arbitrary key-value pairs |
| `touchpoints` | Touchpoint[] | Attribution chain |
| `first_seen` | ISO timestamp | First submission time |
| `last_seen` | ISO timestamp | Most recent submission |
| `submission_count` | integer | Total submissions |
| `created_at` | ISO timestamp | |

### ContactNote

Append-only notes on a contact (from agents or humans).

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `note_xxx` | Primary identity |
| `contact_id` | `contact_xxx` | Parent contact |
| `note` | string | Free-text note |
| `source` | string | `agent`, `human`, `system` |
| `created_at` | ISO timestamp | |

### Company

An organization resolved from submission data.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `company_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | Company name |
| `source` | string | `inbound_form` (default) |
| `created_at` | ISO timestamp | |

### Deal

A revenue opportunity linked to a contact and/or company.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `deal_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `contact_id` | `contact_xxx` | Primary contact |
| `company_id` | `company_xxx` | Associated company |
| `name` | string | Deal title |
| `amount` | float | Dollar value |
| `stage` | enum | `open`, `won`, `lost` |
| `source` | string | `inbound` (default) |
| `source_submission_id` | `sub_xxx` | The submission that created this deal |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

---

## Routing Entities

### HandlerGroup

A team of handlers with a routing strategy.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `group_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | Group name |
| `description` | string | |
| `routing_strategy` | RoutingStrategy enum | `principal`, `round_robin`, `least_loaded`, `broadcast` |
| `members` | GroupMember[] | JSON array of typed members |
| `settings` | JSON | `{ fallback_handler_id, auto_assign_tasks, notify_on_assignment }` |
| `last_assigned_index` | integer | Round-robin state |
| `assignment_count` | JSON map | Per-member count for least-loaded |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

---

## Marketing Automation Entities

### Campaign

A marketing container linking forms, sequences, and tags.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `camp_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | |
| `description` | string | |
| `status` | enum | `active`, `paused`, `completed`, `archived` |
| `type` | string | `lead_gen`, etc. |
| `inbound_form_ids` | JSON array | Linked form IDs |
| `welcome_email_template_id` | string | Template for welcome email |
| `nurture_sequence_id` | `seq_xxx` | Auto-enroll sequence |
| `asset_url` | string | Downloadable asset link |
| `asset_name` | string | Asset display name |
| `contact_tags` | JSON array | Tags applied to enrolled contacts |
| `utm_campaign` | string | UTM value for attribution |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

### Sequence

A timed email drip sequence.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `seq_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | |
| `description` | string | |
| `status` | enum | `active`, `paused`, `archived` |
| `stop_conditions` | JSON array | Conditions that halt enrollment |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

### SequenceStep

A single step in a sequence (child entity of Sequence).

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `step_xxx` | Primary identity |
| `sequence_id` | `seq_xxx` | Parent sequence |
| `order` | integer | Position in sequence (1-based) |
| `delay_days` | integer | Days to wait after previous step |
| `delay_hours` | integer | Additional hours to wait |
| `send_time` | string | Time of day to send (e.g., "09:00") |
| `email_subject` | string | Subject with variable placeholders |
| `email_body` | string | Body with `{{first_name}}` etc. |
| `agent_personalize` | boolean | Whether agent should personalize this step |
| `created_at` | ISO timestamp | |

### Enrollment

Tracks a contact's progression through a sequence.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `enroll_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `sequence_id` | `seq_xxx` | The sequence |
| `contact_id` | `contact_xxx` | The enrolled contact |
| `submission_id` | `sub_xxx` | Triggering submission |
| `campaign_id` | `camp_xxx` | Originating campaign (nullable) |
| `current_step` | integer | Current step number |
| `status` | enum | `active`, `paused`, `completed`, `stopped` |
| `stop_reason` | string | Why stopped (if applicable) |
| `enrolled_at` | ISO timestamp | |
| `next_step_due_at` | ISO timestamp | When next step fires |
| `completed_at` | ISO timestamp | |
| `history` | JSON array | Per-step execution records |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

---

## Experimentation Entities

### Experiment

An A/B test on a form with variants and optimization log.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `exp_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `name` | string | |
| `form_id` | `form_xxx` | Target form |
| `status` | enum | `draft`, `active`, `completed`, `archived` |
| `metric` | string | `conversion_rate`, `contacts`, `deals`, `revenue` |
| `min_sample_size` | integer | Per-variant minimum (default 30) |
| `variants` | Variant[] | JSON array of variant definitions |
| `winner_variant_id` | string | Declared winner (nullable) |
| `optimization_log` | JSON array | Audit trail of optimization actions |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

---

## Agent Execution Entities

### Draft

An agent's proposed actions awaiting human review.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `draft_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `submission_id` | `sub_xxx` | Related submission |
| `handler_id` | string | The agent that created the draft |
| `planned_actions` | JSON | Actions the agent wants to take |
| `draft_content` | JSON | Drafted emails, notes, etc. |
| `status` | enum | `pending`, `approved`, `rejected` |
| `reviewed_by` | string | Who reviewed |
| `reviewed_at` | ISO timestamp | |
| `created_at` | ISO timestamp | |

### Error

Records processing errors for recovery tracking.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `err_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `submission_id` | `sub_xxx` | Related submission |
| `error_type` | string | `llm_timeout`, `llm_parse_error`, `action_failed`, `disallowed_action` |
| `attempt` | integer | Retry attempt number |
| `recovery_action` | string | What recovery was attempted |
| `resolved` | boolean | Whether error was resolved |
| `escalated_to` | string | Handler escalated to (if applicable) |
| `details` | string | Error details / stack trace |
| `created_at` | ISO timestamp | |

---

## Observability Entities

### Event

An activity stream entry emitted by any context.

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | `evt_xxx` | Primary identity |
| `workspace_id` | `ws_xxx` | Tenant scope |
| `submission_id` | `sub_xxx` | Related submission (nullable) |
| `form_id` | `form_xxx` | Related form (nullable) |
| `event_type` | string | One of the defined event types |
| `handler_id` | string | Related handler (nullable) |
| `details` | JSON | Event-specific payload |
| `created_at` | ISO timestamp | |
