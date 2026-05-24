# Implement MVP Mailbox actions against Gmail

Status: done

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Add the MVP Mailbox actions for existing Messages: mark read/unread, Archive, Delete, and star/unstar. Actions should mutate Gmail, then update or resync the Local read model so the UI reflects Gmail state.

## Acceptance criteria

- [x] The UI exposes mark read/unread for Messages.
- [x] Mark read/unread updates Gmail unread state.
- [x] The UI exposes Archive for Messages.
- [x] Archive removes a Message from Inbox while keeping it in the Mail account.
- [x] The UI exposes Delete for Messages.
- [x] Delete moves a Message to Gmail Trash and does not permanently delete it.
- [x] The UI exposes star/unstar for Messages.
- [x] Star/unstar updates Gmail state.
- [x] After a successful Mailbox action, the Local read model reflects updated Gmail state.
- [x] Failed Mailbox actions surface a clear error without corrupting local state.
- [x] Tests cover each Mailbox action against mocked Gmail behavior.
- [x] Tests cover Archive and Delete semantics specifically.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
- `.scratch/mvp-mail-reader/issues/06-render-readable-message-content-safely-in-web-ui.md`
