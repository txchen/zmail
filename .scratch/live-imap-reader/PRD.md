# Live IMAP Reader PRD

Status: ready-for-agent

## Problem Statement

The App user wants Zmail to remain a lightweight, private Gmail Mail reader without copying Gmail mail into a local database. The current Local read model, background Sync jobs, reconciliation, SQLite storage, and server-side AI API add storage, freshness, migration, security, and operational complexity that the App user does not need.

Zmail should instead behave as an intentional live Gmail interface. It should contact Gmail only when the App user performs an explicit UI action, read or mutate Gmail directly through IMAP, retain mail only in the current browser page's memory, and become fully quiescent when the UI is idle. It must still provide a comfortable three-pane reader, Gmail-native Search, safe Message rendering, attachment download, and core Mailbox actions.

## Solution

Replace the synchronized Local read model with **Live IMAP access**. After App login or a full page reload, Zmail shows the three-pane **Reader shell** with configured **Mail accounts** collapsed in the left sidebar, without connecting to Gmail. Selecting a **Mail account** expands it and performs one explicit **Account open** operation that uses a short-lived **Live IMAP session** to read the account's **Visible mailbox set**, Mailbox counts, and the first 50 Inbox Messages.

Each Mail account has at most one ordinary active IMAP session. Its commands are serialized, automatic IMAP IDLE is disabled, and the session can be reused during a ten-second **Interaction lease** after the latest user-triggered operation. Attachment downloads use independent streaming sessions. The server does not persist or cache mail responses. Previously read lists and Message bodies are cache-first only in browser memory until page reload, logout, page close, or **Manual refresh**.

Search is explicitly submitted and uses Gmail `X-GM-RAW`. One Search checks All Mail, Spam, and Trash serially in the same session, deduplicates by `(Mail account ID, X-GM-MSGID)`, and fetches only the current page of Message metadata. Message bodies and attachments are fetched on demand with non-mutating IMAP peek semantics.

Zmail retains mark read/unread, star/unstar, archive, and delete as idempotent target-state **Mailbox actions**. The UI waits for Gmail success before changing browser memory and never automatically retries or re-reads Gmail. Opening an unread Message authorizes one delayed mark-read after the configured **Read dwell time**, but only while the Message remains selected and the page remains visible and focused.

## User Stories

1. As the App user, I want Zmail to remain Gmail-only, so that it can use Gmail-native IMAP behavior without pretending to support inconsistent providers.
2. As the App user, I want Gmail to remain authoritative, so that Zmail never becomes a second mail store.
3. As the App user, I want no Message, Mailbox, body, Search result, or sync state written to disk, so that operating Zmail does not create a mail archive.
4. As the App user, I want the server not to cache mail responses, so that mail content exists only where it is actively being used.
5. As the App user, I want previously read mail retained in browser memory during the current page session, so that back navigation does not repeat Gmail calls.
6. As the App user, I want browser mail state cleared by reload, logout, or page close, so that it is ephemeral.
7. As the App user, I want App login to avoid connecting to Gmail, so that authentication itself does not read mail.
8. As the App user, I want the post-login Reader shell to list configured Mail accounts collapsed in the left sidebar, so that I explicitly choose which Gmail account Zmail may access.
9. As the App user, I want a full page reload to return to the Reader shell with every configured account unopened, so that Zmail never silently restores a prior Gmail connection from a URL.
10. As the App user, I want selecting an account to open its Inbox, so that the first Gmail read follows an explicit action.
11. As the App user, I want Account open to return the Mailbox tree, counts, and first Inbox page together, so that one user action does not create redundant requests.
12. As the App user, I want one Gmail account failure isolated from other accounts, so that I can continue using healthy accounts.
13. As the App user, I want every visible Gmail Mailbox and label available in the account tree, including Spam and Trash, so that navigation reflects Gmail.
14. As the App user, I want account and Mailbox unread counts read from Gmail, so that the tree reflects the state observed during Account open or Manual refresh.
15. As the App user, I want the UI to do nothing while idle, so that it does not poll, prefetch, retry, enter IMAP IDLE, or mutate Gmail without my action.
16. As the App user, I want no automatic refresh, so that leaving Zmail open does not generate Gmail traffic.
17. As the App user, I want Manual refresh scoped to one Mail account, so that refreshing one account does not read every account.
18. As the App user, I want Manual refresh to reload the current account tree and visible Message state, so that I can explicitly request freshness.
19. As the App user, I want a failed Gmail read to stop and show a Manual retry action, so that Zmail does not reconnect behind my back.
20. As the App user, I want failed Gmail writes never automatically retried, so that an uncertain remote outcome is not repeated without my decision.
21. As the App user, I want one ordinary active IMAP connection at most per Mail account, so that rapid interaction does not create a connection storm.
22. As the App user, I want overlapping commands for the same Mail account serialized while different Mail accounts remain independent and may open in parallel, so that one account does not block another and each account's Mailbox selection state cannot race.
23. As the App user, I want a short Interaction lease, so that listing mail, opening a Message, and delayed mark-read can reuse one login.
24. As the App user, I want the Interaction lease to expire ten seconds after the last authorized operation, so that connections do not remain open indefinitely.
25. As the App user, I want automatic IMAP IDLE disabled, so that a retained interaction connection does not become background synchronization.
26. As the App user, I want attachment downloads isolated from the ordinary account session, so that downloading a large file does not block reading.
27. As the App user, I want Message lists to show sender, subject, date, and state without body snippets, so that list loading stays lightweight.
28. As the App user, I want Message lists to contain individual Messages rather than Conversations, so that Zmail avoids thread aggregation complexity.
29. As the App user, I want newest Messages first, so that recent mail is easiest to reach.
30. As the App user, I want lists paged in groups of 50, so that Zmail does not fetch large Mailboxes at once.
31. As the App user, I want an explicit Load more control, so that scrolling alone does not contact Gmail.
32. As the App user, I want returning to a previously visited view to use browser memory, so that navigation avoids unnecessary Gmail calls.
33. As the App user, I want an Account unread view, so that I can see unread mail across the account.
34. As the App user, I want Account unread to use All Mail and exclude Spam and Trash, so that it matches normal Gmail unread expectations.
35. As the App user, I want Search scoped to one selected Mail account, so that account boundaries remain clear.
36. As the App user, I want Search to cover the account rather than only the current Mailbox, so that archived mail is discoverable.
37. As the App user, I want to enter native Gmail Search syntax, so that operators such as `from:`, `is:`, `has:`, and `in:anywhere` work.
38. As the App user, I want Search to run only when I press Enter or activate Search, so that typing does not generate IMAP requests.
39. As the App user, I want Search to check All Mail, Spam, and Trash, so that Gmail Search scope operators behave correctly.
40. As the App user, I want Search results deduplicated by Gmail Message identity, so that labels do not create duplicate Messages.
41. As the App user, I want Search results paged in groups of 50 with explicit Load more, so that large result sets remain manageable.
42. As the App user, I want a stable Message identity across Gmail Mailboxes, so that opening, caching, and acting on a Message remain reliable.
43. As the App user, I want Message identity based on Mail account ID and `X-GM-MSGID`, so that Mailbox-scoped UIDs do not leak into public URLs or contracts.
44. As the App user, I want full MIME content fetched only after I open a Message, so that lists do not download bodies.
45. As the App user, I want body reads to use IMAP peek semantics, so that reading bytes does not implicitly mark mail read.
46. As the App user, I want sanitized HTML with plain-text fallback, so that normal mail is readable without trusting Message HTML.
47. As the App user, I want Message HTML isolated in a sandboxed iframe, so that Message styles and executable content cannot affect the reader shell.
48. As the App user, I want remote images blocked by default, so that opening mail does not automatically notify external senders.
49. As the App user, I want to allow remote images for one Message during the current page session, so that image-heavy mail remains usable.
50. As the App user, I want inline MIME resources rendered with the Message, so that embedded images work without external requests.
51. As the App user, I want attachment metadata shown with the Message, so that I can see available files.
52. As the App user, I want attachments fetched only after I explicitly click Download, so that files are not transferred unnecessarily.
53. As the App user, I want attachment bytes streamed from Gmail without persistence, so that Zmail does not become file storage.
54. As the App user, I want opening an unread Message to wait before marking it read, so that accidental selections do not immediately change Gmail.
55. As the App user, I want Read dwell time configurable from 0 through 60 seconds, so that the operator controls automatic mark-read behavior.
56. As the App user, I want Read dwell time to default to three seconds, so that normal reading marks mail without an immediate write.
57. As the App user, I want zero Read dwell time to disable automatic mark-read rather than make it immediate, so that the safe interpretation is unambiguous.
58. As the App user, I want the delayed mark-read timer to start only after the body loads, so that failed reads do not modify Gmail.
59. As the App user, I want changing Message, hiding the page, or losing focus to cancel the timer, so that mail is marked read only while actively viewed.
60. As the App user, I want mark read/unread, star/unstar, archive, and delete retained, so that Zmail remains a useful Mail reader.
61. As the App user, I want Mailbox actions to express target states rather than toggles, so that repeating an uncertain operation is safe.
62. As the App user, I want Archive to ensure the Inbox label is absent while retaining the Message in Gmail, so that it matches Gmail semantics.
63. As the App user, I want Delete to ensure the Message is in Trash rather than permanently delete it, so that the action remains reversible in Gmail.
64. As the App user, I want the UI to wait for Gmail success before changing state, so that it never presents an unconfirmed mutation as complete.
65. As the App user, I want successful actions applied directly to browser memory without an automatic Gmail reread, so that one action causes one intended remote operation.
66. As the App user, I want an uncertain action result explained clearly, so that I can refresh to verify or safely repeat the same target-state action.
67. As the App user, I want one App login separate from Gmail credentials, so that browser access does not expose app passwords.
68. As the App user, I want Gmail app passwords kept only in server-side configuration, so that the browser never receives them.
69. As the App user, I want an HttpOnly, SameSite App session cookie that is Secure in production, so that the session has appropriate browser protections.
70. As the App user, I want logout to clear browser mail state and close active IMAP sessions, so that the reader leaves no active mail access behind.
71. As the operator, I want the TOML configuration to contain App login, configured Gmail accounts, and Read dwell time only, so that obsolete storage and sync policy are gone.
72. As the operator, I want obsolete storage and sync configuration rejected clearly, so that an old configuration does not appear to remain effective.
73. As the operator, I want the container not to require a data volume, so that deployment matches the no-persistence design.
74. As the operator, I want existing SQLite files left untouched, so that upgrading Zmail never deletes local files automatically.
75. As the App user, I want the undocumented AI API removed, so that it does not create an unauthenticated or unattended Gmail access surface.
76. As the App user, I want the separate diagnostics action removed, so that opening an account and its error state are the single connectivity workflow.
77. As the App user, I do not want compose, reply, forward, draft, or send, so that Zmail remains a focused Mail reader.
78. As the App user, I do not want cross-account Search or a unified inbox, so that every Gmail operation stays explicitly account-scoped.

## Implementation Decisions

- Keep Zmail Gmail-only and continue authenticating configured Mail accounts with Gmail app passwords.
- Keep the Vite+ monorepo, Vue web app, Hono API, TypeScript shared contracts, Nuxt UI, Tailwind, Vue Router, and TanStack Query.
- Remove mail SQLite persistence, schemas, migrations, repositories, sync execution, checkpoints, reconciliation, Sync queue, scheduler, Sync jobs API, Sync job UI, sync configuration, AI API, and Mail account diagnostics.
- Keep Gmail authoritative and perform all mail reads and mutations through live IMAP.
- Introduce a deep `GmailImapReader` boundary for Account open, Mailbox lists, unread lists, Search, Message detail, attachments, Manual refresh, and Mailbox actions.
- Introduce a per-account IMAP session coordinator.
- Allow at most one ordinary active IMAP session per Mail account across overlapping requests.
- Serialize ordinary commands for one Mail account because an IMAP connection has one selected Mailbox at a time.
- Allow different Mail accounts to perform Account open in parallel, with pending and failure state isolated per account.
- Disable ImapFlow automatic IDLE.
- Start or reset a fixed ten-second Interaction lease after each user-authorized operation.
- Close the session when the Interaction lease expires, on logout, or when the connection becomes unusable.
- Do not send IMAP `IDLE`, `NOOP`, Search, Fetch, or other application commands merely to keep a lease alive.
- Use independent, bounded sessions for attachment streams so downloads do not block ordinary account commands.
- Do not cache mail responses on the server.
- Treat TanStack Query and component state as page-session browser memory only.
- Disable query refetch on mount restoration, interval, focus, reconnect, and other automatic triggers.
- Clear all mail queries and reader routes on full page load and logout.
- Preserve App session across an API restart and page reload, but always render the Reader shell with configured accounts collapsed before any Gmail access.
- Implement Account open as one API operation and one IMAP session returning configured account identity, Mailbox tree/counts, and the first Inbox page.
- Discover system Mailboxes by Gmail Special-Use attributes rather than hard-coded localized paths.
- Use `(accountId, X-GM-MSGID)` as public Message identity.
- Keep Mailbox path, UID, and UIDVALIDITY only as internal or opaque cursor/locator data.
- Return Message list metadata without body snippets.
- Treat an incomplete Gmail FETCH row or a Message that disappears during multi-phase page reads as a transient per-Message condition: skip that row, return the remaining page, and do not automatically retry.
- Use newest-first pages of 50 and explicit cursor-based Load more.
- Perform Account unread against Gmail All Mail and exclude Spam and Trash.
- Execute Search only after explicit form submission.
- Pass the user's native Gmail query to IMAP `X-GM-RAW`.
- Search All Mail, Spam, and Trash serially in one session, deduplicate by Gmail Message ID, merge newest-first, and return 50 metadata rows per page.
- Fetch full Message MIME only when the App user opens an uncached Message.
- Use non-mutating IMAP peek semantics for Message bodies, inline resources, and attachments.
- Preserve sandboxed Readable body rendering, sanitization, plain-text fallback, and per-Message remote-image opt-in.
- Stream explicitly requested attachment bytes without writing them to disk or server cache.
- Implement mark read/unread and star/unstar as explicit flag target states.
- Implement Archive as ensuring the Gmail Inbox label is absent.
- Implement Delete as ensuring the Message is in Gmail Trash, never permanent deletion.
- Make all Mailbox actions idempotent so the same target-state request can be safely repeated after an uncertain response.
- Wait for Gmail success before updating browser memory; do not optimistically update, automatically invalidate into an IMAP read, or automatically retry.
- Start delayed mark-read only after an unread Message body successfully renders.
- Require the selected Message, page visibility, and window focus to remain continuous for the configured Read dwell time.
- Cancel rather than pause the timer if any condition is lost.
- Configure `[reader] read_dwell_seconds` with default `3`, valid range `0..60`, and `0` meaning disabled.
- Keep the single App user and stateless JWT App session.
- Use an HttpOnly, SameSite=Lax, browser-session-only cookie, with Secure enabled in production.
- On logout, clear browser mail memory and close every active IMAP session.
- Remove storage and sync tables from the TOML schema and reject them as unknown obsolete configuration.
- Remove the container data-volume requirement and never open or delete existing SQLite files.
- Preserve structured logging for explicitly triggered operations while avoiding credentials, Message content, and query text in logs.
- Keep Composition actions, label management, unified inbox, cross-account Search, Conversation grouping, server mail cache, background refresh, IMAP IDLE, automatic retry, and AI access out of scope.

## Testing Decisions

- Test external behavior and stable contracts rather than internal helper implementation.
- Use the authenticated Hono API with an injected fake `GmailImapReader` as the primary product seam.
- Through the primary seam, test that login and page reload do not access Gmail.
- Test Account open as one account-scoped operation returning Mailboxes, counts, and the first Inbox page.
- Test one account failure does not prevent opening another account.
- Test Mailbox, unread, Search, and Load more contracts with fixed 50-row pagination and opaque cursors.
- Test Search submission and the merged All Mail, Spam, and Trash result contract, including Gmail Message identity deduplication.
- Test Message detail, inline resources, remote-image metadata, and attachment streaming contracts.
- Test that Message body and attachment reads request peek semantics from the adapter.
- Test Mailbox action target states, Gmail-confirmed browser updates, no automatic reread, and failure/uncertain-result responses.
- Test delayed mark-read behavior at the web seam with fake timers: successful body load, configured delay, disable value, selection change, hidden page, lost focus, success, and failure.
- Test browser behavior with a focused smoke path: App login, Reader shell with Configured Mail accounts, Account open, Inbox, opening a Message, and explicit Search.
- Test that client query configuration performs no interval, focus, reconnect, mount, or background refetch.
- Test cache-first navigation within one page session and cache clearing on reload/logout.
- Unit test the IMAP session coordinator only where API fakes cannot prove connection lifecycle.
- Coordinator tests cover one ordinary connection per account, serialization, same-account burst reuse, independent accounts, ten-second lease reset/expiry, disabled automatic IDLE, logout closure, broken-connection cleanup, and independent attachment sessions.
- Add a small adapter-focused test set for Gmail/ImapFlow protocol mapping: Special-Use Mailboxes, `X-GM-MSGID`, `X-GM-RAW`, UID cursors, peek body parts, Gmail labels, flags, archive, Trash, and attachment streams.
- Adapter tests cover incomplete Gmail Message identity and Messages disappearing between sort-key and summary FETCH phases without failing the containing page.
- Reuse the repository's existing API request tests, fake IMAP constructor pattern, Vue API tests, route tests, rendering tests, and browser smoke infrastructure.
- Remove tests whose only contract is SQLite persistence, Sync jobs, reconciliation, scheduler behavior, AI API, or diagnostics.
- Keep typecheck, formatting, lint, full unit/integration suite, and browser smoke as release gates.

## Out of Scope

- Any durable mail, Mailbox, body, attachment, Search, cursor, or sync persistence.
- Server-side mail response caching.
- Offline reading.
- Background polling or freshness timers.
- IMAP IDLE or push updates.
- Automatic retry or reconnect loops.
- A long-lived connection pool.
- Generic non-Gmail IMAP providers.
- Gmail OAuth.
- UI-based Mail account management.
- Cross-account Search.
- Unified inbox or global unread view.
- Conversation or thread aggregation.
- Body snippets in Message lists.
- Search-as-you-type, suggestions, or automatic query submission.
- Infinite scroll or automatic pagination.
- Compose, reply, forward, draft, or send.
- Label creation, deletion, rename, or arbitrary apply/remove label actions.
- Permanent delete.
- AI API, CLI, or agent integration.
- Independent Mail account diagnostics.
- Bulk actions and keyboard shortcuts in this change.
- Automatic deletion of old SQLite files.

## Further Notes

- Canonical language lives in `CONTEXT.md`.
- ADR-0011 records live IMAP without mail persistence and supersedes per-account SQLite and queued sync.
- ADR-0012 records user-authorized Gmail writes and the Quiescent UI boundary.
- ADR-0006 records the retained stateless App session with browser-session cookie protections.
- Gmail Special-Use Mailboxes should be used instead of localized `[Gmail]` paths wherever possible.
- Gmail `X-GM-MSGID` is the cross-Mailbox Message identity; IMAP UIDs remain Mailbox-scoped locators.
- Gmail `X-GM-RAW` is interpreted using Gmail Search syntax.
- An Interaction lease permits a recently authorized connection to remain open without application-level IMAP commands; underlying TCP keepalive is not a Gmail read or write.
- Existing SQLite files are historical operator data after migration. Zmail must not inspect, migrate, truncate, or delete them.
