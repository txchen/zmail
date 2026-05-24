# Expose the read-only AI API

Status: done

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Expose a separate read-only AI API for AI readers. The API should let an agent list Mail accounts, list Gmail-unread Messages, and fetch Message metadata and content by stable Message identity without mutating Gmail state.

## Acceptance criteria

- [x] The AI API is separate from UI-specific endpoints.
- [x] The AI API can list Mail accounts available to the App user.
- [x] The AI API can list Gmail-unread Messages.
- [x] The AI API exposes stable Message identities.
- [x] The AI API can fetch Message metadata by Message identity.
- [x] The AI API can fetch readable Message content by Message identity.
- [x] AI API reads do not mark Messages read in Gmail.
- [x] The AI API cannot perform Mailbox actions in the MVP.
- [x] Tests cover AI API contract responses.
- [x] Tests cover that AI API reads do not mutate Gmail unread state.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
