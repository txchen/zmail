export type RenderReadableMessageInput = {
  accountId: string;
  messageId: string;
  readableBody: string;
  plainTextBody?: string;
  inlineResources: Array<{
    id: string;
    contentId: string;
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
      srcdoc: frameDocument(escapeHtml(input.plainTextBody ?? "").replaceAll("\n", "<br>")),
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
  let blockedRemoteImageCount = 0;
  const html = withSafeLinks.replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => {
    const srcMatch = /\s+src\s*=\s*(["'])(.*?)\1/i.exec(attributes);

    if (!srcMatch) {
      return `<img${attributes}>`;
    }

    const src = srcMatch[2];
    const inlineResourceUrl = inlineResourceUrlFor(input, src);

    if (inlineResourceUrl) {
      const safeAttributes = attributes.replace(
        /\s+src\s*=\s*(["']).*?\1/i,
        ` src="${escapeAttribute(inlineResourceUrl)}"`,
      );

      return `<img${safeAttributes}>`;
    }

    if (input.showRemoteImages || !/^https?:\/\//i.test(src)) {
      return `<img${attributes}>`;
    }

    blockedRemoteImageCount += 1;
    const safeAttributes = attributes.replace(/\s+src\s*=\s*(["']).*?\1/i, "");

    return `<img${safeAttributes} data-remote-src="${escapeAttribute(src)}">`;
  });

  return {
    srcdoc: frameDocument(html),
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

  return `/api/mail-accounts/${encodeURIComponent(input.accountId)}/messages/${encodeURIComponent(
    input.messageId,
  )}/inline-resources/${encodeURIComponent(resource.id)}`;
}

function frameDocument(body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
<style>
html { color-scheme: light; }
body {
  margin: 0;
  color: #1f2933;
  font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-wrap: anywhere;
}
img, video { max-width: 100%; height: auto; }
table { max-width: 100%; }
a { color: #2563eb; }
</style>
</head>
<body>${body}</body>
</html>`;
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
