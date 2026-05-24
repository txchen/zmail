export type RenderReadableMessageInput = {
  readableBody: string;
  plainTextBody?: string;
  showRemoteImages: boolean;
};

export type RenderedReadableMessage = {
  html: string;
  blockedRemoteImageCount: number;
};

export function renderReadableMessage(input: RenderReadableMessageInput): RenderedReadableMessage {
  const source = input.readableBody.trim();

  if (!source) {
    return {
      html: escapeHtml(input.plainTextBody ?? "").replaceAll("\n", "<br>"),
      blockedRemoteImageCount: 0,
    };
  }

  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const withoutEventHandlers = withoutScripts.replace(
    /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    "",
  );
  const withoutJavascriptLinks = withoutEventHandlers.replace(
    /\s+href\s*=\s*(["'])javascript:[\s\S]*?\1/gi,
    "",
  );
  let blockedRemoteImageCount = 0;
  const html = withoutJavascriptLinks.replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => {
    const srcMatch = /\s+src\s*=\s*(["'])(.*?)\1/i.exec(attributes);

    if (!srcMatch) {
      return `<img${attributes}>`;
    }

    const src = srcMatch[2];

    if (input.showRemoteImages || !/^https?:\/\//i.test(src)) {
      return `<img${attributes}>`;
    }

    blockedRemoteImageCount += 1;
    const safeAttributes = attributes.replace(/\s+src\s*=\s*(["']).*?\1/i, "");

    return `<img${safeAttributes} data-remote-src="${escapeAttribute(src)}">`;
  });

  return {
    html,
    blockedRemoteImageCount,
  };
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
