# Return structured regular sync results

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Make regular sync execution return structured result data instead of only logging useful facts. Regular sync should remain checkpointed and incremental: when a selectable **Mailbox** has a saved checkpoint, it should fetch messages after that checkpoint; when it has no checkpoint, it should use the configured initial **Sync window**.

These result counts should become the source of truth for Sync job completion details.

## Acceptance criteria

- [x] Regular sync returns `mailboxCount`.
- [x] Regular sync returns `scannedMailboxCount`.
- [x] Regular sync returns `skippedMailboxCount`.
- [x] Regular sync returns `fetchedMessageCount`.
- [x] Regular sync returns `storedMessageCount`.
- [x] Regular sync returns `removedMailboxEntryCount`, even if it is zero for this slice.
- [x] Regular sync returns `durationMs`.
- [x] Existing per-Mailbox checkpoint behavior remains intact.
- [x] Sync job completion stores the returned regular sync result.
- [x] Tests cover result counts and checkpointed incremental behavior using mocked Gmail/IMAP clients and local persistence.

## Blocked by

- .scratch/queued-tiered-sync/issues/01-add-in-memory-sync-queue-and-job-history.md
