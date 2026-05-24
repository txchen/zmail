Status: ready-for-agent

# Build Message detail and Mailbox actions

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Build the Message content pane for selected Messages from any Message list. The pane renders the Readable body, preserves remote-image blocking by default, shows attachment metadata, and exposes the MVP Mailbox actions. Archive and Delete should advance to the next available Message in the current list.

## Acceptance criteria

- [ ] Selecting a Message from Account unread view, Mailbox view, or Search result view opens Message detail.
- [ ] Message detail displays subject, sender, received time, Readable body, and attachment metadata.
- [ ] Remote images remain blocked by default.
- [ ] A per-Message action can show blocked remote images.
- [ ] The toolbar exposes mark read/unread, Archive, Delete, and star/unstar.
- [ ] Opening a Message does not automatically mark it read.
- [ ] Successful Mailbox actions refresh affected reader data.
- [ ] Archive and Delete advance to the next Message, or previous Message if there is no next Message.
- [ ] If no adjacent Message exists after Archive or Delete, the detail pane returns to an empty selected state for the current list.

## Blocked by

- .scratch/real-vue-web-ui/issues/04-build-message-list-views-and-search.md
