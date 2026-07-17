# Use stateless JWT App sessions

Zmail uses a signed JWT stored in the HttpOnly, SameSite=Lax, browser-session-only `zmail_session` cookie for **App sessions**; production cookies are also Secure. The token contains the **App user** username and expiry time, is signed with `app_login.session_secret`, and is accepted by authenticated UI APIs without reading server-side session state.

This keeps **App sessions** valid across API restarts within the browser session while still giving the operator a simple revocation mechanism: rotating `app_login.session_secret` invalidates previously issued cookies. `app_login.session_ttl_days` controls the JWT's maximum expiry window, defaults to 365 days, and is bounded to 1..3650 days in **App configuration**. Logout clears browser mail state and closes active IMAP sessions.
