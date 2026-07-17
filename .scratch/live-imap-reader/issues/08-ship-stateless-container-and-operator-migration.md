# 08 — Ship the stateless container and operator migration

**What to build:** Finish the live-reader transition as an operator-visible release by removing the container data-volume contract, documenting the new configuration and intentional network behavior, and verifying the same stateless artifact through local and CI paths.

**Blocked by:** 07 — Remove the Local read model and legacy server surfaces.

**Status:** ready-for-agent

- [ ] The container image requires only the read-only App configuration mount and no `/data` volume.
- [ ] The example TOML contains App login, `[reader] read_dwell_seconds`, and configured Gmail accounts without storage or sync settings.
- [ ] README development and Docker instructions describe Account selection, Live IMAP access, browser-memory caching, Manual refresh/retry, and the absence of mail persistence.
- [ ] Operator migration notes state that obsolete storage and sync configuration must be removed.
- [ ] Operator migration notes state that old SQLite files are unused and remain untouched until the operator chooses to delete them.
- [ ] API documentation contains only supported authenticated live-reader endpoints and explicitly lists removed Sync, diagnostics, and AI surfaces.
- [ ] Security documentation covers server-only Gmail app passwords, production Secure App session cookies, remote-image blocking, and User-authorized writes.
- [ ] CI builds the stateless container and runs typecheck, formatting, lint, tests, and the real browser smoke path.
- [ ] A local container smoke verifies App login and Account selection without requiring Gmail access or a writable data volume.
- [ ] The final repository contains no runtime reference to SQLite mail storage, `/data`, background sync, Sync jobs, diagnostics, or AI API.
