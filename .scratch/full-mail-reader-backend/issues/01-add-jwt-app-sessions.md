Status: done

# Add JWT App sessions

## What to build

Replace the current in-memory App session token with stateless signed JWT App sessions stored in the existing HttpOnly `zmail_session` cookie. App sessions must survive API restarts, use a required `session_secret` from App configuration, support a configurable `session_ttl_days`, and expose session status/logout endpoints for the UI.

Create ADR `0006-use-stateless-jwt-app-sessions.md` to record the decision.

## Acceptance criteria

- [x] Successful App login sets a signed JWT cookie and returns `204`.
- [x] Authenticated UI endpoints accept a valid JWT cookie after API restart.
- [x] `GET /api/session` returns `{ authenticated: true, username, expiresAt }` for a valid session and `{ authenticated: false }` otherwise.
- [x] `POST /api/logout` clears the browser cookie and returns `204`.
- [x] App configuration requires `app_login.session_secret` with minimum length 16.
- [x] App configuration supports optional `app_login.session_ttl_days`, default `365`, valid range `1..3650`.
- [x] Rotating `session_secret` invalidates existing JWT cookies.
- [x] Tests cover login, session status, logout, restart survival, expired tokens, and invalid signatures.

## Blocked by

None - can start immediately
