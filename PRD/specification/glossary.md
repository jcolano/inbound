# Glossary of Domain Terms

> Derived from [Inbound-Product-Definition.md](../../Inbound-Product-Definition.md).
> Cross-references: [requirements.md](./requirements.md) | [non-functional.md](./non-functional.md) | [edge-cases.md](./edge-cases.md) | [constraints.md](./constraints.md)

---

## Auth and Tenancy

### Account
A person who uses FormAgent. Identified by a globally unique email address and authenticated with a password (bcrypt-hashed). One account can own multiple workspaces and be a member of others. Stored in the `accounts` table. ID prefix: `acct_`.

### Workspace
A tenant boundary. All business data (forms, submissions, contacts, deals, campaigns, experiments, events) is scoped to a workspace. Workspaces are fully isolated from each other. Stored in the `workspaces` table. ID prefix: `ws_`.

### Membership
The relationship between an account and a workspace, including the account's role within that workspace. A single account can have memberships in multiple workspaces with different roles. Stored in the `workspace_memberships` table. ID prefix: `wm_`.

### Role
The permission level assigned to a membership. Four roles exist:
- **Owner** -- Full access including workspace deletion and member management.
- **Admin** -- Full data access and member management, but cannot delete the workspace.
- **Member** -- Full access to forms, submissions, contacts, and analytics. Cannot manage members or workspace settings.
- **Viewer** -- Read-only access to dashboards and analytics.

### JWT (JSON Web Token)
The authentication token issued on login or signup. Contains `sub` (account_id), `workspace_id`, `role`, `iat` (issued at), and `exp` (expiry). Signed with HS256. Expires in 24 hours. Stored client-side; validated server-side against a session record.

### Session
A server-side record tracking an active JWT. Enables token revocation before natural expiry. Stores `token_hash`, `ip_address`, `user_agent`, and `expires_at`. Stored in the `sessions` table.

### API Key
A programmatic authentication credential scoped to a workspace with granular permissions. The full key is displayed once at creation, then only the SHA-256 hash and a short prefix are stored. Format: `fa_live_{32_chars}` (production) or `fa_test_{32_chars}` (test). Stored in the `api_keys` table. ID prefix: `key_`.

### Auth Context
The result of authentication middleware. Contains `account_id`, `workspace_id`, and `role`. Injected into every authenticated endpoint as a FastAPI dependency. Ensures all queries are workspace-scoped.

---

## Forms and Submissions

### Form
A configuration object that defines what data to collect, how to process it, and who handles the result. Contains field definitions, processing flow selection, handler assignment, agent configuration, security settings, and response config. Stored in the `forms` table. ID prefix: `form_`.

### Field
A single input element within a form. Defined by type (text, email, phone, number, select, multiselect, textarea, checkbox, hidden, date, url), label, placeholder, validation rules, and required flag. Stored as JSON within the form's `fields` column.

### Field Mapping
A configuration that maps form field names to contact/company properties. Example: `"email" -> "contact.email"`, `"company_name" -> "company.name"`. Stored in the form's `field_mapping` column.

### Submission
A single completed form entry from an external website visitor. Contains the submitted data, metadata (IP, user agent, UTM params, referrer), field interaction tracking, processing status, routing info, agent actions, and outcomes. Stored in the `submissions` table. ID prefix: `sub_`.

### Field Interactions
Client-side tracking data collected by the embed script for each form field: whether the user focused on the field, whether they filled it, and how long they spent on it (in milliseconds). Stored in the submission's `field_interactions` column. Used for field-level analytics and optimization suggestions.

### Submission Status
The lifecycle state of a submission. Values:
- **received** -- Stored but not yet processed.
- **processing** -- Currently being handled by a flow or agent.
- **processed** -- Successfully completed.
- **needs_human_review** -- Agent processing failed; awaiting human intervention.
- **failed** -- Processing failed and was not recovered.

---

## Contacts and Companies

### Contact
A person identified by their email address within a workspace. Created or matched on every submission (except notify_only flow). Stores name, phone, company link, status, tags, custom fields, and a touchpoints array. Contacts are workspace-scoped: the same email can exist independently in different workspaces. Stored in the `contacts` table. ID prefix: `contact_`.

### Contact Memory
The system's ability to recognize returning contacts by email, link new submissions to their history, and provide the full context to the agent. This includes all past submissions, touchpoints, tags, notes, and company information.

### Company
An organization record linked to one or more contacts. Created from the `company_name` field in submissions. Matching is by exact name within the workspace. Stored in the `companies` table. ID prefix: `company_`.

### Deal
A revenue opportunity linked to a contact and optionally a company. Created by agents (via the `create_deal` action) or manually. Tracks amount, stage (open/won/lost), and source submission. Stored in the `deals` table. ID prefix: `deal_`.

### Touchpoint
A single interaction in a contact's history. Records which form was submitted, the UTM parameters, referrer, page URL, and timestamp. Appended to the contact's `touchpoints` JSON array on every submission. Used for attribution analysis.

---

## Handlers and Routing

### Handler
An entity that processes submissions. Can be an agent (AI), a human, or a handler group. The form's `entity` and `entity_id` fields specify which handler receives submissions.

### Handler Group
A reusable team definition containing multiple handlers (agents and/or humans) with a routing strategy. Submissions are distributed to group members based on the selected strategy. Stored in the `handler_groups` table. ID prefix: `group_`.

### Routing Strategy
The algorithm a handler group uses to distribute submissions among its members. Four strategies:
- **Principal** -- Always routes to the designated principal member.
- **Round Robin** -- Rotates through active members sequentially.
- **Least Loaded** -- Routes to the member with the fewest assignments.
- **Broadcast** -- Notifies all members; first to claim handles it.

### Fallback Handler
The handler designated to receive submissions when the primary routing fails (all group members inactive, group empty, or no handler available). Configured via `settings.fallback_handler_id` on handler groups.

---

## Agent System

### Agent
An AI handler powered by Claude that processes submissions autonomously or semi-autonomously. Receives a structured prompt with form context, submission data, contact history, allowed actions, and autonomy instructions. Returns a JSON action plan.

### Autonomy Level
The degree of independence granted to an agent. Four levels:
- **notify_only** -- Agent analyzes and summarizes but takes no actions.
- **draft** -- Agent prepares actions and drafts for human approval.
- **semi_autonomous** -- Agent executes actions immediately; human can review within a time window.
- **fully_autonomous** -- Agent handles end-to-end; human sees activity log only.

### Allowed Actions
The set of actions an agent is permitted to take. Each action can be individually enabled or disabled per form. Eight possible actions: qualify_lead, send_email, create_deal, create_ticket, book_meeting, enroll_sequence, escalate, respond_direct. Any attempt to execute a disabled action is blocked and logged.

### Draft
A pending set of agent-proposed actions awaiting human approval. Created when the autonomy level is `draft`. Contains the planned actions and generated content (e.g., email drafts). A human reviews and either approves (triggering execution) or rejects (with notes). Stored in the `drafts` table.

### Escalation
The action of transferring a submission from agent processing to human handling. Occurs when the agent explicitly chooses to escalate, when errors exhaust all retries, or when the agent attempts disallowed actions.

---

## Campaigns and Sequences

### Campaign
A marketing container that ties together forms, nurture sequences, welcome emails, and analytics tracking. Contacts entering through campaign-linked forms are tagged and optionally enrolled in a nurture sequence. Stored in the `campaigns` table. ID prefix: `camp_`.

### Sequence
A timed series of email steps sent to enrolled contacts. Each step has a delay (days/hours), a send time, and email content with variable substitution. Sequences have stop conditions that can halt delivery mid-sequence. Stored in the `sequences` table. ID prefix: `seq_`.

### Sequence Step
A single email within a sequence. Defines the delay before sending, the preferred send time, the email subject and body (with template variables like `{{first_name}}`), and whether the agent should personalize the content. Stored in the `sequence_steps` table. ID prefix: `step_`.

### Enrollment
A contact's active participation in a sequence. Tracks which step they are on, their status (active, completed, stopped), the next step due time, and a history of all steps sent. One contact can be enrolled in multiple different sequences. Stored in the `enrollments` table. ID prefix: `enroll_`.

### Stop Condition
A rule that halts a sequence enrollment before all steps are sent. Defined per sequence. Four conditions: `contact_replied`, `deal_created`, `manual_stop`, `contact_unsubscribed`. Checked before each step execution.

---

## Experiments

### Experiment
An A/B test applied to a single form. Defines variants with traffic weights, a success metric, and a minimum sample size. Only one experiment can be active per form at a time. Stored in the `experiments` table. ID prefix: `exp_`.

### Variant
One version of a form within an experiment. Each variant can override specific form fields (labels, placeholders, field inclusion) while inheriting the rest from the base form. The control variant has no overrides (`null`). Identified by a variant ID (e.g., `ctrl`, `var_a`, `var_b`).

### Traffic Splitting
The mechanism by which the form schema endpoint selects a variant for each page load based on variant weights. The selected experiment_id and variant_id are passed as hidden fields in the submission.

### Optimization Log
An append-only audit trail on each experiment recording every optimization action: creation, promotions, new challenger generation, and rollbacks. Each entry includes a timestamp and details.

### Agent Autopilot
The automated optimization mode where the system periodically analyzes experiment results, promotes winners, and generates new challenger variants via Claude. Subject to guardrails: >10% improvement required, min sample size, required fields preserved, auto-rollback on >15% performance drop.

---

## Observability

### Event
A timestamped record of something that happened during submission processing or agent execution. Sixteen event types including: submission_received, spam_blocked, contact_matched, contact_created, handler_assigned, agent_processing, agent_action, agent_draft, agent_completed, agent_error, agent_retry, agent_escalated, human_approved, human_rejected, human_override, experiment_variant, optimization_run. Stored in the `events` table and emitted via WebSocket.

### Activity Stream
The real-time feed of events displayed on the agent observability dashboard. Filterable by form, agent, or submission. Powered by WebSocket (`/ws/events`).

### Processing Timeline
A per-submission chronological view showing every step from receipt to completion, with timestamps and durations between steps. Built from the submission's `actions` array.

---

## Processing

### Flow
One of six predefined processing pipelines selected by the form's `flow_id`. Each flow defines a sequence of steps (contact matching, company matching, notifications, routing, agent/human processing) appropriate for its use case. Flows are either deterministic (no agent) or agent-guided (includes Claude API call).

| Flow ID | Mode | Primary Use Case |
|---------|------|-----------------|
| email_marketing | Deterministic | Newsletter signups, downloads |
| sales_lead | Agent-guided | Demo requests, pricing inquiries |
| support_triage | Agent-guided | Support requests, bug reports |
| booking_request | Deterministic | Meeting schedulers |
| direct_route | Deterministic | General inquiries, feedback |
| notify_only | Deterministic | Simple notifications |

### Anti-Spam Pipeline
A four-layer defense system that runs synchronously on every submission before processing: honeypot check, IP rate limit, email rate limit, duplicate detection. First failure rejects the submission. See [edge-cases.md](./edge-cases.md) for boundary conditions.

### Attribution
The system for tracking which marketing channels (UTM sources) contributed to contacts and deals. Supports last-touch (default) and first-touch models. Multi-touch paths are visible for contacts with deals.

### Embed Code
An HTML snippet (`<div>` + `<script>`) that website owners paste into their pages to render a FormAgent form. The script (`embed.js`) fetches the form schema, builds the HTML, tracks field interactions, captures UTM parameters, and handles submission.

### Speed-to-Lead
The time between a submission being received (`created_at`) and being fully processed (`processed_at`). Displayed as a distribution histogram on the form performance dashboard.
