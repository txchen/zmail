Status: done

# Build desktop and mobile reader layouts

## Parent

.scratch/real-vue-web-ui/PRD.md

## What to build

Build the responsive reader shell. Desktop uses the full three-pane Mail reader layout. Mobile uses progressive navigation across Account mailbox tree, Message list or Search result view, and Message detail.

## Acceptance criteria

- [x] Desktop view shows Account mailbox tree, Message list, and Message content as three usable panes.
- [x] The layout remains readable and does not overlap controls or text at normal desktop widths.
- [x] Mobile starts in the appropriate progressive pane for the current route.
- [x] Mobile allows navigation from Account mailbox tree to Message list or Search result view.
- [x] Mobile allows navigation from Message list to Message detail.
- [x] Mobile provides a clear way back from Message detail to Message list.
- [x] Search remains accessible on mobile for the selected Mail account.
- [x] Message actions remain available in mobile Message detail.

## Blocked by

- .scratch/real-vue-web-ui/issues/03-build-account-mailbox-tree-and-diagnostics.md
- .scratch/real-vue-web-ui/issues/05-build-message-detail-and-mailbox-actions.md
