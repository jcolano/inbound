# ADR-010: Agent Autonomy Model (4 Levels + Action Guardrails)

## Status
Accepted

## Context
FormAgent routes form submissions to AI agents powered by the Claude API (see [ADR-007](./ADR-007-claude-api-integration.md)). The core tension is: **how much should the agent be allowed to do without human approval?**

Different use cases demand different trust levels:
- A high-volume newsletter signup should be fully automated (no human in the loop).
- A $500K enterprise deal inquiry should involve human review before any outbound communication.
- A support ticket might be triaged automatically, but escalation should be flagged.

The system needs a model that:
1. Lets workspace operators configure trust levels per form (not globally)
2. Constrains agent actions to an explicit allow-list
3. Works across all agent-guided processing flows (`sales_lead`, `support_triage`)
4. Logs every action and decision for auditability
5. Provides clear instructions to the LLM about what it can and cannot do

## Decision
We implement a **two-dimensional autonomy model**: an **autonomy level** (how much the agent can do on its own) combined with **allowed actions** (what the agent can do at all).

### Autonomy Levels (The Trust Slider)

| Level | Agent Behavior | LLM Instructions |
|-------|---------------|-------------------|
| `notify_only` | Agent reads, summarizes, and alerts the handler. Takes no actions. | "Do NOT take any actions. Analyze and prepare a summary." |
| `draft` | Agent drafts a response and action plan. Human must approve before execution. | "Prepare planned actions and drafts. Do NOT execute. Await human review." |
| `semi_autonomous` | Agent executes immediately. Human can review within a configurable window. | "Execute planned actions. Log everything. Human may review within {window}." |
| `fully_autonomous` | Agent handles end-to-end. Human sees activity log only. | "Execute all planned actions. Log everything for the activity stream." |

The autonomy level is set per form in the `agent` configuration block:

```json
{
  "agent": {
    "autonomy_level": "semi_autonomous",
    "allowed_actions": ["qualify_lead", "send_email", "create_deal", "escalate"],
    "instructions": "New demo request. Qualify against ICP criteria."
  }
}
```

### Allowed Actions (The Guardrails Checkboxes)

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

These are binary toggles. An action is either allowed or not. The agent cannot take actions that are not in the allowed list.

### Enforcement Pipeline

```
1. Build agent prompt
   - Include allowed actions list
   - Include autonomy-level-specific instructions
   - Include submission data and contact context

2. Call Claude API -> receive structured JSON action plan

3. Validate each action in the plan:
   - Is this action in the allowed_actions list?
   - YES -> proceed to execution/drafting
   - NO -> block action, log violation, emit event

4. Apply autonomy level:
   - fully_autonomous -> execute all valid actions immediately
   - semi_autonomous -> execute, flag for review within window
   - draft -> store in drafts table, notify handler, await approval
   - notify_only -> store summary, alert handler

5. Log everything:
   - Each action logged to submission.actions array
   - Each action emits a WebSocket event
   - Violations logged separately
```

### Draft Approval Workflow

When autonomy is `draft`, the agent's planned actions are stored in the `drafts` table:

```json
{
  "id": "draft_xxx",
  "submission_id": "sub_xxx",
  "handler_id": "agent_salesbot",
  "planned_actions": [
    {"action": "qualify_lead", "details": {"score": "high"}},
    {"action": "send_email", "details": {"subject": "...", "body": "..."}}
  ],
  "draft_content": {"reasoning": "...", "contact_updates": {...}},
  "status": "pending"
}
```

A human reviews via the drafts API:
- `POST /api/drafts/{id}/approve` - Execute all planned actions
- `POST /api/drafts/{id}/reject` - Reject with notes, notify agent/handler

### Agent Prompt Integration

The autonomy level and allowed actions are injected into every agent system prompt:

```
Your allowed actions: qualify_lead, send_email, create_deal, escalate
Your autonomy level: semi_autonomous

Instructions for semi_autonomous mode:
Execute planned actions immediately. Log everything for the activity stream.
A human reviewer may review your actions within 30 minutes.
If uncertain about any action, use "escalate" instead.
```

The LLM is instructed to return only actions from the allowed list. Server-side validation enforces this even if the LLM deviates.

## Consequences

### Positive
- **Graduated trust:** Operators start with `notify_only` for a new form, observe agent behavior, then gradually increase autonomy. The trust is earned, not assumed.
- **Explicit guardrails:** The allowed actions list means the agent literally cannot create deals if `create_deal` is not checked. This is enforced server-side, not just in the prompt.
- **Auditability:** Every action (taken or blocked) is logged with timestamps, details, and the autonomy level context. Compliance and debugging are straightforward.
- **LLM-aware constraints:** The agent knows its constraints. It can reason within its allowed actions rather than proposing actions that will be blocked.
- **Per-form configuration:** Different forms in the same workspace can have different autonomy levels. A newsletter form can be fully autonomous while a high-value sales form requires human drafts.
- **Human-in-the-loop path:** The `draft` level provides a clear review workflow with approval/rejection via the dashboard, enabling teams to safely adopt AI processing.

### Negative
- **Binary action permissions:** Actions are allowed or not. There is no conditional permission (e.g., "allow send_email only for submissions with budget < $10K"). More granular permissions would require a rule engine.
- **Static per-form configuration:** The autonomy level does not change based on submission content. A $10K inquiry and a $500K inquiry on the same form get the same autonomy level. Dynamic autonomy adjustment is not supported.
- **LLM compliance is not guaranteed:** Even with explicit instructions, the LLM may attempt disallowed actions. Server-side validation catches this, but it wastes a Claude API call and adds latency.
- **4 levels may not be enough:** The gap between `draft` (human approves everything) and `semi_autonomous` (agent executes, human reviews after) is large. Some operators may want "execute only low-risk actions, draft high-risk ones."
- **Draft backlog risk:** If autonomy is set to `draft` for high-volume forms, the pending drafts queue can grow faster than humans can review, creating a bottleneck.

## Alternatives Considered

1. **No autonomy levels (fully autonomous only)** - Agent always executes. Rejected because: (a) no operator would trust a new AI agent with full autonomy on day one; (b) compliance requirements in regulated industries demand human review; (c) the draft workflow is essential for building trust.

2. **Fine-grained permission rules (RBAC-style)** - Conditional permissions like "allow send_email if lead_score > 80." Rejected because: (a) requires a rule engine and condition evaluation framework; (b) dramatically increases configuration complexity; (c) the current model (4 levels + action list) covers MVP needs; (d) can be added as an advanced feature later.

3. **Budget/cost-based guardrails** - Agent has a "budget" per submission (e.g., max $50 in actions). Rejected because: (a) actions in FormAgent are not cost-quantified; (b) adds complexity without clear user value at MVP stage.

4. **Approval chains (multi-step)** - Draft requires approval from multiple reviewers. Rejected because: (a) adds workflow complexity beyond MVP scope; (b) single-approver is sufficient for small teams.

5. **Dynamic autonomy based on AI confidence** - Agent reports confidence scores and the system auto-escalates low-confidence decisions. Considered promising but deferred because: (a) LLM confidence calibration is unreliable; (b) adds unpredictability to the processing flow; (c) operators prefer explicit control over AI-inferred confidence levels.
