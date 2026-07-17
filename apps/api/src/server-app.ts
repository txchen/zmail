import { existsSync } from "node:fs";
import type { Hono } from "hono";
import type { AppConfig } from "./config.js";
import { createApp } from "./app.js";
import { serveStaticFile } from "./static-files.js";

export function createServerApp(
  config: AppConfig,
  options: {
    webDistDir: string;
    secureCookies: boolean;
    services?: Partial<Pick<AppConfig, "gmailImapReader">>;
  },
): Hono {
  const app = createApp({
    ...config,
    ...options.services,
    secureCookies: options.secureCookies,
  });

  if (existsSync(options.webDistDir)) {
    app.get("*", async (c, next) => {
      const pathname = new URL(c.req.url).pathname;

      if (pathname.startsWith("/api/") || pathname === "/health") {
        return next();
      }

      return serveStaticFile(options.webDistDir, pathname, isSpaRoute(pathname));
    });
  }

  return app;
}

function isSpaRoute(pathname: string): boolean {
  if (pathname === "/") {
    return true;
  }

  const account = String.raw`/accounts/[^/]+`;
  const message = String.raw`(?:/messages/[^/]+)?`;

  return (
    new RegExp(`^${account}/(?:unread|search)${message}/?$`).test(pathname) ||
    new RegExp(`^${account}/mailboxes/[^/]+${message}/?$`).test(pathname)
  );
}
