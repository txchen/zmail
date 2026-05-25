# Move web UI to Sync jobs and top-bar status

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Update the web UI to schedule **Sync jobs** and show actual server-side queue state instead of treating a refresh button mutation as sync state. The UI should show one top-bar spinner when any job is pending or running, poll job state every 15 seconds while the app is visible, and show recent jobs when the App user clicks the spinner.

## Acceptance criteria

- [x] The web API client can schedule Sync jobs.
- [x] The web API client can list Sync jobs.
- [x] Manual account sync uses Sync job scheduling instead of waiting for a blocking refresh response.
- [x] A single account sync request no longer makes every account refresh button spin.
- [x] The top bar shows a spinner when any Sync job is pending or running.
- [x] Clicking the top-bar spinner opens recent Sync jobs.
- [x] The recent jobs surface shows pending, running, succeeded, and failed jobs.
- [x] Completed jobs show result counts when available.
- [x] Failed jobs show useful error details.
- [x] The UI polls Sync jobs every 15 seconds while authenticated and visible.
- [x] The UI pauses job polling while the document is hidden.
- [x] Web tests cover top-bar spinner behavior, recent jobs display, and avoiding all-account button loading.

## Blocked by

- .scratch/queued-tiered-sync/issues/02-expose-sync-jobs-api.md
