# Operator migration to Live IMAP

The Live IMAP reader has no local mail projection and requires no writable mail volume.

Before upgrading:

1. Remove obsolete `[storage]` and `[sync]` tables from `zmail.toml`. Current Zmail rejects either
   table so an old setting cannot appear to remain active.
2. Keep `[app_login]`, `[reader] read_dwell_seconds`, and `[[mail_accounts]]` entries. Compare with
   [`zmail.toml.example`](../zmail.toml.example).
3. Remove the old writable mail-data mount from the container definition. Mount only
   `/config/zmail.toml` as a read-only file.

Existing SQLite files are not used by the Live IMAP reader and remain untouched during startup and
operation. Zmail does not inspect, migrate, truncate, or delete them. Keep them wherever they are
until the operator chooses to delete them after completing any desired backup or rollback period.

After starting the new image, App login shows the Reader shell with configured Mail accounts
collapsed in the left sidebar without contacting Gmail. Select one Mail account to expand it,
open its Inbox, and verify Live IMAP access; then use Manual refresh or Manual retry only when you
intend to contact Gmail again.
