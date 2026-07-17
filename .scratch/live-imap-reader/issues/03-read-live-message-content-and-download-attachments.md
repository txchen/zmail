# 03 — Read live Message content and download Attachments

**What to build:** Open an individual Message by Gmail Message identity, fetch and render its MIME content safely without changing Gmail state, reuse the body from browser memory on return navigation, and let the App user explicitly stream Attachment files from Gmail.

**Blocked by:** 02 — Browse live Mailboxes with client-memory pagination.

**Status:** ready-for-agent

- [ ] Message detail uses `(accountId, X-GM-MSGID)` as public identity and does not expose a Mailbox UID as Message identity.
- [ ] The Gmail reader can locate a Message across All Mail, Spam, and Trash after it moves between Mailboxes.
- [ ] Opening an uncached Message fetches full MIME content only for that Message.
- [ ] Body, inline-resource, and attachment reads use non-mutating IMAP peek semantics.
- [ ] Readable body sanitization, sandboxed iframe isolation, safe links, and plain-text fallback remain intact.
- [ ] Inline MIME resources render through authenticated, non-persistent responses.
- [ ] Remote images remain blocked by default and can be allowed only for the selected Message in the current page session.
- [ ] Message detail returns Attachment names, MIME types, and sizes without fetching file bytes.
- [ ] Clicking Download opens an independent bounded IMAP session and streams only the requested Attachment bytes.
- [ ] Attachment completion, cancellation, and failure close the independent session and never write bytes to disk or server cache.
- [ ] Returning to an already opened Message uses browser-memory content without another Gmail request.
- [ ] Tests cover identity lookup, peek semantics, rendering safety, inline resources, remote-image behavior, browser-memory reuse, and Attachment streaming cleanup.

