Status: done

# Build Account mailbox tree and diagnostics

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Build the Account mailbox tree in the reader sidebar. Each Mail account shows unread count, Account sync status, manual refresh, its Mailboxes, and a secondary diagnostics entry point. Diagnostics should run on demand and display current connectivity or credential results without changing the Local read model.

## Acceptance criteria

- [x] Each configured Mail account appears separately in the Account mailbox tree.
- [x] Each Mail account shows its unread count and Account sync status.
- [x] Each Mailbox appears under its Mail account with unread count.
- [x] Manual refresh is available per Mail account and refreshes reader data after completion.
- [x] Diagnostics opens from a Mail account without replacing the current reader view.
- [x] Diagnostics shows current sync-status context before or alongside diagnostic results.
- [x] Running diagnostics displays success with visible Mailbox count or failure with provider error text.
- [x] Diagnostics does not perform mail sync or mutate the Local read model.

## Blocked by

- .scratch/real-vue-web-ui/issues/02-build-app-login-and-default-reader-route.md
