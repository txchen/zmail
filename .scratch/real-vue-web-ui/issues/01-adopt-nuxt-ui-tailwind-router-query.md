Status: ready-for-agent

# Adopt Nuxt UI, Tailwind, Vue Router, and TanStack Query

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Set up the Vue web app foundation for the real Mail reader UI while keeping the app as plain Vite Vue. The app should use Nuxt UI and Tailwind CSS for components and styling, Vue Router for reader navigation state, and TanStack Query for server state.

## Acceptance criteria

- [ ] The web app remains a Vite Vue app and does not migrate to Nuxt.
- [ ] Nuxt UI components render in the running app.
- [ ] Tailwind styles are available to Vue components.
- [ ] Vue Router owns the browser URL state.
- [ ] TanStack Query is registered for server-state fetching and invalidation.
- [ ] Generated Nuxt UI declaration artifacts with package-manager paths are ignored or otherwise kept from creating brittle repo churn.
- [ ] Web typecheck passes.

## Blocked by

None - can start immediately
