# Expose the read-only AI API

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Expose a separate read-only AI API for AI readers. The API should let an agent list Mail accounts, list Gmail-unread Messages, and fetch Message metadata and content by stable Message identity without mutating Gmail state.

## Acceptance criteria

- [ ] The AI API is separate from UI-specific endpoints.
- [ ] The AI API can list Mail accounts available to the App user.
- [ ] The AI API can list Gmail-unread Messages.
- [ ] The AI API exposes stable Message identities.
- [ ] The AI API can fetch Message metadata by Message identity.
- [ ] The AI API can fetch readable Message content by Message identity.
- [ ] AI API reads do not mark Messages read in Gmail.
- [ ] The AI API cannot perform Mailbox actions in the MVP.
- [ ] Tests cover AI API contract responses.
- [ ] Tests cover that AI API reads do not mutate Gmail unread state.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
