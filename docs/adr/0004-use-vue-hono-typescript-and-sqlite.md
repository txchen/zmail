# Use a Vite+ monorepo with Vue, Hono, TypeScript, and SQLite

Zmail's initial implementation uses a Vite+ monorepo with `apps/web` for the Vue frontend, `apps/api` for the Hono backend running on Node.js, and `packages/shared` for code shared between them. TypeScript is used across the repo and SQLite is used for persistence, with one development command expected to launch both backend and frontend while preserving frontend HMR.
