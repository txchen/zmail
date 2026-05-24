import { healthy } from "@zmail/shared";
import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json(healthy));
