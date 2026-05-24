Status: done

# Add sync status and Mail account diagnostics

## What to build

Expose authenticated per-Mail account sync status and a non-mutating Mail account diagnostics endpoint. Sync status should help the App user understand recent refresh activity and failures. Diagnostics should test the Mail account credential and Gmail connectivity without changing the Local read model.

## Acceptance criteria

- [x] `GET /api/mail-accounts/:accountId/sync-status` returns account ID, sync status, last sync start time, last sync finish time, and raw last error text when present.
- [x] Raw sync error text is only available through authenticated UI APIs, not AI APIs.
- [x] Manual refresh records start/finish timestamps and raw error text on failure.
- [x] `POST /api/mail-accounts/:accountId/diagnose` attempts Gmail/IMAP connectivity for the Mail account without saving Mailboxes or Messages.
- [x] Diagnostics returns success state, visible mailbox count when available, and raw error text on failure.
- [x] Unknown Mail account IDs return `404`.
- [x] Tests cover successful sync status, failing sync status, diagnostics success, diagnostics failure, and unauthenticated access.

## Blocked by

None - can start immediately
