# 04 — Search one Gmail account with native Gmail syntax

**What to build:** Give the App user an explicitly submitted, account-scoped Search that passes native Gmail query syntax through IMAP, covers Gmail's normal and `in:anywhere` scopes, deduplicates label appearances, and pages lightweight Message metadata without Search-as-you-type.

**Blocked by:** 02 — Browse live Mailboxes with client-memory pagination.

**Status:** done

- [x] Typing or editing the Search field never contacts Gmail.
- [x] Pressing Enter or activating Search submits the native Gmail query exactly once.
- [x] One Search uses one ordinary account session to check All Mail, Spam, and Trash serially through `X-GM-RAW`.
- [x] Results from the three Mailboxes are deduplicated by `(accountId, X-GM-MSGID)`.
- [x] The merged result is newest-first and returns at most 50 metadata-only Message rows per page.
- [x] Explicit Load more retrieves the next Search page without fetching Message bodies.
- [x] Ordinary Gmail queries exclude Spam and Trash according to Gmail semantics, while scope operators such as `in:anywhere`, `in:spam`, and `in:trash` can include them.
- [x] Search is limited to the selected Mail account and never becomes cross-account.
- [x] Returning to a prior Search result view uses browser-memory results and pagination without automatically repeating the query.
- [x] Empty queries do not create an IMAP request.
- [x] Search query text and Message content are not written to application logs.
- [x] Tests cover explicit submission, three-Mailbox execution, identity deduplication, ordering, pagination, Gmail scope operators, account isolation, and cache-first return navigation.
