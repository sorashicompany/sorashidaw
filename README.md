# Sorashi DAW

A multiplayer DAW delivered as a Telegram Mini App.

The product model is:

`1 Telegram Chat → 1 Beat Room → all participants equal → everyone can edit everything`

## Current foundation

- Telegram Mini App entry point.
- Server-side verification of Telegram WebApp `initData`.
- No email/password registration.
- Client-supplied Telegram IDs are never trusted as authentication proof.
- Cloudflare Worker as the secure API/authentication boundary.
- Supabase as the persistent application database.
- Client-side Web Audio for audio rendering.
- Shared domain contracts for future real-time collaboration.

The repository is being implemented incrementally as product requirements arrive. Product decisions that have not been specified yet are intentionally left open.

## Layout

```
apps/
  web/        Telegram Mini App
  worker/     Cloudflare Worker API
packages/
  shared/     Shared domain contracts
supabase/
  migrations/ Database migrations
docs/
  architecture/
```

## Secrets

Never commit:

- Telegram Bot token.
- Supabase service-role key.
- Any other production secret.

Telegram authentication uses the signed `Telegram.WebApp.initData` value. `initDataUnsafe` is not an authentication source.

## Cloudflare

The Worker is the server-side boundary for Telegram validation and future room/session APIs. Runtime configuration and deployment configuration will be added as the Cloudflare architecture is finalized.

## Supabase

Use a dedicated Sorashi DAW Supabase project. Do not point this application at an unrelated existing project.

## Development

Install dependencies with pnpm and run the workspace checks:

```bash
pnpm install
pnpm typecheck
```
