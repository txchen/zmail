# Expose Sync jobs API

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Expose the in-memory **Sync queue** through authenticated UI API endpoints. The browser should be able to schedule a **Sync job** without waiting for Gmail work and list pending, running, and recent completed jobs for the top-bar sync status view.

The scheduling endpoint should accept a **Mail account** and optional custom **Sync scope** in days. It should validate account existence and custom range limits, return `202 Accepted`, and include the queued or running Sync job record in the response.

## Acceptance criteria

- [x] `POST /api/sync-jobs` requires App login authentication.
- [x] `POST /api/sync-jobs` rejects unknown Mail accounts.
- [x] `POST /api/sync-jobs` accepts regular account sync scheduling.
- [x] `POST /api/sync-jobs` accepts custom range sync scheduling with integer days from 1 through 3650.
- [x] `POST /api/sync-jobs` rejects invalid custom range days.
- [x] `POST /api/sync-jobs` returns `202 Accepted` with a Sync job record.
- [x] `GET /api/sync-jobs` requires App login authentication.
- [x] `GET /api/sync-jobs` returns pending, running, succeeded, and failed jobs.
- [x] Completed job records include result counts when available and error details when failed.
- [x] Shared API contract types cover Sync job state, origin, Sync scope, job result, and jobs responses.
- [x] API tests cover authentication, validation, response status, and response shape.

## Blocked by

- .scratch/queued-tiered-sync/issues/01-add-in-memory-sync-queue-and-job-history.md
