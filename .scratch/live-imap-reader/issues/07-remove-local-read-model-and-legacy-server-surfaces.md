# 07 — Remove the Local read model and legacy server surfaces

**What to build:** Contract the completed live-reader migration by removing the SQLite and background-sync architecture, deleting undocumented or redundant server surfaces, and making the runtime configuration accurately describe a live, non-persistent Gmail reader.

**Blocked by:** 06 — Enforce Quiescent UI and explicit failure recovery.

**Status:** completed

- [x] The production server no longer creates, opens, migrates, or queries a SQLite mail database.
- [x] Mail persistence repositories, schemas, migrations, checkpoints, reconciliation, Sync execution, scheduler, queue, and job history are removed.
- [x] Sync jobs, blocking refresh compatibility, sync status, custom range, and diagnostics APIs are removed.
- [x] Sync activity, diagnostics, custom range, stale/syncing/failing status, and other legacy UI surfaces are removed.
- [x] The AI API and its shared contracts, implementation, documentation, and tests are removed.
- [x] Shared API contracts describe only App session, configured account identity, Account open, live lists, Search, Message detail, Attachments, Manual refresh/retry, and Mailbox actions.
- [x] TOML configuration removes storage and sync tables, accepts `[reader] read_dwell_seconds`, and rejects obsolete `[storage]` and `[sync]` tables with clear migration errors.
- [x] Existing SQLite files and directories are never inspected, modified, migrated, truncated, or deleted.
- [x] Legacy tests whose only contract is persistence, sync, scheduler, reconciliation, jobs, diagnostics, or AI API are removed or replaced by live-reader behavior tests.
- [x] Typecheck, formatting, lint, and the full non-browser test suite pass after the contraction.
