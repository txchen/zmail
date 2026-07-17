# 01 — Open one Gmail account through Live IMAP access

**What to build:** Replace the automatic post-login mail load with an explicit Account selection and Account open path. Selecting one configured Mail account should use the new live Gmail reader and one coordinated IMAP session to return that account's Mailbox tree, counts, and first Inbox Message metadata page while the legacy sync path remains available for later contraction.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] App login and a full page load expose configured Mail accounts without opening an IMAP connection.
- [ ] The post-login UI renders Account selection rather than automatically opening the first account.
- [ ] Selecting one Mail account performs one Account open operation and opens that account's Inbox.
- [ ] Account open returns the Visible mailbox set, Special-Use roles, Mailbox counts, and the newest 50 Inbox Messages in one response.
- [ ] Message rows expose `(accountId, X-GM-MSGID)` identity plus envelope and state metadata without fetching or returning body snippets.
- [ ] One failing Mail account produces an account-scoped error without preventing another configured account from opening.
- [ ] The Gmail reader is injected behind one stable application boundary that can be faked by authenticated API tests.
- [ ] Each Mail account has at most one ordinary active IMAP session and commands for that account are serialized.
- [ ] The active session uses a ten-second Interaction lease, resets the lease after authorized operations, disables automatic IMAP IDLE, and closes on expiry or failure.
- [ ] Tests cover no Gmail access during login, the full Account open response, account failure isolation, one connection per account, command serialization, lease reset, and lease expiry.

