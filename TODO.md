# TODO

Future work items to revisit after the current home deployment fixes.

## AI API

- Review the AI API design end to end and add missing endpoints or capabilities.
- Add API key based authentication for AI API access.
- Create `zmail-cli` and publish it to npm so AI agents can access email data through a stable command-line interface.
- Create an agent skill that explains how to use `zmail-cli` to access email.
- Investigate whether Google IMAP access can retrieve calendar data, since calendar context would also be useful to AI agents.

## Web UI

- Auto-mark an email as read after it has been open for a configured number of seconds.
- Add bulk deletion.
- Add keyboard shortcuts for actions such as delete and star.
