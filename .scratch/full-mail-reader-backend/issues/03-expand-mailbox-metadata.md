Status: ready-for-agent

# Expand Mailbox metadata

## What to build

Extend Mailbox sync, persistence, shared types, and mailbox tree responses so each Mailbox includes richer metadata needed by the full Mail reader UI. Mailboxes should remain a flat list with hierarchy metadata rather than nested trees.

## Acceptance criteria

- [ ] Mailbox summaries include `id`, `name`, `path`, optional `parentId`, optional System mailbox role, `unreadCount`, `totalCount`, and `selectable`.
- [ ] Gmail/IMAP special-use information is normalized to stable System mailbox role values when available.
- [ ] Gmail/IMAP message counts are synced into `totalCount` when available.
- [ ] Custom labels without a System mailbox role are supported.
- [ ] Mailbox tree responses stay per-Mail account and return flat Mailbox arrays.
- [ ] Tests cover system Mailboxes, custom labels, hierarchy metadata, and Mailboxes with no special role.

## Blocked by

None - can start immediately
