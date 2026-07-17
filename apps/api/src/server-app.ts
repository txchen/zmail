import { existsSync } from "node:fs";
import type { Hono } from "hono";
import type { AppConfig } from "./config.js";
import { createAppWithServices } from "./app.js";
import { serveStaticFile } from "./static-files.js";

export function createServerApp(
  config: AppConfig,
  options: {
    webDistDir: string;
    secureCookies: boolean;
    services?: Partial<
      Pick<
        AppConfig,
        "mailboxSyncClient" | "messageSyncClient" | "mailboxActionClient" | "gmailImapReader"
      >
    >;
  },
): Hono {
  const { app } = createAppWithServices({
    ...config,
    ...options.services,
    secureCookies: options.secureCookies,
  });

  if (existsSync(options.webDistDir)) {
    app.get("*", async (c, next) => {
      const pathname = new URL(c.req.url).pathname;

      if (
        pathname.startsWith("/api/") ||
        pathname.startsWith("/ai-api/") ||
        pathname === "/health"
      ) {
        return next();
      }

      return serveStaticFile(options.webDistDir, pathname);
    });
  }

  return app;
}
