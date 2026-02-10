# FormAgent -- SPARC Refinement (TDD Anchors)

> Cross-references: [Specification](./01-specification.md) | [Pseudocode](./02-pseudocode.md) | [Architecture](./03-architecture.md)

Every test specification below is a TDD anchor: write the test first, then implement until it passes.

---

## 1. Unit Test Specs: auth_service

### 1.1 Password Hashing

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| AUTH-U01 | Hash password produces bcrypt string | Call `hash_password("Test1234")` | Result starts with `$2b$` |
| AUTH-U02 | Verify correct password | Hash then verify same password | Returns `True` |
| AUTH-U03 | Verify wrong password | Hash "A", verify "B" | Returns `False` |
| AUTH-U04 | Reject password under 8 chars | Call `validate_password("short")` | Raises validation error |

### 1.2 JWT Generation and Validation

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| AUTH-U05 | Generate JWT with correct claims | Generate for acct_1, ws_1, owner | Decode contains sub=acct_1, workspace_id=ws_1, role=owner |
| AUTH-U06 | JWT expires after configured TTL | Generate with exp=1s, wait 2s | Decode raises ExpiredTokenError |
| AUTH-U07 | JWT with tampered signature | Modify payload, keep signature | Decode raises InvalidTokenError |
| AUTH-U08 | Extract workspace_id from valid JWT | Generate and decode | workspace_id matches |

### 1.3 API Key Validation

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| AUTH-U09 | Valid API key returns context | Insert key, validate with raw key | Returns correct workspace_id |
| AUTH-U10 | Revoked API key rejected | Insert key with status=revoked | Raises 401 |
| AUTH-U11 | Expired API key rejected | Insert key with expires_at in past | Raises 401 |
| AUTH-U12 | Unknown API key rejected | Validate random key | Raises 401 |

---

## 2. Unit Test Specs: contact_matcher

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| CM-U01 | New email creates contact | Empty DB, submit with jane@acme.com | New contact created, is_new=True |
| CM-U02 | Existing email matches contact | Insert contact jane@acme.com, submit same | Returns existing contact, is_new=False |
| CM-U03 | Merge does not overwrite existing fields | Contact has name="Jane", submit with name="J" | Name stays "Jane" |
| CM-U04 | Merge fills null fields | Contact has phone=null, submit with phone="+1555" | Phone updated to "+1555" |
| CM-U05 | submission_count increments | Contact with count=2, new submission | count becomes 3 |
| CM-U06 | last_seen updated on match | Contact with old last_seen, new submission | last_seen = now |
| CM-U07 | Company match by name (case-insensitive) | Insert "Acme Corp", submit "acme corp" | Matches existing company |
| CM-U08 | Company created if no match | No companies, submit with "NewCo" | New company created |
| CM-U09 | Contact linked to company | Match contact + company | contact.company_id = company.id |
| CM-U10 | Workspace isolation: same email, different workspace | Contact in ws_A, search in ws_B | Not found, creates new |

---

## 3. Unit Test Specs: spam.py

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| SPAM-U01 | Honeypot empty passes | _hp="" | rejected=False |
| SPAM-U02 | Honeypot filled rejects silently | _hp="bot_value" | rejected=True, http_code=200 |
| SPAM-U03 | IP under limit passes | 3 submissions from same IP (limit=10) | rejected=False |
| SPAM-U04 | IP at limit rejects | 10 submissions from same IP (limit=10) | rejected=True, http_code=429 |
| SPAM-U05 | Email under limit passes | 2 submissions from same email (limit=5) | rejected=False |
| SPAM-U06 | Email at limit rejects | 5 submissions from same email (limit=5) | rejected=True, http_code=429 |
| SPAM-U07 | Duplicate within window rejects | Same email+form 2 min ago (window=5) | rejected=True, http_code=422 |
| SPAM-U08 | Duplicate outside window passes | Same email+form 10 min ago (window=5) | rejected=False |
| SPAM-U09 | Rejection logged to spam_log | Any rejection | spam_log has 1 record with correct reason |

---

## 4. Unit Test Specs: router.py

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| RTR-U01 | Principal routes to principal member | Group with principal=agent_A | Returns agent_A |
| RTR-U02 | Principal falls back when inactive | Principal inactive, fallback=human_B | Returns human_B |
| RTR-U03 | Round-robin cycles through members | 3 members, last_index=0 | Returns member[1], index updated to 1 |
| RTR-U04 | Round-robin skips inactive | Members [A(active), B(inactive), C(active)], last=0 | Returns C (skips B) |
| RTR-U05 | Round-robin wraps around | 3 members, last_index=2 | Returns member[0] |
| RTR-U06 | Least-loaded picks lowest count | Counts: A=5, B=3, C=7 | Returns B, B count becomes 4 |
| RTR-U07 | Broadcast returns all active | 3 active, 1 inactive | Returns 3 handler IDs |
| RTR-U08 | All inactive falls back | All members inactive, fallback set | Returns fallback |
| RTR-U09 | All inactive no fallback returns null | All members inactive, no fallback | Returns null (unassigned) |

---

## 5. Unit Test Specs: flow_engine

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| FLOW-U01 | notify_only skips contact matching | flow_id=notify_only | No contact created, handlers notified |
| FLOW-U02 | email_marketing creates contact + enrolls | flow_id=email_marketing with sequence | Contact created, enrollment created |
| FLOW-U03 | sales_lead routes to handler group | flow_id=sales_lead, entity=handler_group | router.route_to_handler called |
| FLOW-U04 | direct_route creates task | flow_id=direct_route | Task created for handler |
| FLOW-U05 | Submission status updated to processed on success | Any flow completes | status="processed", processed_at set |
| FLOW-U06 | Submission status updated to failed on error | Flow raises exception, retries exhausted | status="failed" |

---

## 6. Unit Test Specs: agent_processor

| Test ID | Description | Setup | Assert |
|---------|-------------|-------|--------|
| AGT-U01 | Allowed action executes | allowed_actions=["send_email"], plan has send_email | Action executed |
| AGT-U02 | Disallowed action blocked | allowed_actions=["send_email"], plan has create_deal | create_deal not executed, violation logged |
| AGT-U03 | fully_autonomous executes immediately | autonomy=fully_autonomous | All actions executed, no draft |
| AGT-U04 | draft mode creates draft record | autonomy=draft | Draft inserted with status=pending |
| AGT-U05 | notify_only stores summary only | autonomy=notify_only | No actions executed, agent_notes set |
| AGT-U06 | Unparseable response triggers re-prompt | Claude returns invalid JSON | Second call with stricter prompt |
| AGT-U07 | Contact tags updated from plan | plan.contact_updates.tags_add=["qualified"] | Contact tags include "qualified" |
| AGT-U08 | Contact note created from plan | plan.contact_updates.notes="High intent" | contact_notes record created |

---

## 7. Integration Test Specs

### 7.1 Full Signup-to-Submission Flow

| Test ID | Description |
|---------|-------------|
| INT-01 | Signup -> create form -> submit -> verify submission stored with correct workspace_id |
| INT-02 | Signup -> create form -> submit with agent flow -> verify contact + deal created |
| INT-03 | Signup -> create form -> submit spam -> verify rejection logged, no contact created |
| INT-04 | Signup -> create handler group -> assign to form -> submit -> verify routing works |

### 7.2 Campaign + Sequence Flow

| Test ID | Description |
|---------|-------------|
| INT-05 | Create campaign with sequence -> submit to campaign form -> verify enrollment created |
| INT-06 | Enrollment active -> advance time -> run sequence processor -> verify email sent + step advanced |
| INT-07 | Enrollment active -> trigger stop condition (deal_created) -> verify enrollment stopped |

### 7.3 Experiment Flow

| Test ID | Description |
|---------|-------------|
| INT-08 | Create experiment -> request schema multiple times -> verify traffic split |
| INT-09 | Submit with variant tag -> verify submission tagged correctly |
| INT-10 | Optimize with sufficient data -> verify winner promoted, new variant created |
| INT-11 | Optimize with insufficient data -> verify "waiting" response |

---

## 8. API Endpoint Test Specs

### 8.1 Auth Endpoints

| Test ID | Endpoint | Scenario | Expected |
|---------|----------|----------|----------|
| API-01 | POST /api/auth/signup | Valid data | 200 + token + account + workspace |
| API-02 | POST /api/auth/signup | Duplicate email | 409 |
| API-03 | POST /api/auth/signup | Short password | 422 |
| API-04 | POST /api/auth/login | Valid credentials | 200 + token |
| API-05 | POST /api/auth/login | Wrong password | 401 |
| API-06 | POST /api/auth/login | Unknown email | 401 |
| API-07 | POST /api/auth/logout | Valid session | 200, session invalidated |
| API-08 | GET /api/auth/me | Valid JWT | 200 + account + workspace |
| API-09 | GET /api/auth/me | Expired JWT | 401 |
| API-10 | POST /api/auth/switch-workspace | Member of target | 200 + new token |
| API-11 | POST /api/auth/switch-workspace | Not member of target | 403 |

### 8.2 Form CRUD

| Test ID | Endpoint | Scenario | Expected |
|---------|----------|----------|----------|
| API-12 | POST /api/forms | Valid form config | 201 + form with id |
| API-13 | GET /api/forms | Authenticated | 200 + forms for workspace only |
| API-14 | GET /api/forms/{id} | Own workspace | 200 + form detail |
| API-15 | GET /api/forms/{id} | Other workspace | 404 |
| API-16 | PUT /api/forms/{id} | Valid update | 200 + updated form |
| API-17 | DELETE /api/forms/{id} | Own form | 200, form archived |

### 8.3 Submission Flow

| Test ID | Endpoint | Scenario | Expected |
|---------|----------|----------|----------|
| API-18 | POST /api/submissions/{form_id} | Valid submission | 200 + submission_id |
| API-19 | POST /api/submissions/{form_id} | Missing required field | 422 + field errors |
| API-20 | POST /api/submissions/{form_id} | Invalid email format | 422 |
| API-21 | POST /api/submissions/{form_id} | Honeypot filled | 200 (silent reject) |
| API-22 | POST /api/submissions/{form_id} | Inactive form | 404 |
| API-23 | OPTIONS /api/submissions/{form_id} | CORS preflight | 200 + CORS headers |

### 8.4 Analytics

| Test ID | Endpoint | Scenario | Expected |
|---------|----------|----------|----------|
| API-24 | GET /api/analytics/overview | With data | 200 + KPIs with deltas |
| API-25 | GET /api/analytics/funnel | With data | 200 + stage counts |
| API-26 | GET /api/analytics/channels | With UTM data | 200 + per-source breakdown |

---

## 9. Edge Case Test Specs

### 9.1 Workspace Isolation

| Test ID | Description | Assert |
|---------|-------------|--------|
| EDGE-01 | User A cannot list User B's forms | GET /api/forms with A's token returns only A's forms |
| EDGE-02 | User A cannot view User B's submission | GET /api/submissions/{b_sub_id} with A's token returns 404 |
| EDGE-03 | Contact with same email in two workspaces | Each workspace has independent contact record |
| EDGE-04 | API key scoped to workspace | API key for ws_A cannot access ws_B data |

### 9.2 Auth Edge Cases

| Test ID | Description | Assert |
|---------|-------------|--------|
| EDGE-05 | Expired JWT rejected | 401 returned |
| EDGE-06 | Revoked session rejected | Logout, then use same token: 401 |
| EDGE-07 | Viewer role cannot create form | POST /api/forms with viewer token: 403 |
| EDGE-08 | Member cannot invite | POST /api/workspaces/{id}/invite with member token: 403 |

### 9.3 Agent Edge Cases

| Test ID | Description | Assert |
|---------|-------------|--------|
| EDGE-09 | Agent uses disallowed action | Action blocked, violation logged, valid actions still execute |
| EDGE-10 | All handler group members inactive | Submission status=received, in unassigned queue |
| EDGE-11 | Claude returns invalid JSON | Re-prompt attempted, then escalated if still invalid |
| EDGE-12 | Claude API timeout | 3 retries with backoff, then escalated |

### 9.4 Data Edge Cases

| Test ID | Description | Assert |
|---------|-------------|--------|
| EDGE-13 | Submission with no email field | No contact matching attempted, flow continues |
| EDGE-14 | Form with no handler group | Submission stored, status stays received |
| EDGE-15 | Experiment with 0 submissions | Optimize returns "waiting" |
| EDGE-16 | Sequence with 0 steps | Enrollment immediately completed |

---

## 10. Performance Test Specs

| Test ID | Description | Target |
|---------|-------------|--------|
| PERF-01 | Single submission end-to-end (sync portion) | < 200ms for steps 1-7 |
| PERF-02 | 50 concurrent submissions to same form | All return 200, no SQLite lock errors |
| PERF-03 | Analytics query over 10K submissions | < 500ms response time |
| PERF-04 | Sequence processor with 1000 due enrollments | Processes all within 60s cycle |
| PERF-05 | Form schema endpoint with active experiment | < 50ms response time |

---

## 11. Security Test Specs

| Test ID | Description | Assert |
|---------|-------------|--------|
| SEC-01 | Cross-workspace access via direct ID | 404 returned (not 403, to avoid ID enumeration) |
| SEC-02 | SQL injection in form field values | Values stored safely, no SQL execution |
| SEC-03 | SQL injection in query parameters | Parameterized queries prevent injection |
| SEC-04 | CORS: submission from unlisted origin | Rejected when allowed_origins is non-empty |
| SEC-05 | CORS: submission with empty allowed_origins | Allowed (wildcard behavior) |
| SEC-06 | JWT with wrong secret | 401 returned |
| SEC-07 | Brute force login | Rate limited after 5 attempts per email per 15 min |
| SEC-08 | API key not exposed in GET /api/api-keys | Only key_prefix returned, never full key or hash |
| SEC-09 | Password not returned in any API response | Verify no endpoint returns password_hash |
| SEC-10 | XSS in submission data | Stored as-is but never rendered as HTML server-side |
