Status: done

# Add browser smoke coverage and fix repo check

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Add verification coverage for the real Mail reader UI and resolve the repo-level check failure. The smoke path should exercise the high-value user-visible flows rather than component internals.

## Acceptance criteria

- [x] Browser smoke coverage verifies App login and Default reader view routing.
- [x] Browser smoke coverage verifies Account unread empty state.
- [x] Browser smoke coverage verifies per-account Search route behavior.
- [x] Browser smoke coverage verifies Mail account diagnostics success or failure display.
- [x] Browser smoke coverage verifies mobile progressive layout at a narrow viewport.
- [x] When seeded Message data is available, smoke coverage verifies opening a Message, remote-image blocking, and the MVP Mailbox actions.
- [x] `vp run typecheck` passes.
- [x] `vp test` passes.
- [x] `vp check` runs successfully or has a separate documented issue explaining the formatter-config startup failure.

## Blocked by

- .scratch/real-vue-web-ui/issues/06-build-desktop-and-mobile-reader-layouts.md
