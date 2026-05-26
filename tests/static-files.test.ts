import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { serveStaticFile } from "../apps/api/src/static-files";

describe("static file serving", () => {
  it("serves SPA fallback routes as HTML instead of downloads", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "zmail-web-dist-"));
    writeFileSync(join(distDir, "index.html"), '<!doctype html><div id="app"></div>');

    const response = await serveStaticFile(
      distDir,
      "/accounts/mail2hana/mailboxes/INBOX/messages/1865554882713293585",
    );

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain('<div id="app"></div>');
  });
});
