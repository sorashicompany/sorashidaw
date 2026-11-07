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

## Realtime collaboration

Beat Room realtime editing uses a Cloudflare Durable Object per verified Telegram chat.

- Each connected participant keeps a WebSocket to the chat's Beat Room.
- Edits are operation messages, not locks on shared objects.
- Multiple participants can patch the same entity concurrently.
- There is no owner/editor/viewer distinction and no object-busy state.
- Every verified room participant can submit create, patch, and delete operations for any supported entity.
- The Durable Object assigns a monotonically increasing sequence number and broadcasts each accepted operation to every connected participant.
- The client applies remote operations without disabling local controls, so another participant editing the same Piano Roll note, velocity, synth parameter, or mixer value does not block input.
- WebSocket authentication uses a short-lived Worker-signed room ticket derived from verified Telegram WebApp data; raw Telegram initData is not sent to the room WebSocket.
- The Durable Object is the realtime coordination layer. Persistent project snapshots and event history remain a separate concern for Supabase and are intentionally not conflated with live transport.

## Scalability

Beat Rooms are isolated by verified Telegram chat identity. The runtime mapping is:

`Telegram chat → Durable Object instance → isolated realtime channel`

This supports many independent rooms without a global collaboration state. For example, 1000 Telegram chats resolve to 1000 logically independent Beat Rooms. Each room has its own project state, operation sequence/log, connected participants, presence, transport state and R2 asset namespace.

Scaling boundaries:

- Durable Objects provide per-room coordination and serialization. Busy rooms concentrate work in their own instance instead of sharing one global realtime lock.
- Workers remain stateless at the HTTP edge; authentication, room ticket verification and routing can execute across Cloudflare's distributed edge.
- R2 assets are partitioned by verified chat ID, so samples and audio from one room are not mixed with another room's asset namespace.
- Project state and version history are room-scoped rather than held in a process-wide memory structure.
- WebSocket traffic is incremental operations. Presence and cursor traffic is ephemeral and separate from project history.
- Reconnect uses operation sequence numbers, allowing a client to replay only operations after its last acknowledged position.

The architecture therefore scales horizontally across independent rooms at the coordination layer. A single heavily active room remains an intentionally localized realtime workload, while other rooms can operate independently. Global limits such as Cloudflare account quotas, WebSocket capacity, R2 request/storage limits and Supabase connection/database limits remain deployment-level constraints rather than application-level shared-state bottlenecks.

## Security / authorization

The Worker is the only authority for Telegram identity and Beat Room access.

- Telegram.WebApp.initData is verified server-side with the Bot token using the Telegram HMAC data-check algorithm and a freshness window.
- initDataUnsafe is never used for authorization.
- The signed room ticket binds telegramUserId and telegramChatId to the authenticated session and expires after 5 minutes.
- Room APIs and the WebSocket verify the signed ticket before resolving a Durable Object.
- The Durable Object name is derived from the verified Telegram chat ID, not from a frontend-selected room_id.
- A client-supplied chatId is only a consistency check against the signed ticket; it cannot select a different room.
- R2 asset keys are prefixed by the verified Telegram chat ID and are readable only after the same room authorization check.
- Realtime operations are accepted only when roomId and actorId match the verified server-side room connection identity.
- Presence and cursor messages are authenticated by the same room connection but have no project authorization effect.
- There are deliberately no per-user musical permissions inside a Beat Room. Once server-side room access is established, every participant has the same full-edit capability over tracks, notes, samples, mixer, synth, effects, automation, transport and project settings.

Authorization boundary:

Telegram initData → Worker verification → signed room ticket → verified chat ID → Beat Room

Beat Room membership/access = yes/no

Musical object permissions inside an authorized room = unrestricted

## Telegram Bot

The Worker includes a Telegram Bot integration alongside the Mini App.

Supported bot actions:
- `/start`, `/open`, `/beat` — send an **Open Beat Studio** button.
- `/invite` — request a Telegram group invite link when the bot has permission and send it to the chat.
- authenticated Mini App export delivery through `POST /api/bot/export`.
- saved-beat notification through `POST /api/bot/saved`.

The music UI remains inside the Telegram Mini App. The Bot is the entry point, notification and delivery layer; it is not a replacement for the DAW interface.

Required Worker configuration:
- `MINI_APP_URL` — HTTPS URL of the deployed Mini App.
- `BOT_WEBHOOK_SECRET` — optional secret token used to validate Telegram webhook requests.
- `BOT_USERNAME` — optional bot username for future invite/deep-link helpers.

Configure the Telegram webhook to point to `/api/bot/webhook`. The bot token remains a Worker secret and is never exposed to the browser.

For group launch, the preferred flow is:

`Telegram Group → Open Beat Studio → Mini App → verified chat context → Beat Room`

The Bot does not accept a client-supplied Telegram chat ID as authentication. The Mini App continues to use verified Telegram WebApp `initData` and the signed room ticket.

## Architecture

The application is separated into five runtime domains.

### Frontend

`apps/web/` is the Telegram Mini App and DAW shell.

- Telegram Mini App bootstrap and authenticated room entry.
- Playlist / Arrangement.
- Piano Roll.
- Step Sequencer / Drum Machine.
- Mixer.
- Synth.
- Effects and Master Chain.
- Browser / Library.
- Participants and shared Transport.

The UI owns interaction and local presentation. It does not become the authority for Telegram identity or room isolation.

### Audio

The browser owns local audio playback.

- `apps/web/src/audio-engine.ts` — Audio Engine orchestration.
- `apps/web/public/audio-engine-processor.js` — AudioWorklet DSP/runtime.
- `apps/web/src/audio-fx.ts` — Web Audio effects graph.
- MIDI input and MIDI event handling live in the web audio layer.
- `packages/shared/src/synth.ts` and `packages/shared/src/effects.ts` contain shared synth/effect models.

Audio is rendered locally on every participant device. The backend synchronizes musical state and control operations, not the rendered audio stream.

### Realtime

`packages/shared/src/collaboration.ts` defines the collaboration protocol. `apps/web/src/collaboration.ts` is the client transport and `apps/worker/src/room.ts` is the room coordinator.

Current synchronization model:

`WebSocket → Durable Object → ordered operations → broadcast → local project/audio state`

It provides realtime operation ordering, presence, cursors, reconnect replay and shared Transport clocking. The current implementation is operation-based server-authoritative sequencing; it is intentionally not described as a CRDT yet. A CRDT/OT state-transform layer can be introduced behind the same operation boundary if conflict semantics later require it.

### Backend

`apps/worker/` is the trusted server boundary.

- Telegram authentication and `initData` verification.
- Signed room tickets.
- Chat-to-room resolution.
- Durable room coordination.
- Project snapshots and version history.
- R2 asset access.
- Telegram Bot integration and export delivery.

The Durable Object name is derived from the verified Telegram chat ID, establishing the runtime room isolation boundary.

### Database

Supabase is the durable relational application database schema.

- `telegram_users`.
- `telegram_chats`.
- `beat_rooms`.
- `beat_room_members`.
- `beat_projects`.
- `beat_project_versions`.
- `beat_project_metadata`.

The dedicated new `sorashidaw` Supabase project is still a deployment prerequisite; the schema is prepared but must not be pointed at an unrelated existing production project.

### Storage

Cloudflare R2 is the binary asset layer.

- WAV samples.
- Drum Kit assets.
- Audio files.
- Future user/factory presets.
- Wavetables and other binary library assets.

R2 objects are scoped to the verified Telegram chat / Beat Room. Project snapshots store metadata and asset references rather than duplicating large binaries.

### Dependency boundaries

`Telegram → Mini App → Worker auth → Beat Room`

`Mini App → WebSocket → Durable Object → realtime operations`

`Mini App → Web Audio / AudioWorklet → local playback`

`Mini App → Worker → R2 → binary assets`

`Worker / persistence layer → Supabase → durable relational metadata and project records`

No module receives room authority merely because it is a frontend component. Telegram identity is established at the Worker boundary, and room participation is derived from verified chat context.