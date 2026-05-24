# Zmail

## Development

Install dependencies once:

```sh
vp install
```

Start the Vue web app and Hono API together:

```sh
vp run dev
```

The API listens on `http://localhost:3001`. The web app runs through Vite and proxies `/api/*` to the API during development, preserving Vite HMR for frontend work.

Required API configuration:

```sh
export ZMAIL_APP_USERNAME=reader
export ZMAIL_APP_PASSWORD='change-me'
export ZMAIL_MAIL_ACCOUNTS='[{"id":"personal","displayName":"Personal Gmail","emailAddress":"me@example.com","appPassword":"gmail-app-password"}]'
```

Run checks from the monorepo root:

```sh
vp test
vp check
vp run typecheck
```
