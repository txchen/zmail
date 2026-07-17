# 05 — Perform idempotent Mailbox actions and delayed mark-read

**What to build:** Let the App user change Gmail read, star, Inbox, and Trash state through explicit idempotent target-state operations, update browser memory only after Gmail confirms success, and mark an actively viewed unread Message read after the configured dwell period.

**Blocked by:** 03 — Read live Message content and download Attachments.

**Status:** ready-for-agent

- [ ] Mark read, mark unread, star, and unstar set explicit Gmail flag target states rather than toggling unknown state.
- [ ] Archive ensures the Gmail Inbox label is absent while the Message remains in Gmail.
- [ ] Delete ensures the Message is in Gmail Trash and never performs permanent deletion.
- [ ] Repeating an action when Gmail already has the target state succeeds without reversing state.
- [ ] The UI waits for Gmail success before changing Message rows, Message detail, Mailbox membership, or counts in browser memory.
- [ ] Successful actions update browser memory directly without an automatic Gmail reread.
- [ ] Failed or uncertain actions preserve the prior client state and explain that the App user can Refresh to verify or safely repeat the target-state action.
- [ ] No Mailbox action automatically retries.
- [ ] `[reader] read_dwell_seconds` defaults to 3, accepts integers from 0 through 60, and uses 0 to disable automatic mark-read.
- [ ] Opening an unread Message starts the dwell timer only after its body renders successfully.
- [ ] The Message must remain selected and the page must remain visible and focused for the entire dwell time.
- [ ] Changing Message, hiding the page, losing focus, logout, or failed body rendering cancels rather than pauses the dwell timer.
- [ ] A completed dwell timer submits one mark-read target-state action and follows the same Gmail-confirmed client update rules.
- [ ] Tests cover every idempotent target state, uncertain outcomes, no optimistic update, no automatic reread/retry, configuration validation, timer success, timer disablement, and all cancellation conditions.

