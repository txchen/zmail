# Gmail is the source of truth for mail data

Gmail is authoritative for Message existence, Mailbox membership, unread and starred state, labels, and Message content. Zmail reads those facts through live IMAP and holds mail only in the browser's current in-memory page session as decided in ADR-0011; it is neither an independent mail store nor an offline projection of Gmail.
