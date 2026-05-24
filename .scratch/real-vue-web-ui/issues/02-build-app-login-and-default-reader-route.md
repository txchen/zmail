Status: ready-for-agent

# Build App login and Default reader route

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Create the authenticated entry flow for the real Mail reader. The App user can log in, session state survives refresh, logout works, and the first authenticated reader location is the first configured Mail account's Account unread view.

## Acceptance criteria

- [ ] The App user can submit App login credentials from the web UI.
- [ ] Failed login displays a clear failure state.
- [ ] Authenticated session state is checked on page load.
- [ ] Logout ends the App session and returns to the login screen.
- [ ] After successful App login, the app routes to the first configured Mail account's Account unread view.
- [ ] The Default reader view does not route to a global inbox or cross-account unread view.
- [ ] Browser refresh preserves the authenticated reader route when the App session is valid.

## Blocked by

- .scratch/real-vue-web-ui/issues/01-adopt-nuxt-ui-tailwind-router-query.md
