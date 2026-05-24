Status: ready-for-agent

# Document full Mail reader API

## What to build

Create a durable backend API reference for the full Mail reader API so future UI and agent work can rely on a single source of truth. The documentation should cover current endpoints and the new endpoints from this feature set.

## Acceptance criteria

- [ ] API documentation lives at `docs/api.md` unless a better existing docs location is discovered.
- [ ] Auth/session endpoints are documented, including JWT cookie behavior, session TTL, logout, and restart survival.
- [ ] Mail account, sync status, diagnostics, mailbox tree, message list, unread, search, attachment, and Mailbox action endpoints are documented.
- [ ] AI API endpoints are documented separately from authenticated UI APIs.
- [ ] Request params, request bodies, response shapes, status codes, auth requirements, pagination, filters, and error behavior are listed.
- [ ] Documentation explicitly calls out unsupported areas: Composition actions, label management, cross-account unread, saved views, and first-class Thread APIs.
- [ ] Tests or checks ensure documented shared response type names match exported shared API types where practical.

## Blocked by

- .scratch/full-mail-reader-backend/issues/01-add-jwt-app-sessions.md
- .scratch/full-mail-reader-backend/issues/02-add-sync-status-and-diagnostics.md
- .scratch/full-mail-reader-backend/issues/03-expand-mailbox-metadata.md
- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
- .scratch/full-mail-reader-backend/issues/05-add-cursor-pagination-and-message-filters.md
- .scratch/full-mail-reader-backend/issues/06-add-account-unread-view.md
- .scratch/full-mail-reader-backend/issues/07-add-local-read-model-search.md
- .scratch/full-mail-reader-backend/issues/08-add-attachment-download-proxy.md
- .scratch/full-mail-reader-backend/issues/09-add-bulk-mailbox-actions.md
