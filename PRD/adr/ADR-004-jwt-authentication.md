# ADR-004: JWT Authentication with Server-Side Session Records

## Status
Accepted

## Context
FormAgent serves two distinct client types with different authentication needs:

1. **Dashboard users** (browser-based SPA) - Human operators managing forms, reviewing submissions, configuring agents, and viewing analytics. They need session-based authentication with workspace switching and logout capability.

2. **Programmatic clients** (API integrations) - External systems submitting data or querying the API. They need stateless, long-lived credentials scoped to specific permissions.

Additionally, there are **public endpoints** that require no authentication at all:
- `POST /api/submissions/{form_id}` - Form submissions from embedded forms on external websites
- `GET /api/forms/{form_id}/schema` - Form schema retrieval for the embed script
- `OPTIONS /api/submissions/{form_id}` - CORS preflight

The authentication system must support multi-tenancy (see [ADR-005](./ADR-005-workspace-isolation.md)), where a single account can own multiple workspaces and be a member of others. Workspace switching must issue a new token scoped to the target workspace.

## Decision
We implement a **dual authentication** system:

### 1. JWT Tokens (Dashboard Sessions)

JWT tokens are issued on login and signup, signed with **HS256** using a server-side secret stored as an environment variable.

**Token payload:**
```json
{
  "sub": "acct_xxx",
  "workspace_id": "ws_xxx",
  "role": "owner",
  "iat": 1707580800,
  "exp": 1707667200
}
```

- **Expiry:** 24 hours (configurable).
- **Storage:** Client stores token in `localStorage` and sends via `Authorization: Bearer {token}` header.
- **Session records:** Every issued token has a corresponding row in the `sessions` table containing `token_hash` (SHA-256 of the token), `account_id`, `workspace_id`, `ip_address`, `user_agent`, and `expires_at`. This enables server-side revocation on logout.
- **Workspace switching:** Issues a new JWT scoped to the target workspace after verifying active membership. Creates a new session record.

### 2. API Keys (Programmatic Access)

API keys follow the format `fa_live_{random_32_chars}` (production) or `fa_test_{random_32_chars}` (test).

- **Storage:** The full key is shown exactly once on creation. Only the SHA-256 hash (`key_hash`) and a display prefix (`key_prefix`, e.g., `fa_live_abc1`) are stored.
- **Permissions:** Each key carries a JSON array of scoped permissions (e.g., `["forms:read", "forms:write", "submissions:read"]`).
- **Lookup:** On each request, the full key is hashed and looked up by `key_hash`. The associated `workspace_id` is injected into the request context.

### Authentication Middleware

A single FastAPI dependency (`get_current_context`) handles both auth methods:

```python
async def get_current_context(request: Request) -> AuthContext:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer fa_"):
        return await _validate_api_key(auth_header[7:])
    elif auth_header.startswith("Bearer "):
        return await _validate_jwt(auth_header[7:])
    else:
        raise HTTPException(401, "Missing or invalid authorization")
```

Every authenticated endpoint uses `ctx: AuthContext = Depends(get_current_context)`.

### Security Controls

| Concern | Control |
|---------|---------|
| Password storage | bcrypt with salt |
| JWT secret | Environment variable, rotatable |
| API key storage | SHA-256 hash only; full key displayed once |
| Brute force | Rate limit: 5 login attempts per email per 15 minutes |
| Session hijacking | Token tied to session record; revocable on logout |
| Token rotation | Workspace switch issues new token |

## Consequences

### Positive
- **Stateless verification for most requests:** JWT validation requires only the signing secret. No database lookup needed for token verification (the session table is consulted only for revocation checks).
- **Clean separation of auth methods:** Dashboard users and API integrations use different credential types with different lifecycles, permissions, and storage patterns.
- **Revocation capability:** Server-side session records allow immediate invalidation on logout, password change, or security incident, overcoming JWT's typical "irrevocable until expiry" limitation.
- **Workspace-scoped tokens:** The JWT payload carries `workspace_id`, ensuring every downstream query is scoped correctly without additional lookups per request.
- **API key permission scoping:** Programmatic clients can be granted minimal permissions (e.g., read-only access to submissions), reducing blast radius of key compromise.

### Negative
- **localStorage vulnerability:** Storing JWTs in `localStorage` exposes them to XSS attacks. A successful XSS on the dashboard could exfiltrate the token.
- **Token size in headers:** JWT payloads grow with claims. For FormAgent's small payload this is negligible, but it is a consideration.
- **Session table growth:** Every login creates a session record. Without cleanup, the sessions table grows indefinitely. Expired sessions must be periodically pruned.
- **Clock sensitivity:** JWT expiration depends on synchronized clocks between server and client. Clock skew can cause premature expiration or acceptance of expired tokens.
- **Dual auth complexity:** Maintaining two authentication paths (JWT + API key) doubles the surface area for auth bugs. Both paths must produce an identical `AuthContext`.

## Alternatives Considered

1. **Session cookies (httpOnly, Secure, SameSite)** - Server-side sessions with cookie-based identifiers. Rejected because: (a) CORS complexity with cookies across origins (the embed script submits from external domains, though public endpoints bypass auth); (b) the SPA architecture prefers `Authorization` header-based auth for simplicity; (c) cookies require CSRF protection, adding another middleware layer. However, cookies with `httpOnly` would eliminate the XSS/localStorage vulnerability, making this a valid future improvement.

2. **OAuth 2.0 / OpenID Connect** - Delegated authentication via third-party providers (Google, GitHub). Rejected for MVP because: (a) requires integration with an identity provider or running an OAuth server; (b) adds user-facing complexity (redirect flows, consent screens); (c) the PRD specifies email+password authentication with OAuth as a future consideration. Could be added later as an additional auth method alongside email+password.

3. **Stateless JWT only (no session table)** - Pure stateless JWT without server-side session records. Rejected because: (a) no way to revoke tokens on logout or security incident before expiry; (b) no way to audit active sessions; (c) no way to enforce "one active session per workspace" if desired.

4. **Opaque tokens with server-side lookup** - Random tokens stored in database, looked up on every request. Rejected because: (a) every authenticated request requires a database read, adding latency; (b) incompatible with the performance benefits of JWT self-contained verification; (c) the hybrid approach (JWT + session table for revocation) captures the benefits of both.

5. **Passport.js-style middleware** - Not applicable; Passport.js is Node.js-specific. FastAPI's `Depends()` system provides equivalent middleware capability natively.
