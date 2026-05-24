Status: done

# Expand Mailbox metadata

## What to build

Extend Mailbox sync, persistence, shared types, and mailbox tree responses so each Mailbox includes richer metadata needed by the full Mail reader UI. Mailboxes should remain a flat list with hierarchy metadata rather than nested trees.

## Acceptance criteria

- [x] Mailbox summaries include `id`, `name`, `path`, optional `parentId`, optional System mailbox role, `unreadCount`, `totalCount`, and `selectable`.
- [x] Gmail/IMAP special-use information is normalized to stable System mailbox role values when available.
- [x] Gmail/IMAP message counts are synced into `totalCount` when available.
- [x] Custom labels without a System mailbox role are supported.
- [x] Mailbox tree responses stay per-Mail account and return flat Mailbox arrays.
- [x] Tests cover system Mailboxes, custom labels, hierarchy metadata, and Mailboxes with no special role.

## Blocked by

None - can start immediately
