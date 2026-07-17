# Publish a container image for home deployment

Zmail publishes a single **Zmail container image** that runs the API server and serves the built web UI from one container. The image is public-safe: **App configuration** and **Mail account credentials** are supplied at runtime through the **Container config mount** at `/config/zmail.toml`; ADR-0011 removed mail persistence, so the container has no data-volume requirement and does not open or delete old SQLite files.

GitHub Actions will build and verify the repository before publishing to GitHub Container Registry. Pushes to `master` publish `latest` and a short SHA tag, version tags publish version tags, and pull requests build without pushing.
