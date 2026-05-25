# Optimize regular sync with unchanged-Mailbox skipping

Status: ready-for-agent

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Improve regular sync performance for Mail accounts with many labels by skipping unchanged **Mailboxes** where Gmail mailbox status metadata indicates no new messages need to be fetched. Regular sync should remain optimized for fresh new mail and should not become a full reconciliation pass.

## Acceptance criteria

- [ ] The Gmail sync client exposes mailbox status metadata sufficient to decide whether a Mailbox changed when Gmail provides it.
- [ ] Regular sync records or reads the local metadata needed to compare a Mailbox against Gmail status.
- [ ] Regular sync skips opening/fetching a Mailbox when status metadata indicates it is unchanged.
- [ ] Skipped Mailboxes increment `skippedMailboxCount`.
- [ ] Mailboxes without sufficient metadata still sync safely.
- [ ] Recent reconciliation and custom range sync are not weakened by this optimization.
- [ ] Tests cover skipped unchanged Mailboxes, changed Mailboxes still fetching, and fallback when metadata is missing.

## Blocked by

- .scratch/queued-tiered-sync/issues/04-return-structured-regular-sync-results.md
