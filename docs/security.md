# Security

Zmail is a private, single-App-user Mail reader intended for self-hosting behind HTTPS and an
operator-managed access layer.

## Credentials and App sessions

Gmail app passwords live only in server-side configuration. They are used for Live IMAP access and
are never included in browser responses or logs. The App login is separate from every Gmail
credential.

The App session is a signed, HttpOnly, SameSite=Lax, browser-session cookie. In production the
cookie is also `Secure`, so deploy the service behind HTTPS. Rotating
`app_login.session_secret` revokes existing sessions. Logging out clears browser mail memory and
closes active Live IMAP sessions.

## Message content and network access

Remote images are blocked by default so opening a Message does not notify an external image host.
The App user can opt in for one Message during the current page session. Message HTML is sanitized
and rendered inside a sandboxed iframe; scripts, forms, executable embeds, and redirects are
removed or disabled. Attachments and inline resources are fetched from Gmail only after the
corresponding user action and are not persisted by the server.

## Gmail reads and writes

App login, Account selection, page reload, idle time, focus changes, and reconnect events do not
contact Gmail. Reads occur through Live IMAP access after an explicit reader operation, with no
background polling, prefetch, IMAP IDLE, or automatic retry.

**User-authorized writes** are limited to explicit Mailbox actions and delayed mark-read that was
authorized by opening and continuously viewing an unread Message. Passive reads and background
events never authorize Gmail mutations. Failed or uncertain actions are not automatically retried;
the App user must deliberately repeat the idempotent target-state action.
