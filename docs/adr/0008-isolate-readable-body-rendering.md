# Isolate Readable body rendering

Zmail will render each **Readable body** inside a sandboxed iframe rather than injecting Message HTML directly into the Vue app DOM. Message HTML and CSS are untrusted presentation data from outside Zmail, and iframe isolation provides a hard boundary that prevents Message styles from changing the Mail reader shell while still allowing iframe-local base styles and sanitized body content.

Rendered Messages are passive content: scripts, forms, executable embeds, and document-level redirects are removed or disabled; links open outside the reader with opener isolation. Images are the only body subresource Zmail intentionally supports, either as local **Inline message resources** or as remote images shown only after the App user allows them for that Message.

Amendment: the iframe sandbox grants `allow-same-origin` but never `allow-scripts`. Without same-origin access the reader cannot measure the body, so the iframe had a fixed height and scrolled inside the reader's own scroll area, which is unusable on phones. With scripts still blocked by both the sandbox and the iframe's CSP, the Message cannot run code with the app's origin; the reader only reads its size and applies shrink-to-fit zoom to wide fixed-layout HTML.
