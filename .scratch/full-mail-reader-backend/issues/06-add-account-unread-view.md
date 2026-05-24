Status: done

# Add per-Mail account unread view

## What to build

Add a per-Mail account Account unread view that returns unread Messages across that account's Mailboxes, deduplicated by Message. Do not add cross-account unread or unified inbox behavior.

## Acceptance criteria

- [x] `GET /api/mail-accounts/:accountId/messages/unread` returns unread Messages for one Mail account.
- [x] Messages that appear in multiple Mailboxes are deduplicated.
- [x] Response uses the standardized paginated Message list shape.
- [x] Endpoint supports common Message filters where meaningful.
- [x] Unknown Mail account IDs return `404`.
- [x] Cross-account unread is not exposed on authenticated UI APIs.
- [x] Tests cover deduplication, pagination, filters, unknown Mail account, and unauthenticated access.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
- .scratch/full-mail-reader-backend/issues/05-add-cursor-pagination-and-message-filters.md
