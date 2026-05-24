# Harden the MVP operating path

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Tighten the end-to-end MVP so Zmail can run predictably in a home-network deployment. Background polling, startup behavior, configuration errors, per-account failures, and core end-to-end flows should be visible and testable.

## Acceptance criteria

- [ ] Background polling runs for configured Mail accounts on the configured interval.
- [ ] Manual refresh and background polling do not create unsafe overlapping sync work for the same Mail account.
- [ ] Startup clearly reports missing or invalid app configuration.
- [ ] Startup clearly reports missing or invalid Mail account configuration.
- [ ] Per-account sync failures remain visible in the UI.
- [ ] Other Mail accounts remain usable when one Mail account fails.
- [ ] The documented development command still starts both frontend and backend.
- [ ] End-to-end checks cover login, account tree loading, Message listing, Message reading, and AI unread access.
- [ ] Tests or smoke checks cover the main home-network operating path.

## Blocked by

- `.scratch/mvp-mail-reader/issues/06-render-readable-message-content-safely-in-web-ui.md`
- `.scratch/mvp-mail-reader/issues/07-implement-mvp-mailbox-actions-against-gmail.md`
- `.scratch/mvp-mail-reader/issues/08-expose-read-only-ai-api.md`
