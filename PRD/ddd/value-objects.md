# Value Objects

> Value objects are immutable, identity-less types defined entirely by their attributes. Two value objects with the same attributes are considered equal.

See also: [Entities](./entities.md) | [Aggregates](./aggregates.md)

---

## Form Configuration Value Objects

### FormField

Defines a single field within a form. Stored as elements in the Form aggregate's `fields` JSON array.

```python
class FormField:
    name: str             # Machine name (e.g., "first_name")
    type: FieldType       # See FieldType enum below
    label: str            # Display label (e.g., "First Name")
    required: bool        # Whether the field must be filled
    placeholder: str      # Placeholder text (optional)
    max_length: int       # Maximum character length (optional)
    min_length: int       # Minimum character length (optional)
    min_value: float      # Minimum numeric value (optional)
    max_value: float      # Maximum numeric value (optional)
    validation_regex: str # Custom regex pattern (optional)
    options: list[str]    # Options for select/multiselect (optional)
```

**FieldType enum:** `text`, `email`, `phone`, `number`, `select`, `multiselect`, `textarea`, `checkbox`, `hidden`, `date`, `url`

### SecurityConfig

Anti-spam and CORS settings for a form. Stored as `security_config` JSON on the Form aggregate.

```python
class SecurityConfig:
    allowed_origins: list[str]    # CORS origins (empty = wildcard *)
    honeypot_field: str           # Hidden field name (default: "_hp")
    max_submissions_per_ip: int   # Rate limit per IP per hour (default: 10)
    max_submissions_per_email: int # Rate limit per email per hour (default: 5)
    duplicate_window_minutes: int  # Duplicate detection window (default: 5)
```

### AgentConfig

AI agent configuration for a form. Stored as `agent_config` JSON on the Form aggregate.

```python
class AgentConfig:
    agent_id: str                    # Agent identifier (nullable)
    instructions: str                # Natural language instructions for the agent
    autonomy_level: AutonomyLevel    # Trust level enum
    allowed_actions: list[str]       # Guardrail checkboxes
```

### ResponseConfig

Post-submission behavior. Stored as `response_config` JSON on the Form aggregate.

```python
class ResponseConfig:
    thank_you_message: str   # Message shown after submit
    redirect_url: str        # URL to redirect to (optional, nullable)
```

### AutoConfig

Deterministic processing settings. Stored as `auto_config` JSON on the Form aggregate.

```python
class AutoConfig:
    create_contact: bool                  # Auto-create contact record
    create_company: bool                  # Auto-create company record
    confirmation_email_template_id: str   # Template ID for confirmation email (nullable)
    log_activity: bool                    # Log CRM activity
    notify_handler_ids: list[str]         # Handler IDs to notify
    post_to_feed: bool                    # Post to activity feed
```

### FieldMapping

Maps form field names to CRM entity paths. Stored as `field_mapping` JSON on the Form aggregate.

```python
# Example:
# {
#   "first_name": "contact.first_name",
#   "email": "contact.email",
#   "company_name": "company.name",
#   "team_size": "contact.custom_fields.company_size"
# }
FieldMapping = dict[str, str]
```

---

## Submission Value Objects

### SubmissionMeta

Metadata captured from the HTTP request and embed script. Stored as `meta` JSON on the Submission aggregate.

```python
class SubmissionMeta:
    ip: str               # Client IP address
    user_agent: str       # Browser user-agent string
    page_url: str         # The page where the form was embedded
    referrer: str         # HTTP referrer
    utm_source: str       # UTM source parameter (nullable)
    utm_medium: str       # UTM medium parameter (nullable)
    utm_campaign: str     # UTM campaign parameter (nullable)
    utm_content: str      # UTM content parameter (nullable)
    utm_term: str         # UTM term parameter (nullable)
    experiment_id: str    # Active experiment ID (nullable)
    variant_id: str       # Assigned variant ID (nullable)
```

### FieldInteraction

Per-field behavioral tracking from the embed script. Stored in the Submission's `field_interactions` JSON map, keyed by field name.

```python
class FieldInteraction:
    focused: bool    # Whether the user focused this field
    filled: bool     # Whether the user entered a value
    time_ms: int     # Milliseconds spent interacting with the field
```

### AgentAction

A single step in the submission processing pipeline. Stored as elements in the Submission's `actions` JSON array.

```python
class AgentAction:
    step: str        # Step identifier (e.g., "validate", "anti_spam", "qualify_lead")
    status: str      # Outcome (e.g., "ok", "passed", "sent", "created", "failed")
    at: str          # ISO timestamp when the step executed
    entity_id: str   # ID of entity created/affected (optional)
    handler: str     # Handler ID involved (optional)
    details: dict    # Step-specific details (optional)
```

### CreatedEntities

Tracks entities created during submission processing. Stored as `created_entities` JSON on the Submission.

```python
class CreatedEntities:
    deal_id: str     # Created deal ID (nullable)
    task_id: str     # Created task ID (nullable)
    ticket_id: str   # Created ticket ID (nullable)
```

---

## Contact Value Objects

### Touchpoint

A single interaction in a contact's attribution chain. Stored as elements in the Contact's `touchpoints` JSON array.

```python
class Touchpoint:
    submission_id: str   # The submission that produced this touchpoint
    form_id: str         # The form that was submitted
    utm_source: str      # UTM source (nullable)
    utm_medium: str      # UTM medium (nullable)
    utm_campaign: str    # UTM campaign (nullable)
    utm_content: str     # UTM content (nullable)
    utm_term: str        # UTM term (nullable)
    page_url: str        # The page URL where the form was embedded
    at: str              # ISO timestamp of the interaction
```

---

## Routing Value Objects

### GroupMember

A member within a handler group. Stored as elements in the HandlerGroup's `members` JSON array.

```python
class GroupMember:
    handler_id: str    # ID of the handler (agent or human)
    type: HandlerType  # "agent" or "human"
    role: str          # "member" or "principal"
    active: bool       # Whether this member is currently active
```

### GroupSettings

Configuration for a handler group. Stored as `settings` JSON on the HandlerGroup.

```python
class GroupSettings:
    fallback_handler_id: str   # Handler to use when all members inactive
    auto_assign_tasks: bool    # Automatically assign tasks on routing
    notify_on_assignment: bool # Send notification on assignment
```

---

## Experimentation Value Objects

### Variant

A single variant in an A/B experiment. Stored as elements in the Experiment's `variants` JSON array.

```python
class Variant:
    id: str              # Variant identifier (e.g., "ctrl", "var_a")
    label: str           # Human-readable label
    weight: int          # Traffic weight (0-100)
    overrides: dict      # Partial form config overrides (nullable for control)
```

**Note:** `overrides` is a partial form configuration. It may contain a `fields` array that replaces the base form's fields for this variant. A `null` value means "use the base form as-is" (this is the control variant).

### OptimizationLogEntry

An audit entry recording an optimization action. Stored in the Experiment's `optimization_log` JSON array.

```python
class OptimizationLogEntry:
    at: str          # ISO timestamp
    action: str      # "created", "optimized", "rollback", "paused"
    details: str     # Human-readable description
```

---

## Marketing Automation Value Objects

### EnrollmentHistoryEntry

Records the execution of a single sequence step. Stored in the Enrollment's `history` JSON array.

```python
class EnrollmentHistoryEntry:
    step: int        # Step number
    status: str      # "sent", "skipped", "failed"
    sent_at: str     # ISO timestamp of execution (nullable if skipped/failed)
```

---

## Authentication Value Objects

### JWTPayload

The decoded contents of a JWT token. Never stored directly -- derived from the signed token.

```python
class JWTPayload:
    sub: str             # Account ID (e.g., "acct_xxx")
    workspace_id: str    # Active workspace ID (e.g., "ws_xxx")
    role: str            # Role within the workspace
    iat: int             # Issued-at (Unix timestamp)
    exp: int             # Expiry (Unix timestamp, 24h from iat)
```

### AuthContext

The runtime context extracted from every authenticated request. Not persisted -- exists only in-memory during request processing.

```python
class AuthContext:
    account_id: str      # From JWT sub or API key lookup
    workspace_id: str    # From JWT or API key record
    role: str            # From JWT or inferred from API key
```

---

## Enumerations

### AutonomyLevel

Controls how independently an agent can act.

| Value | Behavior |
|-------|----------|
| `notify_only` | Agent reads and summarizes. No actions taken. |
| `draft` | Agent drafts actions. Human approves before execution. |
| `semi_autonomous` | Agent executes immediately. Human may review within window. |
| `fully_autonomous` | Agent handles end-to-end. Human sees activity log only. |

### FlowId

The processing pipeline selected for a form.

| Value | Mode | Description |
|-------|------|-------------|
| `email_marketing` | Deterministic | Newsletter signups, downloads, registrations |
| `sales_lead` | Agent-guided | Demo requests, pricing inquiries |
| `support_triage` | Agent-guided | Support requests, bug reports |
| `booking_request` | Deterministic | Meeting schedulers |
| `direct_route` | Deterministic | General inquiries, feedback |
| `notify_only` | Deterministic | Simple notifications, internal forms |

### RoutingStrategy

How a handler group distributes submissions.

| Value | Description |
|-------|-------------|
| `principal` | Always routes to the principal member |
| `round_robin` | Rotates through active members sequentially |
| `least_loaded` | Routes to the member with fewest assignments |
| `broadcast` | All members notified, first to claim handles |

### HandlerType

The type of entity that can handle submissions.

| Value | Description |
|-------|-------------|
| `agent` | AI agent processes via Claude API |
| `human` | Human handler processes manually |

### AllowedAction

The set of actions an agent may be permitted to take.

| Value | Description |
|-------|-------------|
| `qualify_lead` | Score and categorize the submission |
| `send_email` | Send a response email to the submitter |
| `create_deal` | Create a deal/opportunity record |
| `create_ticket` | Create a support ticket |
| `book_meeting` | Create a calendar booking |
| `enroll_sequence` | Enroll contact in a nurture sequence |
| `escalate` | Flag for human review |
| `respond_direct` | Return an immediate response message |

### SubmissionStatus

Lifecycle states for a submission.

| Value | Description |
|-------|-------------|
| `received` | Stored, pending flow execution |
| `processing` | Flow is actively executing |
| `processed` | All steps completed successfully |
| `needs_human_review` | Escalated after errors |
| `failed` | Terminal failure |
| `spam_rejected` | Blocked by anti-spam |

### SpamReason

Why a submission was rejected by the anti-spam pipeline.

| Value | Description |
|-------|-------------|
| `honeypot` | Bot filled the hidden honeypot field |
| `ip_rate_limit` | Too many submissions from this IP |
| `email_rate_limit` | Too many submissions from this email |
| `duplicate` | Same email + form within the duplicate window |
