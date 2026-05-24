Status: done

# Build Message list views and per-account Search

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Build the shared Message list behavior for Account unread view, Mailbox view, and Search result view. Search must be scoped to one Mail account and behave as its own reader view rather than an inline filter on the selected Mailbox.

## Acceptance criteria

- [x] Account unread view lists unread Messages for one Mail account.
- [x] Mailbox view lists Messages for the selected Mailbox.
- [x] Search submits a query for the selected Mail account and routes to a Search result view.
- [x] Search result view searches across the selected Mail account's synced Messages, not just the current Mailbox.
- [x] Search never mixes results across Mail accounts.
- [x] Clearing Search returns to the previous Mailbox or Account unread view.
- [x] Message lists show individual Messages, not thread groups.
- [x] Loading, error, and empty states are visible and understandable.

## Blocked by

- .scratch/real-vue-web-ui/issues/02-build-app-login-and-default-reader-route.md
