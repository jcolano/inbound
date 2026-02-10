# ADR-006: Vanilla JS Frontend (No Framework)

## Status
Accepted

## Context
FormAgent's dashboard is a single-page application (SPA) providing:
- Form builder with drag-to-reorder fields, field type selection, and live preview
- Natural language form generation modal (conversation with Claude)
- Handler assignment with autonomy level slider and guardrails checkboxes
- Submission list with detail views and processing timelines
- Contact and deal management views
- Campaign and sequence management
- A/B experiment configuration with variant stats display
- Draft approval queue
- Form performance analytics dashboard (KPI cards, funnel, channel attribution, speed-to-lead, field dropoff)
- Agent observability dashboard (live status board, activity stream, processing timeline)
- Optimization suggestions display
- Real-time WebSocket event feed (see [ADR-014](./ADR-014-websocket-observability.md))

The frontend is served as static files from the FastAPI backend (see [ADR-003](./ADR-003-fastapi-backend.md)). There is no separate frontend deployment, no CDN, no server-side rendering.

## Decision
We build the dashboard using **vanilla JavaScript and CSS** with no frontend framework, no build step, and no transpilation.

The frontend structure:

```
frontend/
├── index.html              # Dashboard shell (single HTML file)
├── css/
│   └── styles.css          # All dashboard styling
├── js/
│   ├── app.js              # SPA router, tab switching
│   ├── form-builder.js     # Form creation + visual editor
│   ├── form-config.js      # Handler assignment + guardrails UI
│   ├── ai-builder.js       # NL form builder modal
│   ├── submissions.js      # Submission list + detail view
│   ├── contacts.js         # Contact list + detail
│   ├── groups.js           # Handler group management
│   ├── campaigns.js        # Campaign management
│   ├── sequences.js        # Sequence management
│   ├── experiments.js      # Experiment tab + variant stats + autopilot
│   ├── drafts.js           # Draft review queue
│   ├── dashboard-analytics.js  # Form performance dashboard
│   ├── dashboard-agents.js     # Agent observability dashboard
│   ├── timeline.js         # Per-submission processing timeline
│   ├── suggestions.js      # Optimization suggestions display
│   └── websocket.js        # WebSocket client for live events
└── embed/
    └── embed.js            # Embeddable form widget (separate from dashboard)
```

Key implementation patterns:
- **SPA routing** via `hashchange` events or simple tab switching in `app.js`. No `pushState` or router library.
- **DOM manipulation** via `document.createElement()`, `innerHTML`, and `querySelector()`. No virtual DOM.
- **HTTP requests** via `fetch()` with the JWT token in `Authorization` header.
- **WebSocket** via native `WebSocket` API.
- **CSS bars and charts** for analytics visualizations (funnel bars, speed-to-lead distribution, daily volume). No charting library.
- **State management** via module-scoped variables. No global store.

The embed script (`embed/embed.js`) is a separate, standalone file that runs on external websites (see [ADR-013](./ADR-013-embed-architecture.md)). It shares no code with the dashboard.

## Consequences

### Positive
- **Zero build step:** No webpack, Vite, esbuild, or npm. Edit a `.js` file, refresh the browser, see the change. Development iteration is instant.
- **No dependencies:** No `node_modules`, no package.json, no lock file, no supply chain risk from third-party packages. The frontend is self-contained.
- **Small payload:** No framework runtime. The total JS bundle is what you write, nothing more. Page load is fast.
- **Simple deployment:** Static files served by FastAPI's `StaticFiles` mount. No build artifacts, no asset pipeline, no CDN cache invalidation.
- **Hackathon speed:** For a small team on a tight timeline, avoiding framework setup, toolchain configuration, and component architecture decisions saves significant time.
- **Full control:** No framework opinions about state management, component lifecycle, or rendering strategy. The code does exactly what you write.

### Negative
- **No component reuse model:** Common UI patterns (tables, modals, form inputs, KPI cards) must be manually abstracted into functions. Without a component framework, duplication is likely.
- **Manual DOM management:** Updating the DOM after state changes requires explicit code. There is no reactive binding, no virtual DOM diffing. This becomes error-prone as UI complexity grows (e.g., updating experiment variant stats while a live WebSocket feed is appending events).
- **No TypeScript:** No type checking on the frontend. API response shapes, form field definitions, and event payloads are validated only at runtime. Refactoring is risky.
- **Limited ecosystem:** No UI component libraries, no form validation libraries, no routing libraries. Everything is built from scratch.
- **Scalability ceiling:** As the dashboard grows beyond MVP, the lack of structure will make the codebase harder to maintain. Adding features like complex drag-and-drop, real-time collaborative editing, or rich text editing would be significantly harder without a framework.
- **Accessibility gaps:** Without framework-provided ARIA patterns, accessibility must be manually implemented for every interactive element.
- **Testing difficulty:** No component testing framework. UI testing requires browser automation (Playwright, Cypress) rather than unit-level component tests.

## Alternatives Considered

1. **React (with Vite)** - Industry-standard component framework with a massive ecosystem. Rejected because: (a) requires a build step (Vite/webpack), adding toolchain complexity; (b) `node_modules` and package management overhead; (c) React's learning curve and boilerplate (hooks, state management, context) slow down initial development; (d) for a hackathon, the setup time does not justify the benefits.

2. **Vue.js** - Progressive framework that can be used via CDN without a build step (`<script src="vue.js">`). This was the closest alternative. Rejected because: (a) even CDN Vue adds a framework runtime to learn and debug; (b) template syntax and reactivity system are additional abstractions; (c) the team preferred maximum simplicity. Vue via CDN remains a viable upgrade path if the frontend grows.

3. **Svelte** - Compile-time framework with minimal runtime. Rejected because: (a) requires a build step (SvelteKit or Vite plugin); (b) smaller ecosystem than React/Vue; (c) same build toolchain objection as React.

4. **htmx** - Server-rendered HTML with declarative AJAX attributes. Rejected because: (a) requires server-side HTML templating (Jinja2), conflicting with the API-first architecture; (b) WebSocket integration with htmx is possible but non-trivial; (c) the SPA pattern (client-side routing, client-side state) is a better fit for the real-time dashboard.

5. **Alpine.js** - Lightweight reactivity via HTML attributes. Considered as a middle ground but rejected because: (a) adds another dependency to learn; (b) the dashboard's complexity (multi-tab SPA with live WebSocket updates) benefits from explicit JS control more than declarative attributes.
