Status: done

# Add bulk Mailbox actions

## What to build

Add bulk execution for the existing six Mailbox actions: mark read, mark unread, archive, delete, star, and unstar. Do not add label management, move-to-mailbox, or composition behavior.

## Acceptance criteria

- [x] `POST /api/mail-accounts/:accountId/messages/actions` accepts an action and Message IDs.
- [x] Supported actions are exactly mark read, mark unread, archive, delete, star, and unstar.
- [x] Bulk action returns partial-success results with succeeded IDs and failed items.
- [x] Successful actions update the Local read model consistently with existing single-message actions.
- [x] Label management and move-to-mailbox actions are rejected.
- [x] Tests cover all six actions, partial failure, invalid action, unknown Message IDs, and unauthenticated access.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
