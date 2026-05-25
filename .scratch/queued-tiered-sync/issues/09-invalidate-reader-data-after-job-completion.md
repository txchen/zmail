# Invalidate reader data after job completion

Status: ready-for-agent

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Refresh reader data when the browser observes **Sync job** completion. Since scheduling no longer returns an updated mailbox tree, the web UI should invalidate mailbox tree, Message list, and Message detail data when relevant jobs transition to done.

This slice should make completed regular sync, Recent reconciliation, and custom range sync visible in the reader without a full page refresh.

## Acceptance criteria

- [ ] The web UI detects Sync jobs transitioning from pending/running to succeeded or failed.
- [ ] Successful job completion invalidates the Account mailbox tree.
- [ ] Successful job completion invalidates visible Message list queries that may be affected.
- [ ] Successful job completion invalidates visible Message detail queries when needed.
- [ ] Failed job completion does not discard existing reader data.
- [ ] Reconciliation removals are reflected in visible Mailboxes after invalidation.
- [ ] Tests cover data invalidation after observed successful job completion.
- [ ] Tests cover preserving existing reader data after failed job completion.

## Blocked by

- .scratch/queued-tiered-sync/issues/08-move-web-ui-to-sync-jobs-and-top-bar-status.md
