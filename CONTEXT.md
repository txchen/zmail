# Zmail

Zmail is a private, home-hosted web interface for reading mail from Gmail accounts without configuring those accounts directly on a work laptop.

## Language

**Mail reader**:
A Gmail-only, read-focused application for browsing, searching, inspecting, and managing existing mail. Replying and sending are outside the product boundary.
_Avoid_: Mail client, Gmail replacement

**Mail account**:
A Gmail account accessed by Zmail through **Live IMAP access**. A **Mail account** has an operator-chosen stable ID and a Gmail email address; a single Zmail installation can contain multiple **Mail accounts**.
_Avoid_: User account, inbox

**Mailbox**:
An IMAP-visible folder or Gmail label within a **Mail account**. A **Mailbox** is a view over messages, not the owner of those messages, so one message can appear in multiple **Mailboxes**.
_Avoid_: Folder

**System mailbox role**:
A well-known role for a **Mailbox**, such as inbox, sent, drafts, spam, trash, all mail, archive, or flagged. Custom **Mailboxes** may not have a **System mailbox role**.
_Avoid_: Mailbox name, label type

**Message**:
One logical email item in a **Mail account**, independent of which **Mailboxes** expose it.
_Avoid_: Email, mail item

**Message participant**:
A sender or recipient address associated with a **Message**, optionally with a display name from the mail headers.
_Avoid_: Contact, user

**Live IMAP access**:
Reading and searching Gmail by querying IMAP at request time instead of reading from a durable local mail projection.
_Avoid_: Sync, Local read model

**Ephemeral mail state**:
Browser-memory state used to render mail already read during the current page session. Previously visited Mailboxes, Search results, pagination, and Message bodies are cache-first until **Manual refresh**; the state is never written to disk or cached as a mail response by the Zmail server, and disappears on page reload, logout, or page close.
_Avoid_: Mail persistence, offline cache

**Live IMAP session**:
A short-lived Gmail connection opened for user-triggered work and managed under an **Interaction lease**. Zmail allows at most one ordinary session per Mail account, serializes its commands, disables automatic IMAP IDLE, and keeps attachment streaming on independent sessions.
_Avoid_: Background connection, persistent IMAP session

**Interaction lease**:
The ten-second idle grace period during which one Mail account's **Live IMAP session** may be reused after a user-triggered operation. Each new authorized operation resets the lease; expiry closes the session, and no application-level IMAP command is sent merely to keep it alive.
_Avoid_: Connection pool, background session

**Mailbox entry**:
The appearance of a **Message** inside one specific **Mailbox**. A single **Message** can have many **Mailbox entries**.
_Avoid_: Message copy, duplicate message

**Readable body**:
The sanitized HTML body of a **Message**, with a plain-text fallback when HTML is unavailable. A **Readable body** can include **Inline message resources**; remote images are blocked by default but can be shown manually for a **Message**.
_Avoid_: Raw MIME body, trusted HTML

**Inline message resource**:
An embedded MIME part of a **Message**, commonly an image referenced from the **Readable body**, that is intended to render as part of the body rather than appear as a separate download.
_Avoid_: Attachment, remote image

**Attachment**:
A downloadable file part of a **Message** that is not part of the **Readable body**. Attachment metadata is read with the Message, while file bytes are fetched from Gmail and streamed to the browser only after an explicit download action; Zmail does not persist them.
_Avoid_: Inline image, body resource

**Mailbox action**:
A Gmail-mutating, idempotent target-state action performed directly through IMAP on an existing **Message** or **Mailbox entry**. Zmail **Mailbox actions** explicitly set read/unread, starred/unstarred, archived, or trashed state; the UI waits for Gmail success before updating browser memory, does not optimistically update or automatically re-read Gmail, and leaves label management to Gmail.
_Avoid_: Composition action

**User-authorized write**:
A Gmail mutation attributable to an explicit action in the active Zmail UI, including a delayed mark-read authorized by opening and continuing to view a **Message**. Background refresh, prefetch, list loading, **Search**, and passive IMAP reads never authorize Gmail writes.
_Avoid_: Background action, sync side effect

**Quiescent UI**:
The state in which Zmail initiates no Gmail read, Gmail write, polling, prefetch, retry, or IMAP IDLE work while the **App user** is not interacting with the UI. A pending delayed mark-read remains part of the Message-opening action that authorized it; an existing **Interaction lease** may remain open without application-level IMAP keepalive commands until it expires.
_Avoid_: Background refresh, passive sync

**Read dwell time**:
The operator-configured period for which an unread **Message** must remain selected in a visible, focused Zmail page after its body loads before Zmail performs a mark-read **User-authorized write**. The default is three seconds; values from 1 through 60 select the delay, zero disables automatic mark-read, and changing Message, hiding the page, or losing focus cancels rather than pauses the timer.
_Avoid_: Read delay, auto-read timeout

**Delete**:
A **Mailbox action** that moves a **Message** to Gmail Trash. **Delete** does not mean permanent deletion in the MVP.
_Avoid_: Permanent delete, remove label

**Archive**:
A **Mailbox action** that removes a **Message** from Inbox while keeping it in the **Mail account**, matching Gmail's archive behavior.
_Avoid_: Delete, permanent delete

**Composition action**:
An action that creates outbound mail, such as compose, reply, forward, draft, or send. **Composition actions** are outside the product boundary.
_Avoid_: Mailbox action

**Message identity**:
The `(Mail account ID, Gmail message ID)` pair Zmail exposes for a **Message**. The Gmail message ID comes from IMAP `X-GM-MSGID` and remains stable across Mailboxes; Mailbox-scoped IMAP UIDs are temporary locators, not public identity.
_Avoid_: Mailbox entry identity, IMAP UID, IMAP sequence number

**Unread**:
Gmail's unread state for a **Message**.
_Avoid_: Unseen by Zmail

**App login**:
The simple username/password gate for the single **App user**. The **App login** credential can be provided by environment variable or config file and is separate from **Mail account** credentials.
_Avoid_: Gmail login, signup

**App session**:
A signed, HttpOnly browser-session cookie for the **App user** created after **App login**. **App sessions** survive API restarts, production cookies are Secure, rotating the server-side signing secret revokes them, and logout clears **Ephemeral mail state** and closes active **Live IMAP sessions**.
_Avoid_: Mail account session, Gmail session

**App configuration**:
Server-side settings that declare the **App login**, **Configured Mail accounts**, and operator-controlled reader behavior such as **Read dwell time** for one Zmail installation. **App configuration** is controlled by the operator, not edited by the **App user** in the UI.
_Avoid_: User settings, account settings, preferences

**Zmail container image**:
A deployable package for running one Zmail installation on a server. A **Zmail container image** does not contain **App configuration** or **Mail account credentials**.
_Avoid_: Backup, configured instance

**Container config mount**:
The operator-provided file mount that supplies **App configuration** to a **Zmail container image** at runtime.
_Avoid_: Baked config, image settings

**Mail account credential**:
The Gmail app password Zmail uses server-side for **Live IMAP access** to a **Mail account**. **Mail account credentials** are never exposed to the browser.
_Avoid_: App login, OAuth token

**Configured Mail account**:
A **Mail account** declared in server-side configuration rather than added through the UI. UI account management is outside the MVP boundary.
_Avoid_: User-added account

**Manual refresh**:
A user-triggered, bounded re-read of one **Mail account** through **Live IMAP access**. It refreshes that account's Mailbox tree, counts, current **Message list**, and selected Message state without starting background work or reading other accounts.
_Avoid_: Sync, background refresh, refresh all

**Manual retry**:
An explicit App user request to repeat a failed IMAP operation. Zmail never automatically retries Gmail reads or writes, and a failed **Mailbox action** is not repeated unless the App user deliberately requests it again.
_Avoid_: Automatic retry, reconnect loop

**Visible mailbox set**:
All Gmail mailboxes and labels visible through IMAP for a **Mail account**, including Spam and Trash. Zmail reads this set on demand for the **Account mailbox tree**.
_Avoid_: Inbox-only sync, system-mailbox-only sync

**Account mailbox tree**:
The sidebar navigation model where each **Mail account** appears with its own **Mailboxes** and unread counts. Zmail does not need unified cross-account views in the MVP.
_Avoid_: Unified inbox, smart view

**Account unread view**:
A per-**Mail account** view of unread **Messages** across Gmail All Mail, deduplicated by **Message** and excluding Spam and Trash. **Account unread view** is not a cross-account unified inbox.
_Avoid_: Unified inbox, global unread

**Account selection view**:
The post-login and full-page-load state that lists configured **Mail accounts** without connecting to Gmail. Zmail never restores a prior account or Message from the URL after reload; selecting an account authorizes a **Live IMAP session** for that account and opens its Inbox.
_Avoid_: Default inbox, automatic account load

**Account open**:
The explicit operation started by selecting a **Mail account**. In one **Live IMAP session** and one response, it reads the **Visible mailbox set**, Mailbox counts, and the first Inbox **Message list** page.
_Avoid_: Automatic account load, separate tree and Inbox requests

**Message list**:
The middle-column metadata view of individual **Messages** in the selected **Mailbox**, **Account unread view**, or **Search result view**. It shows envelope and state fields without fetching body snippets, loads newest-first pages of 50 only when the App user opens the view or activates Load more, and never groups Messages into Conversation or thread aggregates.
_Avoid_: Conversation list, thread list

**Search**:
Finding **Messages** across one **Mail account**'s complete Gmail mail set through **Live IMAP access** using a **Gmail search query**. One explicit Search serially checks Gmail All Mail, Spam, and Trash in one **Live IMAP session**, deduplicates by **Message identity**, and loads only the current metadata page; Search is never cross-account and editing text never triggers a request.
_Avoid_: Browse, filter

**Gmail search query**:
The native Gmail search expression entered by the **App user** and executed through IMAP `X-GM-RAW`, including ordinary keywords and Gmail operators such as `from:`, `is:`, and `has:`.
_Avoid_: Search filter, Zmail query language

**Search result view**:
A per-**Mail account** reader view that shows **Messages** returned by **Search** instead of the selected **Mailbox**. Clearing **Search** returns the **App user** to the previously selected **Mailbox** or **Account unread view**.
_Avoid_: Filtered mailbox, global search

**App user**:
The single human operator who logs into Zmail. One **App user** can add many **Mail accounts** to the reader.
_Avoid_: Mail account, Gmail account

## Example Dialogue

Developer: "Is Zmail a mail client?"

Domain expert: "Not yet. For now it is a Mail reader: it should let me inspect and manage existing mail from my Gmail accounts through a private web UI, while replying can come later."

Developer: "Does each Gmail account become a user in Zmail?"

Domain expert: "No. Zmail has one App user for me, and that App user can add multiple Mail accounts."

Developer: "When the sidebar shows Gmail folders, are those folders the owners of messages?"

Domain expert: "No. In Zmail they are Mailboxes: IMAP-visible views like Inbox, All Mail, Sent, or custom Gmail labels. A message can show up in more than one Mailbox."

Developer: "If the same Gmail message appears in Inbox and All Mail, does Zmail have two Messages?"

Domain expert: "No. Zmail has one Message with separate Mailbox entries for each Mailbox where it appears."

Developer: "Does Zmail download attachment files while opening a Message?"

Domain expert: "No. It reads Attachment metadata with the Message, then streams file bytes from Gmail only when I explicitly download an Attachment."

Developer: "Does Zmail load every image inside an email by default?"

Domain expert: "No. Zmail stores a Readable body and blocks remote images by default, with a manual option to show them for a Message."

Developer: "Can I keep reading previously opened mail when Gmail is unavailable?"

Domain expert: "No. Zmail does not persist mail; reading and Search require live Gmail IMAP access."

Developer: "Are mark unread, archive, delete, label, and star considered replying features?"

Domain expert: "No. Those are Mailbox actions, and they are part of the Mail reader. Composition actions like reply and send can come later."

Developer: "Which Mailbox actions are first-class for the MVP?"

Domain expert: "Mark read/unread, archive, delete, and star/unstar. Label management stays in Gmail."

Developer: "When Zmail deletes a Message, is it gone forever?"

Domain expert: "No. Delete means moving the Message to Gmail Trash."

Developer: "When Zmail archives a Message, should it disappear from the Mail account?"

Domain expert: "No. Archive should match Gmail behavior: remove it from Inbox while keeping it in the Mail account."

Developer: "Is the Gmail app password the same as the Zmail login password?"

Domain expert: "No. The App login protects Zmail itself, while Mail account credentials are server-side Gmail app passwords used for live IMAP access."

Developer: "Can the App user add Gmail accounts from the UI?"

Domain expert: "Not in the MVP. Mail accounts are Configured Mail accounts declared server-side."

Developer: "Does Zmail need live push updates from Gmail?"

Domain expert: "No. An idle UI is quiescent; I explicitly refresh a Mail account when I want Zmail to re-read it."

Developer: "Does Zmail only show Inbox?"

Domain expert: "No. Zmail reads the Visible mailbox set for each Mail account, including Spam and Trash."

Developer: "If one Gmail account cannot connect, should Zmail stop showing every account?"

Domain expert: "No. Each Mail account is read independently, so one connection failure should not prevent the others from being used."

Developer: "Should Zmail combine all accounts into one unread view?"

Domain expert: "No. The Account mailbox tree should show each Mail account separately with its own Mailboxes and unread counts."

Developer: "What should Zmail show immediately after login?"

Domain expert: "Show the Account selection view without connecting to Gmail. I explicitly select the account whose Inbox I want to open."

Developer: "If I search, am I filtering the current Mailbox?"

Domain expert: "No. Search opens a Search result view across that Mail account's complete Gmail mail set."

Developer: "Does the middle column show conversations?"

Domain expert: "No. The Message list shows individual Messages. Gmail thread identity may be exposed as metadata, but Zmail does not group Messages into Conversations."

Developer: "Can the App user search mail in the MVP?"

Domain expert: "Yes. Search runs a Gmail search query across the selected Mail account's complete Gmail mail set."
