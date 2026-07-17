# 06 — Enforce Quiescent UI and explicit failure recovery

**What to build:** Make inactivity a true zero-work state, expose every failed read as an explicit recoverable UI state, and harden page lifecycle and App session behavior so Gmail is accessed only after a current user action.

**Blocked by:** 04 — Search one Gmail account with native Gmail syntax; 05 — Perform idempotent Mailbox actions and delayed mark-read.

**Status:** ready-for-agent

- [ ] TanStack Query and reader code disable interval, focus, reconnect, mount, visibility, and other automatic refetch triggers.
- [ ] The UI performs no polling, prefetch, Search-as-you-type, automatic pagination, automatic retry, or IMAP IDLE.
- [ ] Apart from a previously authorized dwell timer and Interaction lease expiry, an idle UI initiates no Gmail read or write.
- [ ] A failed Account open, Message list, Search, Message detail, Manual refresh, or Attachment request ends and presents an explicit Manual retry control.
- [ ] Manual retry repeats only the failed user-selected read operation.
- [ ] A full page load or authenticated reload clears reader routes and browser mail state, then shows Account selection without Gmail access.
- [ ] App sessions use an HttpOnly, SameSite=Lax, browser-session-only cookie and add Secure in production.
- [ ] Logout clears browser mail state, cancels dwell timers, closes all ordinary account sessions and attachment sessions, and clears the App session cookie.
- [ ] Broken or expired IMAP sessions are cleaned up without reconnect loops.
- [ ] The browser smoke path covers App login, no automatic account access, Account open, Inbox, Message open, delayed mark-read, explicit Search, Manual retry, and logout.
- [ ] Tests instrument Gmail reader calls and prove that idle time, page focus changes, browser reconnect, route restoration, and full-page reload do not trigger unauthorized work.

