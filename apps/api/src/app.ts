import { healthy } from "@zmail/shared";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { AppConfig, AppLogin } from "./config.js";
import { loadConfigFromEnv } from "./config.js";

const sessionCookieName = "zmail_session";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();
  const sessionToken = randomUUID();

  app.get("/health", (c) => c.json(healthy));

  app.post("/api/login", async (c) => {
    const body = await c.req.json<AppLogin>();

    if (body.username !== config.appLogin.username || body.password !== config.appLogin.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    c.header("set-cookie", `${sessionCookieName}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/`);

    return c.body(null, 204);
  });

  app.get("/api/mail-accounts", (c) => {
    if (!c.req.header("cookie")?.includes(`${sessionCookieName}=${sessionToken}`)) {
      return c.json({ error: "Authentication required" }, 401);
    }

    return c.json({
      mailAccounts: config.mailAccounts.map(({ id, displayName, emailAddress }) => ({
        id,
        displayName,
        emailAddress,
      })),
    });
  });

  return app;
}

export const app = createApp(loadConfigFromEnv());
