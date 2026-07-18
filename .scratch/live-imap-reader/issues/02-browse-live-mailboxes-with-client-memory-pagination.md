# 02 — Browse live Mailboxes with client-memory pagination

**What to build:** Let the App user browse one opened account's Mailboxes and Account unread view directly from Gmail, load additional Message metadata only through an explicit Load more action, reuse browser-memory results during navigation, and explicitly refresh one Mailbox from its context menu without starting background work.

**Blocked by:** 01 — Open one Gmail account through Live IMAP access.

**Status:** completed

- [x] Selecting a Mailbox reads and displays the newest 50 individual Messages for that Mailbox.
- [x] Account unread reads Gmail All Mail, excludes Spam and Trash, and deduplicates by Message identity.
- [x] Mailbox and unread lists use opaque, Mailbox-safe cursors and return at most 50 Messages per page.
- [x] Load more is an explicit control and appends the next page without infinite-scroll or viewport-triggered requests.
- [x] Returning to an already visited Mailbox or unread view displays browser-memory state without contacting Gmail.
- [x] Previously loaded pagination remains available until page reload, logout, page close, or Manual refresh of that specific Mailbox.
- [x] Manual refresh is scoped to one selected Mailbox, re-reads its account tree and counts plus that Mailbox's Message list and selected Message state, and preserves other cached Mailbox and unread views.
- [x] Refresh is available from Mailbox context menus rather than Mail account rows, with Mailbox-scoped pending, failure, and Manual retry feedback.
- [x] Manual refresh does not read other accounts, create a job, schedule later work, or automatically repeat.
- [x] No Message list request fetches Message body content or a body snippet.
- [x] Tests cover Mailbox and unread behavior, stable ordering, 50-row pagination, cache-first return navigation, and Mailbox-scoped Manual refresh.
