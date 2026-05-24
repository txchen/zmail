Status: ready-for-agent

# Add attachment download proxy

## What to build

Add authenticated on-demand attachment byte download through the backend. Attachment metadata remains in the Local read model, but attachment bytes are fetched from Gmail only when requested.

## Acceptance criteria

- [ ] `GET /api/mail-accounts/:accountId/messages/:messageId/attachments/:attachmentId` streams attachment bytes through the API.
- [ ] Endpoint requires App authentication.
- [ ] Endpoint validates Mail account, Message, and attachment identity before fetching.
- [ ] Attachment bytes are not persisted in the Local read model.
- [ ] Response includes appropriate content type and filename headers when known.
- [ ] Gmail/provider errors return useful authenticated UI errors without exposing Mail account credentials.
- [ ] Tests cover successful download, unknown attachment, unknown message, provider failure, and unauthenticated access.

## Blocked by

- .scratch/full-mail-reader-backend/issues/04-standardize-message-summary-and-detail.md
