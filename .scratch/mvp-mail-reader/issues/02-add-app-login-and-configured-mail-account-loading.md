# Add App login and Configured Mail account loading

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Add the single-user App login and server-side Configured Mail account loading path. The App user should be able to authenticate before using the app, and the backend should load N configured Gmail Mail accounts without exposing Mail account credentials to the browser.

## Acceptance criteria

- [ ] The API protects non-public UI/API routes behind App login.
- [ ] The App login credential can be loaded from environment variables or server-side config.
- [ ] The web app provides a login flow for the single App user.
- [ ] The backend loads multiple Configured Mail accounts from server-side configuration.
- [ ] Mail account credentials are never returned to the browser.
- [ ] The authenticated UI can display configured Mail account display names or identifiers.
- [ ] Tests cover authenticated versus unauthenticated access to protected endpoints.
- [ ] Tests cover safe loading of Configured Mail accounts without exposing credentials.

## Blocked by

- `.scratch/mvp-mail-reader/issues/01-scaffold-viteplus-zmail-monorepo.md`
