export type RenderReadableMessageInput = {
  accountId: string;
  messageId: string;
  applicationOrigin?: string;
  readableBody: string;
  plainTextBody?: string;
  inlineResources: Array<{
    id: string;
    contentId: string;
    url?: string;
  }>;
  showRemoteImages: boolean;
};

export type RenderedReadableMessage = {
  srcdoc: string;
  blockedRemoteImageCount: number;
};

export function renderReadableMessage(input: RenderReadableMessageInput): RenderedReadableMessage {
  const source = input.readableBody.trim();

  if (!source) {
    return {
      srcdoc: frameDocument(
        escapeHtml(input.plainTextBody ?? "").replaceAll("\n", "<br>"),
        input.showRemoteImages,
        input.applicationOrigin,
      ),
      blockedRemoteImageCount: 0,
    };
  }

  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const withoutExecutableEmbeds = withoutScripts.replace(
    /<(iframe|object|embed|applet|form|input|button|textarea|select|option|meta)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  const withoutStandaloneExecutableEmbeds = withoutExecutableEmbeds.replace(
    /<(iframe|object|embed|applet|form|input|button|textarea|select|option|meta)\b[^>]*\/?>/gi,
    "",
  );
  const withoutEventHandlers = withoutStandaloneExecutableEmbeds.replace(
    /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    "",
  );
  const withoutJavascriptLinks = withoutEventHandlers.replace(
    /\s+href\s*=\s*(["'])javascript:[\s\S]*?\1/gi,
    "",
  );
  const withSafeLinks = withoutJavascriptLinks.replace(/<a\b([^>]*)>/gi, (_match, attributes) => {
    const withoutTarget = attributes
      .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*|[^\s>]+)/gi, "")
      .replace(/\s+rel\s*=\s*(?:"[^"]*"|'[^']*|[^\s>]+)/gi, "");

    return `<a${withoutTarget} target="_blank" rel="noopener noreferrer">`;
  });
  const blockedRemoteImageCount = input.showRemoteImages
    ? 0
    : countRemoteImageReferences(withSafeLinks);
  const html = withSafeLinks.replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => {
    const srcMatch = /\s+src\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i.exec(attributes);

    if (!srcMatch) {
      return `<img${attributes}>`;
    }

    const src = srcMatch[2] ?? srcMatch[3] ?? "";
    const inlineResourceUrl = inlineResourceUrlFor(input, src);

    if (inlineResourceUrl) {
      const safeAttributes = attributes.replace(
        /\s+src\s*=\s*(?:(["']).*?\1|[^\s>]+)/i,
        ` src="${escapeAttribute(inlineResourceUrl)}"`,
      );

      return `<img${safeAttributes}>`;
    }

    if (input.showRemoteImages || !/^https?:\/\//i.test(src)) {
      return `<img${attributes}>`;
    }

    const safeAttributes = attributes.replace(/\s+src\s*=\s*(?:(["']).*?\1|[^\s>]+)/i, "");

    return `<img${safeAttributes} data-remote-src="${escapeAttribute(src)}">`;
  });

  return {
    srcdoc: frameDocument(html, input.showRemoteImages, input.applicationOrigin),
    blockedRemoteImageCount,
  };
}

function inlineResourceUrlFor(input: RenderReadableMessageInput, src: string): string | undefined {
  if (!src.toLowerCase().startsWith("cid:")) {
    return undefined;
  }

  const contentId = decodeURIComponent(src.slice(4)).replace(/^</, "").replace(/>$/, "");
  const resource = input.inlineResources.find((candidate) => candidate.contentId === contentId);

  if (!resource) {
    return undefined;
  }

  return (
    resource.url ??
    `/api/mail-accounts/${encodeURIComponent(input.accountId)}/messages/${encodeURIComponent(
      input.messageId,
    )}/inline-resources/${encodeURIComponent(resource.id)}`
  );
}

function countRemoteImageReferences(html: string): number {
  let count = 0;

  for (const match of html.matchAll(/\s+(?:src|srcset)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi)) {
    count += (match[2] ?? match[3] ?? "").match(/https?:\/\//gi)?.length ?? 0;
  }

  const cssWithoutImports = html.replace(/@import\s+(?:url\()?[^;]+;?/gi, "");
  count += [...cssWithoutImports.matchAll(/url\(\s*(?:"|')?https?:\/\//gi)].length;
  return count;
}

function frameDocument(
  body: string,
  showRemoteImages: boolean,
  applicationOrigin?: string,
): string {
  const trustedApplicationOrigin = validatedApplicationOrigin(applicationOrigin);
  const imgSources = [
    "'self'",
    "data:",
    ...(trustedApplicationOrigin ? [trustedApplicationOrigin] : []),
    ...(showRemoteImages ? ["http:", "https:"] : []),
  ].join(" ");
  const contentSecurityPolicy = `default-src 'none'; img-src ${imgSources}; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;

  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
<meta charset="utf-8">
<style>
html { color-scheme: light; }
body {
  margin: 0;
  background: #f1eee6;
  color: #29353d;
  font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-wrap: anywhere;
}
img, video { max-width: 100%; height: auto; }
table { max-width: 100%; }
a { color: #416b86; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function validatedApplicationOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      value !== url.origin
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
