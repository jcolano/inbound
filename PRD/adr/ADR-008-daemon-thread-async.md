# ADR-008: Daemon Threads for Asynchronous Processing

## Status
Accepted

## Context
FormAgent has two categories of work that must happen outside the HTTP request/response cycle:

### 1. Submission-triggered async work
When a form submission arrives, steps 1-8 (form lookup, CORS check, parse, validate, anti-spam, store, A/B tag, contact match) run synchronously within the HTTP request. The submitter receives an immediate HTTP 200 response. Steps 9+ (agent routing, Claude API call, action execution, event emission) run asynchronously because:
- Claude API calls take 1-10+ seconds
- Action execution (email sending, deal creation) can fail and requires retry
- The external submitter should not wait for agent processing

### 2. Scheduled background jobs
Three recurring jobs run on fixed intervals:

| Job | Interval | Purpose |
|-----|----------|---------|
| Sequence step processor | Every 60s | Check enrollments where `next_step_due_at <= now()`, send due emails, advance or complete sequences |
| Stale submission cleanup | Every 15 min | Fail submissions stuck in `processing` state for > 30 minutes |
| Experiment stats refresh | Every 5 min | Pre-compute variant statistics for active experiments |

The system uses SQLite (see [ADR-002](./ADR-002-sqlite-database.md)), which is a single-file embedded database. Any async processing mechanism must access the same database file from within the same process (or handle file locking carefully across processes).

## Decision
We use **Python daemon threads** (via `threading.Thread(daemon=True)`) for all asynchronous processing.

### Submission async processing
When a submission reaches the agent routing step, the flow engine spawns a daemon thread:

```python
import threading

def _process_agent_work(submission_id: str, context: dict):
    """Runs in a daemon thread. Has its own DB connection."""
    # 1. Build agent prompt with full context
    # 2. Call Claude API (sync httpx call or new event loop)
    # 3. Validate actions against allowed list
    # 4. Execute or draft based on autonomy level
    # 5. Log actions, emit WebSocket events
    # 6. Update submission status

thread = threading.Thread(
    target=_process_agent_work,
    args=(submission_id, context),
    daemon=True
)
thread.start()
```

Each daemon thread creates its own SQLite connection (SQLite connections are not thread-safe by default, so each thread uses its own).

### Scheduled background jobs
Background jobs are started at application startup as daemon threads with sleep loops:

```python
def _sequence_processor_loop():
    while True:
        try:
            _process_due_enrollments()
        except Exception as e:
            log_error(e)
        time.sleep(60)

threading.Thread(target=_sequence_processor_loop, daemon=True).start()
```

### Error recovery in threads
Agent processing threads implement retry with exponential backoff:
- Attempt 1: immediate
- Attempt 2: after 2s
- Attempt 3: after 4s
- Attempt 4: after 8s
- After all retries: mark submission as `needs_human_review`, notify fallback handler

Every step in a daemon thread emits events to the WebSocket broadcast (see [ADR-014](./ADR-014-websocket-observability.md)) and logs to the events table.

### Why daemon threads
Daemon threads are terminated when the main process exits. This means:
- No orphan processes
- No graceful shutdown protocol needed for MVP
- The main uvicorn process controls lifecycle

## Consequences

### Positive
- **Zero additional infrastructure:** No Redis, no RabbitMQ, no Celery worker process. The entire system is a single Python process.
- **SQLite compatibility:** Daemon threads in the same process can open their own SQLite connections to the same file. No network database protocol needed.
- **Simple deployment:** `uvicorn backend.main:app` starts everything -- the API server, the WebSocket handler, and all background jobs.
- **Immediate availability:** Threads start when the process starts. No worker registration, no queue consumer configuration, no broker health checks.
- **Low latency for agent work:** Thread spawning is near-instant. No message serialization, no queue enqueue/dequeue overhead. The agent starts processing within milliseconds of submission storage.

### Negative
- **No persistence of in-flight work:** If the process crashes, all daemon threads die immediately. In-flight agent processing is lost. Submissions stuck in `processing` state are cleaned up by the stale cleanup job (every 15 minutes), but the work must be retried.
- **No work distribution:** All processing happens in one process on one machine. There is no way to distribute agent processing across multiple workers or machines.
- **Thread safety burden:** Each thread must manage its own database connection. Shared mutable state (WebSocket connection list, in-memory caches) requires explicit locking.
- **No backpressure:** If 1000 submissions arrive simultaneously, 1000 daemon threads are spawned. There is no thread pool limit, no queue depth control, no rate limiting on thread creation. This could exhaust memory or SQLite write capacity.
- **No retry persistence:** Retry logic runs in-memory within the thread. If the thread crashes mid-retry, the retry state is lost.
- **GIL contention:** Python's Global Interpreter Lock means threads do not achieve true parallelism for CPU-bound work. However, agent processing is I/O-bound (API calls, database writes), so GIL contention is minimal in practice.
- **Monitoring difficulty:** Thread state is not externally observable without custom instrumentation. There is no built-in dashboard for thread health, queue depth, or processing latency (though the events table and WebSocket stream provide indirect observability).

## Alternatives Considered

1. **Celery + Redis** - Industry-standard distributed task queue. Rejected because: (a) requires running a Redis server and Celery worker process, adding infrastructure; (b) Celery workers are separate processes that would need their own SQLite connection strategy (or a network-capable database); (c) Redis adds a dependency for message brokering that is unnecessary at MVP scale; (d) Celery's configuration, serialization, and monitoring overhead is disproportionate.

2. **asyncio task queue (in-process)** - Using `asyncio.create_task()` to run background work on the FastAPI event loop. This was considered as an alternative to threads. Rejected because: (a) long-running tasks on the event loop can starve HTTP request handling; (b) the Anthropic SDK's async client works well, but mixing sync SQLite writes (via aiosqlite's thread pool) with async API calls in background tasks adds complexity; (c) daemon threads provide cleaner isolation of background work from the request-serving event loop.

3. **FastAPI BackgroundTasks** - FastAPI's built-in `BackgroundTasks` for post-response processing. Rejected for the agent processing use case because: (a) BackgroundTasks run on the event loop after the response is sent, blocking subsequent requests if the task is long-running; (b) suitable only for lightweight fire-and-forget tasks, not multi-step agent processing with retries.

4. **APScheduler** - Python scheduling library for periodic jobs. Considered for the three scheduled jobs. Rejected because: (a) adds a dependency for functionality achievable with `threading.Thread` + `time.sleep()`; (b) APScheduler's persistence features (storing job state in a database) are unnecessary when the jobs are simple interval-based loops.

5. **Dramatiq + Redis** - Lighter alternative to Celery. Rejected for the same infrastructure reasons as Celery (requires Redis).

6. **Process-based workers (multiprocessing)** - Separate Python processes for background work. Rejected because: (a) multiple processes accessing the same SQLite file increases lock contention; (b) inter-process communication adds complexity; (c) no benefit over threads for I/O-bound work due to the GIL being irrelevant.
