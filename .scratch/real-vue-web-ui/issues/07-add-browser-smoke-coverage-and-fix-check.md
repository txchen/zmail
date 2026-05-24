Status: ready-for-agent

# Add browser smoke coverage and fix repo check

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Add verification coverage for the real Mail reader UI and resolve the repo-level check failure. The smoke path should exercise the high-value user-visible flows rather than component internals.

## Acceptance criteria

- [ ] Browser smoke coverage verifies App login and Default reader view routing.
- [ ] Browser smoke coverage verifies Account unread empty state.
- [ ] Browser smoke coverage verifies per-account Search route behavior.
- [ ] Browser smoke coverage verifies Mail account diagnostics success or failure display.
- [ ] Browser smoke coverage verifies mobile progressive layout at a narrow viewport.
- [ ] When seeded Message data is available, smoke coverage verifies opening a Message, remote-image blocking, and the MVP Mailbox actions.
- [ ] `vp run typecheck` passes.
- [ ] `vp test` passes.
- [ ] `vp check` runs successfully or has a separate documented issue explaining the formatter-config startup failure.

## Blocked by

- .scratch/real-vue-web-ui/issues/06-build-desktop-and-mobile-reader-layouts.md
