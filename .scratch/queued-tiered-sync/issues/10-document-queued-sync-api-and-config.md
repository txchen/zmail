# Document queued sync API and config

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Update operator and API documentation for queued tiered sync. Documentation should explain the Sync jobs API, job result counts, polling behavior, in-memory retention, and the new `[sync]` App configuration settings.

## Acceptance criteria

- [x] API docs describe `POST /api/sync-jobs`.
- [x] API docs describe `GET /api/sync-jobs`.
- [x] API docs document Sync job states, origins, Sync scope, result counts, and error shape.
- [x] Config example documents `regular_sync_interval_minutes`.
- [x] Config example documents `recent_reconciliation_interval_minutes`.
- [x] Config example documents `recent_reconciliation_window_days`.
- [x] Documentation explains that Sync jobs are in memory and completed history is limited to the last 200 jobs.
- [x] Documentation explains the difference between regular sync, Recent reconciliation, and custom range sync.
- [x] Documentation mentions that the web UI polls Sync jobs while visible rather than using realtime push.
- [x] Existing API docs tests or documentation checks are updated if present.

## Blocked by

- .scratch/queued-tiered-sync/issues/02-expose-sync-jobs-api.md
- .scratch/queued-tiered-sync/issues/03-route-automatic-sync-scheduling-through-sync-jobs.md
