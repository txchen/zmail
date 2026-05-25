# Return structured regular sync results

Status: ready-for-agent

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Make regular sync execution return structured result data instead of only logging useful facts. Regular sync should remain checkpointed and incremental: when a selectable **Mailbox** has a saved checkpoint, it should fetch messages after that checkpoint; when it has no checkpoint, it should use the configured initial **Sync window**.

These result counts should become the source of truth for Sync job completion details.

## Acceptance criteria

- [ ] Regular sync returns `mailboxCount`.
- [ ] Regular sync returns `scannedMailboxCount`.
- [ ] Regular sync returns `skippedMailboxCount`.
- [ ] Regular sync returns `fetchedMessageCount`.
- [ ] Regular sync returns `storedMessageCount`.
- [ ] Regular sync returns `removedMailboxEntryCount`, even if it is zero for this slice.
- [ ] Regular sync returns `durationMs`.
- [ ] Existing per-Mailbox checkpoint behavior remains intact.
- [ ] Sync job completion stores the returned regular sync result.
- [ ] Tests cover result counts and checkpointed incremental behavior using mocked Gmail/IMAP clients and local persistence.

## Blocked by

- .scratch/queued-tiered-sync/issues/01-add-in-memory-sync-queue-and-job-history.md
