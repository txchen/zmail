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

Create local API configuration:

```sh
cp zmail.toml.example zmail.toml
```

Edit `zmail.toml` with your App login and Mail account credentials. The default path is
`./zmail.toml`; set `ZMAIL_CONFIG_PATH` to use a different file.

Run checks from the monorepo root:

```sh
vp test
vp check
vp run typecheck
```
