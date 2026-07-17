# Zmail API

Zmail exposes health checks and authenticated Live IMAP reader APIs. Mail responses are never
persisted or cached by the server.

## Authentication and session

- `GET /health` and `GET /api/health` return `{ "service": "zmail-api", "status": "ok" }`.
- `POST /api/login` accepts `{ "username": string, "password": string }`, returns `204`, and sets
  the HttpOnly `zmail_session` cookie.
- `GET /api/session` returns `SessionResponse`.
- `POST /api/logout` closes active Live IMAP sessions, clears the cookie, and returns `204`.

## Account selection and open

All endpoints below require `zmail_session`.

- `GET /api/mail-accounts` returns `MailAccountsResponse`: configured account identities plus
  `reader.readDwellSeconds`. It does not connect to Gmail.
- `POST /api/mail-accounts/:accountId/open` returns `AccountOpenResponse`: the account Mailbox tree,
  counts, and first Inbox page.

## Live lists and Search

- `GET /api/mail-accounts/:accountId/mailboxes/:mailboxId/messages?cursor=...` returns
  `LiveMessagePage`.
- `GET /api/mail-accounts/:accountId/messages/unread?cursor=...` returns `LiveMessagePage`.
- `GET /api/mail-accounts/:accountId/messages/search?q=...&cursor=...` returns `LiveMessagePage`.

Pages contain at most 50 `LiveMessageSummary` records and an optional opaque `nextCursor`. Search
accepts native Gmail syntax and runs only after an explicit request.

## Message content and Attachments

- `GET /api/mail-accounts/:accountId/messages/:messageId` returns `LiveMessageResponse`.
- `GET /api/mail-accounts/:accountId/messages/:messageId/inline-resources/:resourceId` streams one
  Inline message resource.
- `GET /api/mail-accounts/:accountId/messages/:messageId/attachments/:attachmentId` streams one
  explicitly requested Attachment.

Message and binary responses use `Cache-Control: no-store`.

## Manual refresh and retry

- `POST /api/mail-accounts/:accountId/refresh` accepts `AccountRefreshRequest` and returns
  `AccountRefreshResponse`.

Manual retry repeats the same failed reader request; it has no separate server endpoint.

## Mailbox actions

- `POST /api/mail-accounts/:accountId/messages/:messageId/actions` accepts
  `{ "action": MailboxAction }` and returns `MailboxActionConfirmation`.

Supported target-state actions are mark read/unread, star/unstar, archive, and delete. The endpoint
returns success only after Gmail confirms the action.

## Removed surfaces

Zmail has no Local read model, Sync jobs, blocking refresh compatibility response, sync status,
custom-range sync, independent diagnostics, bulk action, or AI API endpoints.
