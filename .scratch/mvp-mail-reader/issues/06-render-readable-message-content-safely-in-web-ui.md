# Render readable Message content safely in the web UI

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Complete the core Mail reader UI path from Account mailbox tree to Message list to Message content. The App user should be able to choose a Mailbox, see individual Messages, select a Message, and read sanitized content with remote images blocked by default and manually shown per Message.

## Acceptance criteria

- [ ] The UI uses a three-column layout: Account mailbox tree, Message list, and Message content.
- [ ] Selecting a Mailbox loads individual Messages for that Mailbox.
- [ ] Selecting a Message shows its readable body in the content pane.
- [ ] HTML Message bodies are sanitized before rendering.
- [ ] Plain-text fallback is used when HTML is unavailable.
- [ ] Remote images are blocked by default.
- [ ] The App user can manually show remote images for a Message.
- [ ] Attachment metadata is visible when a Message has attachments.
- [ ] The UI does not expose attachment file downloads in the MVP.
- [ ] Tests cover sanitizer behavior for unsafe HTML.
- [ ] Tests cover remote-image blocking.
- [ ] UI tests cover selecting a Mailbox and Message.

## Blocked by

- `.scratch/mvp-mail-reader/issues/05-sync-recent-readable-messages-into-local-read-model.md`
