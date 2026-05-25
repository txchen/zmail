# Add Recent reconciliation execution

Status: ready-for-agent

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Implement **Recent reconciliation** as a sync pass that compares recently visible Gmail **Messages** against recent local **Mailbox entries** and removes local entries that Gmail no longer reports within the configured recent window.

This should support the App user's daily flow where messages are deleted or moved in another mail app, including from INBOX child labels, without forcing every regular sync to perform a full historical reconciliation.

## Acceptance criteria

- [ ] Recent reconciliation scans the configured recent date window.
- [ ] Recent reconciliation covers the Visible mailbox set, not only INBOX.
- [ ] Recent reconciliation compares against message received/header date rather than relying only on UID checkpoints.
- [ ] Local Mailbox entries inside the reconciled window are removed when Gmail no longer reports the Message in that Mailbox.
- [ ] Local Mailbox entries outside the reconciled window are not removed by this pass.
- [ ] Recent reconciliation returns the standard Sync job result counts.
- [ ] Account sync status reflects reconciliation success or failure per Mail account.
- [ ] Tests cover removal of stale recent Mailbox entries, preservation of out-of-window entries, and failure reporting.

## Blocked by

- .scratch/queued-tiered-sync/issues/04-return-structured-regular-sync-results.md
