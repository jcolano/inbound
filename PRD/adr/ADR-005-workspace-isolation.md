# ADR-005: Multi-Tenant Workspace Isolation via workspace_id Column

## Status
Accepted

## Context
FormAgent is a multi-tenant system. Each tenant is called a **workspace**. A workspace contains all of a tenant's data: forms, submissions, contacts, companies, deals, handler groups, campaigns, sequences, experiments, events, errors, drafts, and spam logs. One user account can own multiple workspaces and be a member (with varying roles) of workspaces owned by others.

Data isolation is not a feature -- it is a security requirement. A query in workspace A must never return data from workspace B. This must hold for all 20 database tables, all ~91 API endpoints, all analytics aggregations, and all background jobs.

The PRD states: "The rule is absolute: No query ever touches data without a `WHERE workspace_id = ?` clause. No exceptions."

The system uses SQLite (see [ADR-002](./ADR-002-sqlite-database.md)), which is a single-file database. This constrains the isolation strategy to logical (row-level) isolation within a shared schema.

## Decision
We implement **row-level multi-tenancy** by adding a `workspace_id TEXT NOT NULL` column to every data table that stores tenant-specific data.

### Tables with direct workspace_id

| Table | Notes |
|-------|-------|
| `forms` | Non-nullable |
| `submissions` | Denormalized from form for direct filtering |
| `contacts` | Contacts are per-workspace |
| `companies` | Companies are per-workspace |
| `deals` | Deals are per-workspace |
| `handler_groups` | Groups are per-workspace |
| `campaigns` | Campaigns are per-workspace |
| `sequences` | Sequences are per-workspace |
| `enrollments` | Denormalized for direct queries |
| `experiments` | Experiments are per-workspace |
| `drafts` | Drafts are per-workspace |
| `spam_log` | Spam logs are per-workspace |
| `events` | Events are per-workspace |
| `errors` | Errors are per-workspace |

### Tables that inherit isolation via foreign key

| Table | Inherits via |
|-------|-------------|
| `contact_notes` | `contact_id` FK to contacts |
| `sequence_steps` | `sequence_id` FK to sequences |

### Tables that are workspace-scoped by design

| Table | Notes |
|-------|-------|
| `workspaces` | The workspace record itself |
| `workspace_memberships` | Links accounts to workspaces |
| `api_keys` | Scoped to a workspace |
| `sessions` | Scoped to a workspace |
| `accounts` | Global (not workspace-scoped) |

### Enforcement Mechanism

A FastAPI dependency (`get_current_context`) extracts the authenticated user's `workspace_id` from the JWT token or API key and injects it into every route handler:

```python
@router.get("/api/forms")
async def list_forms(ctx: AuthContext = Depends(get_current_context)):
    forms = await db.execute(
        "SELECT * FROM forms WHERE workspace_id = ?",
        [ctx.workspace_id]
    )
    return {"forms": forms}
```

This pattern applies to every authenticated endpoint. The `AuthContext` is the sole source of `workspace_id` -- it is never accepted from request parameters, query strings, or request bodies.

### Workspace-Scoped Unique Constraints

Uniqueness constraints that would normally be global are scoped to workspaces:

```sql
-- Contact email uniqueness is per-workspace
CREATE UNIQUE INDEX idx_contacts_unique_email ON contacts(workspace_id, email);

-- Form slug uniqueness is per-workspace
CREATE UNIQUE INDEX idx_forms_unique_slug ON forms(workspace_id, slug);
```

This means `jane@acme.com` can exist as a contact in workspace A and workspace B independently.

### Workspace-Scoped Indexes

Every table with `workspace_id` has an index on it for query performance:

```sql
CREATE INDEX idx_forms_workspace ON forms(workspace_id);
CREATE INDEX idx_submissions_workspace ON submissions(workspace_id);
CREATE INDEX idx_contacts_workspace ON contacts(workspace_id);
CREATE INDEX idx_contacts_workspace_email ON contacts(workspace_id, email);
-- ... for all tables
```

### Public Endpoint Isolation

Public endpoints (form submission, schema retrieval) do not receive `workspace_id` from the caller. Instead, the form ID serves as the implicit isolation boundary:

```
POST /api/submissions/{form_id}
  -> Look up form by ID
  -> Inherit workspace_id from form record
  -> Store submission with that workspace_id
```

External visitors never see or provide a workspace_id. The form_id itself is the auth boundary (see [ADR-013](./ADR-013-embed-architecture.md)).

## Consequences

### Positive
- **Simple and auditable:** Every query includes `WHERE workspace_id = ?`. Code review can verify isolation by grep. No complex framework or abstraction layer needed.
- **No infrastructure overhead:** Row-level isolation within a single SQLite file requires no additional databases, schemas, or connection routing.
- **Efficient for small-to-medium tenant count:** All data in one database means cross-tenant analytics (if ever needed for platform admin) is a simple query without federated joins.
- **Flexible membership model:** An account can be a member of multiple workspaces with different roles. Workspace switching is a token reissue, not a database reconnect.
- **Denormalized workspace_id on submissions and enrollments** enables direct filtering without JOINs, important for the analytics queries in Module 4.

### Negative
- **Developer discipline required:** Every new query, every new table, every new endpoint must include workspace_id filtering. A single omission is a data leak. There is no database-level enforcement (no row-level security policies as in PostgreSQL).
- **No physical isolation:** A bug in the application layer can leak data across workspaces. There is no database-level firewall between tenants.
- **Index overhead:** Every table carries an additional index on workspace_id (or composite indexes). For SQLite this is manageable but adds to database file size and write overhead.
- **Noisy neighbor risk:** A workspace with millions of submissions shares table space with all other workspaces. Query performance for one workspace is affected by total table size across all workspaces.
- **Backup granularity:** Cannot back up or restore a single workspace independently. The entire database file is the backup unit.

## Alternatives Considered

1. **Separate database file per tenant** - Each workspace gets its own SQLite file (`ws_xxx.db`). Rejected because: (a) connection management becomes complex (opening/closing database files per request); (b) cross-workspace operations (account membership, workspace listing) require a separate "master" database; (c) file descriptor limits become a concern with many tenants; (d) background jobs must iterate over all database files.

2. **Schema-per-tenant (PostgreSQL)** - Each workspace gets a separate PostgreSQL schema within one database. Rejected because: (a) requires PostgreSQL, conflicting with the SQLite decision (see [ADR-002](./ADR-002-sqlite-database.md)); (b) schema creation/migration overhead per tenant; (c) connection pool routing by schema adds complexity.

3. **Row-level security (PostgreSQL RLS)** - Database-enforced row policies that filter by tenant automatically. Rejected because: (a) requires PostgreSQL; (b) while more secure than application-level filtering, it adds query planning overhead; (c) debugging policy interactions is non-trivial. This would be the recommended approach if migrating to PostgreSQL in the future.

4. **Application-level ORM with automatic filtering** - A custom ORM or query builder that injects `workspace_id` into every query automatically. Rejected because: (a) adds abstraction overhead and magic behavior; (b) the system uses raw SQL via aiosqlite, not an ORM; (c) explicit filtering per query is more transparent and auditable.
