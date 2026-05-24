# Sync mailbox tree and per-account status from Gmail

Status: ready-for-agent

## Parent

`.scratch/mvp-mail-reader/PRD.md`

## What to build

Connect to configured Gmail Mail accounts over IMAP and sync each account's Visible mailbox set into the Local read model. The App user should be able to refresh account mailbox data manually, see each Mail account's Mailboxes and unread counts, and see a per-account sync status when one account fails without losing access to other accounts.

## Acceptance criteria

- [ ] The backend can connect to each Configured Mail account using its server-side Mail account credential.
- [ ] Sync discovers all visible Gmail Mailboxes and labels exposed through IMAP, including Spam and Trash.
- [ ] Sync stores Mailboxes in the correct per-account mail database.
- [ ] Sync stores unread counts per Mail account and Mailbox.
- [ ] The API exposes Mail accounts, Mailboxes, unread counts, and Account sync status to the UI.
- [ ] The UI shows the Account mailbox tree with each Mail account separated.
- [ ] The App user can trigger manual refresh for a Mail account.
- [ ] A failing Mail account shows a failing Account sync status without preventing other Mail accounts from being read.
- [ ] Tests cover Visible mailbox set discovery including Spam and Trash.
- [ ] Tests cover per-account sync failure isolation.

## Blocked by

- `.scratch/mvp-mail-reader/issues/02-add-app-login-and-configured-mail-account-loading.md`
- `.scratch/mvp-mail-reader/issues/03-create-hybrid-sqlite-persistence-and-mail-identity-model.md`
