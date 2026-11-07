# Telegram Mini App authentication

The Mini App uses Telegram WebApp authentication as its only initial identity mechanism.

The browser may expose `initDataUnsafe`, but that object is not trusted for authentication.

The browser sends the signed `Telegram.WebApp.initData` string to the Cloudflare Worker.

The Worker:

1. derives the Telegram WebApp secret from the bot token;
2. builds Telegram's data-check string;
3. verifies the HMAC-SHA256 signature;
4. checks `auth_date` freshness;
5. parses the verified Telegram user and chat context;
6. returns an authenticated application context.

The Mini App never authenticates a user from a client-supplied Telegram user ID.

## Room resolution

The verified Telegram chat ID is the room identity input:

`telegram_chat_id -> beat_room`

The database enforces one `beat_room` per Telegram chat with a unique constraint on `telegram_chat_id`.

Room permissions are intentionally not split into Owner/Editor/Viewer roles. Every authenticated participant of the chat has the same editing model.
