# Telegram authentication

The Mini App never treats `initDataUnsafe.user.id` as proof of identity.

The browser sends the signed `Telegram.WebApp.initData` string to the Cloudflare Worker. The Worker verifies the signature using the Telegram Bot token and validates the `auth_date` freshness window.

Only verified Telegram identity and verified Telegram chat context are accepted for Beat Room resolution.

The Worker secret `TELEGRAM_BOT_TOKEN` must never be committed to Git.

The implementation intentionally keeps authentication separate from the collaborative event model. The next requirements will define room membership, persistence, realtime transport, and the musical data model.
