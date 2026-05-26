import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

export async function serveStaticFile(root: string, pathname: string): Promise<Response> {
  const filePath = safeStaticFilePath(root, pathname);
  const fallbackPath = join(root, "index.html");
  let servedFilePath = filePath;
  let bytes: Buffer;

  try {
    bytes = await readFile(filePath);
  } catch {
    servedFilePath = fallbackPath;
    bytes = await readFile(fallbackPath);
  }

  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);

  return new Response(body, {
    headers: {
      "content-type": contentTypeFor(servedFilePath),
    },
  });
}

function safeStaticFilePath(root: string, pathname: string): string {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const filePath = resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    return join(root, "index.html");
  }

  return filePath;
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
