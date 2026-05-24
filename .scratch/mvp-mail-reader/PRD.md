# MVP Mail Reader PRD

Status: ready-for-agent

## Problem Statement

The App user wants to read and manage four Gmail accounts from a private web UI without configuring those Gmail accounts directly on a work laptop. Existing open source web mail clients do not provide the clean, modern multi-account reading experience the App user wants.

The App user likes the way macOS Mail shows each Gmail account in a sidebar with that account's own Mailboxes and unread counts. Zmail should provide that style of Mail reader as a home-hosted web app, while keeping Gmail as the source of truth and exposing a read-only AI API for unread mail and message content.

## Solution

Build Zmail as a private, single-user Mail reader. The App user configures Gmail Mail accounts server-side using Gmail app passwords, logs into Zmail with a simple App login, and uses a three-column web UI to browse each Mail account's Mailboxes, inspect Messages, and perform core Mailbox actions.

Zmail syncs recent Gmail mail into a Local read model backed by SQLite. It stores readable message bodies and attachment metadata locally so the UI and AI API can read recent mail without waiting on Gmail. Attachment file bytes, Search, Conversation UI, and Composition actions are outside the MVP boundary.

The implementation uses a Vite+ monorepo with Vue for `apps/web`, Hono on Node.js for `apps/api`, TypeScript across the repo, SQLite for persistence, and `packages/shared` for shared code and types.

## User Stories

1. As the App user, I want to access Zmail through a private web UI, so that I can read Gmail without configuring Gmail accounts on my work laptop.
2. As the App user, I want to log into Zmail with a simple App login, so that the app is not open to anyone who can reach the service.
3. As the App user, I want Mail accounts configured server-side, so that Gmail app passwords are not exposed in the browser.
4. As the App user, I want to configure multiple Gmail Mail accounts, so that one Zmail instance can read all of my accounts.
5. As the App user, I want each Mail account to appear separately in the sidebar, so that I can keep account boundaries clear.
6. As the App user, I want each Mail account to show its own Mailboxes, so that the UI resembles the clean account tree I like in macOS Mail.
7. As the App user, I want unread counts per Mail account and Mailbox, so that I can quickly see which accounts need attention.
8. As the App user, I want Zmail to sync all visible Gmail Mailboxes and labels, so that I can browse the account tree without only seeing Inbox.
9. As the App user, I want Spam and Trash included in the Visible mailbox set, so that the local reader reflects the visible Gmail account structure.
10. As the App user, I want sync limited to a configurable recent Sync window, so that the first version does not pull years of historical mail by default.
11. As the App user, I want the default Sync window to be 90 days, so that recent mail is available while storage and first-sync time stay bounded.
12. As the App user, I want background polling, so that mail updates without manual action.
13. As the App user, I want manual refresh, so that I can force an account to sync when I need current mail.
14. As the App user, I want one failing Mail account to show an account-level error, so that other Mail accounts remain usable.
15. As the App user, I want a three-column layout, so that I can browse Mailboxes, Messages, and content efficiently.
16. As the App user, I want the Message list to show individual Messages, so that the MVP avoids thread UI complexity.
17. As the App user, I want selected Message content to render sanitized HTML, so that most modern email remains readable.
18. As the App user, I want plain-text fallback, so that messages without usable HTML can still be read.
19. As the App user, I want remote images blocked by default, so that reading mail does not automatically leak opens to senders.
20. As the App user, I want to manually show remote images for a Message, so that image-heavy emails can still be read when I choose.
21. As the App user, I want attachment metadata shown, so that I can tell when a Message includes attachments.
22. As the App user, I want attachment file bytes deferred, so that sync data does not become too large.
23. As the App user, I want mark read/unread, so that I can manage Gmail unread state from Zmail.
24. As the App user, I want archive, so that I can remove Messages from Inbox while keeping them in the Mail account.
25. As the App user, I want delete to move Messages to Gmail Trash, so that delete is reversible and matches normal Gmail expectations.
26. As the App user, I want star/unstar, so that I can preserve a common Gmail organization action.
27. As the App user, I want Gmail to remain the source of truth, so that Zmail can be rebuilt from Gmail if local mail data is discarded.
28. As the App user, I want app-level state separate from per-account mail data, so that each Mail account's Local read model is operationally isolated.
29. As an AI reader, I want a read-only API separate from UI endpoints, so that I have predictable access to mail data.
30. As an AI reader, I want to list Mail accounts, so that I can understand the available account scope.
31. As an AI reader, I want to list Gmail-unread Messages, so that I can process new information.
32. As an AI reader, I want stable Message identities, so that I can deduplicate work across API calls.
33. As an AI reader, I want to fetch Message metadata and content by Message identity, so that I can inspect unread mail.
34. As the App user, I want AI API reads not to mark mail read, so that AI processing does not change Gmail unread state.
35. As the App user, I want the AI API to be read-only in the MVP, so that agents cannot archive, delete, or otherwise mutate Gmail.
36. As a developer, I want one development command to start the frontend and backend, so that local development is straightforward.
37. As a developer, I want frontend HMR preserved during development, so that UI iteration is fast.
38. As a developer, I want shared TypeScript code in a shared package, so that API contracts and shared domain types do not drift.

## Implementation Decisions

- Build a Vite+ monorepo with `apps/web`, `apps/api`, and `packages/shared`.
- Use Vue in `apps/web`.
- Use Hono running on Node.js in `apps/api`.
- Use TypeScript across the monorepo.
- Use SQLite for persistence.
- Use hybrid persistence: one app database plus one mail database per Mail account.
- Keep Gmail authoritative for mail data; Zmail stores a rebuildable Local read model.
- Authenticate Mail accounts with Gmail app passwords, not Gmail OAuth.
- Configure Mail accounts server-side for the MVP; do not build UI account management yet.
- Provide a simple App login for the single App user.
- Load App login credentials from environment variables or server-side config.
- Keep Mail account credentials server-side and never expose them to the browser.
- Sync each Mail account independently.
- Track Account sync status per Mail account.
- Use background polling plus manual refresh for Sync freshness.
- Defer IMAP IDLE.
- Sync the Visible mailbox set for each Mail account, including Spam and Trash.
- Use a configurable Sync window with a 90-day MVP default.
- Store Message readable bodies and attachment metadata locally.
- Do not sync attachment file bytes in the MVP.
- Model Gmail folders/labels as Mailboxes.
- Model a logical email as a Message.
- Model a Message's appearance in one Mailbox as a Mailbox entry.
- Preserve thread identity as metadata if available, but do not build Conversation UI for the MVP.
- Render readable bodies as sanitized HTML with plain-text fallback.
- Block remote images by default and provide a manual per-message show-remote-images action.
- Build the UI around an Account mailbox tree, a Message list, and a Message content pane.
- Do not build unified cross-account smart views in the MVP.
- Support MVP Mailbox actions: mark read/unread, Archive, Delete, and star/unstar.
- Define Archive as removing a Message from Inbox while keeping it in the Mail account.
- Define Delete as moving a Message to Gmail Trash, not permanent deletion.
- Defer move and label changes until after the MVP.
- Defer Composition actions: compose, reply, forward, draft, and send.
- Defer Search until after the MVP.
- Expose a separate read-only AI API instead of expecting agents to use UI endpoints.
- Expose stable Message identities through the AI API.
- Define Unread as Gmail unread state only.
- Keep AI reader processed state outside Zmail for the MVP.
- Ensure AI API reads do not mark Messages read.

The major implementation modules are:

- Config and Auth: App login, server-side config, Configured Mail accounts, and credential loading.
- IMAP Sync: Gmail IMAP connection, Mailbox discovery, Message and Mailbox entry sync, body sync, attachment metadata extraction, and Account sync status.
- Mail Persistence: app database, per-account mail databases, schema, migrations, and repository interfaces.
- Message Rendering: MIME-to-readable-body processing, HTML sanitization, plain-text fallback, and remote-image blocking.
- Mailbox Actions: mark read/unread, Archive, Delete, and star/unstar mapped to Gmail behavior.
- UI API: authenticated endpoints used by the Vue frontend.
- AI API: read-only agent-facing endpoints for Mail accounts, unread Messages, metadata, and content.
- Web UI: three-column Vue interface with Account mailbox tree, Message list, Message content, and Mailbox actions.
- Shared Package: shared domain types, API contract types, and validation schemas where useful.

Deep modules should be preferred for IMAP Sync, Mail Persistence, Message Rendering, Mailbox Actions, and AI API contracts because those areas contain complex behavior behind relatively stable interfaces.

## Testing Decisions

- Test external behavior and stable contracts rather than private implementation details.
- Write IMAP Sync tests against mocked Gmail/IMAP responses.
- Test Mailbox discovery and Visible mailbox set handling, including Spam and Trash.
- Test Sync window filtering.
- Test that one Mail account sync failure produces per-account failure state without preventing other accounts from being usable.
- Test Mail Persistence around Message identity, Mailbox identity, and Mailbox entry relationships.
- Test that the Local read model can be rebuilt from Gmail-shaped inputs.
- Test Mailbox Actions against mocked Gmail operations.
- Test that Archive maps to Gmail archive semantics.
- Test that Delete means move to Trash and not permanent deletion.
- Test Message Rendering with representative HTML, plain-text-only mail, unsafe HTML, and remote images.
- Test that remote images are blocked by default in rendered readable bodies.
- Test AI API contract behavior:
  - list Mail accounts
  - list unread Messages
  - fetch Message metadata and content by stable Message identity
  - do not mutate Gmail unread state
- Test App login enough to prove protected endpoints reject unauthenticated access.
- Add UI tests only for core flows with meaningful user behavior: login, account tree, selecting a Mailbox, selecting a Message, and invoking MVP Mailbox actions.
- Use existing test patterns once the monorepo is scaffolded; there is no current codebase test prior art.

## Out of Scope

- Compose, reply, forward, draft, or send mail.
- Search.
- Conversation/thread UI.
- Unified inbox or cross-account smart views.
- UI-based Gmail account management.
- Syncing attachment file bytes.
- Downloading attachments.
- Permanent delete.
- Move between Mailboxes.
- Apply/remove labels.
- AI-triggered Mailbox actions.
- Hosted multi-user SaaS behavior.
- Gmail OAuth.
- Near-real-time IMAP IDLE sync.
- Full historical sync by default.

## Further Notes

- Canonical domain language lives in `CONTEXT.md`.
- Architectural decisions are recorded in `docs/adr/`.
- Relevant ADRs:
  - `0001-gmail-source-of-truth.md`
  - `0002-hybrid-sqlite-persistence.md`
  - `0003-gmail-app-passwords-for-mail-account-auth.md`
  - `0004-use-vue-hono-typescript-and-sqlite.md`
- Open technical choices remain:
  - IMAP library for `apps/api`
  - SQLite access layer
  - config-file format
  - session mechanism
  - stable Message identity fallback when Gmail-specific IDs are unavailable
  - sanitizer and remote-image blocking implementation
