# Use stateless JWT App sessions

Zmail uses a signed JWT stored in the HttpOnly, SameSite=Lax `zmail_session` cookie for **App sessions**; production cookies are also Secure. The token contains the **App user** username and expiry time, is signed with `app_login.session_secret`, and is accepted by authenticated UI APIs without reading server-side session state.

This keeps **App sessions** valid across API restarts while still giving the operator a simple revocation mechanism: rotating `app_login.session_secret` invalidates previously issued cookies. `app_login.session_ttl_days` controls the JWT's maximum expiry window, defaults to 365 days, and is bounded to 1..3650 days in **App configuration**. Logout clears browser mail state and closes active IMAP sessions.

Amendment: the cookie was originally browser-session-only. It now carries `Max-Age` equal to `app_login.session_ttl_days`, because a home screen web app on iOS drops session cookies whenever the app is closed, which forced a new **App login** on nearly every launch. The JWT expiry still bounds the session, and logout still clears the cookie.
