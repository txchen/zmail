# Implement MVP Mailbox actions against Gmail

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Add the MVP Mailbox actions for existing Messages: mark read/unread, Archive, Delete, and star/unstar. Actions should mutate Gmail, then update or resync the Local read model so the UI reflects Gmail state.

## Acceptance criteria

- [ ] The UI exposes mark read/unread for Messages.
- [ ] Mark read/unread updates Gmail unread state.
- [ ] The UI exposes Archive for Messages.
- [ ] Archive removes a Message from Inbox while keeping it in the Mail account.
- [ ] The UI exposes Delete for Messages.
- [ ] Delete moves a Message to Gmail Trash and does not permanently delete it.
- [ ] The UI exposes star/unstar for Messages.
- [ ] Star/unstar updates Gmail state.
- [ ] After a successful Mailbox action, the Local read model reflects updated Gmail state.
- [ ] Failed Mailbox actions surface a clear error without corrupting local state.
- [ ] Tests cover each Mailbox action against mocked Gmail behavior.
- [ ] Tests cover Archive and Delete semantics specifically.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
- `.scratch/mvp-mail-reader/issues/06-render-readable-message-content-safely-in-web-ui.md`
