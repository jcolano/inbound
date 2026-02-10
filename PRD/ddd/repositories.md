# Repositories

> Each aggregate root has a repository interface. All repositories enforce workspace isolation as a fundamental constraint -- no query executes without `workspace_id`.

See also: [Aggregates](./aggregates.md) | [Entities](./entities.md) | [Services](./services.md)

---

## Workspace Isolation Constraint

Every repository method that reads or writes data **must** include `workspace_id` in the query predicate. This is the tenant isolation guarantee.

```python
# CORRECT -- always filtered by workspace
async def get_forms(self, workspace_id: str) -> list[Form]: ...

# WRONG -- never allowed
async def get_all_forms(self) -> list[Form]: ...
```

**Exceptions:**
- `AccountRepository` -- accounts are global (email uniqueness is cross-tenant)
- Public endpoints that resolve `workspace_id` from `form_id` (submission, schema)

---

## AccountRepository

**Aggregate:** Account
**Table:** `accounts`
**Context:** Identity & Access

```python
class AccountRepository:
    async def create(self, account: Account) -> Account
    async def get_by_id(self, account_id: str) -> Account | None
    async def get_by_email(self, email: str) -> Account | None
    async def update(self, account: Account) -> Account
    async def update_last_login(self, account_id: str, timestamp: str) -> None
```

**Notes:**
- No workspace_id filter -- accounts are global entities
- `get_by_email` is used during login and invite resolution
- Password hash is included in the model but never returned to API layer

---

## WorkspaceRepository

**Aggregate:** Workspace (with memberships, API keys, sessions)
**Tables:** `workspaces`, `workspace_memberships`, `api_keys`, `sessions`
**Context:** Identity & Access

```python
class WorkspaceRepository:
    # Workspace CRUD
    async def create(self, workspace: Workspace) -> Workspace
    async def get_by_id(self, workspace_id: str) -> Workspace | None
    async def get_by_slug(self, slug: str) -> Workspace | None
    async def update(self, workspace: Workspace) -> Workspace
    async def list_by_account(self, account_id: str) -> list[Workspace]

    # Memberships
    async def add_member(self, membership: WorkspaceMembership) -> WorkspaceMembership
    async def get_membership(self, workspace_id: str, account_id: str) -> WorkspaceMembership | None
    async def list_members(self, workspace_id: str) -> list[WorkspaceMembership]
    async def update_membership(self, membership: WorkspaceMembership) -> WorkspaceMembership
    async def remove_member(self, workspace_id: str, membership_id: str) -> None
    async def activate_pending_memberships(self, account_id: str) -> int

    # API Keys
    async def create_api_key(self, api_key: ApiKey) -> ApiKey
    async def get_api_key_by_hash(self, key_hash: str) -> ApiKey | None
    async def list_api_keys(self, workspace_id: str) -> list[ApiKey]
    async def revoke_api_key(self, workspace_id: str, key_id: str) -> None
    async def update_api_key_last_used(self, key_id: str, timestamp: str) -> None

    # Sessions
    async def create_session(self, session: Session) -> Session
    async def get_session_by_token_hash(self, token_hash: str) -> Session | None
    async def delete_session(self, session_id: str) -> None
    async def delete_sessions_for_account(self, account_id: str) -> int
```

**Key Query Patterns:**
- `list_by_account` joins through `workspace_memberships` to find all workspaces an account belongs to
- `get_api_key_by_hash` is used during API key authentication (hash lookup)
- `activate_pending_memberships` is called after signup/login to activate any pending invitations

---

## FormRepository

**Aggregate:** Form
**Table:** `forms`
**Context:** Form Management

```python
class FormRepository:
    async def create(self, workspace_id: str, form: Form) -> Form
    async def get_by_id(self, workspace_id: str, form_id: str) -> Form | None
    async def get_by_slug(self, workspace_id: str, slug: str) -> Form | None
    async def get_by_id_public(self, form_id: str) -> Form | None  # No workspace filter
    async def list(self, workspace_id: str, status: str = None, type: str = None) -> list[Form]
    async def update(self, workspace_id: str, form: Form) -> Form
    async def archive(self, workspace_id: str, form_id: str) -> None
    async def count_by_workspace(self, workspace_id: str) -> int
```

**Key Query Patterns:**
- `get_by_id_public` is the one method that does not require workspace_id -- it is used by the public schema endpoint and submission endpoint to resolve workspace_id from the form
- `list` supports optional filters by status and type
- JSON columns (fields, security_config, etc.) are loaded and saved as part of the form

---

## SubmissionRepository

**Aggregate:** Submission
**Table:** `submissions`
**Context:** Inbound Processing

```python
class SubmissionRepository:
    async def create(self, workspace_id: str, submission: Submission) -> Submission
    async def get_by_id(self, workspace_id: str, submission_id: str) -> Submission | None
    async def update(self, workspace_id: str, submission: Submission) -> Submission
    async def list(
        self,
        workspace_id: str,
        form_id: str = None,
        status: str = None,
        contact_id: str = None,
        date_from: str = None,
        date_to: str = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Submission]
    async def count_by_form(self, workspace_id: str, form_id: str) -> int
    async def count_by_status(self, workspace_id: str, form_id: str = None) -> dict[str, int]
    async def get_stale_processing(self, workspace_id: str, threshold_minutes: int) -> list[Submission]

    # Analytics queries
    async def get_by_experiment_variant(
        self, workspace_id: str, experiment_id: str, variant_id: str
    ) -> list[Submission]
    async def get_processing_time_distribution(self, workspace_id: str, form_id: str = None) -> list[dict]
    async def get_daily_volume(self, workspace_id: str, days: int = 30) -> list[dict]
    async def get_by_utm_source(self, workspace_id: str, form_id: str = None) -> list[dict]
```

**Key Query Patterns:**
- `list` is the most complex query with multiple optional filters and pagination
- `get_stale_processing` finds submissions stuck in `processing` status beyond the threshold (for the cleanup job)
- Analytics queries aggregate data for dashboards

---

## ContactRepository

**Aggregate:** Contact (with notes)
**Tables:** `contacts`, `contact_notes`
**Context:** Contact & CRM

```python
class ContactRepository:
    async def create(self, workspace_id: str, contact: Contact) -> Contact
    async def get_by_id(self, workspace_id: str, contact_id: str) -> Contact | None
    async def get_by_email(self, workspace_id: str, email: str) -> Contact | None
    async def update(self, workspace_id: str, contact: Contact) -> Contact
    async def list(
        self,
        workspace_id: str,
        status: str = None,
        tag: str = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Contact]
    async def increment_submission_count(self, workspace_id: str, contact_id: str) -> None
    async def append_touchpoint(self, workspace_id: str, contact_id: str, touchpoint: dict) -> None
    async def add_tags(self, workspace_id: str, contact_id: str, tags: list[str]) -> None

    # Notes
    async def add_note(self, contact_id: str, note: ContactNote) -> ContactNote
    async def list_notes(self, contact_id: str) -> list[ContactNote]
```

**Key Query Patterns:**
- `get_by_email` is the primary lookup during contact matching (per-workspace unique index)
- `append_touchpoint` performs a JSON array append on the touchpoints column
- `add_tags` merges new tags with existing tags (deduplicating)

---

## CompanyRepository

**Table:** `companies`
**Context:** Contact & CRM

```python
class CompanyRepository:
    async def create(self, workspace_id: str, company: Company) -> Company
    async def get_by_id(self, workspace_id: str, company_id: str) -> Company | None
    async def get_by_name(self, workspace_id: str, name: str) -> Company | None
    async def list(self, workspace_id: str) -> list[Company]
```

---

## DealRepository

**Table:** `deals`
**Context:** Contact & CRM

```python
class DealRepository:
    async def create(self, workspace_id: str, deal: Deal) -> Deal
    async def get_by_id(self, workspace_id: str, deal_id: str) -> Deal | None
    async def update(self, workspace_id: str, deal: Deal) -> Deal
    async def list(
        self,
        workspace_id: str,
        contact_id: str = None,
        stage: str = None,
    ) -> list[Deal]
    async def sum_revenue_by_source(self, workspace_id: str, form_id: str = None) -> float
    async def count_by_stage(self, workspace_id: str) -> dict[str, int]
```

---

## HandlerGroupRepository

**Aggregate:** HandlerGroup
**Table:** `handler_groups`
**Context:** Routing

```python
class HandlerGroupRepository:
    async def create(self, workspace_id: str, group: HandlerGroup) -> HandlerGroup
    async def get_by_id(self, workspace_id: str, group_id: str) -> HandlerGroup | None
    async def list(self, workspace_id: str) -> list[HandlerGroup]
    async def update(self, workspace_id: str, group: HandlerGroup) -> HandlerGroup
    async def delete(self, workspace_id: str, group_id: str) -> None
    async def update_routing_state(
        self, workspace_id: str, group_id: str,
        last_assigned_index: int = None,
        assignment_count: dict = None,
    ) -> None
```

**Key Query Patterns:**
- `update_routing_state` is an atomic update to the round-robin index or assignment counts, avoiding race conditions

---

## CampaignRepository

**Aggregate:** Campaign
**Table:** `campaigns`
**Context:** Marketing Automation

```python
class CampaignRepository:
    async def create(self, workspace_id: str, campaign: Campaign) -> Campaign
    async def get_by_id(self, workspace_id: str, campaign_id: str) -> Campaign | None
    async def list(self, workspace_id: str, status: str = None) -> list[Campaign]
    async def update(self, workspace_id: str, campaign: Campaign) -> Campaign
    async def archive(self, workspace_id: str, campaign_id: str) -> None
    async def get_by_form_id(self, workspace_id: str, form_id: str) -> list[Campaign]
```

---

## SequenceRepository

**Aggregate:** Sequence (with steps)
**Tables:** `sequences`, `sequence_steps`
**Context:** Marketing Automation

```python
class SequenceRepository:
    async def create(self, workspace_id: str, sequence: Sequence) -> Sequence
    async def get_by_id(self, workspace_id: str, sequence_id: str) -> Sequence | None
    async def list(self, workspace_id: str) -> list[Sequence]
    async def update(self, workspace_id: str, sequence: Sequence) -> Sequence
    async def delete(self, workspace_id: str, sequence_id: str) -> None

    # Steps
    async def add_step(self, sequence_id: str, step: SequenceStep) -> SequenceStep
    async def update_step(self, sequence_id: str, step: SequenceStep) -> SequenceStep
    async def delete_step(self, sequence_id: str, step_id: str) -> None
    async def list_steps(self, sequence_id: str) -> list[SequenceStep]
    async def get_step_by_order(self, sequence_id: str, order: int) -> SequenceStep | None
```

---

## EnrollmentRepository

**Aggregate:** Enrollment
**Table:** `enrollments`
**Context:** Marketing Automation

```python
class EnrollmentRepository:
    async def create(self, workspace_id: str, enrollment: Enrollment) -> Enrollment
    async def get_by_id(self, workspace_id: str, enrollment_id: str) -> Enrollment | None
    async def update(self, workspace_id: str, enrollment: Enrollment) -> Enrollment
    async def list_by_sequence(self, workspace_id: str, sequence_id: str) -> list[Enrollment]
    async def list_by_contact(self, workspace_id: str, contact_id: str) -> list[Enrollment]
    async def get_active_for_contact_sequence(
        self, workspace_id: str, contact_id: str, sequence_id: str
    ) -> Enrollment | None
    async def get_due_enrollments(self, now: str) -> list[Enrollment]  # Cross-workspace (background job)
    async def count_by_status(self, workspace_id: str, sequence_id: str) -> dict[str, int]
```

**Key Query Patterns:**
- `get_due_enrollments` is the only cross-workspace query -- used by the background sequence processor. It queries `WHERE status='active' AND next_step_due_at <= ?`
- `get_active_for_contact_sequence` prevents duplicate enrollment

---

## ExperimentRepository

**Aggregate:** Experiment
**Table:** `experiments`
**Context:** Experimentation

```python
class ExperimentRepository:
    async def create(self, workspace_id: str, experiment: Experiment) -> Experiment
    async def get_by_id(self, workspace_id: str, experiment_id: str) -> Experiment | None
    async def get_active_for_form(self, workspace_id: str, form_id: str) -> Experiment | None
    async def get_active_for_form_public(self, form_id: str) -> Experiment | None  # No workspace filter
    async def list(self, workspace_id: str) -> list[Experiment]
    async def update(self, workspace_id: str, experiment: Experiment) -> Experiment
    async def archive(self, workspace_id: str, experiment_id: str) -> None
```

**Key Query Patterns:**
- `get_active_for_form` enforces the one-active-experiment-per-form invariant
- `get_active_for_form_public` is used by the public schema endpoint (resolves workspace from form)

---

## SpamLogRepository

**Table:** `spam_log`
**Context:** Inbound Processing

```python
class SpamLogRepository:
    async def create(self, workspace_id: str, entry: SpamLogEntry) -> SpamLogEntry
    async def count_by_ip(self, form_id: str, ip: str, since: str) -> int
    async def count_by_email(self, form_id: str, email: str, since: str) -> int
    async def check_duplicate(self, form_id: str, email: str, since: str) -> bool
    async def list(self, workspace_id: str, form_id: str = None) -> list[SpamLogEntry]
```

---

## EventRepository

**Table:** `events`
**Context:** Analytics & Observability

```python
class EventRepository:
    async def create(self, workspace_id: str, event: Event) -> Event
    async def list(
        self,
        workspace_id: str,
        form_id: str = None,
        submission_id: str = None,
        event_type: str = None,
        handler_id: str = None,
        date_from: str = None,
        date_to: str = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Event]
    async def count_by_type(self, workspace_id: str, date_from: str = None) -> dict[str, int]
```

---

## DraftRepository

**Table:** `drafts`
**Context:** Agent Execution

```python
class DraftRepository:
    async def create(self, workspace_id: str, draft: Draft) -> Draft
    async def get_by_id(self, workspace_id: str, draft_id: str) -> Draft | None
    async def list_pending(self, workspace_id: str) -> list[Draft]
    async def update(self, workspace_id: str, draft: Draft) -> Draft
```

---

## ErrorRepository

**Table:** `errors`
**Context:** Agent Execution

```python
class ErrorRepository:
    async def create(self, workspace_id: str, error: Error) -> Error
    async def get_by_submission(self, workspace_id: str, submission_id: str) -> list[Error]
    async def mark_resolved(self, workspace_id: str, error_id: str) -> None
    async def count_unresolved(self, workspace_id: str) -> int
```
