Status: done

# Adopt Nuxt UI, Tailwind, Vue Router, and TanStack Query

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Set up the Vue web app foundation for the real Mail reader UI while keeping the app as plain Vite Vue. The app should use Nuxt UI and Tailwind CSS for components and styling, Vue Router for reader navigation state, and TanStack Query for server state.

## Acceptance criteria

- [x] The web app remains a Vite Vue app and does not migrate to Nuxt.
- [x] Nuxt UI components render in the running app.
- [x] Tailwind styles are available to Vue components.
- [x] Vue Router owns the browser URL state.
- [x] TanStack Query is registered for server-state fetching and invalidation.
- [x] Generated Nuxt UI declaration artifacts with package-manager paths are ignored or otherwise kept from creating brittle repo churn.
- [x] Web typecheck passes.

## Blocked by

None - can start immediately
