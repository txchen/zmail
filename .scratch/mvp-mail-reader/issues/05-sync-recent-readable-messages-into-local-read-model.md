# Sync recent readable Messages into the Local read model

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Extend Gmail sync so Zmail stores recent Messages, readable bodies, attachment metadata, and Mailbox entries in each Mail account's Local read model. The sync should use the configurable Sync window with a 90-day default and avoid syncing attachment file bytes.

## Acceptance criteria

- [ ] Sync applies a configurable Sync window with a 90-day default.
- [ ] Sync stores Messages for each Mail account inside that account's mail database.
- [ ] Sync stores Mailbox entries linking Messages to Mailboxes.
- [ ] Sync handles a Message appearing in multiple Mailboxes without treating it as separate logical Messages.
- [ ] Sync stores readable bodies locally for synced Messages.
- [ ] Sync stores attachment metadata locally.
- [ ] Sync does not store attachment file bytes.
- [ ] The API can list individual Messages for a selected Mailbox.
- [ ] The API can return Message metadata and readable body for a selected Message.
- [ ] Tests cover Sync window filtering.
- [ ] Tests cover Message versus Mailbox entry behavior.
- [ ] Tests cover readable body and attachment metadata persistence.

## Blocked by

- `.scratch/mvp-mail-reader/issues/04-sync-mailbox-tree-and-per-account-status-from-gmail.md`
