import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("installable web app", () => {
  const indexHtml = readFileSync(resolve("apps/web/index.html"), "utf8");

  it("renders at device width so mobile text is not scaled down", () => {
    expect(indexHtml).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    );
  });

  it("links an iOS home screen icon and a manifest whose icons exist", () => {
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(existsSync(resolve("apps/web/public/apple-touch-icon.png"))).toBe(true);

    const manifest: unknown = JSON.parse(
      readFileSync(resolve("apps/web/public/manifest.webmanifest"), "utf8"),
    );
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/" });
    const icons =
      typeof manifest === "object" &&
      manifest &&
      "icons" in manifest &&
      Array.isArray(manifest.icons)
        ? manifest.icons
        : [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(existsSync(resolve(`apps/web/public${String(icon.src)}`))).toBe(true);
    }
  });
});
