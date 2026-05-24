Status: done

# Add cursor pagination and common Message filters

## What to build

Add cursor pagination and a common filter model to Message-list endpoints. Message lists must remain stable as sync changes the Local read model.

## Acceptance criteria

- [x] Mailbox Message list endpoints accept `limit` and `cursor`.
- [x] Default limit is `50`; maximum limit is `200`.
- [x] Ordering is stable by `receivedAt desc, id desc`.
- [x] Responses include `messages` and optional `nextCursor`.
- [x] Cursor pagination uses the last `(receivedAt, id)` position rather than offset pagination.
- [x] Common filters include unread, starred, has attachments, from participant, after date, and before date.
- [x] Filters are supported on mailbox lists and reusable by later unread/search endpoints.
- [x] Tests cover pagination first page, next page, max limit, invalid cursor, and each common filter.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
