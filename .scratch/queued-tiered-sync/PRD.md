# Queued Tiered Sync PRD

Status: ready-for-agent

## Problem Statement

The App user needs Zmail sync to stop behaving like a blocking refresh request. Syncing Gmail can take many seconds, especially across several Mail accounts and many Gmail labels, so the browser should schedule server-side work and keep reading mail while the server processes it.

The current UI also misrepresents sync state: clicking one account refresh makes all account refresh buttons spin because the browser only knows a mutation is pending, not which server-side sync work exists. The App user needs a top-bar view of actual pending, running, and recently completed Sync jobs, including whether recent jobs succeeded and what they changed.

The App user also needs Zmail to converge after normal morning cleanup in another mail app. Regular sync must stay fast and incremental, but a less frequent Recent reconciliation pass should detect external deletions or moves in recent mail across the Visible mailbox set.

## Solution

Replace synchronous manual refresh with queued **Sync jobs**. The API schedules work onto one in-memory global **Sync queue** and returns immediately. The queue runs one job at a time across all **Mail accounts**, coalesces duplicate automatic work, and keeps the last 200 completed jobs in memory for operational feedback.

Split sync work into tiers. Frequent regular sync remains checkpointed and incremental for fast **Sync freshness**. Less frequent **Recent reconciliation** scans a short recent window, defaulting to 2 days every 30 minutes, and removes local **Mailbox entries** that Gmail no longer reports. App user-triggered custom range sync accepts a numeric day range and fetches plus reconciles that **Sync scope**.

The web UI polls the jobs API every 15 seconds while the app is visible. A top-bar spinner appears when any Sync job is pending or running. Clicking the spinner opens recent Sync jobs with pending, in-progress, succeeded, and failed results.

## User Stories

1. As the App user, I want clicking sync to return quickly, so that the reader does not block while Gmail work runs.
2. As the App user, I want Sync jobs to run on the server, so that long Gmail operations continue independently of one button click.
3. As the App user, I want all Mail account sync work to run through one queue, so that Zmail avoids several concurrent Gmail IMAP syncs.
4. As the App user, I want Sync jobs for four Mail accounts to run one by one, so that each account gets synced without parallel mailbox crawling.
5. As the App user, I want duplicate automatic Sync jobs to be coalesced, so that the queue does not fill with stale repeated work.
6. As the App user, I want a wider custom Sync job to supersede smaller pending automatic jobs for the same Mail account, so that queue time is not wasted.
7. As the App user, I want automatic jobs for a Mail account skipped while a custom range job for that account is pending or running, so that larger user-requested work is respected.
8. As the App user, I want queued jobs for other Mail accounts to continue behind the global queue, so that one custom account sync does not disable scheduling for the whole installation.
9. As the App user, I want regular repeating sync to be fast, so that Zmail stays fresh without constantly doing expensive mailbox scans.
10. As the App user, I want regular sync to use Mailbox checkpoints, so that Zmail fetches new Gmail messages instead of rescanning the whole Sync window.
11. As the App user, I want regular sync to skip unchanged Mailboxes where possible, so that accounts with many labels do not take many seconds on every poll.
12. As the App user, I want Recent reconciliation to run automatically, so that cleanup I do in another mail app is reflected in Zmail.
13. As the App user, I want Recent reconciliation to cover recent mail across the Visible mailbox set, so that deletes from INBOX and INBOX child labels both converge.
14. As the App user, I want Recent reconciliation to default to the last 2 days, so that normal daily cleanup is detected without a full historical scan.
15. As the App user, I want Recent reconciliation to run less often than regular sync, so that deletion detection does not make every freshness poll slow.
16. As the App user, I want App configuration to control sync intervals and reconciliation window, so that I can tune Zmail for my Gmail volume.
17. As the App user, I want the default regular sync interval to be 5 minutes, so that new mail appears without manual refresh.
18. As the App user, I want the default Recent reconciliation interval to be 30 minutes, so that Zmail catches external cleanup during the workday.
19. As the App user, I want to schedule a custom range sync by entering days, so that I can repair or backfill a specific Mail account.
20. As the App user, I want custom range days validated, so that I do not accidentally schedule an unbounded Gmail scan.
21. As the App user, I want custom range sync to fetch and reconcile that range, so that “sync last 180 days” makes Zmail converge for that range.
22. As the App user, I want the web UI to poll sync state only while visible, so that background tabs do not waste requests.
23. As the App user, I want the web UI to poll every 15 seconds while visible, so that job state is current enough without adding realtime infrastructure.
24. As the App user, I want one top-bar spinner for active sync work, so that sync state is visible without making every account button spin.
25. As the App user, I want clicking the top-bar spinner to show recent Sync jobs, so that I can inspect what is running and what just finished.
26. As the App user, I want pending jobs shown in the recent jobs view, so that I know what is waiting in the queue.
27. As the App user, I want the running job shown in the recent jobs view, so that I know which Mail account is currently syncing.
28. As the App user, I want completed jobs shown with success or failure, so that I can tell whether sync is healthy.
29. As the App user, I want failed jobs to include an error, so that I have useful troubleshooting information.
30. As the App user, I want completed jobs to include result counts, so that I can tell whether sync fetched, stored, skipped, or removed anything.
31. As the App user, I want the last 200 completed jobs kept in memory, so that the jobs view has useful recent operational history.
32. As the App user, I accept Sync job history being lost on server restart, so that implementation remains simple for a private home-hosted app.
33. As the App user, I want Account sync status to remain per Mail account, so that one failing account does not make all accounts appear broken.
34. As the App user, I want Gmail to remain authoritative, so that Zmail removes local Mailbox entries when reconciliation proves Gmail no longer exposes them.
35. As a developer, I want Sync job scheduling to be a small API surface, so that the web UI no longer depends on a blocking refresh endpoint.
36. As a developer, I want sync queue behavior testable without Gmail, so that coalescing, ordering, and job status can be verified in isolation.
37. As a developer, I want sync execution results returned as structured data, so that logs and UI feedback use the same facts.
38. As a developer, I want the Gmail IMAP client to expose enough mailbox status metadata to skip unchanged Mailboxes, so that regular sync performance can improve without changing UI behavior.
39. As a developer, I want Recent reconciliation behavior tested against mocked Gmail mailbox contents, so that deletion and label-removal convergence is reliable.
40. As an AI reader, I want the Local read model to stay fresh through background work, so that read-only AI API calls continue to avoid waiting on Gmail.

## Implementation Decisions

- Replace synchronous manual refresh semantics with asynchronous **Sync job** scheduling.
- Add a `POST /api/sync-jobs` endpoint that schedules a Sync job and returns `202 Accepted` with the queued or running job record.
- Add a `GET /api/sync-jobs` endpoint that returns pending, running, and recent completed Sync jobs.
- Keep Sync jobs and Sync queue state in memory.
- Keep the last 200 completed Sync jobs in memory.
- Use one global Sync queue with concurrency 1 for one Zmail installation.
- Run Sync jobs one at a time across all Mail accounts.
- Coalesce duplicate regular automatic jobs for the same Mail account.
- Allow wider App user-triggered custom range jobs to replace or supersede pending smaller automatic jobs for the same Mail account.
- If a smaller regular job is already running and a wider custom range is requested, enqueue the custom range job behind the running job.
- Skip automatic jobs for a Mail account while a custom range job for that Mail account is pending or running.
- Continue scheduling automatic jobs for other Mail accounts behind the same global queue.
- Model Sync job state as pending, running, succeeded, or failed.
- Include created, started, and finished timestamps where applicable.
- Include job origin, distinguishing App user-triggered work from automatic Sync freshness polling.
- Include Sync scope on each job.
- Return job results with `mailboxCount`, `scannedMailboxCount`, `skippedMailboxCount`, `fetchedMessageCount`, `storedMessageCount`, `removedMailboxEntryCount`, and `durationMs`.
- Return job failure details with a stable user-visible error string.
- Preserve per-Mail account Account sync status alongside job state.
- Configure regular incremental sync with `[sync] regular_sync_interval_minutes`, defaulting to 5.
- Configure Recent reconciliation with `[sync] recent_reconciliation_interval_minutes`, defaulting to 30.
- Configure Recent reconciliation range with `[sync] recent_reconciliation_window_days`, defaulting to 2.
- Keep existing `recent_message_window_days` as the initial backfill Sync window for Mailboxes without checkpoints.
- Validate custom range sync days as an integer from 1 through 3650.
- Treat custom range sync as fetch plus reconciliation for the requested range.
- Treat Recent reconciliation as a recent Gmail membership comparison against local recent Mailbox entries.
- Regular sync may skip unchanged Mailboxes using Gmail mailbox status metadata such as UIDNEXT when available.
- Recent reconciliation should compare by message received/header date range rather than relying only on UID checkpoints.
- The web UI should use the Sync jobs API instead of the blocking refresh response.
- The web UI should poll `GET /api/sync-jobs` every 15 seconds while authenticated and visible.
- The web UI should pause job polling while the document is hidden.
- The web UI should show one top-bar spinner when any Sync job is pending or running.
- Clicking the top-bar spinner should open a recent jobs surface.
- Account refresh buttons should not all show loading just because one schedule request is in flight.
- Mailbox tree and Message lists should be invalidated after observed job completion rather than from the schedule response.
- Existing `/api/mail-accounts/:id/refresh` may remain temporarily as a compatibility wrapper, but the web UI should move to Sync jobs.

The major modules to build or modify are:

- Sync queue module: in-memory queue, concurrency, coalescing, job state transitions, and recent history retention.
- Sync scheduler module: automatic regular and Recent reconciliation scheduling into the Sync queue.
- Sync execution module: regular incremental sync, Recent reconciliation, custom range sync, and structured result counts.
- Gmail IMAP sync client: mailbox status metadata, unchanged-mailbox skipping, and date-range reconciliation support.
- Persistence module: methods to remove stale Mailbox entries in a reconciled date range and expose any checkpoint/status metadata needed by sync.
- API module: Sync job scheduling and listing endpoints, plus compatibility handling for the old refresh endpoint if retained.
- App configuration module: new sync interval and reconciliation settings with defaults and validation.
- Shared contract types: Sync job, Sync job state, Sync scope, job result, and jobs response.
- Web API client: schedule/list Sync jobs and stop depending on blocking refresh responses.
- Web reader UI: top-bar spinner, recent jobs surface, visible-tab polling, and query invalidation after job completion.

Deep modules should be preferred for the Sync queue and Sync execution layers. The Sync queue can encapsulate ordering, coalescing, state, and retention behind a small testable interface. Sync execution can encapsulate Gmail and persistence work behind structured result data that the API and UI can consume without knowing IMAP details.

## Testing Decisions

- Test externally visible behavior and stable contracts rather than private implementation details.
- Unit test the Sync queue without Gmail:
  - schedules jobs in FIFO order
  - runs only one job at a time
  - exposes pending, running, succeeded, and failed jobs
  - keeps the last 200 completed jobs
  - coalesces duplicate regular jobs
  - supersedes pending smaller automatic jobs with wider custom range jobs
  - skips automatic jobs for an account with a pending or running custom range job
- Unit test App configuration parsing for new sync settings, defaults, unknown keys, and valid ranges.
- API test `POST /api/sync-jobs` for authentication, unknown Mail account, custom range validation, `202 Accepted`, and returned job shape.
- API test `GET /api/sync-jobs` for authentication and inclusion of pending, running, succeeded, and failed jobs.
- API test that job completion updates Account sync status and exposes failure details without breaking other accounts.
- Sync execution tests should use mocked Gmail/IMAP clients and local persistence, following existing mailbox/message sync test patterns.
- Test regular sync remains checkpointed incremental when Mailbox sync state exists.
- Test regular sync can skip unchanged Mailboxes based on mailbox status metadata.
- Test Recent reconciliation removes local Mailbox entries for recent messages no longer reported by Gmail.
- Test Recent reconciliation does not remove local entries outside its configured recent window.
- Test custom range sync fetches and reconciles the requested day range.
- Test result counts for fetched messages, stored messages, skipped mailboxes, scanned mailboxes, and removed Mailbox entries.
- Web tests should cover that one scheduled account sync does not make every account button spin.
- Web tests should cover top-bar spinner visibility when jobs are pending or running.
- Web tests should cover opening recent Sync jobs and displaying pending, running, succeeded, failed, counts, and errors.
- Web tests should cover 15-second polling while visible and paused polling while hidden where practical.
- Existing mailbox sync, message sync, AI API, persistence, and reader UI tests should remain green.

## Out of Scope

- Durable Sync job persistence across API server restarts.
- A database-backed job queue.
- Running multiple Sync jobs concurrently.
- WebSocket, Server-Sent Events, or long-polling job updates.
- Near-real-time IMAP IDLE.
- Full historical reconciliation on every automatic sync.
- Permanent deletion of local Message rows solely because a Message is absent from a short reconciliation window.
- UI account management.
- Gmail OAuth.
- Composition actions.
- Cross-account unified inbox behavior.
- Changing AI API mutability.

## Further Notes

- Canonical domain language lives in `CONTEXT.md`.
- This PRD follows `docs/adr/0010-use-queued-tiered-sync-jobs.md`.
- It also relies on:
  - `docs/adr/0001-gmail-source-of-truth.md`
  - `docs/adr/0002-hybrid-sqlite-persistence.md`
  - `docs/adr/0005-use-toml-for-app-configuration.md`
  - `docs/adr/0007-use-nuxt-ui-and-tailwind-for-web-ui.md`
- Existing code already has per-Mailbox UID checkpoints and structured sync logging; implementation should convert those facts into job result data rather than invent a separate reporting path.
- Current Gmail message sync only opens INBOX-style mailboxes despite the glossary saying the MVP syncs the Visible mailbox set. This PRD assumes the queued/tiered sync work should align behavior with the glossary while still using skip/reconciliation strategies to control cost.
