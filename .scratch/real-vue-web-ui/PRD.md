# Real Vue Web UI PRD

Status: ready-for-agent

## Problem Statement

The App user needs Zmail to move beyond a raw proof-of-concept Vue screen into a beautiful, clean, fast Mail reader UI that is pleasant on desktop and usable on mobile. The UI must respect Zmail's domain boundaries: one App user, separately scoped Mail accounts, no unified inbox, no thread grouping, no Composition actions, and Gmail as the source of truth.

The backend already exposes the core reader capabilities for App login, Account mailbox tree, Account unread view, per-account Search, Message detail, Mailbox actions, refresh, Account sync status, and Mail account diagnostics. The remaining product problem is to turn those capabilities into a real Vue application with clear navigation, reliable server-state handling, and an interface that can be extended without turning `App.vue` into the whole product.

## Solution

Build the real Zmail web UI as a plain Vite Vue app using Nuxt UI and Tailwind CSS, without migrating to Nuxt. Use Vue Router for reader navigation state and TanStack Query for server state. The primary desktop experience is a three-pane Mail reader: Account mailbox tree, Message list, and Message content. Mobile uses progressive navigation through the same conceptual panes.

The Default reader view after App login is the first configured Mail account's Account unread view. Search is a per-Mail-account reader view across that account's synced Messages. Message lists show individual Messages, not thread groups. Message detail exposes the MVP Mailbox actions: mark read/unread, Archive, Delete, and star/unstar. Archive and Delete should advance to the next available Message. Remote images remain blocked by default and can be shown per Message. Each Mail account exposes sync status, manual refresh, and secondary on-demand Mail account diagnostics.

## User Stories

1. As the App user, I want the real web UI to feel clean and polished, so that Zmail is comfortable to use as my daily private Mail reader.
2. As the App user, I want the web UI to stay a plain Vite Vue app, so that the project does not take on Nuxt server and routing concepts it does not need.
3. As the App user, I want Nuxt UI and Tailwind CSS to provide the component and styling foundation, so that the UI can be beautiful without first building a local design system.
4. As the App user, I want to log in through the web UI, so that the Mail reader is protected by App login.
5. As the App user, I want App sessions to survive page refreshes, so that I do not have to log in again on every reload.
6. As the App user, I want to log out from the web UI, so that I can end an App session.
7. As the App user, I want the Default reader view to open after App login, so that I land directly on mail that may need attention.
8. As the App user, I want the Default reader view to be the first configured Mail account's Account unread view, so that Zmail does not imply a unified inbox.
9. As the App user, I want each Mail account shown separately in the Account mailbox tree, so that account boundaries stay clear.
10. As the App user, I want each Mailbox shown under its Mail account with unread counts, so that the navigation mirrors the account's Visible mailbox set.
11. As the App user, I want a manual refresh action per Mail account, so that I can trigger Sync freshness when needed.
12. As the App user, I want Account sync status visible in the UI, so that I can tell whether a Mail account is synced, stale, syncing, or failing.
13. As the App user, I want Mail account diagnostics available from the sidebar, so that I can troubleshoot Gmail credentials or connectivity without checking server logs first.
14. As the App user, I want Mail account diagnostics to run on demand, so that diagnostic results are current.
15. As the App user, I want diagnostics to avoid changing the Local read model, so that troubleshooting does not accidentally sync or mutate mail data.
16. As the App user, I want a Message list for the selected Mailbox, so that I can browse Messages in one mailbox view.
17. As the App user, I want an Account unread view per Mail account, so that I can triage unread Messages without crossing account boundaries.
18. As the App user, I want Message lists to show individual Messages, so that the first real UI avoids thread grouping complexity.
19. As the App user, I want to open a Message from any Message list, so that the Message detail pane shows its content and metadata.
20. As the App user, I want Message detail to render the Readable body, so that I can read synced mail without waiting on Gmail.
21. As the App user, I want remote images blocked by default, so that opening a Message does not automatically leak image loads to senders.
22. As the App user, I want to show remote images for a single Message, so that image-heavy Messages can still be inspected manually.
23. As the App user, I want attachment metadata visible in Message detail, so that I can see when a Message has attachments.
24. As the App user, I want mark read/unread in the Message toolbar, so that I can explicitly change Gmail unread state.
25. As the App user, I want selecting a Message not to automatically mark it read, so that reading state changes remain explicit for now.
26. As the App user, I want Archive in the Message toolbar, so that I can remove a Message from Inbox while keeping it in the Mail account.
27. As the App user, I want Delete in the Message toolbar, so that I can move a Message to Gmail Trash.
28. As the App user, I want star/unstar in the Message toolbar, so that I can manage a common Gmail marker.
29. As the App user, I want Archive and Delete to advance to the next available Message, so that fast triage does not leave me in an empty detail pane after each action.
30. As the App user, I want Search scoped to the selected Mail account, so that results do not mix accounts.
31. As the App user, I want Search to search synced Messages across the selected Mail account rather than filtering only the current Mailbox, so that it behaves like a reader view.
32. As the App user, I want Search results to open in the same Message detail pane, so that reading search results feels like reading any other Message list.
33. As the App user, I want clearing Search to return me to the previous Mailbox or Account unread view, so that Search is temporary navigation.
34. As the App user, I want route URLs for reader state, so that refresh, back, forward, and direct links preserve my location in the reader.
35. As the App user, I want desktop to use the full three-pane layout, so that browsing and reading are efficient on large screens.
36. As the App user, I want mobile to use progressive navigation, so that the same reader model is usable on a phone.
37. As the App user, I want the mobile UI to support Account mailbox tree, Message list, Search result view, and Message detail, so that mobile is a real target.
38. As the App user, I want no keyboard shortcuts in the first real UI, so that the app avoids hidden behavior until the visual workflow is solid.
39. As a developer, I want server state managed through TanStack Query, so that loading, error, refetch, and invalidation behavior is consistent.
40. As a developer, I want route state managed through Vue Router rather than implicit component state, so that the reader can grow without a fragile local state machine.
41. As a developer, I want shared API response types to include UI-needed session, sync status, diagnostics, and paginated Message list shapes, so that frontend and backend contracts do not drift.
42. As a developer, I want generated Nuxt UI type artifacts ignored when they contain package-manager paths, so that the repo avoids brittle generated-file churn.

## Implementation Decisions

- Use Nuxt UI with Tailwind CSS as the web UI component and styling foundation.
- Do not migrate the app to Nuxt; keep the existing Vite Vue app shape from ADR-0004.
- Use Vue Router for reader navigation state.
- Use TanStack Query for server state.
- Do not add Pinia for this phase.
- Keep App login, session check, and logout in the web UI.
- After App login, route to the first configured Mail account's Account unread view.
- Use a desktop three-pane layout: Account mailbox tree, Message list, and Message content.
- Use mobile progressive navigation over the same conceptual panes instead of compressing all three panes onto one phone screen.
- Keep Message lists unthreaded.
- Treat Search as a per-Mail-account reader view, not as a filter on the current Mailbox.
- Keep Search out of cross-account scope.
- Keep remote images blocked by default, with a per-Message show-images action.
- Show exactly the MVP Mailbox actions in the first toolbar: mark read/unread, Archive, Delete, and star/unstar.
- Keep read-state changes explicit for now; do not automatically mark Messages read when opened.
- After Archive or Delete, advance to the next Message in the current list, or the previous Message if there is no next Message.
- Include sidebar Account sync status, manual refresh, and secondary on-demand Mail account diagnostics.
- Keep Mail account diagnostics non-mutating with respect to the Local read model.
- Keep keyboard shortcuts out of this phase.
- Extend the shared API contract types only where the UI needs stable response shapes.
- Ignore Nuxt UI generated auto-import/component declaration files if they contain package-manager-specific paths.

The major modules to build or modify are:

- Web app bootstrap: Nuxt UI/Tailwind, Vue Router, and TanStack Query registration.
- API client: typed helpers for session, logout, unread view, Search, Account sync status, and Mail account diagnostics.
- Reader route model: URL parsing and construction for Account unread view, Mailbox view, Search result view, and selected Message.
- Reader layout: desktop three-pane layout and mobile progressive navigation.
- Account navigation: Account mailbox tree, unread counts, refresh, sync status, and diagnostics entry point.
- Message list: common list behavior for Mailbox views, Account unread view, and Search result view.
- Message detail: Readable body rendering, remote-image toggle, attachments, and Mailbox action toolbar.
- Mailbox action workflow: action mutation, query invalidation, and Archive/Delete auto-advance.
- Shared contract types: session, sync status, diagnostics, and paginated list responses.

## Testing Decisions

- Test user-visible behavior and API contracts, not component internals.
- Preserve existing backend API tests for Account unread view, Search, diagnostics, and Mailbox actions.
- Add or keep shared typechecking as the first guard against frontend/backend contract drift.
- Browser smoke testing should cover App login, Default reader view routing, Account unread empty state, Search result routing, diagnostics modal, and mobile progressive layout.
- When seeded Message data is available, smoke testing should also cover opening a Message, remote-image blocking, attachment metadata, mark read/unread, Archive, Delete auto-advance, and star/unstar.
- Existing `vp test` should remain green.
- Existing TypeScript build/typecheck should remain green.
- `vp check` should be fixed or tracked separately if its formatter configuration cannot load before analysis.

## Out of Scope

- Migrating to Nuxt.
- Building a custom design system before using Nuxt UI.
- Adding Pinia.
- Keyboard shortcuts.
- Automatic mark-read on Message open.
- Thread grouping or Conversation UI.
- Cross-account Search.
- Unified inbox or global unread view.
- Composition actions: compose, reply, forward, draft, or send.
- UI-based Mail account management.
- Permanent delete.
- Gmail label management.
- Attachment file download UI, except for displaying attachment metadata.
- Offline support.

## Further Notes

- Canonical domain language lives in `CONTEXT.md`.
- Relevant ADRs:
  - `docs/adr/0004-use-vue-hono-typescript-and-sqlite.md`
  - `docs/adr/0005-use-toml-for-app-configuration.md`
  - `docs/adr/0006-use-stateless-jwt-app-sessions.md`
  - `docs/adr/0007-use-nuxt-ui-and-tailwind-for-web-ui.md`
- Relevant prior backend issues:
  - `.scratch/full-mail-reader-backend/issues/02-add-sync-status-and-diagnostics.md`
  - `.scratch/full-mail-reader-backend/issues/06-add-account-unread-view.md`
  - `.scratch/full-mail-reader-backend/issues/07-add-local-read-model-search.md`
- A first implementation was prototyped during the planning conversation. Future agents should verify behavior against this PRD rather than assume every prototype detail is final.
