# Use hybrid SQLite persistence

Zmail uses one app-level SQLite database for application state and one mail SQLite database per Mail account for synced mail data. This keeps each Gmail account's local read model operationally isolated while avoiding duplicated app login, configuration, and scheduler state across account databases.
