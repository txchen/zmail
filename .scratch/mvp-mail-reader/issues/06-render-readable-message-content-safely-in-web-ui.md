# Render readable Message content safely in the web UI

Status: done

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Complete the core Mail reader UI path from Account mailbox tree to Message list to Message content. The App user should be able to choose a Mailbox, see individual Messages, select a Message, and read sanitized content with remote images blocked by default and manually shown per Message.

## Acceptance criteria

- [x] The UI uses a three-column layout: Account mailbox tree, Message list, and Message content.
- [x] Selecting a Mailbox loads individual Messages for that Mailbox.
- [x] Selecting a Message shows its readable body in the content pane.
- [x] HTML Message bodies are sanitized before rendering.
- [x] Plain-text fallback is used when HTML is unavailable.
- [x] Remote images are blocked by default.
- [x] The App user can manually show remote images for a Message.
- [x] Attachment metadata is visible when a Message has attachments.
- [x] The UI does not expose attachment file downloads in the MVP.
- [x] Tests cover sanitizer behavior for unsafe HTML.
- [x] Tests cover remote-image blocking.
- [x] UI tests cover selecting a Mailbox and Message.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
