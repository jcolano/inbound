# ADR-014: WebSocket for Real-Time Event Streaming

## Status
Accepted

## Context
FormAgent's Agent Observability Dashboard (Module 4) requires real-time visibility into system activity:

- When a submission arrives, the dashboard should show it immediately
- When an agent starts processing, the status board should update
- When an agent takes an action (qualify, email, create deal), it should appear in the activity stream in real-time
- When an error or escalation occurs, operators should be notified without polling
- The per-submission processing timeline should build up live as steps complete

The system emits 16+ event types (see below) at every stage of submission processing. These events are already stored in the `events` table for historical query. The question is how to push them to connected dashboard clients in real-time.

### Event Types

| Event Type | Trigger |
|------------|---------|
| `submission_received` | New submission stored |
| `spam_blocked` | Anti-spam rejection |
| `contact_matched` | Linked to existing contact |
| `contact_created` | New contact record created |
| `handler_assigned` | Submission routed to handler |
| `agent_processing` | Agent started analyzing |
| `agent_action` | Agent took a specific action |
| `agent_draft` | Agent produced a draft (awaiting approval) |
| `agent_completed` | Agent finished processing |
| `agent_error` | Agent encountered an error |
| `agent_retry` | System retrying after error |
| `agent_escalated` | Escalated to human |
| `human_approved` | Human approved agent's draft |
| `human_rejected` | Human rejected agent's draft |
| `human_override` | Human took over from agent |
| `experiment_variant` | Submission tagged with A/B variant |
| `optimization_run` | Autopilot ran optimization cycle |

Events carry structured payloads:

```json
{
  "id": "evt_w3x6z9",
  "submission_id": "sub_k4m7n2",
  "form_id": "form_8a3f2b",
  "event_type": "agent_action",
  "handler_id": "agent_salesbot",
  "details": {
    "action": "create_deal",
    "deal_id": "deal_h3j9k6",
    "deal_name": "Acme Corp - Enterprise",
    "deal_amount": 100000
  },
  "created_at": "2026-02-10T14:00:08Z"
}
```

## Decision
We use **WebSocket** (FastAPI's native WebSocket support via Starlette) for real-time event streaming from the server to connected dashboard clients.

### Architecture

```
Event Sources                    Event Emitter              Dashboard Clients
─────────────                    ─────────────              ─────────────────
flow_engine.py     ──┐
agent_processor.py ──┤           event_emitter.py           /ws/events
action_executor.py ──┼──emit()──> 1. Store in events table  ┌─ Client A
error_recovery.py  ──┤           2. Broadcast to WebSocket  ├─ Client B
spam.py            ──┤              connection pool          └─ Client C
sequence_processor ──┘
```

### Server-Side Implementation

A centralized event emitter (`services/event_emitter.py`) handles both persistence and broadcasting:

```python
# In-memory set of connected WebSocket clients
_connected_clients: set[WebSocket] = set()

async def emit_event(event_type: str, submission_id: str = None,
                     form_id: str = None, handler_id: str = None,
                     details: dict = None, workspace_id: str = None):
    # 1. Store in database
    event = {
        "id": generate_id("evt"),
        "event_type": event_type,
        "submission_id": submission_id,
        "form_id": form_id,
        "handler_id": handler_id,
        "details": json.dumps(details or {}),
        "workspace_id": workspace_id,
        "created_at": utcnow()
    }
    await db.execute("INSERT INTO events ...", event)

    # 2. Broadcast to connected clients (filtered by workspace_id)
    message = json.dumps(event)
    for client in list(_connected_clients):
        if client.workspace_id == workspace_id:
            try:
                await client.send_text(message)
            except:
                _connected_clients.discard(client)
```

### WebSocket Endpoint

```python
@router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await websocket.accept()
    # Authenticate via query param or initial message
    ctx = await _authenticate_websocket(websocket)
    websocket.workspace_id = ctx.workspace_id
    _connected_clients.add(websocket)
    try:
        while True:
            # Keep connection alive, handle client messages (filters)
            data = await websocket.receive_text()
            # Optional: client sends filter preferences
    except WebSocketDisconnect:
        _connected_clients.discard(websocket)
```

### Client-Side Implementation

The dashboard's `websocket.js` module:

```javascript
const ws = new WebSocket(`ws://${host}/ws/events?token=${jwt}`);
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // Dispatch to relevant dashboard component
    // - Activity stream: append event
    // - Status board: update agent state
    // - Processing timeline: add step
};
ws.onclose = () => {
    // Reconnect with exponential backoff
};
```

### Workspace Isolation

Events are broadcast only to WebSocket clients authenticated for the same workspace (see [ADR-005](./ADR-005-workspace-isolation.md)). The WebSocket connection is authenticated on establishment (JWT token passed as query parameter or in the initial message frame). Events from workspace A are never sent to clients in workspace B.

### Event Emission from Daemon Threads

Background processing threads (see [ADR-008](./ADR-008-daemon-thread-async.md)) emit events by calling the event emitter. Since daemon threads may not have access to the async event loop, event emission from threads uses thread-safe mechanisms (e.g., `asyncio.run_coroutine_threadsafe()` to schedule the broadcast on the main event loop).

## Consequences

### Positive
- **True real-time:** Events arrive at the dashboard within milliseconds of emission. No polling delay. Operators see agent actions as they happen.
- **Native FastAPI support:** WebSocket is built into Starlette/FastAPI. No additional library, server, or proxy needed.
- **Bidirectional potential:** WebSocket supports client-to-server messages. The client can send filter preferences (e.g., "only show events for form_8a3f2b") to reduce traffic.
- **Single connection:** One WebSocket connection carries all event types. The client filters and dispatches locally. No need for multiple event channels.
- **Event persistence + streaming:** Events are stored in the database AND broadcast live. Historical queries (`GET /api/events`) and real-time streaming (`/ws/events`) use the same data model.
- **Zero additional infrastructure:** The WebSocket handler runs in the same FastAPI process. No Redis pub/sub, no message broker, no separate WebSocket server.

### Negative
- **In-memory connection state:** The set of connected WebSocket clients is held in process memory. If the process restarts, all connections are dropped and must reconnect. There is no connection state persistence.
- **Single-process scaling limit:** All WebSocket connections terminate at one process. With many concurrent dashboard users, memory and CPU for message broadcasting become a bottleneck. There is no way to distribute WebSocket connections across multiple server instances without a pub/sub backbone (e.g., Redis).
- **Thread-to-async bridge complexity:** Daemon threads emitting events must coordinate with the async event loop for WebSocket broadcasting. This requires `asyncio.run_coroutine_threadsafe()` or a thread-safe queue, adding a small amount of inter-thread coordination complexity.
- **No delivery guarantee:** If a WebSocket message send fails (client disconnected, network issue), the event is still in the database but lost from the live stream. The client must fetch missed events via the REST API on reconnect.
- **Authentication on WebSocket:** JWT token is typically passed as a query parameter in the WebSocket URL (`/ws/events?token=xxx`), which means the token appears in server access logs. This is a minor security concern mitigated by HTTPS.

## Alternatives Considered

1. **Server-Sent Events (SSE)** - Unidirectional server-to-client streaming over HTTP. Rejected because: (a) SSE does not support client-to-server messages (filter preferences would require a separate REST call); (b) SSE connections can be more fragile through proxies and load balancers; (c) FastAPI's WebSocket support is more mature than its SSE support; (d) WebSocket's bidirectional capability is useful for future features (e.g., client acknowledging receipt of events).

2. **Short polling** - Client polls `GET /api/events?since={timestamp}` every N seconds. Rejected because: (a) polling interval creates a latency floor (even at 1-second intervals, events are delayed up to 1 second); (b) high polling frequency wastes bandwidth and server resources; (c) the agent observability dashboard's value proposition is real-time visibility, which polling undermines.

3. **Long polling** - Client sends a request that the server holds open until an event is available. Rejected because: (a) more complex than WebSocket for the same result; (b) each long-poll request occupies a server thread/connection; (c) reconnection overhead after each response; (d) WebSocket is the standard replacement for long polling.

4. **Redis pub/sub + WebSocket** - Events published to Redis channels, WebSocket server subscribes and fans out. Rejected because: (a) adds Redis as infrastructure (conflicts with zero-infra goal); (b) unnecessary for single-process deployment; (c) would be the right choice if scaling to multiple server instances.

5. **Push notifications (browser)** - Web Push API for desktop notifications. Rejected as a replacement (could be complementary) because: (a) requires service worker registration and user permission; (b) not suitable for high-frequency event streams (agent actions happen in rapid sequence); (c) Web Push is for occasional notifications, not real-time activity feeds.
