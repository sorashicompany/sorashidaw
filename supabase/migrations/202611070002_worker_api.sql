create schema if not exists private;

create table if not exists private.worker_config (
  id boolean primary key default true check (id),
  signing_secret text not null
);

revoke all on schema private from public;
revoke all on private.worker_config from public, anon, authenticated;

create or replace function public.worker_sync_room(
  p_action text,
  p_chat_id bigint,
  p_user_id bigint,
  p_payload jsonb,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_message text;
  v_expected text;
  v_room_id uuid;
  v_state jsonb;
  v_version bigint;
  v_updated_at timestamptz;
  v_history jsonb;
begin
  select signing_secret into v_secret
  from private.worker_config
  where id = true;

  if v_secret is null then
    raise exception 'Worker signing secret is not configured';
  end if;

  v_message := p_action || ':' || p_chat_id::text || ':' || p_user_id::text || ':' || coalesce(p_payload::text, '{}');
  v_expected := encode(public.hmac(v_message::bytea, v_secret::bytea, 'sha256'), 'hex');

  if p_signature is null or not public.secure_compare(v_expected, p_signature) then
    raise exception 'Invalid worker signature';
  end if;

  insert into public.telegram_users (telegram_user_id, first_name)
  values (p_user_id, coalesce(p_payload->>'first_name', 'Telegram user'))
  on conflict (telegram_user_id) do update set
    username = coalesce(p_payload->>'username', public.telegram_users.username),
    first_name = coalesce(p_payload->>'first_name', public.telegram_users.first_name),
    last_name = coalesce(p_payload->>'last_name', public.telegram_users.last_name),
    updated_at = now();

  insert into public.telegram_chats (telegram_chat_id, chat_type, title, username)
  values (p_chat_id, p_payload->>'chat_type', p_payload->>'chat_title', p_payload->>'chat_username')
  on conflict (telegram_chat_id) do update set
    chat_type = coalesce(excluded.chat_type, public.telegram_chats.chat_type),
    title = coalesce(excluded.title, public.telegram_chats.title),
    username = coalesce(excluded.username, public.telegram_chats.username),
    updated_at = now();

  insert into public.beat_rooms (telegram_chat_id, chat_type, title)
  values (p_chat_id, p_payload->>'chat_type', p_payload->>'chat_title')
  on conflict (telegram_chat_id) do update set
    chat_type = coalesce(excluded.chat_type, public.beat_rooms.chat_type),
    title = coalesce(excluded.title, public.beat_rooms.title),
    updated_at = now()
  returning id into v_room_id;

  insert into public.beat_room_members (room_id, telegram_user_id, last_seen_at)
  values (v_room_id, p_user_id, now())
  on conflict (room_id, telegram_user_id) do update set last_seen_at = now();

  if p_action = 'load' then
    select state, version, updated_at into v_state, v_version, v_updated_at
    from public.beat_projects where room_id = v_room_id;

    return jsonb_build_object(
      'roomId', v_room_id,
      'state', coalesce(v_state, null),
      'version', coalesce(v_version, 0),
      'updatedAt', v_updated_at
    );
  elsif p_action = 'save' then
    v_state := p_payload->'state';
    v_version := greatest(
      coalesce((select version from public.beat_projects where room_id = v_room_id), 0) + 1,
      coalesce((p_payload->>'version')::bigint, 0)
    );
    insert into public.beat_projects (room_id, state, version, updated_at)
    values (v_room_id, v_state, v_version, now())
    on conflict (room_id) do update set
      state = excluded.state,
      version = excluded.version,
      updated_at = excluded.updated_at;

    return jsonb_build_object('roomId', v_room_id, 'version', v_version, 'updatedAt', now());
  elsif p_action = 'history' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'version', version,
      'label', label,
      'createdAt', created_at
    ) order by version desc), '[]'::jsonb)
    into v_history
    from public.beat_project_versions
    where room_id = v_room_id;

    return jsonb_build_object('roomId', v_room_id, 'history', v_history);
  elsif p_action = 'version' then
    select state into v_state
    from public.beat_project_versions
    where room_id = v_room_id and version = (p_payload->>'version')::bigint;

    if v_state is null then
      raise exception 'Project version not found';
    end if;

    return jsonb_build_object('roomId', v_room_id, 'version', (p_payload->>'version')::bigint, 'state', v_state);
  elsif p_action = 'save_version' then
    v_state := p_payload->'state';
    v_version := (p_payload->>'version')::bigint;
    insert into public.beat_project_versions (room_id, version, label, state, created_by)
    values (v_room_id, v_version, coalesce(p_payload->>'label', 'Beat v' || v_version::text), v_state, p_user_id)
    on conflict (room_id, version) do update set
      label = excluded.label,
      state = excluded.state,
      created_by = excluded.created_by;
    return jsonb_build_object('roomId', v_room_id, 'version', v_version);
  else
    raise exception 'Unknown worker action';
  end if;
end;
$$;

revoke all on function public.worker_sync_room(text, bigint, bigint, jsonb, text) from public;
grant execute on function public.worker_sync_room(text, bigint, bigint, jsonb, text) to anon;
