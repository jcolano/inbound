# ADR-007: Claude API (Anthropic SDK) for All LLM Features

## Status
Accepted

## Context
FormAgent uses large language models in four distinct capacities:

1. **Form generation** (Module 1) - Natural language prompt to structured form configuration JSON. User describes "build a demo request form for an AI consulting firm" and receives a complete form definition with fields, types, validation, flow selection, agent instructions, and security defaults.

2. **Agent processing** (Module 2) - Submissions routed to AI agents receive full context (submission data, contact history, company info, allowed actions, autonomy instructions) and the LLM returns a structured JSON action plan (reasoning, ordered actions with details, contact updates).

3. **A/B optimization** (Module 3) - The autopilot optimizer sends current form config, experiment metrics, and per-variant performance stats to the LLM, which generates a new challenger variant as a partial form config override.

4. **Optimization suggestions** (Module 4) - The suggestion engine sends field completion rates, outcome distributions, agent notes patterns, response times, and escalation reasons. The LLM returns plain-language recommendations with actionable changes.

All four use cases require:
- Structured JSON output (not free-text prose)
- System prompt + user prompt pattern
- Reliable schema conformance (form field definitions must match expected types)
- Reasonable latency (form generation is interactive; agent processing is async but time-sensitive)

## Decision
We use the **Claude API via the Anthropic Python SDK** (`anthropic` package) as the sole LLM provider for all four capabilities.

### Integration Architecture

All LLM calls are encapsulated in `backend/llm/`:

```
backend/llm/
├── form_generator.py       # NL prompt -> form config JSON
├── agent_prompts.py        # Agent system prompts per flow type
├── optimizer.py            # A/B optimization prompt + response parsing
└── suggestion_engine.py    # Optimization assistant prompt + response parsing
```

Each module:
1. Constructs a system prompt defining the output schema and constraints
2. Constructs a user prompt with the specific input data
3. Calls the Anthropic API with `await client.messages.create()`
4. Parses the response as JSON
5. Validates against expected schema (via Pydantic models)
6. Returns typed Python objects to the calling service

### Structured Output Pattern

All prompts end with "Return only JSON, no explanation." and the response is parsed with `json.loads()`. If parsing fails, the system re-prompts with stricter format instructions (see error recovery in [ADR-008](./ADR-008-daemon-thread-async.md) for retry logic).

Example agent prompt structure:
```
System: You are a FormAgent handler for: "{form_name}"
Your allowed actions: {allowed_actions_list}
Your autonomy level: {autonomy_level}
{autonomy_level_specific_instructions}

--- Contact Context ---
{contact_history_block}

--- Current Submission ---
{submission_data}

Return a structured JSON response:
{
  "reasoning": "...",
  "actions": [...],
  "contact_updates": {...}
}
```

### Error Handling

| Error | Recovery |
|-------|----------|
| API timeout | Retry with exponential backoff: 2s, 4s, 8s (3 attempts) |
| Rate limit (429) | Respect `Retry-After` header, queue for retry |
| Unparseable JSON response | Re-prompt with stricter format instructions |
| Schema validation failure | Re-prompt with explicit schema |
| All retries exhausted | Escalate to human handler |

### Async Integration

The Anthropic SDK provides an async client (`anthropic.AsyncAnthropic`) that integrates with FastAPI's async event loop:

```python
client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
response = await client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    system=system_prompt,
    messages=[{"role": "user", "content": user_prompt}]
)
```

## Consequences

### Positive
- **Single provider simplicity:** One API key, one SDK, one billing relationship, one set of rate limits to manage. No abstraction layer needed to support multiple providers.
- **Structured output reliability:** Claude models follow JSON schema instructions consistently, reducing parse failures compared to other models.
- **Anthropic Python SDK maturity:** The `anthropic` package provides typed responses, async support, automatic retries, and streaming. It integrates cleanly with FastAPI's async architecture.
- **Consistent behavior across use cases:** Using the same model family for form generation, agent processing, optimization, and suggestions means consistent prompt engineering patterns and predictable output quality.
- **Context window:** Claude models support large context windows, important for agent processing where the prompt includes full contact history, submission data, and action constraints.

### Negative
- **Single vendor dependency:** All LLM functionality depends on Anthropic's API availability. An outage disables form generation, agent processing, and optimization simultaneously. There is no fallback provider.
- **Cost unpredictability:** Agent processing is triggered per submission. A traffic spike means a proportional spike in API costs. There is no cost ceiling without explicit rate limiting.
- **Latency variability:** LLM response times vary (1-10+ seconds). For interactive form generation, this means visible wait times. For agent processing, this contributes to speed-to-lead metrics.
- **Model version coupling:** Prompt behavior can change across model versions. Model upgrades require re-testing all four prompt paths.
- **No offline operation:** The system cannot process agent-guided submissions without network access to the Claude API.

## Alternatives Considered

1. **OpenAI GPT-4 / GPT-4o** - Industry-leading LLM with function calling and structured output modes. Rejected because: (a) the team has more experience with Claude's prompting patterns; (b) Claude's longer context window is better suited for the agent processing use case (full contact history + submission data); (c) structured JSON output from Claude is reliable without requiring the function calling API. Could be added as an alternative provider behind an abstraction layer if needed.

2. **Local/self-hosted models (Llama, Mistral)** - On-premise LLM inference via Ollama or vLLM. Rejected because: (a) requires GPU infrastructure, conflicting with the zero-infra deployment goal; (b) model quality for structured JSON output is significantly lower than Claude/GPT-4; (c) inference latency on consumer hardware is prohibitive for interactive form generation; (d) operational overhead of model serving, updates, and monitoring.

3. **Multi-provider abstraction (LiteLLM, LangChain)** - Abstraction layer supporting multiple LLM providers. Rejected because: (a) adds dependency complexity without immediate benefit (we only use one provider); (b) LangChain's abstractions add overhead and debugging difficulty; (c) the four LLM use cases have simple prompt-in/JSON-out patterns that do not benefit from a framework; (d) provider-specific prompt tuning is lost behind generic abstractions.

4. **Claude API with tool use / function calling** - Using Claude's tool-use feature to enforce output schema. Considered but deferred. The current "JSON in system prompt" approach works reliably. Tool use would add structured schema enforcement at the API level, which could improve reliability. This is a future improvement, not a launch blocker.
