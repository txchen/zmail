# Publish a container image for home deployment

Zmail will publish a single **Zmail container image** that runs the API server and serves the built web UI from one container. The image is immutable and public-safe: **App configuration**, **Mail account credentials**, and **Local read model** database files are supplied at runtime through a **Container config mount** and **Container data volume**, with `/config/zmail.toml` and `/data` as the container conventions.

GitHub Actions will build and verify the repository before publishing to GitHub Container Registry. Pushes to `master` publish `latest` and a short SHA tag, version tags publish version tags, and pull requests build without pushing.
