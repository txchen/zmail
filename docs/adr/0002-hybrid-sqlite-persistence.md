---
status: superseded by ADR-0011
---

# Use per-account SQLite persistence

Zmail uses one mail SQLite database per Mail account for synced mail data. The database directory is declared in App configuration, defaults to the repo-local `.data` directory in the example config, and stores per-account mail databases as `<mail-account-id>.sqlite`; database files are ignored by git. Configured Mail accounts come from App configuration, and runtime sync status stays in memory. This keeps each Gmail account's local read model operationally isolated without duplicating config-derived account state.
