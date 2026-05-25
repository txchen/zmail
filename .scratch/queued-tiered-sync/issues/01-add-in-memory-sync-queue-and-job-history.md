# Add in-memory Sync queue and job history

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Build the core in-memory **Sync queue** for one Zmail installation. The queue should accept **Sync jobs**, run only one job at a time across all **Mail accounts**, expose pending/running/completed state, coalesce duplicate automatic work, allow wider App user-triggered **Sync scope** jobs to supersede smaller pending automatic jobs for the same **Mail account**, and retain the last 200 completed jobs in memory.

This slice does not need to wire the queue into HTTP or Gmail sync yet. It should provide a small testable interface that later API and scheduler work can call.

## Acceptance criteria

- [x] Sync jobs can be scheduled and move through pending, running, succeeded, and failed states.
- [x] Only one Sync job runs at a time.
- [x] Jobs run in queue order unless coalescing or superseding rules intentionally remove pending work.
- [x] Duplicate automatic jobs for the same Mail account and Sync scope are coalesced.
- [x] A wider App user-triggered custom range job supersedes pending smaller automatic jobs for the same Mail account.
- [x] Automatic jobs for a Mail account are skipped while a custom range job for that account is pending or running.
- [x] Automatic jobs for other Mail accounts can still be queued behind the global queue.
- [x] Failed jobs capture a stable error string without stopping later jobs.
- [x] The queue retains the last 200 completed jobs in memory.
- [x] Unit tests cover ordering, concurrency, coalescing, superseding, failure capture, and history retention.

## Blocked by

None - can start immediately
