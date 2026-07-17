import { describe, expect, it, vi } from "vite-plus/test";
import { app } from "../apps/api/src/app";
import { fetchHealth } from "../apps/web/src/api";

const healthy = {
  service: "zmail-api",
  status: "ok",
} as const;

describe("Zmail scaffold", () => {
  it("serves health status from the API", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthy);
  });

  it("serves health status from the proxied API path", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthy);
  });

  it("fetches API health through the frontend development path", async () => {
    const fetcher = vi.fn(async (path: string | URL | Request) => {
      expect(path).toBe("/api/health");
      return Response.json(healthy);
    });

    await expect(fetchHealth(fetcher)).resolves.toEqual(healthy);
  });
});
