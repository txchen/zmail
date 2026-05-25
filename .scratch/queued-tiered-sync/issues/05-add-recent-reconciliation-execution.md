# Add Recent reconciliation execution

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Implement **Recent reconciliation** as a sync pass that compares recently visible Gmail **Messages** against recent local **Mailbox entries** and removes local entries that Gmail no longer reports within the configured recent window.

This should support the App user's daily flow where messages are deleted or moved in another mail app, including from INBOX child labels, without forcing every regular sync to perform a full historical reconciliation.

## Acceptance criteria

- [x] Recent reconciliation scans the configured recent date window.
- [x] Recent reconciliation covers the Visible mailbox set, not only INBOX.
- [x] Recent reconciliation compares against message received/header date rather than relying only on UID checkpoints.
- [x] Local Mailbox entries inside the reconciled window are removed when Gmail no longer reports the Message in that Mailbox.
- [x] Local Mailbox entries outside the reconciled window are not removed by this pass.
- [x] Recent reconciliation returns the standard Sync job result counts.
- [x] Account sync status reflects reconciliation success or failure per Mail account.
- [x] Tests cover removal of stale recent Mailbox entries, preservation of out-of-window entries, and failure reporting.

## Blocked by

- .scratch/queued-tiered-sync/issues/04-return-structured-regular-sync-results.md
