# Use a Vite+ monorepo with Vue, Hono, and TypeScript

Zmail uses a Vite+ monorepo with `apps/web` for the Vue frontend, `apps/api` for the Hono backend running on Node.js, and `packages/shared` for code shared between them. TypeScript is used across the repo, with one development command expected to launch both backend and frontend while preserving frontend HMR; mail persistence was removed by ADR-0011.
