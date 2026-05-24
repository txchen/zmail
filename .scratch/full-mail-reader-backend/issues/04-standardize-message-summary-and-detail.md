Status: done

# Standardize Message summary and detail

## What to build

Define and implement the full-reader Message summary/detail shapes used by mailbox lists, unread view, search, UI detail, and AI read APIs. The primary API remains Message-based; thread identity is metadata only, not a first-class Thread API.

## Acceptance criteria

- [x] Message summaries include `accountId`, `id`, `stableIdentity`, optional `threadId`, `subject`, sender, recipients, `receivedAt`, `unread`, `starred`, `mailboxIds`, snippet, `attachmentCount`, and `updatedAt`.
- [x] Message participant values include address and optional display name.
- [x] Message detail includes summary fields plus `readableBody`, optional `plainTextBody`, `blockedRemoteImageCount`, and attachment metadata.
- [x] Attachment bytes are not stored in Message detail.
- [x] Existing mailbox message list and message detail endpoints return the standardized shapes.
- [x] AI read APIs share the core message shapes without UI-only workflow fields.
- [x] Tests cover summary serialization, detail serialization, thread metadata, participant fields, snippets, attachment counts, and `updatedAt`.

## Blocked by

- .scratch/full-mail-reader-backend/issues/03-expand-mailbox-metadata.md
