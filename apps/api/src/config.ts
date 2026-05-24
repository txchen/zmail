import type { MailAccountSummary } from "@zmail/shared";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { MailboxActionClient } from "./mailbox-actions.js";
import type { HybridPersistence } from "./persistence.js";
import type { MailboxSyncClient } from "./sync.js";

export type AppLogin = {
  username: string;
  password: string;
  sessionSecret: string;
  sessionTtlDays?: number;
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
  attachmentDownloadClient?: AttachmentDownloadClient;
};

export type AttachmentDownloadClient = {
  downloadAttachment(request: {
    accountId: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Uint8Array>;
};

type Env = Record<string, string | undefined>;

type ConfigFileMailAccount = {
  id: string;
  email_address: string;
  app_password: string;
};

export function loadConfig(env: Env = process.env): AppConfig {
  return loadConfigFromFile(resolveConfigPath(env));
}

export function loadConfigFromFile(path: string): AppConfig {
  let parsed: unknown;

  if (!existsSync(path)) {
    throw new Error(`Missing App configuration file at ${path}. Copy zmail.toml.example to zmail.toml.`);
  }

  try {
    parsed = parseToml(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid App configuration file at ${path}: ${errorMessage(error)}`);
  }

  return parseConfigFile(parsed);
}

export function resolveConfigPath(env: Env = process.env, cwd = process.cwd()): string {
  if (env.ZMAIL_CONFIG_PATH) {
    return resolve(env.ZMAIL_CONFIG_PATH);
  }

  return join(findWorkspaceRoot(cwd), "zmail.toml");
}

function parseConfigFile(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new Error("Invalid App configuration: expected TOML table");
  }

  assertKnownKeys(value, "App configuration", ["app_login", "mail_accounts"]);

  if (!isRecord(value.app_login)) {
    throw new Error("Invalid App configuration: missing app_login table");
  }

  assertKnownKeys(value.app_login, "app_login", [
    "username",
    "password",
    "session_secret",
    "session_ttl_days",
  ]);

  const username = requireString(value.app_login.username, "app_login.username");
  const password = requireString(value.app_login.password, "app_login.password");
  const sessionSecret = requireString(
    value.app_login.session_secret,
    "app_login.session_secret",
  );
  const sessionTtlDays = optionalIntegerInRange(
    value.app_login.session_ttl_days,
    "app_login.session_ttl_days",
    1,
    3650,
  );

  if (sessionSecret.length < 16) {
    throw new Error("Invalid app_login.session_secret: minimum length 16");
  }

  if (!("mail_accounts" in value)) {
    throw new Error("Invalid App configuration: missing mail_accounts");
  }

  if (!Array.isArray(value.mail_accounts)) {
    throw new Error("Invalid mail_accounts: expected array");
  }

  return {
    appLogin: {
      username,
      password,
      sessionSecret,
      sessionTtlDays: sessionTtlDays ?? 365,
    },
    mailAccounts: value.mail_accounts.map(parseMailAccount),
  };
}

function parseMailAccount(value: unknown, index: number): ConfiguredMailAccount {
  const path = `mail_accounts[${index}]`;

  if (!isRecord(value)) {
    throw new Error(`Invalid ${path}: expected table`);
  }

  assertKnownKeys(value, path, ["id", "email_address", "app_password"]);

  const id = requireString(value.id, `${path}.id`);

  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid ${path}.id: expected lowercase slug`);
  }

  return {
    id,
    emailAddress: requireString(value.email_address, `${path}.email_address`),
    appPassword: requireString(value.app_password, `${path}.app_password`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) {
    if (value === undefined) {
      throw new Error(`Invalid App configuration: missing ${path}`);
    }

    throw new Error(`Invalid ${path}: expected non-empty string`);
  }

  return value;
}

function optionalIntegerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${path}: expected integer in range ${min}..${max}`);
  }

  return value;
}

function assertKnownKeys(value: Record<string, unknown>, path: string, keys: string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new Error(`Invalid ${path}: unknown ${key}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findWorkspaceRoot(start: string): string {
  let current = resolve(start);
  const root = parse(current).root;

  while (current !== root) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    current = dirname(current);
  }

  return start;
}
