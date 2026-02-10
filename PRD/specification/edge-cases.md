# Edge Cases and Boundary Conditions

> Derived from [Inbound-Product-Definition.md](../../Inbound-Product-Definition.md).
> Cross-references: [requirements.md](./requirements.md) | [non-functional.md](./non-functional.md) | [constraints.md](./constraints.md) | [glossary.md](./glossary.md)

---

## 1. Auth Edge Cases

### EC-A1: Multi-Workspace Accounts

**Scenario:** A single account is a member of 3+ workspaces with different roles in each.

**Expected behavior:**
- Login returns the full workspace list; user selects one.
- JWT contains the selected `workspace_id` and the role for that workspace only.
- Switching workspaces issues a new JWT with the new workspace's role.
- Actions permitted in workspace A (where user is admin) may be forbidden in workspace B (where user is viewer).

**Related requirement:** [FR-0.4](./requirements.md), [FR-0.7](./requirements.md), [FR-0.10](./requirements.md)

### EC-A2: Pending Invites for Unregistered Email

**Scenario:** Admin invites `newuser@example.com` who does not yet have an account.

**Expected behavior:**
- Membership record created with `status: pending`.
- When `newuser@example.com` signs up (or logs in via future OAuth), all pending memberships for that email are auto-activated.
- Pending invite expires after 7 days. If the user signs up after expiry, the membership is not activated; a new invite is required.

**Related requirement:** [FR-0.9](./requirements.md)

### EC-A3: Expired JWT with Valid Session

**Scenario:** User's JWT has expired but the session record still exists in the database.

**Expected behavior:**
- The request is rejected (401 Unauthorized). JWT expiry is the first check.
- The client must re-authenticate (login) to obtain a new token.
- Expired session records should be periodically cleaned up but are not required to block requests (JWT expiry is sufficient).

### EC-A4: Revoked API Key Mid-Request

**Scenario:** An API key is revoked while a long-running request using that key is in progress.

**Expected behavior:**
- The in-flight request completes (key was validated at the start).
- The next request with the same key is rejected (401).
- `status` on the api_keys record is `revoked`; `last_used_at` reflects the last successful use.

**Related requirement:** [FR-0.12](./requirements.md)

### EC-A5: Concurrent Sessions from Multiple Devices

**Scenario:** Same account logs in from a laptop and a phone simultaneously.

**Expected behavior:**
- Both sessions are valid and independent. Each has its own session record and JWT.
- Logging out from one device invalidates only that session's token.
- The other session remains active until its own logout or JWT expiry.

### EC-A6: Owner Removes Themselves

**Scenario:** Workspace owner attempts to remove their own membership.

**Expected behavior:**
- The system rejects the request. A workspace must always have at least one owner.
- Error message: "Cannot remove the last owner of a workspace."

### EC-A7: Deleting Workspace with Active Data

**Scenario:** Owner deletes a workspace that contains forms, submissions, contacts, etc.

**Expected behavior:**
- Soft delete: workspace `status` set to `archived`. All data remains but is inaccessible via API.
- Alternatively, block deletion if active forms or running experiments exist and require the user to archive them first.

---

## 2. Form Edge Cases

### EC-F1: Empty Submission (All Optional Fields)

**Scenario:** A form has all optional fields and a user submits without filling any of them.

**Expected behavior:**
- Submission passes field validation (no required fields violated).
- Anti-spam still runs (honeypot check, rate limits).
- Contact matching skipped if no email field is present or filled.
- Submission stored with empty `data` object; flow executes with minimal context.

### EC-F2: Maximum Field Count

**Scenario:** A form is created with an unusually large number of fields (50+).

**Expected behavior:**
- The system should enforce a reasonable field limit (e.g., 50 fields per form) at form creation/update time.
- Embed script must handle large forms without breaking (scroll, pagination, or a warning).
- Agent prompt must not exceed Claude's context window with excessive field data.

### EC-F3: Honeypot Field Filled by Legitimate User

**Scenario:** A user with an auto-fill browser extension fills the hidden honeypot field.

**Expected behavior:**
- Submission is silently rejected (HTTP 200 returned to avoid tipping off bots).
- Logged to `spam_log` with reason `honeypot`.
- No recourse for the user within the system. This is an accepted false-positive trade-off.

**Mitigation:** Name the honeypot field obscurely (e.g., `_hp`) so auto-fill extensions are unlikely to target it.

### EC-F4: Duplicate Submission Within Window

**Scenario:** User double-clicks submit, sending the same data twice within the duplicate window.

**Expected behavior:**
- First submission accepted and processed.
- Second submission rejected (422) with message indicating a recent submission was detected.
- Window is configurable per form via `security.duplicate_window_minutes`.

**Related requirement:** [FR-2.7](./requirements.md)

### EC-F5: Form Archived Mid-Submission

**Scenario:** A form is archived (status set to `inactive`) while a user has the form loaded on a page.

**Expected behavior:**
- The user can still submit (the form ID is valid and the record exists).
- Option A: Reject with a message that the form is no longer accepting submissions.
- Option B: Accept the submission but mark it with a flag indicating the form was inactive at time of receipt.
- Recommended: Option A -- reject with a clear message.

### EC-F6: Form Schema Request for Non-Existent Form

**Scenario:** Embed script requests `GET /api/forms/{form_id}/schema` with an invalid or deleted form ID.

**Expected behavior:**
- Return 404 with a user-friendly error.
- Embed script should display a fallback message (e.g., "This form is no longer available").

---

## 3. Agent Edge Cases

### EC-AG1: LLM API Timeout

**Scenario:** Claude API does not respond within the expected timeout window.

**Expected behavior:**
1. First retry after 2 seconds.
2. Second retry after 4 seconds.
3. Third retry after 8 seconds.
4. If all 3 fail: queue for retry in 5 minutes.
5. Each retry logged in submission `actions` array and emitted as `agent_retry` WebSocket event.

**Related requirement:** [FR-2.21](./requirements.md)

### EC-AG2: Unparseable Agent Response

**Scenario:** Claude returns a response that is not valid JSON or does not match the expected schema.

**Expected behavior:**
1. Re-prompt with stricter format instructions (e.g., "You MUST return valid JSON matching this exact schema: ...").
2. If the second attempt also fails, escalate to human handler.
3. Both attempts and the escalation logged.

**Related requirement:** [FR-2.21](./requirements.md)

### EC-AG3: Agent Requests Disallowed Action

**Scenario:** Agent's response includes `create_deal` but the form only allows `qualify_lead` and `send_email`.

**Expected behavior:**
- `create_deal` action is blocked before execution.
- Violation logged in submission actions array with type `action_blocked`.
- Remaining valid actions (`qualify_lead`, `send_email`) execute normally.
- Event emitted: `agent_action` with blocked flag.

**Related requirement:** [FR-2.19](./requirements.md)

### EC-AG4: All Agent Retries Exhausted

**Scenario:** LLM API fails 3 times, then the 5-minute retry queue also fails.

**Expected behavior:**
- Submission status set to `needs_human_review`.
- Fallback handler notified (from handler group settings or form config).
- Error record created in `errors` table with full details.
- Dashboard shows the submission as stuck/error.

**Related requirement:** [FR-2.21](./requirements.md)

### EC-AG5: Agent Produces No Actions

**Scenario:** Claude returns a valid JSON response with an empty `actions` array.

**Expected behavior:**
- No actions executed. This is valid (the agent determined no action was needed).
- Contact updates from `contact_updates` still applied if present.
- Submission marked as processed with outcome reflecting the agent's reasoning.
- Log: "Agent completed with no actions."

### EC-AG6: Agent Processing Exceeds 30 Minutes

**Scenario:** An agent processing thread hangs or takes extremely long.

**Expected behavior:**
- Stale submission cleanup job (runs every 15 minutes) detects submissions in `processing` status for > 30 minutes.
- Submission marked as failed.
- Error logged; fallback handler notified.

---

## 4. Routing Edge Cases

### EC-R1: All Handlers in Group Inactive

**Scenario:** A handler group has 3 members but all have `active: false`.

**Expected behavior:**
- Routing falls back to `settings.fallback_handler_id`.
- If fallback is also inactive or not configured, submission enters unassigned queue with `status: received`.
- Dashboard shows the submission in the unassigned list.

**Related requirement:** [FR-1.14](./requirements.md)

### EC-R2: Empty Handler Group

**Scenario:** A handler group exists but has zero members.

**Expected behavior:**
- Same as EC-R1: fall back to `fallback_handler_id`, then to unassigned queue.
- Consider preventing forms from being assigned to empty groups at configuration time (validation warning).

### EC-R3: No Fallback Handler Configured

**Scenario:** All group members are inactive and `settings.fallback_handler_id` is null.

**Expected behavior:**
- Submission status remains `received`.
- Submission appears in the unassigned queue in the dashboard.
- No automated notification sent (no handler to notify).

### EC-R4: Round-Robin with Single Active Member

**Scenario:** A round-robin group has 3 members but only 1 is active.

**Expected behavior:**
- All submissions route to the single active member.
- `last_assigned_index` still updates but the rotation always lands on the same member.
- When other members become active, rotation resumes normally.

### EC-R5: Broadcast with No Claimant

**Scenario:** Broadcast notification sent to all members but nobody claims the submission.

**Expected behavior:**
- Submission remains in `received` or `assigned` status awaiting claim.
- After a configurable timeout (or no timeout in MVP), it stays in the dashboard as unclaimed.
- Consider adding a "stale assignment" flag for dashboard visibility.

### EC-R6: Handler Deleted While Assigned

**Scenario:** A handler (agent or human) is removed from a group while submissions are assigned to them.

**Expected behavior:**
- Already-assigned submissions are not reassigned automatically (to avoid confusion).
- New submissions will not route to the deleted handler.
- Dashboard should show the handler reference as "removed" on historical submissions.

---

## 5. Experiment Edge Cases

### EC-E1: Insufficient Sample Size

**Scenario:** User triggers optimization but variants do not yet have `min_sample_size` submissions.

**Expected behavior:**
- API returns `{"action": "waiting", "message": "Need more data (var_a: 18/30, ctrl: 22/30)"}`.
- No winner determined; no changes applied.

**Related requirement:** [FR-3.5](./requirements.md)

### EC-E2: One Active Experiment Per Form

**Scenario:** User attempts to create a second experiment for a form that already has an active experiment.

**Expected behavior:**
- API returns an error: "An active experiment already exists for this form."
- User must complete or archive the existing experiment before creating a new one.

**Related requirement:** [FR-3.7](./requirements.md)

### EC-E3: Required Field Removal by Optimizer

**Scenario:** The Claude-generated challenger variant attempts to remove a required field.

**Expected behavior:**
- The system validates the generated variant before saving.
- Required fields from the base form cannot be removed. If the variant omits a required field, it is re-added automatically or the generation is rejected and retried.

**Related requirement:** [FR-3.6](./requirements.md)

### EC-E4: Experiment on Archived Form

**Scenario:** A form is archived while an experiment is active.

**Expected behavior:**
- The experiment should be automatically paused or completed when its parent form is archived.
- No new submissions will arrive (form is inactive), so the experiment cannot gather more data.

### EC-E5: Variant Weight Totals Not 100

**Scenario:** User creates variants with weights that sum to more or less than 100.

**Expected behavior:**
- Weights are treated as relative proportions, not absolute percentages.
- E.g., weights [60, 40] and [3, 2] produce the same 60/40 split.
- Alternatively, validate that weights sum to 100 at creation time and reject otherwise.

### EC-E6: All Variants Perform Identically

**Scenario:** After sufficient samples, all variants have identical conversion rates.

**Expected behavior:**
- No winner promoted (the >10% improvement threshold is not met).
- API returns a result indicating no significant difference.
- User can choose to extend the experiment or close it.

---

## 6. Sequence Edge Cases

### EC-SQ1: Stop Condition Met Mid-Sequence

**Scenario:** Contact is on step 2 of 5, then a deal is created (which is a stop condition).

**Expected behavior:**
- Before sending step 3, the background job checks stop conditions.
- `deal_created` condition detected: enrollment status set to `stopped`, `stop_reason` set to `deal_created`.
- Remaining steps are skipped. No further emails sent.

**Related requirement:** [FR-2.23](./requirements.md)

### EC-SQ2: Contact Unsubscribed

**Scenario:** Contact is enrolled in a sequence and then marked as unsubscribed.

**Expected behavior:**
- `contact_unsubscribed` is one of the defined stop conditions.
- Next time the background job processes this enrollment, it detects the unsubscribe and stops.
- Enrollment status: `stopped`, stop_reason: `contact_unsubscribed`.

### EC-SQ3: Concurrent Enrollments in Same Sequence

**Scenario:** Contact submits two different forms that both enroll them in the same sequence.

**Expected behavior:**
- Option A: Prevent duplicate enrollment. Check for active enrollment in the same sequence for the same contact before enrolling. Skip if already enrolled.
- Option B: Allow duplicate enrollment (two parallel email streams).
- Recommended: Option A -- prevent duplicates. Return a note that the contact is already enrolled.

### EC-SQ4: Sequence Deleted While Enrollments Active

**Scenario:** Admin deletes a sequence that has active enrollments.

**Expected behavior:**
- Active enrollments should be stopped with `stop_reason: sequence_deleted`.
- Alternatively, block deletion and require the admin to stop all enrollments first.
- Recommended: Stop all enrollments, then soft-delete the sequence.

### EC-SQ5: Send Time Falls on Weekend/Holiday

**Scenario:** A step's `send_time` is "09:00" and the `delay_days` lands on a Saturday.

**Expected behavior:**
- MVP: Send regardless of day of week. The system does not have holiday/weekend awareness.
- Post-MVP: Add business-day scheduling option.

### EC-SQ6: Email Send Failure During Sequence Step

**Scenario:** SMTP send fails for a sequence step.

**Expected behavior:**
- Retry once immediately.
- If retry fails: log the failure in enrollment history, mark the step as `failed`, advance to the next step.
- The enrollment continues; a single failed step does not stop the sequence.

---

## 7. Contact Edge Cases

### EC-C1: Returning Contact with Updated Information

**Scenario:** Jane submitted once as "jane@acme.com" with company "Acme". She submits again with the same email but company "Acme Corp".

**Expected behavior:**
- Contact matched by email. New submission linked to existing contact.
- Existing fields are NOT overwritten (original company name preserved).
- New information that fills previously empty fields IS added.
- The agent sees full history: both submissions with their respective data.

**Related requirement:** [FR-2.8](./requirements.md)

### EC-C2: Cross-Form Contact Matching

**Scenario:** Jane submits on Form A (whitepaper download) and later on Form B (demo request), both in the same workspace.

**Expected behavior:**
- Both submissions linked to the same contact record (matched by email within workspace).
- Both submissions appear in the contact's touchpoints array.
- Agent processing Form B's submission sees the full history including Form A.

### EC-C3: Company Name Variations

**Scenario:** One submission says "Acme", another says "Acme Corp", another says "Acme Corporation".

**Expected behavior:**
- MVP: Exact string match only. Each variation creates a separate company record.
- The system does not perform fuzzy matching in MVP.
- Post-MVP: Consider fuzzy matching, normalization, or manual merge UI.

### EC-C4: Contact Without Email

**Scenario:** A form does not include an email field, or the email field is optional and left blank.

**Expected behavior:**
- Contact matching is skipped (email is the primary match key).
- No contact record is created.
- Submission proceeds without contact/company linkage.
- Agent receives submission data without contact history.

### EC-C5: Same Email in Different Workspaces

**Scenario:** `jane@acme.com` is a contact in Workspace A and also in Workspace B.

**Expected behavior:**
- These are completely independent contact records.
- Workspace isolation ensures no cross-workspace data leakage.
- Each workspace's agent sees only that workspace's history for the contact.

**Related requirement:** [FR-0.14](./requirements.md)

### EC-C6: Contact with Extremely Long Touchpoints Array

**Scenario:** A very active contact has hundreds of submissions, creating a large `touchpoints` JSON array.

**Expected behavior:**
- The system stores all touchpoints (append-only).
- Agent prompt should include only the most recent N touchpoints (e.g., last 10) to avoid exceeding context limits.
- Dashboard shows full history with pagination.
