# Initial architecture

## Telegram

Telegram Chat is the product entry point. The Mini App receives Telegram WebApp context and sends signed `initData` to the server.

## Cloudflare

Cloudflare Worker is the trusted API boundary. Telegram bot secrets stay server-side.

The Worker will later own:

- Telegram session validation;
- room/session issuance;
- collaboration API boundaries;
- authorization checks against verified Telegram context.

## Supabase

Supabase stores durable application state:

- Telegram users;
- Beat Rooms;
- room membership observations;
- the current project snapshot/version.

High-frequency collaboration transport is intentionally not finalized yet.

## Client audio

Audio is generated and played on the user's device with Web Audio APIs. The server synchronizes musical state rather than streaming rendered audio between participants.

## Collaboration

The application has one shared project per Telegram chat. There are no project-owner permissions inside the Beat Room.

Conflict resolution, event ordering, presence, and transport selection remain open until the remaining requirements are provided.
