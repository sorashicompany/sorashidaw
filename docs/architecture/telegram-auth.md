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

Room permissions are intentionally not split into Owner/Editor/Viewer/Admin roles.
There are no per-track or per-tool permissions.
A participant is either a member of the shared Beat Room or is not a member.
Every authenticated room participant has the same full-edit capability.

This means any participant can create, modify, move, automate, replace, or delete
tracks, MIDI, playlist items, samples, synth settings, effects, mixer settings,
master-chain settings, BPM, and arrangement data.

The collaboration protocol must therefore never derive write authorization from
the identity of the creator of an element. Actor identity is retained for
attribution, presence, and conflict handling, not for permission levels.
