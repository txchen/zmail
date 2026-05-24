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
  const missing = ["ZMAIL_APP_USERNAME", "ZMAIL_APP_PASSWORD", "ZMAIL_MAIL_ACCOUNTS"].filter(
    (name) => !env[name],
  );

  if (missing.length) {
    throw new Error(`Missing ${formatList(missing)}`);
  }

  const username = env.ZMAIL_APP_USERNAME;
  const password = env.ZMAIL_APP_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing ZMAIL_APP_USERNAME or ZMAIL_APP_PASSWORD");
  }

  return {
    appLogin: {
      username,
      password,
    },
    mailAccounts: parseMailAccounts(env.ZMAIL_MAIL_ACCOUNTS),
  };
}

function parseMailAccounts(value: string | undefined): ConfiguredMailAccount[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error("Invalid ZMAIL_MAIL_ACCOUNTS: expected JSON array");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid ZMAIL_MAIL_ACCOUNTS: expected JSON array");
  }

  return parsed.map((account, index) => {
    if (!isRecord(account)) {
      throw new Error(`Invalid ZMAIL_MAIL_ACCOUNTS[${index}]: expected object`);
    }

    for (const field of ["id", "displayName", "emailAddress", "appPassword"]) {
      if (typeof account[field] !== "string" || !account[field]) {
        throw new Error(`Invalid ZMAIL_MAIL_ACCOUNTS[${index}]: missing ${field}`);
      }
    }

    return account as ConfiguredMailAccount;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatList(values: string[]): string {
  if (values.length === 1) {
    return values[0];
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
