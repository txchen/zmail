import type { MailAccountMailboxTree } from "@zmail/shared";

export function accountSyncStatusLabel(status: MailAccountMailboxTree["syncStatus"]): string {
  return {
    synced: "Synced",
    syncing: "Syncing",
    stale: "Stale",
    failing: "Failing",
  }[status];
}
