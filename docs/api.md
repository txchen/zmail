# Zmail API

Zmail exposes authenticated UI APIs under `/api` and read-only AI APIs under `/ai-api`.

## Authentication

`POST /api/login`
- Auth: none.
- Body: `{ "username": string, "password": string }`.
- Success: `204`, sets HttpOnly `zmail_session` JWT cookie with `SameSite=Lax; Path=/`.
- Failure: `401 { "error": "Invalid credentials" }`.
- The JWT includes the App user name and expiry. It is signed with `app_login.session_secret`, survives API restarts, expires after `app_login.session_ttl_days` days, and is invalidated by rotating `session_secret`.

`GET /api/session`
- Auth: optional cookie.
- Success: `{ "authenticated": true, "username": string, "expiresAt": string }` or `{ "authenticated": false }`.

`POST /api/logout`
- Auth: optional cookie.
- Success: `204`, clears `zmail_session`.

## Authenticated UI APIs

All endpoints below require `zmail_session`; unauthenticated requests return `401 { "error": "Authentication required" }`.

`GET /api/mail-accounts`
- Response type: `MailAccountsResponse`.
- Success: `{ "mailAccounts": [{ "id": string, "emailAddress": string }] }`.

`GET /api/mailbox-tree`
- Response type: `MailboxTreeResponse`.
- Returns configured Mail accounts with sync status, unread count, and flat Mailbox arrays.
- Mailboxes include `id`, `name`, `path`, optional `parentId`, optional `systemRole`, `unreadCount`, `totalCount`, and `selectable`.

`POST /api/mail-accounts/:accountId/refresh`
- Triggers sync for one Mail account.
- Success: `MailboxTreeResponse`.
- Unknown account: `404`.
- Missing sync client: `503`.

`GET /api/mail-accounts/:accountId/sync-status`
- Success: `{ accountId, syncStatus, lastSyncStartedAt?, lastSyncFinishedAt?, lastError? }`.
- `lastError` is raw provider text and is only exposed on authenticated UI APIs.
- Unknown account: `404`.

`POST /api/mail-accounts/:accountId/diagnose`
- Checks provider connectivity without saving Mailboxes or Messages.
- Success: `{ "success": true, "visibleMailboxCount": number }`.
- Provider failure: `{ "success": false, "lastError": string }`.
- Unknown account: `404`.

### Message Lists

`GET /api/mail-accounts/:accountId/mailboxes/:mailboxId/messages`
- Response type: `MailboxMessagesResponse`.
- Query: `limit`, `cursor`, `unread`, `starred`, `hasAttachments`, `from`, `after`, `before`.

`GET /api/mail-accounts/:accountId/messages/unread`
- Per-Mail account unread view. No cross-account UI unread endpoint exists.
- Query: `limit`, `cursor`, `starred`, `hasAttachments`, `from`, `after`, `before`.

`GET /api/mail-accounts/:accountId/messages/search?q=...`
- Searches synced Local read model subject/body only; it does not call Gmail.
- Query: `q` required, plus `limit`, `cursor`, `starred`, `hasAttachments`, `from`, `after`, `before`.
- Empty query: `400`.

Message list responses are `{ "messages": MessageSummary[], "nextCursor"?: string }`. Default `limit` is `50`; maximum is `200`. Ordering is stable by `receivedAt desc, id desc`. Cursors encode the last `(receivedAt, id)` position. Invalid cursors return `400`.

`MessageSummary` fields: `accountId`, `id`, `stableIdentity`, optional `threadId`, `subject`, `sender`, `recipients`, `receivedAt`, `unread`, `starred`, `mailboxIds`, `snippet`, `attachmentCount`, `updatedAt`.

`GET /api/mail-accounts/:accountId/messages/:messageId`
- Response type: `MessageResponse`.
- Success: `{ "message": MessageDetail }`.
- `MessageDetail` adds `readableBody`, optional `plainTextBody`, `blockedRemoteImageCount`, and attachment metadata. Attachment bytes are not included.
- Unknown Message: `404`.

`GET /api/mail-accounts/:accountId/messages/:messageId/attachments/:attachmentId`
- Streams attachment bytes from the provider after validating account, Message, and attachment metadata locally.
- Success headers include `Content-Type` and `Content-Disposition` when known.
- Unknown account, Message, or attachment: `404`.
- Provider failure: `502 { "error": "Attachment download failed" }`.

### Mailbox Actions

`POST /api/mail-accounts/:accountId/messages/:messageId/actions`
- Body: `{ "action": "markRead" | "markUnread" | "archive" | "delete" | "star" | "unstar" }`.
- Success: `MessageResponse`.
- Provider failure: `502`.

`POST /api/mail-accounts/:accountId/messages/actions`
- Body: `{ "action": MailboxAction, "messageIds": string[] }`.
- Success: `{ "succeededIds": string[], "failed": [{ "id": string, "error": string }] }`.
- Unsupported actions such as label management or move-to-mailbox return `400`.

## AI APIs

AI APIs are read-only and separate from authenticated UI APIs.

`GET /ai-api/mail-accounts`
- Lists Mail accounts without raw sync errors.

`GET /ai-api/messages/unread`
- Lists unread Messages across Mail accounts for AI readers.

`GET /ai-api/messages/:stableIdentity`
- Returns one Message by stable identity.
- Unknown Message: `404`.

AI APIs do not expose Mailbox actions.

## Unsupported

Zmail does not currently expose Composition actions, label management, move-to-mailbox actions, cross-account UI unread, saved views, or first-class Thread APIs. Thread identity is Message metadata only.
