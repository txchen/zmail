# Zmail

[![Docker image](https://img.shields.io/badge/ghcr.io-txchen%2Fzmail-blue?logo=github)](https://github.com/txchen/zmail/pkgs/container/zmail)

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

## Docker

GitHub Actions publishes a single-container image to GitHub Container Registry on pushes to
`master` and version tags.

The container serves both the web UI and API on port `3001`. A config file is required; without it
the service cannot start. Use [`zmail.toml.example`](./zmail.toml.example) as the template:

```sh
mkdir -p /srv/zmail/config /srv/zmail/data
cp zmail.toml.example /srv/zmail/config/zmail.toml
```

Edit `/srv/zmail/config/zmail.toml` with the App login and Mail account credentials, and set
`[storage] database_dir = "/data"`. The image defaults to
`ZMAIL_CONFIG_PATH=/config/zmail.toml`.

Mount the config directory and persistent data directory:

```sh
docker run --name zmail \
  -p 3001:3001 \
  -v /srv/zmail/config:/config:ro \
  -v /srv/zmail/data:/data \
  ghcr.io/txchen/zmail:latest
```

Equivalent `docker-compose.yml`:

```yaml
services:
  zmail:
    image: ghcr.io/txchen/zmail:latest
    container_name: zmail
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - /srv/zmail/config:/config:ro
      - /srv/zmail/data:/data
```

The `/config` mount can be read-only. The `/data` mount must be writable because it stores the
SQLite databases.
