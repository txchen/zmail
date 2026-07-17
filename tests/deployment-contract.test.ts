import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { loadConfigFromFile } from "../apps/api/src/config";

describe("stateless deployment contract", () => {
  it("ships an image with a config-only runtime contract", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("ENV ZMAIL_CONFIG_PATH=/config/zmail.toml");
    expect(dockerfile).not.toContain("/data");
    expect(dockerfile).not.toMatch(/^VOLUME\b/m);
  });

  it("keeps the example configuration limited to App login, reader behavior, and accounts", () => {
    const example = readFileSync("zmail.toml.example", "utf8");
    const config = loadConfigFromFile("zmail.toml.example");

    expect(config.appLogin.username).toBe("reader");
    expect(config.reader).toEqual({ readDwellSeconds: 3 });
    expect(config.mailAccounts).toEqual([
      {
        id: "personal",
        emailAddress: "me@example.com",
        appPassword: "replace-with-gmail-app-password",
      },
    ]);
    expect(example).not.toMatch(/^\[(storage|sync)\]/m);
  });

  it("documents stateless operation, migration, and security boundaries", () => {
    const readme = readFileSync("README.md", "utf8");
    const migration = readFileSync("docs/operator-migration.md", "utf8");
    const security = readFileSync("docs/security.md", "utf8");

    for (const phrase of [
      "Account selection",
      "Live IMAP access",
      "browser memory",
      "Manual refresh",
      "Manual retry",
      "does not persist mail",
      "readonly",
    ]) {
      expect(readme).toContain(phrase);
    }
    expect(readme).not.toContain("/data");

    expect(migration).toContain("Remove obsolete `[storage]` and `[sync]`");
    expect(migration).toContain("Existing SQLite files are not used");
    expect(migration).toContain("remain untouched");
    expect(migration).toContain("operator chooses to delete them");

    for (const phrase of [
      "server-side configuration",
      "Secure",
      "Remote images are blocked by default",
      "User-authorized writes",
    ]) {
      expect(security).toContain(phrase);
    }
  });

  it("runs every release gate in container CI", () => {
    const workflow = readFileSync(".github/workflows/container.yml", "utf8");

    for (const command of [
      "pnpm run typecheck",
      "pnpm exec vp fmt --check",
      "pnpm exec vp lint",
      "pnpm exec vp test --run",
      "pnpm run smoke:web",
      "pnpm run smoke:container",
      "docker build --tag zmail:ci .",
      'ZMAIL_SMOKE_SKIP_BUILD: "1"',
      "docker tag zmail:ci",
      "docker push",
    ]) {
      expect(workflow).toContain(command);
    }
  });

  it("provides a local smoke for the stateless production image", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const smoke = readFileSync("scripts/smoke-stateless-container.mjs", "utf8");

    expect(packageJson).toContain(
      '"smoke:container": "node scripts/smoke-stateless-container.mjs"',
    );
    expect(smoke).toContain("docker");
    expect(smoke).toContain("ZMAIL_SMOKE_SKIP_BUILD");
    expect(smoke).toContain("destination=/config/zmail.toml,readonly");
    expect(smoke).toContain("/api/login");
    expect(smoke).toContain("/api/mail-accounts");
    expect(smoke).not.toContain("/data");
  });
});
