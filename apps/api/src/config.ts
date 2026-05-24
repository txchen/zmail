import type { MailAccountSummary } from "@zmail/shared";
import type { MailboxActionClient } from "./mailbox-actions.js";
import type { HybridPersistence } from "./persistence.js";
import type { MailboxSyncClient } from "./sync.js";

export type AppLogin = {
  username: string;
  password: string;
};

export type ConfiguredMailAccount = MailAccountSummary & {
  appPassword: string;
};

export type AppConfig = {
  appLogin: AppLogin;
  mailAccounts: ConfiguredMailAccount[];
  persistence?: HybridPersistence;
  mailboxSyncClient?: MailboxSyncClient;
  mailboxActionClient?: MailboxActionClient;
};

type Env = Record<string, string | undefined>;

export function loadConfigFromEnv(env: Env = process.env): AppConfig {
  return {
    appLogin: {
      username: env.ZMAIL_APP_USERNAME ?? "zmail",
      password: env.ZMAIL_APP_PASSWORD ?? "zmail",
    },
    mailAccounts: parseMailAccounts(env.ZMAIL_MAIL_ACCOUNTS),
  };
}

function parseMailAccounts(value: string | undefined): ConfiguredMailAccount[] {
  if (!value) {
    return [];
  }

  return JSON.parse(value) as ConfiguredMailAccount[];
}
