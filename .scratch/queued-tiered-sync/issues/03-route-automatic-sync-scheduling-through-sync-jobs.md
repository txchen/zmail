# Route automatic sync scheduling through Sync jobs

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Move background **Sync freshness** scheduling onto the **Sync queue**. Automatic regular sync should enqueue checkpointed incremental jobs. Automatic **Recent reconciliation** should enqueue less frequent reconciliation jobs with a configurable recent window.

Add App configuration for the new server-side cadences while preserving the existing initial backfill **Sync window** setting.

## Acceptance criteria

- [x] App configuration supports `regular_sync_interval_minutes`, defaulting to 5.
- [x] App configuration supports `recent_reconciliation_interval_minutes`, defaulting to 30.
- [x] App configuration supports `recent_reconciliation_window_days`, defaulting to 2.
- [x] Existing `recent_message_window_days` remains the initial backfill Sync window for Mailboxes without checkpoints.
- [x] Configuration parsing validates the new values and rejects unknown sync keys.
- [x] The scheduler enqueues regular Sync jobs instead of directly running parallel per-account sync work.
- [x] The scheduler enqueues Recent reconciliation jobs on their separate interval.
- [x] Automatic jobs use the Sync queue's coalescing and custom-job superseding rules.
- [x] Scheduler tests cover regular job enqueueing, reconciliation job enqueueing, default config values, and validation.

## Blocked by

- .scratch/queued-tiered-sync/issues/01-add-in-memory-sync-queue-and-job-history.md
