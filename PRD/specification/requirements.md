# Functional Requirements

> Extracted from [Inbound-Product-Definition.md](../../Inbound-Product-Definition.md).
> Cross-references: [non-functional.md](./non-functional.md) | [edge-cases.md](./edge-cases.md) | [constraints.md](./constraints.md) | [glossary.md](./glossary.md)

---

## Module 0: Auth + Multi-Tenancy

| ID | Requirement | Acceptance Criteria | PRD Section |
|----|-------------|---------------------|-------------|
| FR-0.1 | **Account creation** -- Users can create an account with email, password, name, and an initial workspace name. | Account record created with bcrypt-hashed password; workspace created with owner role; JWT returned. | Auth Flows: Signup |
| FR-0.2 | **Email uniqueness** -- Account emails must be globally unique. | Signup with an existing email returns a validation error. | Data Models: Accounts |
| FR-0.3 | **Password hashing** -- Passwords are stored as bcrypt hashes, never in plaintext. | `password_hash` column contains a valid bcrypt digest; raw password is not persisted anywhere. | Security Considerations |
| FR-0.4 | **Login with workspace selection** -- Users log in with email and password. If the account belongs to multiple workspaces, the system returns the list for the user to choose. | Single workspace: auto-selected and JWT issued. Multiple workspaces: list returned, user picks, then JWT issued. `last_login_at` updated. | Auth Flows: Login |
| FR-0.5 | **JWT token generation** -- On login/signup, a JWT is issued containing `sub` (account_id), `workspace_id`, `role`, `iat`, and `exp`. Signed with HS256. | Token decodes correctly; expires in 24 hours; session record created in `sessions` table. | JWT Token Structure |
| FR-0.6 | **Session tracking and revocation** -- Each JWT is linked to a session record. Logout invalidates the session server-side. | After logout, requests with the old token are rejected even before expiry. | Auth Flows: Logout / Sessions table |
| FR-0.7 | **Workspace switching** -- Authenticated users can switch to another workspace they are a member of. A new JWT is issued for the target workspace. | Membership verified; new JWT returned with updated `workspace_id`; new session created. | Auth Flows: Switch Workspace |
| FR-0.8 | **Workspace creation** -- Authenticated users can create additional workspaces. | New workspace record created; membership record with `owner` role created; workspace isolated from all others. | API Endpoints: POST /api/workspaces |
| FR-0.9 | **Member invitation** -- Owners and admins can invite users by email. Existing accounts get immediate membership; unknown emails get a pending invite. | Pending invites auto-activate on signup/login; invite expires after 7 days; role assigned correctly. | Auth Flows: Invite Member |
| FR-0.10 | **Role-based access control (RBAC)** -- Four roles: owner, admin, member, viewer. Each role has defined permissions. | Owner: full access + delete workspace. Admin: full access + manage members. Member: data access, no member/settings management. Viewer: read-only dashboards. | Data Models: Roles table |
| FR-0.11 | **API key authentication** -- Users can create API keys scoped to a workspace with granular permissions. Keys are shown once, then stored as SHA-256 hashes. | Key format `fa_live_*` or `fa_test_*`; only prefix stored after creation; lookup by hash; permissions checked per request; `last_used_at` updated. | Auth Flows: API Key Authentication |
| FR-0.12 | **API key revocation** -- Users can revoke API keys. Revoked keys immediately stop working. | `status` set to `revoked`; subsequent requests with that key return 401. | API Endpoints: DELETE /api/api-keys/{id} |
| FR-0.13 | **Workspace isolation middleware** -- Every authenticated endpoint injects `workspace_id` from the auth context. Every database query filters by `workspace_id`. | No query executes without `WHERE workspace_id = ?`; cross-workspace data is never returned. | Middleware: Workspace Isolation |
| FR-0.14 | **Workspace-scoped unique constraints** -- Uniqueness (e.g., contact email, form slug) is enforced per workspace, not globally. | Same email can exist as a contact in two different workspaces independently. | Impact on Existing Tables |
| FR-0.15 | **Public endpoint isolation** -- Public endpoints (form schema, submission) derive `workspace_id` from the `form_id` without exposing it to external visitors. | `workspace_id` is never present in public API responses; it is resolved internally from the form record. | Public Endpoints Exception |
| FR-0.16 | **Account profile management** -- Users can update their name and password. | PUT /api/auth/me updates fields; password change requires bcrypt re-hash. | API Endpoints: PUT /api/auth/me |

---

## Module 1: BUILD -- Form Creation + Assignment

| ID | Requirement | Acceptance Criteria | PRD Section |
|----|-------------|---------------------|-------------|
| FR-1.1 | **Natural language form generation** -- Users describe a form in plain text. Claude generates a complete form configuration (fields, flow, agent config, security defaults). | JSON config returned with name, slug, type, flow_id, fields, agent instructions, and security defaults. Config is a draft (not saved) until user confirms. | 1.1 NL Form Builder |
| FR-1.2 | **Conversational iteration** -- Users can refine the generated form via follow-up prompts before saving. | Each follow-up returns an updated draft config reflecting the requested changes. | 1.1 Iteration via conversation |
| FR-1.3 | **Visual form editor** -- A UI allows drag-to-reorder, add/delete fields, toggle required, edit labels/placeholders/options, and live preview. | All 11 field types editable; changes reflected in preview; saved via PUT /api/forms/{id}. | 1.2 Visual Form Editor |
| FR-1.4 | **Supported field types** -- The system supports 11 field types: text, email, phone, number, select, multiselect, textarea, checkbox, hidden, date, url. | Each type renders the correct HTML element; validation rules enforced per type. | 1.2 Field types table |
| FR-1.5 | **Form data model** -- Forms store fields, field_mapping, auto config, agent config, security config, and response config as JSON columns. | Form record matches the schema defined in PRD section 1.3; all JSON columns parse correctly. | 1.3 Form Data Model |
| FR-1.6 | **Handler assignment** -- Each form is assigned to a handler: agent, human, or handler_group via `entity` and `entity_id`. | Submissions route to the configured handler type; handler type determines processing path. | 1.4 Handler Assignment |
| FR-1.7 | **Autonomy levels** -- Four levels: notify_only, draft, semi_autonomous, fully_autonomous. Each level controls whether the agent observes, drafts, acts with review, or acts independently. | Agent behavior matches the level description; draft mode creates draft records; semi-autonomous flags for review within window. | 1.4 Autonomy Levels |
| FR-1.8 | **Allowed actions (guardrails)** -- Eight actions can be individually enabled: qualify_lead, send_email, create_deal, create_ticket, book_meeting, enroll_sequence, escalate, respond_direct. | Agent cannot execute disabled actions; attempts are blocked, logged, and flagged. | 1.4 Allowed Actions |
| FR-1.9 | **Handler groups with routing** -- Groups contain mixed members (agents + humans) and use one of four strategies: principal, round_robin, least_loaded, broadcast. | Each strategy distributes submissions correctly per its algorithm; state persisted between submissions. | 1.5 Handler Groups |
| FR-1.10 | **Principal routing** -- Always routes to the member with `role: principal`. Falls back to `fallback_handler_id` if principal is inactive. | Principal always receives submissions when active; fallback used when principal inactive. | 1.5 Strategy: principal |
| FR-1.11 | **Round-robin routing** -- Rotates through active members sequentially. `last_assigned_index` persisted. | Assignments cycle evenly; skips inactive members; index wraps correctly. | 1.5 Strategy: round_robin |
| FR-1.12 | **Least-loaded routing** -- Routes to the active member with the fewest assignments. `assignment_count` persisted per member. | Member with lowest count always selected; count incremented on assignment. | 1.5 Strategy: least_loaded |
| FR-1.13 | **Broadcast routing** -- All active members notified. First to claim handles it. | Notification sent to all active members; claiming assigns the submission. | 1.5 Strategy: broadcast |
| FR-1.14 | **Fallback logic** -- If all members inactive or group empty, fall back to `fallback_handler_id`. If no fallback, submission enters unassigned queue. | Submission status = `received`; appears in unassigned queue in dashboard. | 1.5 Fallback Logic |
| FR-1.15 | **Embed code generation** -- One click generates an HTML/JS snippet for embedding the form on any website. | Snippet contains a div and script tag; script fetches schema, builds form, handles submission, tracks interactions. | 1.6 Embed Code |
| FR-1.16 | **Embed script field tracking** -- The embed script tracks focus, blur, and fill events per field with time-in-field. | `field_interactions` JSON submitted with each submission; contains focused, filled, time_ms per field. | 1.6 Embed Script |
| FR-1.17 | **UTM and referrer capture** -- Embed script captures utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, and page_url. | All UTM params from query string and referrer/page_url included in submission `meta`. | 1.6 Embed Script |

---

## Module 2: CAPTURE + PROCESS -- Inbound Engine

| ID | Requirement | Acceptance Criteria | PRD Section |
|----|-------------|---------------------|-------------|
| FR-2.1 | **Submission ingestion** -- Public POST endpoint accepts form data, validates fields, runs anti-spam, stores submission, and triggers flow execution. | Steps 1-8 complete synchronously; HTTP 200 returned to submitter; submission record created with status `received`. | 2.1 Submission Flow |
| FR-2.2 | **CORS validation** -- Submission endpoint checks `Origin` header against form's `security.allowed_origins`. If empty, allows all origins. | Matching origin: request proceeds. Non-matching: rejected. Empty list: `Access-Control-Allow-Origin: *`. | 1.6 CORS |
| FR-2.3 | **Field validation** -- Each submitted field is validated against its type, required flag, length limits, regex, and options list. | Invalid submissions return 422 with per-field error details. | 2.1 Step 4 |
| FR-2.4 | **Honeypot anti-spam** -- A hidden field (`_hp`) is included in every form. If filled, the submission is silently rejected (HTTP 200). | Bots that fill hidden fields get 200 response but submission is discarded; logged to `spam_log`. | 2.2 Honeypot Check |
| FR-2.5 | **IP rate limiting** -- Submissions from the same IP are limited to N per hour (configurable per form). | Exceeding the limit returns 429; logged to `spam_log`. | 2.2 IP Rate Limit |
| FR-2.6 | **Email rate limiting** -- Submissions from the same email are limited to N per hour (configurable per form). | Exceeding the limit returns 429; logged to `spam_log`. | 2.2 Email Rate Limit |
| FR-2.7 | **Duplicate detection** -- Same email + same form within N minutes (configurable) is rejected. | Duplicate returns 422; logged to `spam_log`. | 2.2 Duplicate Check |
| FR-2.8 | **Contact matching** -- On every submission, the system searches contacts by email. If found, links and updates; if not, creates a new contact. | Returning contacts linked without duplication; new info merged (no overwrite of existing fields). | 2.3 Contact resolution |
| FR-2.9 | **Company matching** -- If `company_name` is submitted, the system searches companies by name, matches or creates, and links to the contact. | Existing company linked; new company created; contact's `company_id` set. | 2.3 Company matching |
| FR-2.10 | **Attribution tracking** -- Each submission creates a touchpoint on the contact's record with UTM params, referrer, and page URL. | Touchpoint appended to `contact.touchpoints` array with all meta fields and timestamp. | 2.3 Touchpoints |
| FR-2.11 | **Six processing flows** -- The form's `flow_id` selects one of: email_marketing, sales_lead, support_triage, booking_request, direct_route, notify_only. | Each flow executes its defined steps in order; deterministic flows complete synchronously; agent-guided flows spawn async processing. | 2.4 Processing Flows |
| FR-2.12 | **email_marketing flow** -- Deterministic: match contact, match company, add to campaign, send welcome email, enroll nurture sequence, log activity, notify handlers. | All 8 steps execute without agent involvement; contact tagged with campaign tags; enrollment created if sequence configured. | 2.4 Flow: email_marketing |
| FR-2.13 | **sales_lead flow** -- Agent-guided: match contact, match company, send confirmation, log activity, notify handlers, route to handler, agent or human processes. | Agent receives full context; executes allowed actions; creates deals/emails as appropriate. | 2.4 Flow: sales_lead |
| FR-2.14 | **support_triage flow** -- Agent-guided: match contact, match company, create ticket, send confirmation, notify, route, agent triages. | Ticket created; agent categorizes and either resolves or escalates. | 2.4 Flow: support_triage |
| FR-2.15 | **booking_request flow** -- Deterministic: match contact, match company, send confirmation with booking link, log activity, notify. | Confirmation email includes booking link; no agent involved. | 2.4 Flow: booking_request |
| FR-2.16 | **direct_route flow** -- Deterministic: match contact, route to handler, create task, send confirmation, notify. | Human handler receives task; no agent processing. | 2.4 Flow: direct_route |
| FR-2.17 | **notify_only flow** -- Minimal: notify handlers, complete. No contact matching or CRM entities. | Only notification sent; submission marked processed; no contact/company records created. | 2.4 Flow: notify_only |
| FR-2.18 | **Agent processing pipeline** -- Build prompt with full context, call Claude API, validate actions against allowed list, execute or draft based on autonomy level, log and emit events. | Agent receives structured prompt; returns JSON action plan; disallowed actions blocked; actions executed per autonomy level. | 2.5 Agent Pipeline |
| FR-2.19 | **Agent action validation** -- Every action the agent proposes is checked against the form's `allowed_actions` list before execution. | Disallowed actions are blocked, logged as violations, and flagged. Valid actions proceed. | 2.5 Step 3 |
| FR-2.20 | **Draft mode** -- When autonomy = draft, agent's planned actions and content are stored in a `drafts` record for human review. | Draft record created with planned_actions and draft_content; status = pending; human can approve or reject. | 2.5 Step 4 / Drafts |
| FR-2.21 | **Error recovery** -- LLM timeouts retry with exponential backoff (3 attempts: 2s, 4s, 8s). Unparseable responses re-prompt. Failed external actions retry once. All retries exhausted escalates to human. | Each error type follows its recovery path; all attempts logged; final fallback is `needs_human_review` status. | 2.6 Error Recovery |
| FR-2.22 | **Campaigns** -- Marketing containers linking forms, sequences, and analytics. Contacts are tagged and enrolled on submission. | Campaign record stores form IDs, sequence ID, welcome email template, asset URL, and contact tags. | 2.8 Campaigns |
| FR-2.23 | **Nurture sequences** -- Timed email drip sequences with configurable delays, send times, and stop conditions. | Steps execute on schedule; stop conditions checked before each step; variable substitution in email body. | 2.9 Nurture Sequences |
| FR-2.24 | **Enrollment tracking** -- Each contact's enrollment tracks current step, status, next due time, and full send history. | Enrollment advances through steps; stops on condition met; records history per step. | 2.9 Enrollment tracking |
| FR-2.25 | **Sequence background job** -- Runs every 60 seconds, processes enrollments where `next_step_due_at <= now()`. | Due steps sent; stop conditions checked; completed enrollments marked; next step scheduled. | 2.9 Background job |
| FR-2.26 | **Submission reprocessing** -- An endpoint allows re-triggering the flow for a submission. | POST /api/submissions/{id}/reprocess re-executes the flow; new actions appended to existing actions array. | API: Reprocess |

---

## Module 3: EXPERIMENTS -- A/B Testing + Agent Autopilot

| ID | Requirement | Acceptance Criteria | PRD Section |
|----|-------------|---------------------|-------------|
| FR-3.1 | **Experiment creation** -- Users create an A/B experiment for a form with a metric, minimum sample size, and variant definitions. | Experiment record created; only one active experiment allowed per form; variants stored with weights and overrides. | 3.1 Experiment Data Model |
| FR-3.2 | **Variant overrides** -- Each variant stores partial form config overrides applied on top of the base form. Control variant has `null` overrides. | Overrides merged at schema fetch time; base form unchanged; control serves original config. | 3.1 Key design |
| FR-3.3 | **Traffic splitting** -- Form schema endpoint performs weighted random variant selection when an active experiment exists. | Variant selected proportionally to weights; experiment_id and variant_id attached to response and passed as hidden fields. | 3.2 Traffic Splitting |
| FR-3.4 | **Variant stats computation** -- Per-variant metrics: submissions count, processed count, contacts created, deals created, revenue, conversion rate. | Stats computed from submissions filtered by experiment_id + variant_id; conversion metric matches experiment's configured metric. | 3.3 Variant Stats |
| FR-3.5 | **Agent autopilot optimization** -- On-demand endpoint checks sample sizes, determines winner, promotes winner to base form, generates new challenger via Claude. | Winner promoted only if it beats runner-up by >10% with sufficient sample; new challenger generated preserving required fields; optimization logged. | 3.4 Agent Autopilot |
| FR-3.6 | **Optimization guardrails** -- Winner must beat by >10% with >= min_sample_size. Required fields cannot be removed. Every optimization logged. | Insufficient data returns "waiting" status; required field removal blocked; all actions in optimization_log with timestamps. | 3.4 Guardrails |
| FR-3.7 | **One experiment per form** -- Creating a second experiment for a form with an active experiment is rejected. | API returns error if an active experiment already exists for the target form. | 3.4 Guardrails |

---

## Module 4: OBSERVE -- Analytics + Agent Observability

| ID | Requirement | Acceptance Criteria | PRD Section |
|----|-------------|---------------------|-------------|
| FR-4.1 | **KPI cards with period comparison** -- Dashboard shows: total submissions, conversion rate, contacts created, revenue, deals created, deals won, avg response time, spam blocked. Each with delta vs previous period. | Metrics computed for selected date range; same-length previous period computed; percentage deltas displayed. | 4.1 KPI Cards |
| FR-4.2 | **Funnel visualization** -- Horizontal bar chart showing drop-off: received, passed spam, contact matched, processed, deal created, deal won. | Each stage shows count and percentage of total; drop-off between stages visible. | 4.1 Funnel |
| FR-4.3 | **Channel attribution** -- Table of UTM sources with submissions, contacts, deals, revenue, and conversion rate. | Last-touch attribution by default; first-touch available as toggle; data from submission meta UTM fields. | 4.1 Channel Attribution |
| FR-4.4 | **Multi-touch attribution** -- Contacts with deals show the full touchpoint path from first to last interaction. | All touchpoints displayed in chronological order with source, page, and date. | 4.1 Multi-Touch |
| FR-4.5 | **Speed-to-lead distribution** -- Bar chart showing processing time buckets: <1min, 1-5min, 5-30min, 30m-1h, 1-4h, 4-24h, >24h. | Computed from `created_at` to `processed_at`; percentage per bucket displayed. | 4.1 Speed-to-Lead |
| FR-4.6 | **Field-level interaction analytics** -- Per field: focused %, filled %, avg time, dropoff %. | Aggregated from `field_interactions` across submissions; dropoff = focused but not filled. | 4.1 Field-Level |
| FR-4.7 | **Form comparison** -- Side-by-side table comparing multiple forms on key metrics. | Metrics aligned in columns; forms selectable by user. | 4.1 Form Comparison |
| FR-4.8 | **Sequence health** -- Per sequence: enrolled, active, completed, stopped, completion %. | Aggregated from enrollment records; status counts accurate. | 4.1 Sequence Health |
| FR-4.9 | **Daily volume chart** -- Bar chart of submissions per day for the last 30 days with trend line. | One bar per day; trend line overlaid. | 4.1 Daily Volume |
| FR-4.10 | **Agent live status board** -- Per agent handler: current state (idle, processing, waiting_approval, stuck, error), last heartbeat, current submission. | State updated in real time; stuck flag if no heartbeat exceeds threshold. | 4.2 Live Status Board |
| FR-4.11 | **Activity stream via WebSocket** -- Live feed of 16 event types, filterable by form, agent, or submission. | Events emitted in real time over WebSocket; filter reduces displayed events; all event types supported. | 4.2 Activity Stream |
| FR-4.12 | **Processing timeline** -- Per-submission horizontal timeline with every step, timestamp, and duration. | All actions from submission's `actions` array displayed chronologically with time deltas. | 4.2 Processing Timeline |
| FR-4.13 | **Agent performance metrics** -- Avg handling time, success rate, escalation rate, error rate, recovery rate, actions per submission. | Metrics computed from submission and event data for the selected agent; period-filterable. | 4.2 Agent Performance |
| FR-4.14 | **Optimization assistant (suggestion mode)** -- After 50+ submissions, Claude analyzes field interaction data, outcomes, and agent notes to produce plain-language suggestions. | Suggestions include actionable recommendations with "Apply to Editor" and "Dismiss" options. | 4.3 Mode 1 |
| FR-4.15 | **Optimization assistant (autopilot mode)** -- When enabled, the system periodically analyzes, creates experiments, runs them, promotes winners, and generates new challengers. | Autonomous optimization loop with >10% improvement threshold; auto-rollback if performance drops >15% within 48h; human can pause/stop. | 4.3 Mode 2 |
