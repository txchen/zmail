export type HealthStatus = {
  service: "zmail-api";
  status: "ok";
};

export const healthy: HealthStatus = {
  service: "zmail-api",
  status: "ok",
};

export type MailAccountSummary = {
  id: string;
  displayName: string;
  emailAddress: string;
};

export type MailAccountsResponse = {
  mailAccounts: MailAccountSummary[];
};
