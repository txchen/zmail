# Add custom range sync execution

Status: done

## Parent

.scratch/queued-tiered-sync/PRD.md

## What to build

Implement App user-triggered custom range sync. A custom range **Sync job** should accept a numeric day range, fetch Gmail data for that **Sync scope**, and reconcile local **Mailbox entries** within that same range.

The result should make “sync last N days” behave like a targeted repair or backfill for one **Mail account**, not merely a fetch-new-messages operation.

## Acceptance criteria

- [x] Custom range sync accepts a validated day range from the scheduling API.
- [x] Custom range sync fetches messages within the requested Sync scope.
- [x] Custom range sync reconciles Mailbox entries within the requested Sync scope.
- [x] Custom range sync uses the same result count shape as regular sync and Recent reconciliation.
- [x] A custom range job updates Account sync status for the target Mail account.
- [x] Tests cover a custom range that fetches messages.
- [x] Tests cover a custom range that removes stale Mailbox entries inside the requested range.
- [x] Tests cover that entries outside the custom range are preserved.

## Blocked by

- .scratch/queued-tiered-sync/issues/05-add-recent-reconciliation-execution.md
