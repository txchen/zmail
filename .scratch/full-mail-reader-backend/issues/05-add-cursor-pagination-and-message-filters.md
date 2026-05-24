Status: ready-for-agent

# Add cursor pagination and common Message filters

## What to build

Add cursor pagination and a common filter model to Message-list endpoints. Message lists must remain stable as sync changes the Local read model.

## Acceptance criteria

- [ ] Mailbox Message list endpoints accept `limit` and `cursor`.
- [ ] Default limit is `50`; maximum limit is `200`.
- [ ] Ordering is stable by `receivedAt desc, id desc`.
- [ ] Responses include `messages` and optional `nextCursor`.
- [ ] Cursor pagination uses the last `(receivedAt, id)` position rather than offset pagination.
- [ ] Common filters include unread, starred, has attachments, from participant, after date, and before date.
- [ ] Filters are supported on mailbox lists and reusable by later unread/search endpoints.
- [ ] Tests cover pagination first page, next page, max limit, invalid cursor, and each common filter.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
