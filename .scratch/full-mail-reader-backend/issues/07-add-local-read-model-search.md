Status: ready-for-agent

# Add Local read model Search

## What to build

Add Search over synced Messages in the Local read model for the eventual full Mail reader UI. Search must not block on Gmail and must remain scoped to one Mail account.

## Acceptance criteria

- [ ] `GET /api/mail-accounts/:accountId/messages/search?q=...` searches synced Messages for one Mail account.
- [ ] Search returns the standardized paginated Message list shape.
- [ ] Search supports common Message filters.
- [ ] Empty or missing query is rejected with a clear `400` response.
- [ ] Unknown Mail account IDs return `404`.
- [ ] Search reads only the Local read model and does not call Gmail.
- [ ] Tests cover subject/body matches, no matches, filters, pagination, invalid query, and unauthenticated access.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
- .scratch/full-mail-reader-backend/issues/05-add-cursor-pagination-and-message-filters.md
