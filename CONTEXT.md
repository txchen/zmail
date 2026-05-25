# Zmail

Zmail is a private, home-hosted web interface for reading mail from Gmail accounts without configuring those accounts directly on a work laptop.

## Language

**Mail reader**:
A read-focused application for browsing, searching, inspecting, and managing existing mail. Replying and sending are outside the first product boundary.
_Avoid_: Mail client, Gmail replacement

**Mail account**:
A Gmail account whose mail is synced into Zmail. A **Mail account** has an operator-chosen stable ID and a Gmail email address; a single Zmail installation can contain multiple **Mail accounts**.
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

**Message snippet**:
A short preview of a **Message** body used in **Message lists** and **Search** results. A **Message snippet** is derived from normalized body text and is not a separate source of truth.
_Avoid_: Summary, excerpt

**Mailbox entry**:
The appearance of a **Message** inside one specific **Mailbox**. A single **Message** can have many **Mailbox entries**.
_Avoid_: Message copy, duplicate message

**Full-message sync**:
A sync mode where Zmail stores each synced **Message**'s **Readable body**, **Inline message resources**, and **Attachment** metadata locally so the UI and AI API can read recent mail without waiting on Gmail. **Attachment** file bytes are not part of the **Local read model** and can be fetched from Gmail on demand.
_Avoid_: Header-only sync, lazy sync

**Readable body**:
The sanitized HTML body of a **Message**, with a plain-text fallback when HTML is unavailable. A **Readable body** can include **Inline message resources**; remote images are blocked by default but can be shown manually for a **Message**.
_Avoid_: Raw MIME body, trusted HTML

**Inline message resource**:
An embedded MIME part of a **Message**, commonly an image referenced from the **Readable body**, that is intended to render as part of the body rather than appear as a separate download.
_Avoid_: Attachment, remote image

**Attachment**:
A downloadable file part of a **Message** that is not part of the **Readable body**.
_Avoid_: Inline image, body resource

**Local read model**:
Zmail's local database projection of Gmail state, optimized for reading and AI access. Gmail remains the source of truth for mail data; the **Local read model** can be rebuilt from Gmail.
_Avoid_: Mail store, source of truth

**Mailbox action**:
A Gmail-mutating action on an existing **Message** or **Mailbox entry**. Zmail **Mailbox actions** are mark read/unread, archive, delete, and star/unstar; Gmail remains the place for label management.
_Avoid_: Composition action

**Delete**:
A **Mailbox action** that moves a **Message** to Gmail Trash. **Delete** does not mean permanent deletion in the MVP.
_Avoid_: Permanent delete, remove label

**Archive**:
A **Mailbox action** that removes a **Message** from Inbox while keeping it in the **Mail account**, matching Gmail's archive behavior.
_Avoid_: Delete, permanent delete

**Composition action**:
An action that creates outbound mail, such as compose, reply, forward, draft, or send. **Composition actions** are outside the first product boundary.
_Avoid_: Mailbox action

**AI reader**:
An external agent that reads mail through Zmail's API. An **AI reader** can list unread **Messages** and inspect message content and metadata, but cannot perform **Mailbox actions** in the MVP.
_Avoid_: AI user, assistant

**AI API**:
A read-only API surface optimized for **AI readers**, separate from UI-specific endpoints. The **AI API** exposes stable **Message identities**, unread **Messages**, and message content and metadata.
_Avoid_: UI API, automation user

**Message identity**:
The stable identifier Zmail exposes for a **Message** so an **AI reader** can deduplicate work across API calls.
_Avoid_: Mailbox entry identity, IMAP sequence number

**Unread**:
Gmail's unread state for a **Message**. **Unread** does not mean whether an **AI reader** has processed the Message.
_Avoid_: AI processed, unseen by agent

**Hybrid persistence**:
A storage layout with one Zmail app database for app-level state and one mail database per **Mail account** for synced mail data.
_Avoid_: Single mail store, account-only database

**App login**:
The simple username/password gate for the single **App user**. The **App login** credential can be provided by environment variable or config file and is separate from **Mail account** credentials.
_Avoid_: Gmail login, signup

**App session**:
A signed browser session for the **App user** created after **App login**. **App sessions** survive API restarts and can be revoked by rotating the server-side signing secret.
_Avoid_: Mail account session, Gmail session

**App configuration**:
Server-side settings that declare the **App login**, **Configured Mail accounts**, and operator-controlled sync settings for one Zmail installation. **App configuration** is controlled by the operator, not edited by the **App user** in the UI.
_Avoid_: User settings, account settings, preferences

**Zmail container image**:
An immutable deployable package for running one Zmail installation on a server. A **Zmail container image** does not contain **App configuration**, **Mail account credentials**, or **Local read model** database files.
_Avoid_: Backup, configured instance

**Container config mount**:
The operator-provided file mount that supplies **App configuration** to a **Zmail container image** at runtime.
_Avoid_: Baked config, image settings

**Container data volume**:
The operator-provided persistent storage mounted into a **Zmail container image** for the **Local read model**.
_Avoid_: Image storage, bundled database

**Mail account credential**:
The Gmail app password Zmail uses server-side to sync a **Mail account**. **Mail account credentials** are never exposed to the browser.
_Avoid_: App login, OAuth token

**Configured Mail account**:
A **Mail account** declared in server-side configuration rather than added through the UI. UI account management is outside the MVP boundary.
_Avoid_: User-added account

**Sync freshness**:
The expectation that Zmail refreshes each **Mail account** through background polling and App user-triggered manual refresh. Near-real-time IMAP IDLE is outside the MVP boundary.
_Avoid_: Push sync, live sync

**Sync job**:
A server-side queued request to sync one **Mail account** into the **Local read model**. A **Sync job** can be created by the **App user** or by **Sync freshness** polling.
_Avoid_: Synchronous refresh, UI loading state

**Sync queue**:
The server-side queue of **Sync jobs** for one Zmail installation. The **Sync queue** runs **Sync jobs** one at a time across all **Mail accounts**.
_Avoid_: Per-account queue, parallel sync

**Mail account diagnostics**:
An authenticated operator check of a **Mail account credential** and Gmail connectivity that does not change the **Local read model**. **Mail account diagnostics** can expose raw provider errors to the **App user** for troubleshooting.
_Avoid_: Sync, health check

**Sync window**:
The configurable recent time range of Gmail mail that Zmail syncs for each **Mail account**. The MVP default **Sync window** is 90 days.
_Avoid_: Full history, unlimited sync

**Sync scope**:
The requested Gmail time range for a **Sync job**. A regular **Sync job** uses the configured **Sync window**, while an App user-triggered **Sync job** can request a wider **Sync scope** for one **Mail account**.
_Avoid_: Job type, refresh mode

**Recent reconciliation**:
A less frequent sync pass that compares recently visible Gmail **Messages** against recent local **Mailbox entries** so external cleanup in another mail app is reflected in Zmail. **Recent reconciliation** is narrower than a custom historical sync and slower than regular incremental sync.
_Avoid_: Full resync, deletion polling

**Visible mailbox set**:
All Gmail mailboxes and labels visible through IMAP for a **Mail account**, including Spam and Trash. The MVP syncs the **Visible mailbox set** within the **Sync window**.
_Avoid_: Inbox-only sync, system-mailbox-only sync

**Account sync status**:
The per-**Mail account** state that indicates whether that account is synced, syncing, stale, or failing. One **Mail account** can have a failing **Account sync status** while other accounts remain usable.
_Avoid_: Global sync status

**Account mailbox tree**:
The sidebar navigation model where each **Mail account** appears with its own **Mailboxes** and unread counts. Zmail does not need unified cross-account views in the MVP.
_Avoid_: Unified inbox, smart view

**Account unread view**:
A per-**Mail account** view of unread **Messages** across that account's **Mailboxes**, deduplicated by **Message**. **Account unread view** is not a cross-account unified inbox.
_Avoid_: Unified inbox, global unread

**Default reader view**:
The first view shown to the **App user** after **App login**. The MVP **Default reader view** is the first configured **Mail account**'s **Account unread view**.
_Avoid_: Home page, dashboard, unified inbox

**Message list**:
The middle-column view of individual **Messages** in the selected **Mailbox**. Thread identity can be preserved as **Message** metadata, but threads are not first-class UI or API aggregates.
_Avoid_: Conversation list, thread list

**Search**:
Finding **Messages** by query across one **Mail account**'s synced mail in the **Local read model**. **Search** is part of the real **Mail reader** UI boundary and is not cross-account.
_Avoid_: Browse, filter

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

Developer: "Can the AI API wait for Gmail when it needs unread mail content?"

Domain expert: "No. Zmail should sync Message bodies locally so AI can read the latest information without waiting."

Developer: "Does Full-message sync include attachment files?"

Domain expert: "No. It includes Readable bodies, Inline message resources, and Attachment metadata, but normal Attachment file bytes can wait because they would make the sync data too large."

Developer: "Does Zmail load every image inside an email by default?"

Domain expert: "No. Zmail stores a Readable body and blocks remote images by default, with a manual option to show them for a Message."

Developer: "If Zmail's database disagrees with Gmail, which one wins?"

Domain expert: "Gmail wins. Zmail keeps a Local read model that can be rebuilt from Gmail."

Developer: "Are mark unread, archive, delete, label, and star considered replying features?"

Domain expert: "No. Those are Mailbox actions, and they are part of the Mail reader. Composition actions like reply and send can come later."

Developer: "Which Mailbox actions are first-class for the MVP?"

Domain expert: "Mark read/unread, archive, delete, and star/unstar. Label management stays in Gmail."

Developer: "When Zmail deletes a Message, is it gone forever?"

Domain expert: "No. Delete means moving the Message to Gmail Trash."

Developer: "When Zmail archives a Message, should it disappear from the Mail account?"

Domain expert: "No. Archive should match Gmail behavior: remove it from Inbox while keeping it in the Mail account."

Developer: "Can an AI reader archive or delete mail?"

Domain expert: "Not in the MVP. The AI reader can list unread Messages and read their content, but it needs stable Message identities so it can remember what it already processed."

Developer: "If an AI reader reads a Message, does that make it read?"

Domain expert: "No. Unread means Gmail unread only. AI readers manage their own processed state outside Zmail."

Developer: "Should an AI reader scrape the same endpoints as the frontend?"

Domain expert: "No. Zmail should expose a separate AI API with stable Message identities and read-only access to unread mail and message content."

Developer: "Does every Mail account store its own app login and scheduler settings?"

Domain expert: "No. Zmail uses Hybrid persistence: app-level state belongs in the app database, while synced mail data belongs in each Mail account's mail database."

Developer: "Is the Gmail app password the same as the Zmail login password?"

Domain expert: "No. The App login protects Zmail itself, while Mail account credentials are server-side Gmail app passwords used for sync."

Developer: "Can the App user add Gmail accounts from the UI?"

Domain expert: "Not in the MVP. Mail accounts are Configured Mail accounts declared server-side."

Developer: "Does Zmail need live push updates from Gmail?"

Domain expert: "Not for the MVP. Sync freshness can come from background polling, such as every few minutes, plus manual refresh."

Developer: "Does Zmail sync years of historical Gmail immediately?"

Domain expert: "No. Each Mail account has a configurable Sync window, defaulting to recent mail such as 90 days."

Developer: "Does Zmail only sync Inbox?"

Domain expert: "No. Zmail syncs the Visible mailbox set for each Mail account, including Spam and Trash."

Developer: "If one Gmail account fails to sync, should Zmail stop showing every account?"

Domain expert: "No. Account sync status is per Mail account, so one failing account should not prevent the others from being read."

Developer: "Should Zmail combine all accounts into one unread view?"

Domain expert: "No. The Account mailbox tree should show each Mail account separately with its own Mailboxes and unread counts."

Developer: "What should Zmail show immediately after login?"

Domain expert: "Show the Default reader view: the first configured Mail account's Account unread view, not a global inbox."

Developer: "If I search, am I filtering the current Mailbox?"

Domain expert: "No. Search opens a Search result view for the selected Mail account, across that account's synced Messages."

Developer: "Does the middle column show conversations?"

Domain expert: "No. The MVP Message list shows individual Messages. Thread identity can be stored for later, but threads are not the first UI model."

Developer: "Can the App user search mail in the MVP?"

Domain expert: "No. Search can come later; the MVP focuses on syncing, browsing, reading, and core Mailbox actions."
