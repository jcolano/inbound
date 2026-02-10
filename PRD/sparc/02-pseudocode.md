# FormAgent -- SPARC Pseudocode

> Cross-references: [Specification](./01-specification.md) | [Architecture](./03-architecture.md) | [Domain Model](../ddd/domain-model.md)

All algorithms below use pseudocode notation, not Python.

---

## 1. Auth Flow: Signup

```
FUNCTION signup(email, password, name, workspace_name):
    VALIDATE email matches RFC 5322 format
    VALIDATE password length >= 8
    IF account EXISTS with email:
        RETURN error 409 "Email already registered"

    password_hash = BCRYPT_HASH(password)
    account_id   = GENERATE_ID("acct")
    workspace_id = GENERATE_ID("ws")
    membership_id = GENERATE_ID("wm")
    slug          = SLUGIFY(workspace_name)

    BEGIN TRANSACTION
        INSERT accounts (id=account_id, email, name, password_hash, status="active", created_at=NOW)
        INSERT workspaces (id=workspace_id, name=workspace_name, slug, owner_account_id=account_id, status="active", created_at=NOW)
        INSERT workspace_memberships (id=membership_id, workspace_id, account_id, role="owner", status="active", joined_at=NOW)
    COMMIT

    token = GENERATE_JWT(sub=account_id, workspace_id, role="owner", exp=NOW + 24h)
    session_id = GENERATE_ID("sess")
    INSERT sessions (id=session_id, account_id, workspace_id, token_hash=SHA256(token), expires_at=NOW+24h, created_at=NOW)

    RETURN { token, account, workspace }
```

---

## 2. Auth Flow: Login

```
FUNCTION login(email, password):
    account = SELECT FROM accounts WHERE email = email
    IF account IS NULL:
        RETURN error 401 "Invalid credentials"
    IF NOT BCRYPT_VERIFY(password, account.password_hash):
        RETURN error 401 "Invalid credentials"

    memberships = SELECT FROM workspace_memberships WHERE account_id = account.id AND status = "active"
    workspaces = LOAD workspaces for each membership

    IF workspaces.length == 1:
        selected_workspace = workspaces[0]
    ELSE:
        selected_workspace = workspaces[0]  // client picks later

    token = GENERATE_JWT(sub=account.id, workspace_id=selected_workspace.id, role=membership.role, exp=NOW + 24h)
    INSERT session record
    UPDATE accounts SET last_login_at = NOW WHERE id = account.id

    RETURN { token, account, workspace: selected_workspace, workspaces }
```

---

## 3. get_current_context() Middleware

```
FUNCTION get_current_context(request):
    auth_header = request.headers["Authorization"]

    IF auth_header IS EMPTY:
        RAISE 401 "Missing authorization"

    IF auth_header STARTS WITH "Bearer fa_":
        raw_key = auth_header[7:]
        RETURN validate_api_key(raw_key)

    ELSE IF auth_header STARTS WITH "Bearer ":
        token = auth_header[7:]
        RETURN validate_jwt(token)

    ELSE:
        RAISE 401 "Invalid authorization format"

FUNCTION validate_jwt(token):
    payload = JWT_DECODE(token, secret, algorithm="HS256")
    IF payload IS INVALID OR EXPIRED:
        RAISE 401 "Token expired or invalid"

    session = SELECT FROM sessions WHERE token_hash = SHA256(token)
    IF session IS NULL OR session.expires_at < NOW:
        RAISE 401 "Session revoked or expired"

    RETURN AuthContext(
        account_id  = payload.sub,
        workspace_id = payload.workspace_id,
        role         = payload.role
    )

FUNCTION validate_api_key(raw_key):
    key_hash = SHA256(raw_key)
    api_key = SELECT FROM api_keys WHERE key_hash = key_hash
    IF api_key IS NULL:
        RAISE 401 "Invalid API key"
    IF api_key.status != "active":
        RAISE 401 "API key revoked"
    IF api_key.expires_at IS NOT NULL AND api_key.expires_at < NOW:
        RAISE 401 "API key expired"

    UPDATE api_keys SET last_used_at = NOW WHERE id = api_key.id

    RETURN AuthContext(
        account_id   = api_key.account_id,
        workspace_id = api_key.workspace_id,
        role         = "api_key",
        permissions  = api_key.permissions
    )
```

---

## 4. Submission Processing Pipeline (11 Steps)

```
FUNCTION handle_submission(form_id, request_body, request_meta):

    // --- Step 1: Form Lookup ---
    form = SELECT FROM forms WHERE id = form_id AND status = "active"
    IF form IS NULL:
        RETURN 404

    // --- Step 2: CORS Check ---
    origin = request_meta.origin
    IF form.security.allowed_origins IS NOT EMPTY:
        IF origin NOT IN form.security.allowed_origins:
            RETURN 403 "Origin not allowed"

    // --- Step 3: Parse Body ---
    honeypot_value = request_body["_hp"]
    experiment_id  = request_body["_experiment_id"]
    variant_id     = request_body["_variant_id"]
    meta_fields    = request_body["_meta"]        // utm_*, page_url, referrer
    field_interactions = request_body["_field_interactions"]
    submission_data = REMOVE all keys starting with "_" from request_body

    // --- Step 4: Field Validation ---
    errors = EMPTY MAP
    FOR EACH field_def IN form.fields:
        value = submission_data[field_def.name]
        IF field_def.required AND value IS EMPTY:
            errors[field_def.name] = "Required"
        ELSE IF value IS NOT EMPTY:
            VALIDATE value against field_def.type rules
            IF invalid: errors[field_def.name] = error_message
    IF errors IS NOT EMPTY:
        RETURN 422 { errors }

    // --- Step 5: Anti-Spam ---
    spam_result = run_anti_spam(form, submission_data, meta_fields, honeypot_value)
    IF spam_result.rejected:
        LOG to spam_log
        RETURN spam_result.http_code

    // --- Step 6: Store ---
    submission_id = GENERATE_ID("sub")
    INSERT submissions (
        id=submission_id, form_id, form_type=form.type, flow_id=form.flow_id,
        data=submission_data, meta=meta_fields, field_interactions,
        status="received", created_at=NOW
    )
    EMIT event "submission_received"

    // --- Step 7: A/B Tag ---
    IF experiment_id IS NOT NULL:
        UPDATE submissions SET meta.experiment_id = experiment_id, meta.variant_id = variant_id
        EMIT event "experiment_variant"

    // --- Steps 8-11: Async ---
    SPAWN_BACKGROUND_THREAD(process_submission_async, submission_id, form)

    RETURN 200 { submission_id, message: form.response.thank_you_message, redirect_url: form.response.redirect_url }

FUNCTION process_submission_async(submission_id, form):
    submission = LOAD submission by id

    // --- Step 8: Contact Match ---
    email = submission.data["email"]
    contact = match_or_create_contact(form.workspace_id, submission)
    UPDATE submissions SET contact_id = contact.id, is_new_contact = contact.is_new

    // --- Step 9: Company Match ---
    company_name = submission.data["company_name"]
    IF company_name IS NOT NULL:
        company = match_or_create_company(form.workspace_id, company_name)
        UPDATE submissions SET company_id = company.id
        UPDATE contacts SET company_id = company.id WHERE id = contact.id

    // --- Step 10: Attribution ---
    touchpoint = BUILD_TOUCHPOINT(submission)
    APPEND touchpoint to contact.touchpoints
    UPDATE contacts SET touchpoints, last_seen=NOW, submission_count += 1

    // --- Step 11: Execute Flow ---
    UPDATE submissions SET status = "processing"
    TRY:
        execute_flow(form.flow_id, submission, contact, form)
        UPDATE submissions SET status = "processed", processed_at = NOW
    CATCH error:
        handle_error(submission_id, error)
```

---

## 5. Anti-Spam Pipeline

```
FUNCTION run_anti_spam(form, data, meta, honeypot_value):
    security = form.security

    // Check 1: Honeypot
    IF honeypot_value IS NOT EMPTY:
        RETURN { rejected: true, reason: "honeypot", http_code: 200 }

    // Check 2: IP Rate Limit
    ip = meta.ip
    recent_ip_count = COUNT FROM submissions
        WHERE form_id = form.id AND meta->ip = ip AND created_at > NOW - 1 HOUR
    recent_ip_spam = COUNT FROM spam_log
        WHERE form_id = form.id AND ip_address = ip AND created_at > NOW - 1 HOUR
    IF (recent_ip_count + recent_ip_spam) >= security.max_submissions_per_ip:
        RETURN { rejected: true, reason: "ip_rate_limit", http_code: 429 }

    // Check 3: Email Rate Limit
    email = data["email"]
    IF email IS NOT NULL:
        recent_email_count = COUNT FROM submissions
            WHERE form_id = form.id AND data->email = email AND created_at > NOW - 1 HOUR
        IF recent_email_count >= security.max_submissions_per_email:
            RETURN { rejected: true, reason: "email_rate_limit", http_code: 429 }

    // Check 4: Duplicate
    IF email IS NOT NULL:
        dup_count = COUNT FROM submissions
            WHERE form_id = form.id AND data->email = email
            AND created_at > NOW - security.duplicate_window_minutes MINUTES
        IF dup_count > 0:
            RETURN { rejected: true, reason: "duplicate", http_code: 422 }

    RETURN { rejected: false }
```

---

## 6. Contact Resolution

```
FUNCTION match_or_create_contact(workspace_id, submission):
    email = submission.data["email"]
    IF email IS NULL:
        RETURN NULL

    existing = SELECT FROM contacts WHERE workspace_id = workspace_id AND email = email

    IF existing IS NOT NULL:
        // Merge: update only NULL fields with new data
        FOR EACH mapping IN form.field_mapping:
            target_field = mapping.target
            new_value = submission.data[mapping.source]
            IF existing[target_field] IS NULL AND new_value IS NOT NULL:
                SET existing[target_field] = new_value
        UPDATE contacts SET updated fields, last_seen = NOW, submission_count += 1
        RETURN { contact: existing, is_new: false }

    ELSE:
        contact_id = GENERATE_ID("contact")
        name = submission.data["first_name"] OR submission.data["name"]
        phone = submission.data["phone"]
        INSERT contacts (id=contact_id, workspace_id, email, name, phone,
            status="lead", source="inbound_form", first_seen=NOW, last_seen=NOW,
            submission_count=1, created_at=NOW)
        EMIT event "contact_created"
        RETURN { contact: new_contact, is_new: true }

FUNCTION match_or_create_company(workspace_id, company_name):
    existing = SELECT FROM companies WHERE workspace_id = workspace_id AND LOWER(name) = LOWER(company_name)
    IF existing IS NOT NULL:
        RETURN existing
    company_id = GENERATE_ID("company")
    INSERT companies (id=company_id, workspace_id, name=company_name, source="inbound_form", created_at=NOW)
    RETURN new_company
```

---

## 7. Handler Routing (4 Strategies)

```
FUNCTION route_to_handler(form, submission):
    IF form.entity == "agent":
        RETURN { type: "agent", id: form.entity_id }
    IF form.entity == "human":
        RETURN { type: "human", id: form.entity_id }

    // Handler group routing
    group = SELECT FROM handler_groups WHERE id = form.entity_id
    active_members = FILTER group.members WHERE active = true

    IF active_members IS EMPTY:
        IF group.settings.fallback_handler_id IS NOT NULL:
            RETURN { type: "fallback", id: group.settings.fallback_handler_id }
        RETURN NULL  // unassigned queue

    SWITCH group.routing_strategy:
        CASE "principal":
            principal = FIND member WHERE role = "principal" AND active = true
            IF principal IS NULL:
                RETURN { type: "fallback", id: group.settings.fallback_handler_id }
            RETURN { type: principal.type, id: principal.handler_id }

        CASE "round_robin":
            index = (group.last_assigned_index + 1) MOD active_members.length
            selected = active_members[index]
            UPDATE handler_groups SET last_assigned_index = index
            RETURN { type: selected.type, id: selected.handler_id }

        CASE "least_loaded":
            counts = group.assignment_count
            selected = active_member WITH MIN(counts[member.handler_id] OR 0)
            counts[selected.handler_id] = (counts[selected.handler_id] OR 0) + 1
            UPDATE handler_groups SET assignment_count = counts
            RETURN { type: selected.type, id: selected.handler_id }

        CASE "broadcast":
            FOR EACH member IN active_members:
                NOTIFY member of new submission
            RETURN { type: "broadcast", ids: active_members.map(m -> m.handler_id) }
```

---

## 8. Agent Processing Pipeline

```
FUNCTION process_with_agent(submission, contact, form):
    EMIT event "agent_processing"

    // Step 1: Build prompt
    system_prompt = BUILD_AGENT_SYSTEM_PROMPT(form, submission, contact)
    /*  Includes: form purpose, allowed_actions, autonomy instructions,
        contact history, current submission data, company info  */

    // Step 2: Call Claude
    TRY:
        response = CALL_CLAUDE_API(system_prompt, max_retries=3)
    CATCH timeout_or_error:
        RETURN handle_llm_error(submission, error)

    // Step 3: Parse and validate actions
    action_plan = PARSE_JSON(response)
    IF action_plan IS INVALID:
        response = RETRY_CLAUDE_WITH_STRICTER_PROMPT(system_prompt)
        action_plan = PARSE_JSON(response)
        IF action_plan IS STILL INVALID:
            ESCALATE_TO_HUMAN(submission, "Unparseable LLM response")
            RETURN

    validated_actions = EMPTY LIST
    FOR EACH action IN action_plan.actions:
        IF action.action NOT IN form.agent.allowed_actions:
            LOG_VIOLATION(submission, action.action, "Action not allowed")
            EMIT event "agent_action_blocked"
        ELSE:
            APPEND action TO validated_actions

    // Step 4: Execute or Draft based on autonomy level
    SWITCH form.agent.autonomy_level:
        CASE "fully_autonomous":
            FOR EACH action IN validated_actions:
                execute_action(action, submission, contact)
                EMIT event "agent_action"

        CASE "semi_autonomous":
            FOR EACH action IN validated_actions:
                execute_action(action, submission, contact)
                EMIT event "agent_action"
            FLAG submission for human review within configured window

        CASE "draft":
            draft_id = GENERATE_ID("draft")
            INSERT drafts (id=draft_id, submission_id, handler_id,
                planned_actions=validated_actions, draft_content=action_plan,
                status="pending", created_at=NOW)
            EMIT event "agent_draft"
            NOTIFY handler of pending draft

        CASE "notify_only":
            summary = action_plan.reasoning
            UPDATE submissions SET agent_notes = summary
            EMIT event "agent_completed"
            NOTIFY handler with summary

    // Step 5: Log and update
    IF action_plan.contact_updates IS NOT NULL:
        APPLY contact_updates.tags_add to contact.tags
        INSERT contact_notes (note=contact_updates.notes, source="agent")
    UPDATE submissions SET agent_notes = action_plan.reasoning
    EMIT event "agent_completed"
```

---

## 9. Error Recovery with Exponential Backoff

```
FUNCTION handle_llm_error(submission, error, attempt=1):
    MAX_RETRIES = 3
    DELAYS = [2000, 4000, 8000]  // milliseconds

    error_id = GENERATE_ID("err")
    INSERT errors (id=error_id, submission_id, error_type=error.type, attempt, details=error.message, created_at=NOW)
    EMIT event "agent_error"

    IF attempt <= MAX_RETRIES:
        SLEEP(DELAYS[attempt - 1])
        EMIT event "agent_retry"
        TRY:
            RETURN retry_agent_processing(submission, attempt + 1)
        CATCH:
            RETURN handle_llm_error(submission, error, attempt + 1)

    // All retries exhausted
    UPDATE submissions SET status = "needs_human_review"
    UPDATE errors SET recovery_action = "escalated", escalated_to = fallback_handler
    EMIT event "agent_escalated"
    NOTIFY fallback handler
```

---

## 10. Sequence Processor Background Job

```
FUNCTION process_due_enrollments():
    // Runs every 60 seconds as daemon thread
    LOOP FOREVER:
        due = SELECT FROM enrollments
            WHERE status = "active" AND next_step_due_at <= NOW

        FOR EACH enrollment IN due:
            sequence = LOAD sequence by enrollment.sequence_id
            contact  = LOAD contact by enrollment.contact_id

            // Check stop conditions
            FOR EACH condition IN sequence.stop_conditions:
                IF evaluate_stop_condition(condition, contact, enrollment):
                    UPDATE enrollments SET status = "stopped", stop_reason = condition
                    CONTINUE next enrollment

            // Get current step
            step = SELECT FROM sequence_steps
                WHERE sequence_id = enrollment.sequence_id AND order = enrollment.current_step

            IF step IS NULL:
                UPDATE enrollments SET status = "completed", completed_at = NOW
                CONTINUE

            // Send email with variable substitution
            body = REPLACE_VARIABLES(step.email_body, contact)
            subject = REPLACE_VARIABLES(step.email_subject, contact)

            IF step.agent_personalize:
                body = CALL_CLAUDE_TO_PERSONALIZE(body, contact)

            SEND_EMAIL(to=contact.email, subject, body)

            // Update enrollment
            APPEND { step: enrollment.current_step, status: "sent", sent_at: NOW } to enrollment.history

            next_step = SELECT FROM sequence_steps
                WHERE sequence_id = enrollment.sequence_id AND order = enrollment.current_step + 1

            IF next_step IS NULL:
                UPDATE enrollments SET status = "completed", completed_at = NOW, current_step += 1
            ELSE:
                next_due = NOW + next_step.delay_days DAYS + next_step.delay_hours HOURS
                UPDATE enrollments SET current_step += 1, next_step_due_at = next_due

        SLEEP 60 seconds
```

---

## 11. A/B Traffic Splitting

```
FUNCTION get_form_schema(form_id):
    form = LOAD form by id
    experiment = SELECT FROM experiments WHERE form_id = form.id AND status = "active"

    IF experiment IS NULL:
        RETURN form.fields  // no experiment, return base

    // Weighted random selection
    total_weight = SUM(variant.weight FOR variant IN experiment.variants)
    random_value = RANDOM(0, total_weight)
    cumulative = 0
    selected_variant = NULL

    FOR EACH variant IN experiment.variants:
        cumulative += variant.weight
        IF random_value <= cumulative:
            selected_variant = variant
            BREAK

    // Apply overrides
    IF selected_variant.overrides IS NOT NULL:
        fields = selected_variant.overrides.fields
    ELSE:
        fields = form.fields  // control

    RETURN {
        fields,
        experiment_id: experiment.id,
        variant_id: selected_variant.id,
        form_meta: { name: form.name, response: form.response }
    }
```

---

## 12. Optimization Autopilot Cycle

```
FUNCTION optimize_experiment(experiment_id):
    experiment = LOAD experiment by id
    VALIDATE experiment.status == "active"

    // Compute per-variant stats
    stats = EMPTY LIST
    FOR EACH variant IN experiment.variants:
        subs = SELECT FROM submissions
            WHERE meta->experiment_id = experiment.id AND meta->variant_id = variant.id
        stat = {
            variant_id: variant.id,
            submissions: COUNT(subs),
            processed: COUNT(subs WHERE status = "processed"),
            contacts: COUNT(subs WHERE is_new_contact = true),
            deals: COUNT DISTINCT deals WHERE source_submission_id IN subs,
            revenue: SUM deals.amount WHERE source_submission_id IN subs,
            conversion_rate: COMPUTE based on experiment.metric
        }
        APPEND stat TO stats

    // Check sample size
    FOR EACH stat IN stats:
        IF stat.submissions < experiment.min_sample_size:
            RETURN { action: "waiting", variant_progress: stats }

    // Determine winner
    winner = stat WITH HIGHEST conversion_rate
    runner_up = stat WITH SECOND HIGHEST conversion_rate
    improvement = (winner.conversion_rate - runner_up.conversion_rate) / runner_up.conversion_rate

    IF improvement <= 0.10:
        RETURN { action: "no_clear_winner", stats }

    // Promote winner
    winner_variant = FIND variant by winner.variant_id
    IF winner_variant.overrides IS NOT NULL:
        APPLY winner_variant.overrides to base form
    APPEND to experiment.optimization_log { action: "optimized", promoted: winner.variant_id }

    // Generate new challenger via Claude
    new_overrides = CALL_CLAUDE_OPTIMIZER(form.fields, experiment.metric, stats)
    new_variant = { id: GENERATE_ID("var"), label: "Auto-generated", weight: 50, overrides: new_overrides }
    SET winner_variant.weight = 50, winner_variant.overrides = NULL  // becomes new control
    REPLACE experiment.variants with [winner_variant, new_variant]
    RESET experiment stats

    RETURN { action: "optimized", promoted: winner.variant_id, new_variant: new_variant.id, stats }
```
