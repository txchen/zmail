# 08 — Ship the stateless container and operator migration

**What to build:** Finish the live-reader transition as an operator-visible release by removing the container data-volume contract, documenting the new configuration and intentional network behavior, and verifying the same stateless artifact through local and CI paths.

**Blocked by:** 07 — Remove the Local read model and legacy server surfaces.

**Status:** ready-for-human

- [x] The container image requires only the read-only App configuration mount and no `/data` volume.
- [x] The example TOML contains App login, `[reader] read_dwell_seconds`, and configured Gmail accounts without storage or sync settings.
- [x] README development and Docker instructions describe Account selection, Live IMAP access, browser-memory caching, Manual refresh/retry, and the absence of mail persistence.
- [x] Operator migration notes state that obsolete storage and sync configuration must be removed.
- [x] Operator migration notes state that old SQLite files are unused and remain untouched until the operator chooses to delete them.
- [x] API documentation contains only supported authenticated live-reader endpoints and explicitly lists removed Sync, diagnostics, and AI surfaces.
- [x] Security documentation covers server-only Gmail app passwords, production Secure App session cookies, remote-image blocking, and User-authorized writes.
- [x] CI builds the stateless container and runs typecheck, formatting, lint, tests, and the real browser smoke path.
- [ ] A local container smoke verifies App login and Account selection without requiring Gmail access or a writable data volume.
- [x] The final repository contains no runtime reference to SQLite mail storage, `/data`, background sync, Sync jobs, diagnostics, or AI API.

## Comments

- Added a local `smoke:container` command that builds and inspects the production image, mounts only
  `/config/zmail.toml` read-only, and verifies App login and Account selection without opening Gmail.
- Validation passed for typecheck, formatting, lint, 147 non-browser tests, the focused production
  browser smoke, a clean production build, a production server login/Account-selection smoke, and
  a clean runtime artifact scan.
- The local environment has no `docker` executable, so the image build/run could not execute here.
  Implementation is complete, but a human on a Docker host must run `vp run smoke:container`.
  After that command passes, check the remaining acceptance item and change the status to
  `completed`. CI builds once, smokes that exact local image, and only then tags and pushes it.
