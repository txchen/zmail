# Use Gmail app passwords for Mail account authentication

For the initial private home deployment, Zmail authenticates Mail accounts with user-provided Gmail app passwords instead of Gmail OAuth. This keeps setup simple for a single App user who already controls the Gmail accounts, but it means Mail account credentials must remain server-side and this approach is not intended for a hosted multi-user SaaS product.
