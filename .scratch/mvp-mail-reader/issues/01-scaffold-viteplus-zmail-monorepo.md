# Scaffold the Vite+ Zmail monorepo

Status: done

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Create the initial Zmail monorepo shape with a runnable Vue web app, Hono API on Node.js, and shared TypeScript package. The slice should prove that one development command starts both apps, the web app has HMR, the API can respond to a basic health request, and the frontend can call the API through the intended local development path.

## Acceptance criteria

- [x] The repo has a Vite+ monorepo with `apps/web`, `apps/api`, and `packages/shared`.
- [x] `apps/web` runs a Vue app with frontend HMR in development.
- [x] `apps/api` runs a Hono API on Node.js.
- [x] `packages/shared` can export a small shared type or schema consumed by both apps.
- [x] One documented development command starts both frontend and backend.
- [x] The web app can call an API health endpoint and render its result.
- [x] Type checking and tests can run from the monorepo root.

## Blocked by

None - can start immediately
