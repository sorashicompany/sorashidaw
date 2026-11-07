-- Sorashi DAW persistence foundation.
-- Telegram identity is verified by the Cloudflare Worker before application access.
-- Room identity is derived from the verified Telegram chat.

create extension if not exists pgcrypto;

create table if not exists public.telegram_users (
  telegram_user_id bigint primary key,
  username text,
  first_name text not null,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beat_rooms (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null unique,
  chat_type text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beat_room_members (
  room_id uuid not null references public.beat_rooms(id) on delete cascade,
  telegram_user_id bigint not null references public.telegram_users(telegram_user_id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (room_id, telegram_user_id)
);

create table if not exists public.beat_projects (
  room_id uuid primary key references public.beat_rooms(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.telegram_users enable row level security;
alter table public.beat_rooms enable row level security;
alter table public.beat_room_members enable row level security;
alter table public.beat_projects enable row level security;

-- Browser access is not granted by these tables directly.
-- The authenticated API/Realtime design will be added after the collaboration
-- protocol is finalized. Service-role credentials must never reach the Mini App.
