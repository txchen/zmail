# Gmail is the source of truth for mail data

Zmail keeps a local read model of Gmail mail data so the UI and AI API can read messages quickly, but Gmail remains authoritative for message existence, mailbox membership, unread state, and message content. The local database is treated as a projection that can be rebuilt from Gmail, which keeps the first product boundary focused on private reading rather than becoming an independent mail store.
