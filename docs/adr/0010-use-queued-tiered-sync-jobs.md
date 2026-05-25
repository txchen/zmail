# Use queued tiered Sync jobs

Zmail sync requests are scheduled as in-memory **Sync jobs** on one global **Sync queue** instead of blocking the HTTP caller until Gmail work finishes. The queue runs one job at a time across all **Mail accounts**, keeps only recent operational history in memory, and coalesces duplicate automatic work so a wider App user-triggered **Sync scope** supersedes smaller pending automatic jobs for the same **Mail account**.

Sync work is split into tiers: frequent regular sync is checkpointed and incremental for fast freshness, less frequent **Recent reconciliation** scans a short recent window to reflect external cleanup from other mail apps, and App user-triggered custom range sync fetches and reconciles the requested range. This rejects full reconciliation on every poll because Gmail accounts can have many labels and mailbox opens are expensive, while still keeping Zmail close to Gmail for the App user's normal daily cleanup flow.
