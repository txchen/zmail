# Use hybrid SQLite persistence

Zmail uses one app-level SQLite database for application state and one mail SQLite database per Mail account for synced mail data. The database directory is declared in App configuration, defaults to the repo-local `.data` directory in the example config, and stores `app.sqlite` plus per-account mail databases under `mail/<mail-account-id>.sqlite`; database files are ignored by git. This keeps each Gmail account's local read model operationally isolated while avoiding duplicated app login, configuration, and scheduler state across account databases.
