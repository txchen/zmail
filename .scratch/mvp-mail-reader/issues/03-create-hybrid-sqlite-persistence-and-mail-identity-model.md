# Create hybrid SQLite persistence and mail identity model

Status: done

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Create the hybrid SQLite persistence foundation for Zmail's Local read model. The app should have one app database for app-level state and one mail database per Mail account for synced mail data. The model should represent Mail accounts, Mailboxes, Messages, Mailbox entries, stable Message identities, Unread state, and Account sync status.

## Acceptance criteria

- [x] The app database can store app-level state without duplicating it into per-account mail databases.
- [x] Each Mail account can have its own mail database.
- [x] The mail database can store Mailboxes discovered for that Mail account.
- [x] The mail database can store Messages independently from Mailbox entries.
- [x] A Message can be associated with more than one Mailbox entry.
- [x] The model stores stable Message identity for API and AI reader use.
- [x] The model stores Gmail Unread state separately from any AI reader processed state.
- [x] The model stores per-Mail-account Account sync status.
- [x] Tests cover Message, Mailbox, and Mailbox entry relationships.
- [x] Tests cover per-account isolation in hybrid persistence.

## Blocked by

- `.scratch/mvp-mail-reader/issues/01-scaffold-viteplus-zmail-monorepo.md`
