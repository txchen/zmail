# Zmail

[![Docker image](https://img.shields.io/badge/ghcr.io-txchen%2Fzmail-blue?logo=github)](https://github.com/txchen/zmail/pkgs/container/zmail)

Zmail is a private, self-hosted Gmail Mail reader. It lets you read and manage existing mail from a
work laptop or other browser without adding the Gmail account to that device.

Zmail uses **Live IMAP access**: mail is read from Gmail only after an explicit action. App login
and page reload stop at the **Account selection** view without contacting Gmail; choosing a
configured Mail account opens its Inbox. Previously visited Mailboxes, Search results, pagination,
and Message bodies are cached only in browser memory for the current page session. Reloading,
logging out, or closing the page clears that state.

Zmail does not persist mail. The server does not cache Messages, Mailboxes, bodies, Attachments,
Search results, or cursors, and Gmail remains authoritative. Use **Manual refresh** to re-read the
selected account and **Manual retry** to repeat a failed operation. There is no polling, background
refresh, or automatic retry while the UI is idle.

## Security model

One App login protects the web UI and API. Gmail app passwords stay in server-side configuration
and are never returned to the browser. For an internet-facing deployment, put Zmail behind HTTPS
and a stronger access layer such as Cloudflare Zero Trust.

See [Security](./docs/security.md) for the complete trust boundary and
[Operator migration](./docs/operator-migration.md) before upgrading a persistent deployment.

## Development

Install dependencies and create local App configuration:

```sh
vp install
cp zmail.toml.example zmail.toml
```

Edit `zmail.toml` with the App login and Configured Mail accounts. Start the Vue web app and Hono
API together:

```sh
vp run dev
```

The API listens on `http://localhost:3001`. Vite serves the web app with HMR and proxies `/api/*` to
the API. The default config path is `./zmail.toml`; set `ZMAIL_CONFIG_PATH` to select another file.
After login, select a Mail account to authorize its first Live IMAP request.

Run the release checks from the monorepo root:

```sh
vp run typecheck
vp fmt --check
vp lint
vp test --run
vp run smoke:web
```

## Docker

The single container serves the production web UI and API on port `3001`. It requires only
`/config/zmail.toml` as a readonly bind mount; it needs no writable mail volume.

```sh
mkdir -p /srv/zmail/config
cp zmail.toml.example /srv/zmail/config/zmail.toml
```

Edit the copied file with the App login and Mail account credentials, then run:

```sh
docker run --name zmail \
  -p 3001:3001 \
  --mount type=bind,src=/srv/zmail/config/zmail.toml,dst=/config/zmail.toml,readonly \
  ghcr.io/txchen/zmail:latest
```

Equivalent `compose.yaml`:

```yaml
services:
  zmail:
    image: ghcr.io/txchen/zmail:latest
    container_name: zmail
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /srv/zmail/config/zmail.toml:/config/zmail.toml:ro
```

To build and smoke-test the same stateless image locally:

```sh
vp run smoke:container
```

The smoke builds the image, mounts a generated config file readonly, starts without Gmail access,
logs in through the production API, verifies the Account selection contract, and confirms that the
container has no writable data mount.

GitHub Actions builds the image on pull requests. Pushes to `master` publish `latest` and a short
SHA tag; version tags publish the corresponding version tag.
