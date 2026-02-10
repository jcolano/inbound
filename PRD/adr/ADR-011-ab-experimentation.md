# ADR-011: A/B Experimentation with Variant Overrides

## Status
Accepted

## Context
FormAgent needs to support A/B testing of form configurations to optimize conversion rates, contact creation, deal creation, and revenue. The system generates forms via LLM (see [ADR-007](./ADR-007-claude-api-integration.md)) and serves them via an embed script on external websites (see [ADR-013](./ADR-013-embed-architecture.md)).

Key requirements:
- Experiments compare different form configurations (field sets, labels, placeholders) for the same form
- Traffic is split between variants using weighted random assignment
- The embed script must transparently serve the correct variant
- Results are tracked at the submission level (which variant produced which outcome)
- An "autopilot" mode uses the Claude API to automatically promote winners and generate new challengers
- Guardrails prevent destructive changes (removing required fields, promoting without sufficient data)

A central design question is how variants relate to the base form: should each variant store a complete form configuration, or only the differences from the base?

## Decision
We implement A/B experimentation using **variant overrides** -- partial form configurations that are merged on top of the base form.

### Experiment Data Model

```json
{
  "id": "exp_xxx",
  "form_id": "form_xxx",
  "status": "active",
  "metric": "conversion_rate",
  "min_sample_size": 30,
  "variants": [
    {
      "id": "ctrl",
      "label": "Control",
      "weight": 50,
      "overrides": null
    },
    {
      "id": "var_a",
      "label": "Shorter form",
      "weight": 50,
      "overrides": {
        "fields": [
          {"name": "first_name", "type": "text", "label": "Name", "required": true},
          {"name": "email", "type": "email", "label": "Email", "required": true},
          {"name": "message", "type": "textarea", "label": "How can we help?", "required": false}
        ]
      }
    }
  ],
  "winner_variant_id": null,
  "optimization_log": []
}
```

**Key design:** `overrides: null` means "use the base form as-is" (control group). `overrides` with content is a partial config that replaces corresponding sections of the base form. For fields, the entire `fields` array is replaced (not merged field-by-field), because field ordering matters.

### Traffic Splitting

When `GET /api/forms/{form_id}/schema` is called by the embed script:

1. Check if an active experiment exists for this form
2. If yes, perform weighted random selection across variants
3. If selected variant has overrides, merge them onto the base form config
4. Return the merged schema with `experiment_id` and `variant_id` as metadata
5. The embed script includes these as hidden fields: `_experiment_id`, `_variant_id`
6. On submission, these are stored in `meta.experiment_id` and `meta.variant_id`

### Constraints

- **One active experiment per form.** Creating a new experiment for a form with an existing active experiment is rejected. This simplifies traffic splitting and prevents overlapping experiments from confounding results.
- **Required fields cannot be removed by variants.** The optimizer's prompt explicitly constrains it: "Preserve all required fields from the base form."
- **Minimum sample size before promotion.** The `min_sample_size` (default: 30) must be reached by all variants before the autopilot can promote a winner.

### Autopilot Optimization

`POST /api/experiments/{exp_id}/optimize` triggers the optimization cycle:

1. Compute per-variant stats (submissions, conversions, contacts, deals, revenue)
2. Check if all variants have >= `min_sample_size` submissions
3. If not: return `{"action": "waiting", "message": "Need more data"}`
4. Determine winner based on experiment metric
5. If winner beats runner-up by >10%:
   a. Apply winner's overrides to the base form
   b. Generate new challenger via Claude API
   c. Set winner (now the new control) at 50% weight, new challenger at 50%
   d. Log to `optimization_log`
6. If winner does not beat by >10%: continue collecting data

**Auto-rollback guardrail:** If performance drops >15% within 48 hours of an optimization, the system flags for human review.

### Metric Options

| Metric | Calculation |
|--------|------------|
| `conversion_rate` | processed / total submissions |
| `contacts` | contacts created / total submissions |
| `deals` | deals created / total submissions |
| `revenue` | total revenue from submission-linked deals |

## Consequences

### Positive
- **Storage efficiency:** Variants store only differences, not entire form configs. A variant that changes only field labels stores just the modified fields array, not the full form with security config, agent config, response config, etc.
- **Base form changes propagate:** If the operator updates the base form's security config or agent instructions, those changes apply to all variants automatically (since variants only override specific sections).
- **Clean control group:** `overrides: null` unambiguously means the base form is the control. No risk of control drift if the override copy gets out of sync.
- **LLM-compatible format:** The Claude API generates challengers as partial configs. The override format matches the LLM's output directly, requiring no transformation.
- **One-experiment-per-form simplicity:** No need for experiment layering, traffic allocation across multiple experiments, or interaction effects analysis.
- **Auditable optimization:** Every autopilot action is logged in `optimization_log` with timestamps, variant IDs, and performance stats.

### Negative
- **Field-level merge limitations:** The current design replaces the entire `fields` array. A variant cannot modify a single field while keeping others unchanged -- it must specify all fields. This leads to larger override payloads for minor changes (e.g., changing one label).
- **One experiment per form is restrictive:** Cannot simultaneously test field changes and response message changes on the same form. Sequential experiments are slower than parallel.
- **No session-based consistency:** Variant assignment is per-request (per schema fetch), not per-visitor. A returning visitor may see a different variant on their next visit. This can be mitigated with cookie-based variant pinning in the embed script, but it is not implemented in the base design.
- **Statistical rigor is basic:** The >10% improvement threshold is a fixed rule, not a statistical significance test (no p-values, no confidence intervals). This can lead to false positives at small sample sizes near the minimum threshold.
- **Autopilot compounding risk:** Continuous automated optimization (promote winner, generate challenger, repeat) can drift the form far from the original design over many cycles. The optimization log provides an audit trail but no automatic revert-to-original.

## Alternatives Considered

1. **Full form duplication per variant** - Each variant stores a complete, independent form config. Rejected because: (a) duplicated data must be kept in sync if the base form changes (e.g., security config update); (b) storage overhead; (c) the LLM generates partial configs naturally, requiring transformation to full configs.

2. **Field-level diff/patch** - Variants specify diffs at the individual field level (e.g., "change field 3's label to X"). Considered but deferred because: (a) merge logic becomes complex (field additions, deletions, reordering); (b) field ordering is significant for form UX and hard to express as patches; (c) the current section-level override is simpler and sufficient for MVP.

3. **Multi-armed bandit (instead of A/B)** - Dynamically shift traffic toward the better-performing variant using Thompson Sampling or UCB. Rejected because: (a) implementation complexity (requires Bayesian statistics or confidence bounds); (b) harder for operators to understand and trust; (c) the fixed-split A/B with autopilot is simpler and more transparent.

4. **Multiple concurrent experiments per form** - Allow overlapping experiments (e.g., one testing fields, another testing response messages). Rejected because: (a) traffic allocation across overlapping experiments is complex; (b) interaction effects between experiments confound results; (c) sequential experiments with autopilot achieve continuous optimization without overlap complexity.

5. **No automated optimization (manual A/B only)** - Operator manually creates variants, reviews stats, and promotes winners. This is supported (the optimize endpoint is opt-in). The autopilot adds automatic optimization on top. Rejected as the sole approach because the PRD explicitly includes agent-driven autopilot as a differentiator.
