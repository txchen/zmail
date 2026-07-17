# 03 — Read live Message content and download Attachments

**What to build:** Open an individual Message by Gmail Message identity, fetch and render its MIME content safely without changing Gmail state, reuse the body from browser memory on return navigation, and let the App user explicitly stream Attachment files from Gmail.

**Blocked by:** 02 — Browse live Mailboxes with client-memory pagination.

**Status:** done

- [x] Message detail uses `(accountId, X-GM-MSGID)` as public identity and does not expose a Mailbox UID as Message identity.
- [x] The Gmail reader can locate a Message across All Mail, Spam, and Trash after it moves between Mailboxes.
- [x] Opening an uncached Message fetches full MIME content only for that Message.
- [x] Body, inline-resource, and attachment reads use non-mutating IMAP peek semantics.
- [x] Readable body sanitization, sandboxed iframe isolation, safe links, and plain-text fallback remain intact.
- [x] Inline MIME resources render through authenticated, non-persistent responses.
- [x] Remote images remain blocked by default and can be allowed only for the selected Message in the current page session.
- [x] Message detail returns Attachment names, MIME types, and sizes without fetching file bytes.
- [x] Clicking Download opens an independent bounded IMAP session and streams only the requested Attachment bytes.
- [x] Attachment completion, cancellation, and failure close the independent session and never write bytes to disk or server cache.
- [x] Returning to an already opened Message uses browser-memory content without another Gmail request.
- [x] Tests cover identity lookup, peek semantics, rendering safety, inline resources, remote-image behavior, browser-memory reuse, and Attachment streaming cleanup.
